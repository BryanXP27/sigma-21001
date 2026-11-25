import { PoolClient } from "pg";
import { pool } from "../../core/db.js";

export interface AuditRow {
  id: string;
  at: Date;
  by_user: string;
  event: string;
}

export async function listAudit(
  client: PoolClient,
  limit = 100,
  offset = 0,
  search?: string
): Promise<AuditRow[]> {
  let query = `SELECT * FROM audit_log`;
  const params: any[] = [];
  const conditions: string[] = [];

  if (search) {
    conditions.push(`(by_user ILIKE $${params.length + 1} OR event ILIKE $${params.length + 2})`);
    params.push(`%${search}%`, `%${search}%`);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }

  query += ` ORDER BY at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await client.query(query, params);
  return result.rows;
}

export async function countAudit(
  client: PoolClient,
  search?: string
): Promise<number> {
  let query = `SELECT COUNT(*) FROM audit_log`;
  const params: any[] = [];
  const conditions: string[] = [];

  if (search) {
    conditions.push(`(by_user ILIKE $${params.length + 1} OR event ILIKE $${params.length + 2})`);
    params.push(`%${search}%`, `%${search}%`);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }

  const result = await client.query(query, params);
  return parseInt(result.rows[0].count, 10);
}

export async function exportAudit(client: PoolClient): Promise<AuditRow[]> {
  const result = await client.query(
    `SELECT * FROM audit_log ORDER BY at DESC`
  );
  return result.rows;
}
