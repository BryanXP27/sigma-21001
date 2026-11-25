import { Router } from "express";
import { z } from "zod";
import {
  authenticateUser,
  generateToken,
  getUserById,
  logAudit,
} from "../core/auth.js";
import { pool } from "../db.js";
import {
  requestFamilyOtp,
  requestPasswordReset,
  resetPasswordWithOtp,
  verifyFamilyOtp,
} from "../modules/auth-challenges/index.js";
import { AppError } from "../core/errors.js";

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1, "El usuario es requerido."),
  password: z.string().min(1, "La contraseña es requerida."),
});

function sendAuthError(res: any, error: unknown): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  throw error;
}

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Usuario y contraseña son requeridos." });
    return;
  }

  const { username, password } = parsed.data;

  try {
    const user = await authenticateUser(username, password);
    const token = generateToken({
      userId: user.id,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });

    const client = await pool.connect();
    try {
      await logAudit(
        client,
        user.username,
        `Inicio de sesión: ${user.fullName} (${user.role})`
      );
    } finally {
      client.release();
    }

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        active: user.active,
        tokenVersion: user.tokenVersion,
      },
    });
  } catch (error: any) {
    res.status(error.statusCode ?? 500).json({ error: error.message });
  }
});

router.post("/family/request-code", async (req: any, res) => {
  const parsed = z.object({
    qr: z.string().min(1).max(256),
    dni: z.string().regex(/^\d{8}$/),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Escanea el carné e ingresa el DNI de 8 dígitos." });
    return;
  }
  try {
    res.json(await requestFamilyOtp(parsed.data.qr, parsed.data.dni, req.ip));
  } catch (error) {
    sendAuthError(res, error);
  }
});

router.post("/family/verify-code", async (req, res) => {
  const parsed = z.object({
    challengeId: z.string().uuid(),
    code: z.string().regex(/^\d{6}$/),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "El código debe tener 6 dígitos." });
    return;
  }
  try {
    res.json(await verifyFamilyOtp(parsed.data.challengeId, parsed.data.code));
  } catch (error) {
    sendAuthError(res, error);
  }
});

router.post("/password-reset/request", async (req: any, res) => {
  const parsed = z.object({
    username: z.string().min(1).max(100),
    phone: z.string().regex(/^9\d{8}$/),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ingresa el usuario y el celular registrado de 9 dígitos." });
    return;
  }
  try {
    res.json(await requestPasswordReset(parsed.data.username, parsed.data.phone, req.ip));
  } catch (error) {
    sendAuthError(res, error);
  }
});

router.post("/password-reset/verify", async (req, res) => {
  const parsed = z.object({
    challengeId: z.string().uuid(),
    code: z.string().regex(/^\d{6}$/),
    newPassword: z.string().min(10).max(128),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Verifica el código y usa una contraseña de al menos 10 caracteres." });
    return;
  }
  try {
    await resetPasswordWithOtp(
      parsed.data.challengeId,
      parsed.data.code,
      parsed.data.newPassword
    );
    res.json({ message: "La contraseña se restableció. Inicia sesión con la nueva contraseña." });
  } catch (error) {
    sendAuthError(res, error);
  }
});

router.post("/logout", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const client = await pool.connect();
    try {
      await logAudit(
        client,
        "system",
        `Cierre de sesión (token: ${token.slice(0, 8)}...)`
      );
    } finally {
      client.release();
    }
  }
  res.json({ message: "Sesión cerrada." });
});

router.get("/me", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Token requerido." });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const { verifyToken } = await import("../core/auth.js");
    const payload = verifyToken(token);
    const user = await getUserById(payload.userId);
    if (
      !user ||
      !user.active ||
      payload.tokenVersion !== user.tokenVersion
    ) {
      res.status(401).json({ error: "El usuario ya no está activo." });
      return;
    }
    res.json({
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        active: user.active,
      },
    });
  } catch {
    res.status(401).json({ error: "Token inválido o expirado." });
  }
});

export default router;
