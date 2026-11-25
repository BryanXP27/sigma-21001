import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import type { PoolClient } from "pg";

const require = createRequire(import.meta.url);
import { pool } from "../../core/db.js";
import {
  generateToken,
  hashPassword,
  logAudit,
  type AuthenticatedUser,
} from "../../core/auth.js";
import { AppError, AuthenticationError } from "../../core/errors.js";

const OTP_LIFETIME_MINUTES = 5;
const MAX_OTP_ATTEMPTS = 5;
const SANDBOX_SECRET = "sigma-21001-otp-dev-only";

function hashOtp(challengeId: string, code: string): string {
  const secret = process.env.OTP_SECRET ?? process.env.JWT_SECRET ?? SANDBOX_SECRET;
  return createHmac("sha256", secret).update(`${challengeId}:${code}`).digest("hex");
}

function isSandbox(): boolean {
  return (process.env.SMS_PROVIDER ?? "sandbox") === "sandbox";
}

function previewCode(code: string): string | undefined {
  return isSandbox() && process.env.NODE_ENV !== "production" ? code : undefined;
}

function ensureSmsAvailable(): void {
  const provider = process.env.SMS_PROVIDER ?? "sandbox";
  if (process.env.NODE_ENV === "production" && provider === "sandbox") {
    throw new AppError("El envío SMS de pruebas está deshabilitado en producción.", 503);
  }
}

async function sendSms(to: string, body: string): Promise<void> {
  const provider = process.env.SMS_PROVIDER ?? "sandbox";
  if (provider === "sandbox") {
    if (process.env.NODE_ENV !== "production") {
      // No se envía SMS real en sandbox. Solo registro operativo sin exponer el código.
      console.log("[sigma:sms:sandbox] envío simulado a:", to.replace(/\d(?=\d{4})/g, "*"));
    }
    return;
  }
  if (provider === "twilio") {
    let Twilio: any = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      Twilio = require("twilio");
    } catch {
      // El paquete no está instalado.
    }
    if (!Twilio) {
      throw new AppError(
        "El paquete 'twilio' no está instalado. Ejecuta: npm install twilio",
        503
      );
    }
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM_NUMBER;
    if (!accountSid || !authToken || !from) {
      throw new AppError(
        "Faltan credenciales de Twilio (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER).",
        503
      );
    }
    const client = Twilio(accountSid, authToken);
    await client.messages.create({ body, from, to });
    return;
  }
  throw new AppError(`El proveedor SMS '${provider}' no está soportado.`, 503);
}

