import { PoolClient } from "pg";
import { pool } from "../../core/db.js";
import { logAudit } from "../../core/auth.js";
import { NotFoundError, ValidationError } from "../../core/errors.js";
import { peruTodayIso } from "../../core/time.js";

export interface StudentRow {
  siagie_code: string;
  given_names: string;
  family_names: string;
  doc?: string;
  sex?: string;
  birth?: string;
  active: boolean;
  qr: number;
  created_at: Date;
  section_id?: string | null;
  enrollment_starts_on?: string | null;
}

export async function listStudents(
  client: PoolClient,
  sectionId?: string,
  date?: string,
  status: "active" | "inactive" | "all" = "active"
): Promise<StudentRow[]> {
  const asOf = date ?? peruTodayIso();
  const params: unknown[] = [asOf];
  const sectionFilter = sectionId
    ? `AND enrollment.section_id = $${params.push(sectionId)}`
    : "";
  const statusFilter = status === "active"
    ? `AND s.active
       AND enrollment.status = 'active'
       AND enrollment.starts_on <= $1::date
       AND (enrollment.ends_on IS NULL OR enrollment.ends_on > $1::date)`
    : status === "inactive"
      ? `AND (NOT s.active
          OR enrollment.status IS DISTINCT FROM 'active'
          OR enrollment.starts_on > $1::date
          OR enrollment.ends_on <= $1::date)`
      : "";
  const result = await client.query(
    `SELECT s.siagie_code, s.given_names, s.family_names, s.doc, s.sex,
            s.birth,
            (s.active AND enrollment.status = 'active'
             AND enrollment.starts_on <= $1::date
             AND (enrollment.ends_on IS NULL OR enrollment.ends_on > $1::date)) AS active,
            s.qr, s.created_at,
            enrollment.section_id,
            enrollment.starts_on AS enrollment_starts_on
       FROM students s
       LEFT JOIN LATERAL (
         SELECT e.section_id, e.starts_on, e.ends_on, e.status
           FROM enrollments e
          WHERE e.student_id = s.siagie_code
          ORDER BY
            CASE WHEN e.status = 'active'
                       AND e.starts_on <= $1::date
                       AND (e.ends_on IS NULL OR e.ends_on > $1::date)
                 THEN 0 ELSE 1 END,
            e.starts_on DESC
          LIMIT 1
       ) enrollment ON true
      WHERE true ${statusFilter} ${sectionFilter}
      ORDER BY s.family_names, s.given_names`,
    params
  );
  return result.rows;
}

export async function getStudent(
  client: PoolClient,
  siagieCode: string
): Promise<StudentRow | null> {
  const result = await client.query(
    `SELECT s.*,
            (s.active AND enrollment.status = 'active'
             AND enrollment.starts_on <= current_date
             AND (enrollment.ends_on IS NULL OR enrollment.ends_on > current_date)) AS active,
            enrollment.section_id,
            enrollment.starts_on AS enrollment_starts_on
       FROM students s
       LEFT JOIN LATERAL (
         SELECT e.section_id, e.starts_on
           FROM enrollments e
          WHERE e.student_id = s.siagie_code AND e.status = 'active'
          ORDER BY e.starts_on DESC
          LIMIT 1
       ) enrollment ON true
      WHERE s.siagie_code = $1`,
    [siagieCode]
  );
  if (result.rowCount === 0) return null;
  return result.rows[0];
}

