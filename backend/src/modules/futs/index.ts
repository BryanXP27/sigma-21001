import { PoolClient } from "pg";
import { pool } from "../../core/db.js";
import { logAudit } from "../../core/auth.js";
import { NotFoundError, ValidationError } from "../../core/errors.js";

export interface FutRow {
  id: string;
  student_id: string;
  fut_date: Date;
  ref: string;
  reason: string;
  status: "Pendiente" | "Aprobada" | "Rechazada";
  created_at: Date;
}

export interface FutWithStudent extends FutRow {
  student_name?: string;
  student_section?: string;
}

export async function listFuts(
  client: PoolClient,
  studentId?: string,
  status?: string,
  sectionId?: string
): Promise<FutWithStudent[]> {
  let query = `
    SELECT f.*, s.given_names, s.family_names
      FROM futs f
      JOIN students s ON s.siagie_code = f.student_id
  `;
  const params: any[] = [];
  const conditions: string[] = [];

  if (studentId) {
    conditions.push(`f.student_id = $${params.length + 1}`);
    params.push(studentId);
  }
  if (status) {
    conditions.push(`f.status = $${params.length + 1}`);
    params.push(status);
  }
  if (sectionId) {
    conditions.push(
      `EXISTS (
         SELECT 1 FROM enrollments e
          WHERE e.student_id = f.student_id
            AND e.section_id = $${params.length + 1}
            AND e.starts_on <= f.fut_date
            AND (e.ends_on IS NULL OR e.ends_on > f.fut_date)
       )`
    );
    params.push(sectionId);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }

  query += ` ORDER BY f.created_at DESC`;

  const result = await client.query(query, params);
  return result.rows.map((row) => ({
    ...row,
    student_name: `${row.given_names ?? ""} ${row.family_names ?? ""}`.trim(),
  }));
}

export async function getFut(
  client: PoolClient,
  id: string
): Promise<FutRow | null> {
  const result = await client.query(`SELECT * FROM futs WHERE id = $1`, [id]);
  if (result.rowCount === 0) return null;
  return result.rows[0];
}

export async function createFut(
  client: PoolClient,
  data: {
    student_id: string;
    fut_date: string;
    ref: string;
    reason: string;
    status?: "Pendiente" | "Aprobada" | "Rechazada";
  },
  byUser: string
): Promise<FutRow> {
  // Verificar que el estudiante existe
  const studentResult = await client.query(
    `SELECT 1 FROM students WHERE siagie_code = $1`,
    [data.student_id]
  );
  if (studentResult.rowCount === 0) {
    throw new ValidationError("El estudiante especificado no existe.");
  }

  // Plazo máximo en días lectivos, configurable en system_config.
  const configResult = await client.query(
    `SELECT value FROM system_config WHERE key = 'futDays'`
  );
  const futDays = parseInt(configResult.rows[0]?.value ?? "7", 10);
  if (Number.isFinite(futDays)) {
    const elapsed = await client.query(
      `WITH days AS (
         SELECT generate_series($1::date, current_date, '1 day'::interval)::date AS d
       )
       SELECT count(*)::int AS n
         FROM days
        WHERE EXTRACT(ISODOW FROM d) < 6
          AND NOT EXISTS (
            SELECT 1 FROM school_calendar sc
             WHERE sc.school_date = d AND sc.lective = false
          )`,
      [data.fut_date]
    );
    if ((elapsed.rows[0]?.n ?? 0) > futDays) {
      throw new ValidationError(
        `El plazo para presentar el FUT es de ${futDays} días lectivos.`
      );
    }
  }

  // Verificar que haya una falta injustificada registrada para esa fecha
  const attendanceResult = await client.query(
    `SELECT sa.status FROM student_attendance sa
     JOIN attendance_sessions ats ON ats.id = sa.session_id
     WHERE sa.student_id = $1
       AND sa.recorded_at::date = $2::date
       AND ats.school_date = $2::date
     LIMIT 1`,
    [data.student_id, data.fut_date]
  );
  if ((attendanceResult.rowCount ?? 0) === 0 || attendanceResult.rows[0].status !== "absent") {
    throw new ValidationError("No hay una falta injustificada registrada para este estudiante y fecha.");
  }

  // Verificar no duplicar FUT pendiente para la misma falta
  const existing = await client.query(
    `SELECT 1 FROM futs WHERE student_id = $1 AND fut_date = $2::date AND status <> 'Rechazada'`,
    [data.student_id, data.fut_date]
  );
  if ((existing.rowCount ?? 0) > 0) {
    throw new ValidationError("Ya existe una solicitud FUT para esta falta.");
  }

  const result = await client.query(
    `INSERT INTO futs (student_id, fut_date, ref, reason, status)
     VALUES ($1, $2::date, $3, $4, $5)
     RETURNING *`,
    [data.student_id, data.fut_date, data.ref, data.reason, data.status ?? "Pendiente"]
  );

  await logAudit(
    client,
    byUser,
    `Se registró una solicitud FUT ${data.ref} para el estudiante ${data.student_id}`
  );

  return result.rows[0];
}

export async function resolveFut(
  client: PoolClient,
  id: string,
  result: "Aprobada" | "Rechazada",
  byUser: string
): Promise<FutRow> {
  const existing = await getFut(client, id);
  if (!existing) {
    throw new NotFoundError("Solicitud FUT no encontrada.");
  }
  if (existing.status !== "Pendiente") {
    throw new ValidationError("Esta solicitud FUT ya fue resuelta.");
  }

  const futResult = await client.query(
    `UPDATE futs SET status = $1 WHERE id = $2 RETURNING *`,
    [result, id]
  );

  // Si se aprueba, cambiar la falta a excused y agregar motivo
  if (result === "Aprobada") {
    const attendanceResult = await client.query(
      `SELECT sa.id FROM student_attendance sa
       JOIN attendance_sessions ats ON ats.id = sa.session_id
       WHERE sa.student_id = $1
         AND sa.recorded_at::date = $2::date
         AND ats.school_date = $2::date
       LIMIT 1`,
      [existing.student_id, existing.fut_date.toISOString().slice(0, 10)]
    );
    if ((attendanceResult.rowCount ?? 0) > 0) {
      await client.query(
        `UPDATE student_attendance SET status = 'excused', reason = $1 WHERE id = $2`,
        [existing.ref, attendanceResult.rows[0].id]
      );
    }
  }

  await logAudit(
    client,
    byUser,
    `Se ${result.toLowerCase()} la solicitud FUT ${existing.ref}`
  );

  return futResult.rows[0];
}

export async function deleteFut(
  client: PoolClient,
  id: string,
  byUser: string
): Promise<void> {
  const existing = await getFut(client, id);
  if (!existing) {
    throw new NotFoundError("Solicitud FUT no encontrada.");
  }

  await client.query(`DELETE FROM futs WHERE id = $1`, [id]);

  await logAudit(client, byUser, `Se eliminó la solicitud FUT ${existing.ref}`);
}