function codeMatches(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

function codeFromQr(qr: string): string | null {
  const match = /^SIGMA:E:\d{14}:\d+:([a-f0-9]{48})$/.exec(qr.trim());
  return match?.[1] ?? null;
}

function issueCode(): { id: string; code: string; codeHash: string } {
  const id = randomUUID();
  const code = String(randomInt(100000, 1000000));
  return { id, code, codeHash: hashOtp(id, code) };
}

export async function requestFamilyOtp(
  qr: string,
  dni: string,
  requestIp: string | undefined
): Promise<{ challengeId: string; previewCode?: string }> {
  ensureSmsAvailable();
  const familyQrToken = codeFromQr(qr);
  if (!familyQrToken || !/^\d{8}$/.test(dni)) {
    throw new AuthenticationError("No se pudo verificar la información familiar.");
  }

  const client = await pool.connect();
  try {
    const guardianResult = await client.query(
      `SELECT g.id, g.phone, s.siagie_code AS student_id
         FROM students s
         JOIN guardians g ON g.student_id = s.siagie_code
        WHERE s.family_qr_token = $1
          AND s.active
          AND g.doc = $2
          AND g.phone IS NOT NULL
        LIMIT 1`,
      [familyQrToken, dni]
    );
    if ((guardianResult.rowCount ?? 0) === 0) {
      throw new AuthenticationError("No se pudo verificar la información familiar.");
    }

    const guardian = guardianResult.rows[0] as { id: string; phone: string };
    const rate = await client.query(
      `SELECT count(*)::int AS count
         FROM auth_challenges
        WHERE purpose = 'family' AND guardian_id = $1
          AND created_at > now() - interval '15 minutes'`,
      [guardian.id]
    );
    if (rate.rows[0].count >= 3) {
      throw new AppError("Se alcanzó el límite de códigos. Intenta nuevamente en 15 minutos.", 429);
    }

    const { id, code, codeHash } = issueCode();
    await client.query(
      `INSERT INTO auth_challenges
         (id, purpose, guardian_id, student_id, code_hash, expires_at, request_ip)
       VALUES ($1, 'family', $2, $3, $4,
               now() + ($5::int * interval '1 minute'), $6)`,
      [
        id,
        guardian.id,
        guardianResult.rows[0].student_id,
        codeHash,
        OTP_LIFETIME_MINUTES,
        requestIp ?? null,
      ]
    );

    await sendSms(
      guardian.phone,
      `Código de verificación SIGMA 21001: ${code}. Vence en ${OTP_LIFETIME_MINUTES} minutos. No lo compartas.`
    );

    return { challengeId: id, previewCode: previewCode(code) };
  } finally {
    client.release();
  }
}

export async function verifyFamilyOtp(
  challengeId: string,
  code: string
): Promise<{ token: string; user: AuthenticatedUser }> {
  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query("BEGIN");
    inTransaction = true;
    const result = await client.query(
      `SELECT c.id, c.code_hash, c.expires_at, c.attempts,
              g.id AS guardian_id, g.user_id, g.doc, g.phone, g.name,
              s.siagie_code
         FROM auth_challenges c
         JOIN guardians g ON g.id = c.guardian_id
         JOIN students s ON s.siagie_code = c.student_id
        WHERE c.id = $1 AND c.purpose = 'family'
          AND c.consumed_at IS NULL
          AND c.expires_at > now()
          AND c.attempts < $2
          AND s.active
        FOR UPDATE OF c`,
      [challengeId, MAX_OTP_ATTEMPTS]
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new AuthenticationError("El código no es válido o ha vencido.");
    }

    const challenge = result.rows[0];
    if (!codeMatches(challenge.code_hash, hashOtp(challengeId, code))) {
      await client.query(
        `UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = $1`,
        [challengeId]
      );
      await client.query("COMMIT");
      inTransaction = false;
      throw new AuthenticationError("El código no es válido o ha vencido.");
    }

    let userId = challenge.user_id as string | null;
    let username = "";
    let fullName = challenge.name as string;
    let tokenVersion = 0;
    if (userId) {
      const existing = await client.query(
        `SELECT id, username, full_name, role, active, token_version, phone
           FROM users WHERE id = $1 FOR UPDATE`,
        [userId]
      );
      const user = existing.rows[0];
      if (!user || !user.active || user.role !== "apoderado") {
        throw new AuthenticationError("La cuenta familiar no está disponible.");
      }
      username = user.username;
      fullName = user.full_name;
      tokenVersion = Number(user.token_version ?? 0);
    } else {
      username = `familia_${randomUUID().replaceAll("-", "")}`;
      const randomPassword = randomUUID() + randomUUID();
      const passwordHash = await hashPassword(randomPassword);
      const created = await client.query(
        `INSERT INTO users (username, password_hash, full_name, role, active, phone)
         VALUES ($1, $2, $3, 'apoderado', true, $4)
         RETURNING id, token_version`,
        [username, passwordHash, fullName, challenge.phone]
      );
      userId = created.rows[0].id;
      tokenVersion = Number(created.rows[0].token_version ?? 0);
    }

    if (!userId) {
      throw new AppError("No se pudo crear la cuenta familiar.", 500);
    }

    await client.query(
      `UPDATE guardians
          SET user_id = $1
        WHERE doc = $2 AND phone = $3
          AND (user_id IS NULL OR user_id = $1)`,
      [userId, challenge.doc, challenge.phone]
    );
    await client.query(
      `UPDATE auth_challenges SET consumed_at = now() WHERE id = $1`,
      [challengeId]
    );
    await logAudit(client, username, "Se verificó el acceso al portal familiar por OTP.");
    await client.query("COMMIT");
    inTransaction = false;

    const user: AuthenticatedUser = {
      id: userId,
      username,
      fullName,
      role: "apoderado",
      active: true,
      tokenVersion,
      phone: challenge.phone,
    };
    return {
      token: generateToken({
        userId,
        username,
        role: "apoderado",
        tokenVersion,
      }),
      user,
    };
  } catch (error) {
    if (inTransaction) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function requestPasswordReset(
  username: string,
  phone: string,
  requestIp: string | undefined
): Promise<{ challengeId: string; message: string; previewCode?: string }> {
  ensureSmsAvailable();
  const client = await pool.connect();
  try {
    const userResult = await client.query(
      `SELECT id, phone FROM users
        WHERE username = $1 AND active AND phone = $2`,
      [username, phone]
    );
    const userId = userResult.rows[0]?.id as string | undefined;
    const userPhone = userResult.rows[0]?.phone as string | undefined;
    const rate = await client.query(
      `SELECT count(*)::int AS count
         FROM auth_challenges
        WHERE purpose = 'password_reset' AND request_ip = $1::inet
          AND created_at > now() - interval '15 minutes'`,
      [requestIp ?? null]
    );
    if (rate.rows[0].count >= 5) {
      throw new AppError("Se alcanzó el límite de solicitudes. Intenta más tarde.", 429);
    }

    const { id, code, codeHash } = issueCode();
    await client.query(
      `INSERT INTO auth_challenges
         (id, purpose, user_id, code_hash, expires_at, request_ip)
       VALUES ($1, 'password_reset', $2, $3,
               now() + ($4::int * interval '1 minute'), $5)`,
      [id, userId ?? null, codeHash, OTP_LIFETIME_MINUTES, requestIp ?? null]
    );

    if (userPhone) {
      await sendSms(
        userPhone,
        `Código de recuperación SIGMA 21001: ${code}. Vence en ${OTP_LIFETIME_MINUTES} minutos. No lo compartas.`
      );
    }

    return {
      challengeId: id,
      message: "Si el usuario y el teléfono coinciden, se enviará un código de recuperación.",
      previewCode: userId ? previewCode(code) : undefined,
    };
  } finally {
    client.release();
  }
}

export async function resetPasswordWithOtp(
  challengeId: string,
  code: string,
  newPassword: string
): Promise<void> {
  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query("BEGIN");
    inTransaction = true;
    const result = await client.query(
      `SELECT id, user_id, code_hash
         FROM auth_challenges
        WHERE id = $1 AND purpose = 'password_reset'
          AND user_id IS NOT NULL AND consumed_at IS NULL
          AND expires_at > now() AND attempts < $2
        FOR UPDATE`,
      [challengeId, MAX_OTP_ATTEMPTS]
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new AuthenticationError("El código no es válido o ha vencido.");
    }
    if (!codeMatches(result.rows[0].code_hash, hashOtp(challengeId, code))) {
      await client.query(
        `UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = $1`,
        [challengeId]
      );
      await client.query("COMMIT");
      inTransaction = false;
      throw new AuthenticationError("El código no es válido o ha vencido.");
    }

    const passwordHash = await hashPassword(newPassword);
    await client.query(
      `UPDATE users
          SET password_hash = $1, token_version = token_version + 1
        WHERE id = $2 AND active`,
      [passwordHash, result.rows[0].user_id]
    );
    await client.query(
      `UPDATE auth_challenges SET consumed_at = now() WHERE id = $1`,
      [challengeId]
    );
    await logAudit(client, String(result.rows[0].user_id), "Se restableció una contraseña mediante OTP.");
    await client.query("COMMIT");
    inTransaction = false;
  } catch (error) {
    if (inTransaction) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