export async function createStudent(
  client: PoolClient,
  data: {
    siagie_code: string;
    given_names: string;
    family_names: string;
    doc?: string;
    sex?: string;
    birth?: string;
    active?: boolean;
    qr?: number;
    section_id?: string;
    starts_on?: string;
  },
  byUser: string
): Promise<StudentRow> {
  const existing = await getStudent(client, data.siagie_code);
  if (existing) {
    throw new ValidationError("Ya existe un estudiante con ese código SIAGIE.");
  }

  const result = await client.query(
    `INSERT INTO students (siagie_code, given_names, family_names, doc, sex, birth, active, qr)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      data.siagie_code,
      data.given_names,
      data.family_names,
      data.doc ?? null,
      data.sex ?? null,
      data.birth ?? null,
      data.active ?? true,
      data.qr ?? 0,
    ]
  );

  const student = result.rows[0];

  if (data.section_id && data.starts_on) {
    await client.query(
      `INSERT INTO enrollments (student_id, section_id, starts_on, status)
       VALUES ($1, $2, $3::date, 'active')`,
      [data.siagie_code, data.section_id, data.starts_on]
    );
  }

  await logAudit(
    client,
    byUser,
    `Se creó el estudiante ${student.given_names} ${student.family_names} (${student.siagie_code})`
  );

  return student;
}

export async function updateStudent(
  client: PoolClient,
  siagieCode: string,
  data: {
    given_names?: string;
    family_names?: string;
    doc?: string;
    sex?: string;
    birth?: string;
    active?: boolean;
    qr?: number;
    section_id?: string;
    starts_on?: string;
  },
  byUser: string
): Promise<StudentRow> {
  const existing = await getStudent(client, siagieCode);
  if (!existing) {
    throw new NotFoundError("Estudiante no encontrado.");
  }

  const result = await client.query(
    `UPDATE students
       SET given_names = COALESCE($1, given_names),
           family_names = COALESCE($2, family_names),
           doc = COALESCE($3, doc),
           sex = COALESCE($4, sex),
           birth = COALESCE($5, birth),
           active = COALESCE($6, active),
           qr = COALESCE($7, qr)
     WHERE siagie_code = $8
     RETURNING *`,
    [
      data.given_names,
      data.family_names,
      data.doc,
      data.sex,
      data.birth,
      data.active,
      data.qr,
      siagieCode,
    ]
  );

  await logAudit(
    client,
    byUser,
    `Se actualizó el estudiante ${siagieCode}`
  );

  if (data.section_id && data.starts_on) {
    const currentEnrollment = await client.query(
      `SELECT id, section_id, starts_on
         FROM enrollments
        WHERE student_id = $1 AND status = 'active'
        ORDER BY starts_on DESC
        LIMIT 1
        FOR UPDATE`,
      [siagieCode]
    );
    const current = currentEnrollment.rows[0] as
      | { id: string; section_id: string; starts_on: string }
      | undefined;

    if (current?.section_id !== data.section_id) {
      if (current && data.starts_on <= String(current.starts_on).slice(0, 10)) {
        throw new ValidationError(
          "La fecha de cambio debe ser posterior al inicio de la matrícula vigente."
        );
      }
      if (current) {
        await client.query(
          `UPDATE enrollments
              SET ends_on = $2::date, status = 'transferred'
            WHERE id = $1`,
          [current.id, data.starts_on]
        );
      }
      await client.query(
        `INSERT INTO enrollments (student_id, section_id, starts_on, status)
         VALUES ($1, $2, $3::date, 'active')`,
        [siagieCode, data.section_id, data.starts_on]
      );
      await logAudit(
        client,
        byUser,
        `Se cambió al estudiante ${siagieCode} a la sección ${data.section_id} desde ${data.starts_on}`
      );
    }
  }

  return result.rows[0];
}

export async function deleteStudent(
  client: PoolClient,
  siagieCode: string,
  byUser: string
): Promise<void> {
  const existing = await getStudent(client, siagieCode);
  if (!existing) {
    throw new NotFoundError("Estudiante no encontrado.");
  }

  await client.query(`DELETE FROM students WHERE siagie_code = $1`, [
    siagieCode,
  ]);

  await logAudit(
    client,
    byUser,
    `Se eliminó el estudiante ${siagieCode}`
  );
}

export async function importStudents(
  client: PoolClient,
  rows: Array<{
    siagie_code: string;
    given_names: string;
    family_names: string;
    doc?: string;
    section_id?: string;
    active?: boolean;
  }>,
  byUser: string
): Promise<{ imported: number; errors: string[] }> {
  const errors: string[] = [];
  let imported = 0;

  for (const row of rows) {
    try {
      const existing = await getStudent(client, row.siagie_code);
      if (existing) {
        await updateStudent(
          client,
          row.siagie_code,
          {
            given_names: row.given_names,
            family_names: row.family_names,
            doc: row.doc,
            active: row.active,
          },
          byUser
        );
      } else {
        await createStudent(
          client,
          {
            siagie_code: row.siagie_code,
            given_names: row.given_names,
            family_names: row.family_names,
            doc: row.doc,
            active: row.active ?? true,
            section_id: row.section_id,
            starts_on: new Date().toISOString().slice(0, 10),
          },
          byUser
        );
      }
      imported++;
    } catch (err: any) {
      errors.push(`${row.siagie_code}: ${err.message}`);
    }
  }

  return { imported, errors };
}
