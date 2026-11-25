import { PoolClient } from "pg";
import { pool } from "../../core/db.js";
import { logAudit } from "../../core/auth.js";
import { NotFoundError, ValidationError } from "../../core/errors.js";

export interface AlertRow {
  id: string;
  student_id: string;
  alert_date: Date;
  kind: "absence" | "threshold";
  status: "Pendiente" | "Preparado" | "Resuelta";
  count: number;
  created_at: Date;
}

export interface AlertWithStudent extends AlertRow {
  student_name?: string;
  student_section?: string;
}

export async function listAlerts(
  client: PoolClient,
  studentId?: string,
  status?: string,
  sectionId?: string
): Promise<AlertWithStudent[]> {
  let query = `
    SELECT a.*, s.given_names, s.family_names
      FROM alerts a
      JOIN students s ON s.siagie_code = a.student_id
  `;
  const params: any[] = [];
  const conditions: string[] = [];

  if (studentId) {
    conditions.push(`a.student_id = $${params.length + 1}`);
    params.push(studentId);
  }
  if (status) {
    conditions.push(`a.status = $${params.length + 1}`);
    params.push(status);
  }
  if (sectionId) {
    conditions.push(
      `EXISTS (
         SELECT 1 FROM enrollments e
          WHERE e.student_id = a.student_id
            AND e.section_id = $${params.length + 1}
            AND e.starts_on <= a.alert_date
            AND (e.ends_on IS NULL OR e.ends_on > a.alert_date)
       )`
    );
    params.push(sectionId);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }

  query += ` ORDER BY a.created_at DESC`;

  const result = await client.query(query, params);
  return result.rows.map((row) => ({
    ...row,
    student_name: `${row.given_names ?? ""} ${row.family_names ?? ""}`.trim(),
  }));
}

export async function getAlert(
  client: PoolClient,
  id: string
): Promise<AlertRow | null> {
  const result = await client.query(`SELECT * FROM alerts WHERE id = $1`, [id]);
  if (result.rowCount === 0) return null;
  return result.rows[0];
}

export async function createAlert(
  client: PoolClient,
  data: {
    student_id: string;
    alert_date: string;
    kind: "absence" | "threshold";
    status?: "Pendiente" | "Preparado" | "Resuelta";
    count?: number;
  },
  byUser: string
): Promise<AlertRow> {
  // Verificar que el estudiante existe
  const studentResult = await client.query(
    `SELECT 1 FROM students WHERE siagie_code = $1`,
    [data.student_id]
  );
  if (studentResult.rowCount === 0) {
    throw new ValidationError("El estudiante especificado no existe.");
  }

  // Verificar no duplicar alerta del mismo tipo y fecha para el mismo estudiante
  const existing = await client.query(
    `SELECT 1 FROM alerts WHERE student_id = $1 AND alert_date = $2::date AND kind = $3`,
    [data.student_id, data.alert_date, data.kind]
  );
  if ((existing.rowCount ?? 0) > 0) {
    throw new ValidationError("Ya existe una alerta de este tipo para este estudiante y fecha.");
  }

  const result = await client.query(
    `INSERT INTO alerts (student_id, alert_date, kind, status, count)
     VALUES ($1, $2::date, $3, $4, $5)
     RETURNING *`,
    [
      data.student_id,
      data.alert_date,
      data.kind,
      data.status ?? "Pendiente",
      data.count ?? 1,
    ]
  );

  await logAudit(
    client,
    byUser,
    `Se creó una alerta ${data.kind} para el estudiante ${data.student_id}`
  );

  return result.rows[0];
}

export async function updateAlertStatus(
  client: PoolClient,
  id: string,
  status: "Pendiente" | "Preparado" | "Resuelta",
  byUser: string
): Promise<AlertRow> {
  const existing = await getAlert(client, id);
  if (!existing) {
    throw new NotFoundError("Alerta no encontrada.");
  }

  const result = await client.query(
    `UPDATE alerts SET status = $1 WHERE id = $2 RETURNING *`,
    [status, id]
  );

  await logAudit(
    client,
    byUser,
    `Se actualizó la alerta ${id} a estado ${status}`
  );

  return result.rows[0];
}

export async function deleteAlert(
  client: PoolClient,
  id: string,
  byUser: string
): Promise<void> {
  const existing = await getAlert(client, id);
  if (!existing) {
    throw new NotFoundError("Alerta no encontrada.");
  }

  await client.query(`DELETE FROM alerts WHERE id = $1`, [id]);

  await logAudit(client, byUser, `Se eliminó la alerta ${id}`);
}

export async function generateAlertsForAbsence(
  client: PoolClient,
  studentId: string,
  date: string,
  threshold: number,
  byUser: string
): Promise<AlertRow[]> {
  const created: AlertRow[] = [];

  // Alerta por inasistencia simple
  const absenceAlert = await createAlert(
    client,
    { student_id: studentId, alert_date: date, kind: "absence", count: 1 },
    byUser
  );
  created.push(absenceAlert);

  // Verificar umbral para alerta de acumulación
  // Contar ausencias en los últimos `threshold` días lectivos (simplificado: últimos N días)
  const startDate = new Date(date);
  startDate.setDate(startDate.getDate() - 30);

  const absences = await client.query(
    `SELECT COUNT(*) as cnt FROM student_attendance
       WHERE student_id = $1
         AND status = 'absent'
         AND recorded_at::date >= $2::date
         AND recorded_at::date <= $3::date`,
    [studentId, startDate.toISOString().slice(0, 10), date]
  );
  const absenceCount = parseInt(absences.rows[0].cnt, 10);

  if (absenceCount >= threshold) {
    const thresholdAlert = await createAlert(
      client,
      {
        student_id: studentId,
        alert_date: date,
        kind: "threshold",
        count: absenceCount,
      },
      byUser
    );
    created.push(thresholdAlert);
  }

  return created;
}
