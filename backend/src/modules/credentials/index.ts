import { PoolClient } from "pg";
import { randomBytes } from "node:crypto";
import { pool } from "../../core/db.js";
import { logAudit } from "../../core/auth.js";
import { NotFoundError } from "../../core/errors.js";

export interface CredentialRow {
  id: string;
  name: string;
  type: "students" | "staff";
  section?: string;
  role?: string;
  qr: number;
  active: boolean;
  family_qr_token?: string;
}

export async function listCredentials(
  client: PoolClient,
  type: "students" | "staff",
  activeOnly = true
): Promise<CredentialRow[]> {
  if (type === "students") {
    let query = `
      SELECT s.siagie_code AS id, s.given_names, s.family_names, s.qr, s.active,
             s.family_qr_token,
             e.section_id
      FROM students s
      LEFT JOIN enrollments e ON e.student_id = s.siagie_code AND e.status = 'active'
    `;
    const params: any[] = [];
    const conditions: string[] = [];
    if (activeOnly) {
      conditions.push(`s.active = true`);
    }
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }
    query += ` ORDER BY s.family_names, s.given_names`;
    const result = await client.query(query, params);
    return result.rows.map((r) => ({
      id: r.id,
      name: `${r.given_names} ${r.family_names}`,
      type: "students",
      section: r.section_id,
      qr: r.qr,
      active: r.active,
      family_qr_token: r.family_qr_token,
    }));
  } else {
    let query = `SELECT * FROM personnel`;
    const params: any[] = [];
    const conditions: string[] = [];
    if (activeOnly) {
      conditions.push(`active = true`);
    }
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }
    query += ` ORDER BY name`;
    const result = await client.query(query, params);
    return result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: "staff",
      role: r.role,
      qr: r.qr,
      active: r.active,
    }));
  }
}

export async function getCredential(
  client: PoolClient,
  type: "students" | "staff",
  id: string
): Promise<CredentialRow | null> {
  if (type === "students") {
    const result = await client.query(
      `SELECT s.siagie_code AS id, s.given_names, s.family_names, s.qr, s.active,
              s.family_qr_token,
              e.section_id
       FROM students s
       LEFT JOIN enrollments e ON e.student_id = s.siagie_code AND e.status = 'active'
       WHERE s.siagie_code = $1`,
      [id]
    );
    if (result.rowCount === 0) return null;
    const r = result.rows[0];
    return {
      id: r.id,
      name: `${r.given_names} ${r.family_names}`,
      type: "students",
      section: r.section_id,
      qr: r.qr,
      active: r.active,
      family_qr_token: r.family_qr_token,
    };
  } else {
    const result = await client.query(`SELECT * FROM personnel WHERE id = $1`, [id]);
    if (result.rowCount === 0) return null;
    const r = result.rows[0];
    return {
      id: r.id,
      name: r.name,
      type: "staff",
      role: r.role,
      qr: r.qr,
      active: r.active,
    };
  }
}

export async function reissueQr(
  client: PoolClient,
  type: "students" | "staff",
  id: string,
  byUser: string
): Promise<{ id: string; qr: number; name: string; familyQrToken?: string }> {
  let existing;
  if (type === "students") {
    const result = await client.query(
      `SELECT siagie_code AS id, given_names, family_names, qr, family_qr_token
         FROM students WHERE siagie_code = $1`,
      [id]
    );
    if (result.rowCount === 0) {
      throw new NotFoundError("Estudiante no encontrado.");
    }
    existing = result.rows[0];
  } else {
    const result = await client.query(
      `SELECT id, name, qr FROM personnel WHERE id = $1`,
      [id]
    );
    if (result.rowCount === 0) {
      throw new NotFoundError("Personal no encontrado.");
    }
    existing = result.rows[0];
  }

  const newQr = (existing.qr ?? 0) + 1;
  const familyQrToken = type === "students"
    ? randomBytes(24).toString("hex")
    : undefined;

  if (type === "students") {
    await client.query(
      `UPDATE students SET qr = $1, family_qr_token = $2 WHERE siagie_code = $3`,
      [newQr, familyQrToken, id]
    );
  } else {
    await client.query(
      `UPDATE personnel SET qr = $1 WHERE id = $2`,
      [newQr, id]
    );
  }

  await logAudit(
    client,
    byUser,
    `Se reemitió el carné QR de ${existing.name ?? existing.given_names} (${id})`
  );

  return {
    id,
    qr: newQr,
    name: existing.name ?? `${existing.given_names} ${existing.family_names}`,
    ...(familyQrToken ? { familyQrToken } : {}),
  };
}
