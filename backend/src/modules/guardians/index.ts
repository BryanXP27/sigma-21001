import { PoolClient } from "pg";
import { pool } from "../../core/db.js";
import { logAudit } from "../../core/auth.js";
import { NotFoundError, ValidationError } from "../../core/errors.js";

export interface GuardianRow {
  id: string;
  student_id: string;
  name: string;
  doc?: string;
  phone?: string;
  relation?: string;
  email?: string;
  created_at: Date;
}

export interface GuardianWithStudent extends GuardianRow {
  student_name?: string;
  student_section?: string;
}

export async function listGuardians(
  client: PoolClient,
  studentId?: string
): Promise<GuardianWithStudent[]> {
  if (studentId) {
    const result = await client.query(
      `SELECT g.*, s.given_names, s.family_names, e.section_id
         FROM guardians g
         JOIN students s ON s.siagie_code = g.student_id
         LEFT JOIN enrollments e ON e.student_id = g.student_id AND e.status = 'active'
        WHERE g.student_id = $1
        ORDER BY g.name`,
      [studentId]
    );
    return result.rows.map((row) => ({
      ...row,
      student_name: `${row.given_names ?? ""} ${row.family_names ?? ""}`.trim(),
      student_section: row.section_id ?? undefined,
    }));
  }

  const result = await client.query(
    `SELECT g.*, s.given_names, s.family_names
       FROM guardians g
       JOIN students s ON s.siagie_code = g.student_id
       ORDER BY g.name`
  );
  return result.rows.map((row) => ({
    ...row,
    student_name: `${row.given_names ?? ""} ${row.family_names ?? ""}`.trim(),
  }));
}

export async function getGuardian(
  client: PoolClient,
  id: string
): Promise<GuardianRow | null> {
  const result = await client.query(`SELECT * FROM guardians WHERE id = $1`, [id]);
  if (result.rowCount === 0) return null;
  return result.rows[0];
}

export async function createGuardian(
  client: PoolClient,
  data: {
    student_id: string;
    name: string;
    doc?: string;
    phone?: string;
    relation?: string;
    email?: string;
  },
  byUser: string
): Promise<GuardianRow> {
  // Verificar que el estudiante existe
  const studentResult = await client.query(
    `SELECT 1 FROM students WHERE siagie_code = $1`,
    [data.student_id]
  );
  if (studentResult.rowCount === 0) {
    throw new ValidationError("El estudiante especificado no existe.");
  }

  // Verificar máximo 2 apoderados por estudiante
  const countResult = await client.query(
    `SELECT COUNT(*) FROM guardians WHERE student_id = $1`,
    [data.student_id]
  );
  const count = parseInt(countResult.rows[0].count, 10);
  if (count >= 2) {
    throw new ValidationError("El estudiante ya tiene dos apoderados vinculados.");
  }

  // Verificar que el DNI no esté ya vinculado a otro estudiante
  if (data.doc) {
    const dupResult = await client.query(
      `SELECT g.id, g.student_id, s.siagie_code
         FROM guardians g
         JOIN students s ON s.siagie_code = g.student_id
        WHERE g.doc = $1 AND g.student_id <> $2`,
      [data.doc, data.student_id]
    );
    if ((dupResult.rowCount ?? 0) > 0) {
      throw new ValidationError("El DNI ya está vinculado a otro estudiante.");
    }
  }

  const result = await client.query(
    `INSERT INTO guardians (student_id, name, doc, phone, relation, email)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [data.student_id, data.name, data.doc ?? null, data.phone ?? null, data.relation ?? null, data.email ?? null]
  );

  await logAudit(
    client,
    byUser,
    `Se creó el apoderado ${data.name} para el estudiante ${data.student_id}`
  );

  return result.rows[0];
}

export async function updateGuardian(
  client: PoolClient,
  id: string,
  data: {
    name?: string;
    doc?: string;
    phone?: string;
    relation?: string;
    email?: string;
  },
  byUser: string
): Promise<GuardianRow> {
  const existing = await getGuardian(client, id);
  if (!existing) {
    throw new NotFoundError("Apoderado no encontrado.");
  }

  if (data.doc && data.doc !== existing.doc) {
    const dupResult = await client.query(
      `SELECT 1 FROM guardians WHERE doc = $1 AND id <> $2`,
      [data.doc, id]
    );
    if ((dupResult.rowCount ?? 0) > 0) {
      throw new ValidationError("El DNI ya está en uso por otro apoderado.");
    }
  }

  const result = await client.query(
    `UPDATE guardians
       SET name = COALESCE($1, name),
           doc = COALESCE($2, doc),
           phone = COALESCE($3, phone),
           relation = COALESCE($4, relation),
           email = COALESCE($5, email)
     WHERE id = $6
     RETURNING *`,
    [data.name, data.doc, data.phone, data.relation, data.email, id]
  );

  await logAudit(client, byUser, `Se actualizó el apoderado ${id}`);

  return result.rows[0];
}

export async function deleteGuardian(
  client: PoolClient,
  id: string,
  byUser: string
): Promise<void> {
  const existing = await getGuardian(client, id);
  if (!existing) {
    throw new NotFoundError("Apoderado no encontrado.");
  }

  await client.query(`DELETE FROM guardians WHERE id = $1`, [id]);

  await logAudit(client, byUser, `Se eliminó el apoderado ${id}`);
}
