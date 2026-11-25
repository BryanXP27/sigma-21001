import { PoolClient } from "pg";
import { pool } from "../../core/db.js";
import { hashPassword } from "../../core/auth.js";
import { logAudit } from "../../core/auth.js";
import { NotFoundError, ValidationError } from "../../core/errors.js";

export interface UserRow {
  id: string;
  username: string;
  full_name: string;
  role: string;
  active: boolean;
  created_at: Date;
  phone: string | null;
}

export async function listUsers(client: PoolClient): Promise<UserRow[]> {
  const result = await client.query(
    `SELECT id, username, full_name, role, active, created_at, phone
       FROM users
      ORDER BY username`
  );
  return result.rows;
}

export async function getUser(client: PoolClient, id: string): Promise<UserRow | null> {
  const result = await client.query(
    `SELECT id, username, full_name, role, active, created_at, phone
       FROM users
      WHERE id = $1`,
    [id]
  );
  if (result.rowCount === 0) return null;
  return result.rows[0];
}

export async function createUser(
  client: PoolClient,
  data: {
    username: string;
    password: string;
    full_name: string;
    role: string;
    active?: boolean;
    phone?: string;
  },
  byUser: string
): Promise<UserRow> {
  // Verificar que el username no exista
  const existing = await client.query(
    `SELECT 1 FROM users WHERE username = $1`,
    [data.username]
  );
  if ((existing.rowCount ?? 0) > 0) {
    throw new ValidationError("El usuario ya existe.");
  }

  const passwordHash = await hashPassword(data.password);

  const result = await client.query(
    `INSERT INTO users (username, password_hash, full_name, role, active, phone)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, username, full_name, role, active, created_at, phone`,
    [data.username, passwordHash, data.full_name, data.role, data.active ?? true, data.phone ?? null]
  );

  await logAudit(
    client,
    byUser,
    `Se creó el usuario ${data.username} (${data.role})`
  );

  return result.rows[0];
}

export async function updateUser(
  client: PoolClient,
  id: string,
  data: {
    full_name?: string;
    role?: string;
    active?: boolean;
    password?: string;
    phone?: string | null;
  },
  byUser: string
): Promise<UserRow> {
  const existing = await getUser(client, id);
  if (!existing) {
    throw new NotFoundError("Usuario no encontrado.");
  }

  const updateParts: string[] = [];
  const values: any[] = [];
  let paramIdx = 1;

  if (data.full_name !== undefined) {
    updateParts.push(`full_name = $${paramIdx++}`);
    values.push(data.full_name);
  }
  if (data.role !== undefined) {
    updateParts.push(`role = $${paramIdx++}`);
    values.push(data.role);
  }
  if (data.active !== undefined) {
    updateParts.push(`active = $${paramIdx++}`);
    values.push(data.active);
  }
  if (data.phone !== undefined) {
    updateParts.push(`phone = $${paramIdx++}`);
    values.push(data.phone);
  }
  if (data.password !== undefined) {
    const passwordHash = await hashPassword(data.password);
    updateParts.push(`password_hash = $${paramIdx++}`);
    values.push(passwordHash);
  }

  if (updateParts.length === 0) {
    throw new ValidationError("No hay campos para actualizar.");
  }
  if (
    data.password !== undefined ||
    data.role !== undefined ||
    data.active !== undefined
  ) {
    updateParts.push("token_version = token_version + 1");
  }

  values.push(id);
  const result = await client.query(
    `UPDATE users
       SET ${updateParts.join(", ")}
     WHERE id = $${paramIdx}
     RETURNING id, username, full_name, role, active, created_at, phone`,
    values
  );

  await logAudit(client, byUser, `Se actualizó el usuario ${existing.username}`);

  return result.rows[0];
}

export async function deleteUser(
  client: PoolClient,
  id: string,
  byUser: string
): Promise<void> {
  const existing = await getUser(client, id);
  if (!existing) {
    throw new NotFoundError("Usuario no encontrado.");
  }

  if (existing.username === byUser) {
    throw new ValidationError("No puedes eliminar tu propio usuario.");
  }

  await client.query(`DELETE FROM users WHERE id = $1`, [id]);

  await logAudit(client, byUser, `Se eliminó el usuario ${existing.username}`);
}
