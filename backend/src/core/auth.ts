import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const { compare, hash } = bcrypt;
const { sign: jwtSign, verify: jwtVerify } = jwt;
type JwtPayload = jwt.JwtPayload;
type SignOptions = jwt.SignOptions;
import { PoolClient } from "pg";
import { pool } from "../db.js";
import { AuthenticationError, AuthorizationError, AppError } from "./errors.js";

const DEVELOPMENT_JWT_SECRET = "sigma-21001-dev-secret-change-in-production";
const JWT_SECRET: string =
  process.env.JWT_SECRET ??
  (process.env.NODE_ENV === "production"
    ? ""
    : DEVELOPMENT_JWT_SECRET);
const JWT_EXPIRES_IN: string | number = process.env.JWT_EXPIRES_IN ?? "8h";
export const STAFF_ROLES = [
  "direccion",
  "subdireccion",
  "pip",
  "oficina",
  "docente",
  "auxiliar",
] as const;

export function validateAuthConfiguration(): void {
  if (process.env.NODE_ENV === "production" && JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET debe configurarse con al menos 32 caracteres en producción.");
  }
  if (process.env.NODE_ENV !== "production" && !process.env.JWT_SECRET) {
    console.warn("JWT_SECRET no está configurado; se usa una clave solo para desarrollo.");
  }
  if (
    process.env.NODE_ENV === "production" &&
    (process.env.SMS_PROVIDER ?? "sandbox") === "sandbox"
  ) {
    throw new Error("SMS_PROVIDER no puede ser sandbox en producción.");
  }
}

export interface TokenPayload {
  userId: string;
  username: string;
  role: string;
  tokenVersion?: number;
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, 10);
}

export async function verifyPassword(password: string, hashed: string): Promise<boolean> {
  return compare(password, hashed);
}

export function generateToken(payload: TokenPayload): string {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET no está configurado.");
  }
  return jwtSign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as SignOptions);
}

export function verifyToken(token: string): TokenPayload {
  if (!JWT_SECRET) {
    throw new AuthenticationError("Autenticación no configurada.");
  }
  try {
    const decoded = jwtVerify(token, JWT_SECRET) as JwtPayload & TokenPayload;
    return {
      userId: decoded.userId,
      username: decoded.username,
      role: decoded.role,
      tokenVersion: Number.isInteger(decoded.tokenVersion) ? decoded.tokenVersion : 0,
    };
  } catch {
    throw new AuthenticationError("Token inválido o expirado");
  }
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  fullName: string;
  role: string;
  active: boolean;
  tokenVersion: number;
  phone?: string | null;
}

export async function authenticateUser(username: string, password: string): Promise<AuthenticatedUser> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, username, password_hash, full_name, role, active, token_version
         FROM users
        WHERE username = $1`,
      [username]
    );

    if (result.rowCount === 0) {
      throw new AuthenticationError("Usuario o contraseña incorrectos.");
    }

    const user = result.rows[0];

    if (!user.active) {
      throw new AuthenticationError("Tu cuenta está desactivada. Contacta a Dirección.");
    }

    const passwordValid = await verifyPassword(password, user.password_hash);
    if (!passwordValid) {
      throw new AuthenticationError("Usuario o contraseña incorrectos.");
    }

    return {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
      active: user.active,
      tokenVersion: Number(user.token_version ?? 0),
    };
  } finally {
    client.release();
  }
}

export const ROLE_HIERARCHY: Record<string, string[]> = {
  direccion: ["direccion", "subdireccion", "pip", "oficina", "docente", "auxiliar", "apoderado"],
  subdireccion: ["subdireccion", "pip", "oficina", "docente", "auxiliar", "apoderado"],
  pip: ["pip", "oficina", "docente", "auxiliar", "apoderado"],
  oficina: ["oficina", "docente", "auxiliar", "apoderado"],
  docente: ["docente", "auxiliar"],
  auxiliar: ["auxiliar"],
  apoderado: ["apoderado"],
};

export function canAccess(role: string, requiredRoles: string[]): boolean {
  return requiredRoles.includes(role);
}

/**
 * Docentes y auxiliares trabajan únicamente con la sección asignada 3A.
 * El resto de perfiles puede elegir libremente.
 */
export function resolveSectionForRole(
  role: string | undefined,
  requestedSectionId: string | undefined
): string | undefined {
  if (role === "docente" || role === "auxiliar") return "3A";
  return requestedSectionId;
}

export async function isStudentInSectionOnDate(
  client: PoolClient,
  studentId: string,
  sectionId: string,
  date: string
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1
       FROM enrollments
      WHERE student_id = $1 AND section_id = $2
        AND starts_on <= $3::date
        AND (ends_on IS NULL OR ends_on > $3::date)
      LIMIT 1`,
    [studentId, sectionId, date]
  );
  return (result.rowCount ?? 0) > 0;
}

export function requireAuth(requiredRoles: string[] = [...STAFF_ROLES]) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const original = descriptor.value;
    descriptor.value = async function (this: any, ...args: any[]) {
      const req = args[0];
      const res = args[1];

      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        res.status(401).json({ error: "Token de autenticación requerido." });
        return;
      }

      const token = authHeader.slice(7);
      let payload: TokenPayload;
      try {
        payload = verifyToken(token);
      } catch {
        res.status(401).json({ error: "Token inválido o expirado." });
        return;
      }

      if (!canAccess(payload.role, requiredRoles)) {
        res.status(403).json({ error: "No tienes permiso para acceder a este recurso." });
        return;
      }

      (req as any).user = payload;
      return original.apply(this, args);
    };
    return descriptor;
  };
}

export function authMiddleware(requiredRoles: string[] = [...STAFF_ROLES]) {
  return async (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Token de autenticación requerido." });
      return;
    }

    const token = authHeader.slice(7);
    try {
      const payload = verifyToken(token);
      const currentUser = await getUserById(payload.userId);
      if (!currentUser?.active) {
        res.status(401).json({ error: "La cuenta ya no está activa." });
        return;
      }
      if (payload.tokenVersion !== currentUser.tokenVersion) {
        res.status(401).json({ error: "La sesión fue revocada. Inicia sesión nuevamente." });
        return;
      }
      if (!canAccess(currentUser.role, requiredRoles)) {
        res.status(403).json({ error: "No tienes permiso para acceder a este recurso." });
        return;
      }
      req.user = {
        userId: currentUser.id,
        username: currentUser.username,
        role: currentUser.role,
      };
      next();
    } catch (error) {
      if (error instanceof AuthenticationError) {
        res.status(401).json({ error: "Token inválido o expirado." });
        return;
      }
      next(error);
    }
  };
}

export async function getUserById(userId: string): Promise<AuthenticatedUser | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, username, full_name, role, active, token_version, phone
         FROM users
        WHERE id = $1`,
      [userId]
    );
    if (result.rowCount === 0) return null;
    const u = result.rows[0];
    return {
      id: u.id,
      username: u.username,
      fullName: u.full_name,
      role: u.role,
      active: u.active,
      tokenVersion: Number(u.token_version ?? 0),
      phone: u.phone,
    };
  } finally {
    client.release();
  }
}

export async function logAudit(
  client: PoolClient,
  byUser: string,
  event: string
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (by_user, event) VALUES ($1, $2)`,
    [byUser, event]
  );
}
