import { PoolClient } from "pg";
import { pool } from "../../core/db.js";
import { logAudit } from "../../core/auth.js";
import { NotFoundError } from "../../core/errors.js";

export interface ConfigRow {
  key: string;
  value: string;
  updated_at: Date;
}

export async function listConfig(client: PoolClient): Promise<ConfigRow[]> {
  const result = await client.query(
    `SELECT * FROM system_config ORDER BY key`
  );
  return result.rows;
}

export async function getConfig(
  client: PoolClient,
  key: string
): Promise<string | null> {
  const result = await client.query(
    `SELECT value FROM system_config WHERE key = $1`,
    [key]
  );
  if (result.rowCount === 0) return null;
  return result.rows[0].value;
}

export async function updateConfig(
  client: PoolClient,
  updates: Record<string, string>,
  byUser: string
): Promise<ConfigRow[]> {
  const updated: ConfigRow[] = [];

  for (const [key, value] of Object.entries(updates)) {
    const existing = await getConfig(client, key);
    if (!existing) {
      throw new NotFoundError(`La configuración "${key}" no existe.`);
    }

    await client.query(
      `UPDATE system_config SET value = $1, updated_at = now() WHERE key = $2`,
      [value, key]
    );

    const result = await client.query(
      `SELECT * FROM system_config WHERE key = $1`,
      [key]
    );
    updated.push(result.rows[0]);

    await logAudit(
      client,
      byUser,
      `Se cambió el parámetro "${key}" a "${value}"`
    );
  }

  return updated;
}

export async function resetConfig(client: PoolClient, byUser: string): Promise<void> {
  const defaults = [
    ["window", "rolling"],
    ["days", "7"],
    ["threshold", "3"],
    ["notify", "review"],
    ["cutAM", "09:00"],
    ["cutPM", "14:00"],
    ["attendanceMode", "staff-separate"],
    ["maxQueue", "200"],
    ["futDays", "7"],
  ];

  for (const [key, value] of defaults) {
    await client.query(
      `UPDATE system_config SET value = $1, updated_at = now() WHERE key = $2`,
      [value, key]
    );
    await logAudit(client, byUser, `Se restableció el parámetro "${key}" a "${value}"`);
  }
}
