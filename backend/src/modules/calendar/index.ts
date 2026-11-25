import { PoolClient } from "pg";
import { pool } from "../../core/db.js";
import { logAudit } from "../../core/auth.js";
import { NotFoundError, ValidationError } from "../../core/errors.js";
import { isValidSchoolDate } from "../../core/time.js";

export interface CalendarDay {
  school_date: string;
  lective: boolean;
  reason?: string;
}

export async function isLectiveSchoolDay(
  client: PoolClient,
  date: string
): Promise<boolean> {
  const result = await client.query(
    `SELECT lective FROM school_calendar WHERE school_date = $1::date`,
    [date]
  );
  if ((result.rowCount ?? 0) > 0) return result.rows[0].lective;

  const weekday = await client.query(
    `SELECT EXTRACT(ISODOW FROM $1::date) BETWEEN 1 AND 5 AS lective`,
    [date]
  );
  return weekday.rows[0].lective;
}

export async function listCalendar(
  client: PoolClient,
  year?: string,
  month?: string
): Promise<CalendarDay[]> {
  let query = `SELECT * FROM school_calendar`;
  const params: any[] = [];
  const conditions: string[] = [];

  if (year && month) {
    conditions.push(`EXTRACT(YEAR FROM school_date) = $${params.length + 1}`);
    params.push(year);
    conditions.push(`EXTRACT(MONTH FROM school_date) = $${params.length + 1}`);
    params.push(month);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }

  query += ` ORDER BY school_date`;

  const result = await client.query(query, params);
  return result.rows.map((r) => ({
    school_date: r.school_date.toISOString().slice(0, 10),
    lective: r.lective,
    reason: r.reason,
  }));
}

export async function getCalendarDay(
  client: PoolClient,
  date: string
): Promise<CalendarDay | null> {
  const result = await client.query(
    `SELECT * FROM school_calendar WHERE school_date = $1`,
    [date]
  );
  if (result.rowCount === 0) return null;
  const r = result.rows[0];
  return {
    school_date: r.school_date.toISOString().slice(0, 10),
    lective: r.lective,
    reason: r.reason,
  };
}

export async function upsertCalendarDay(
  client: PoolClient,
  data: {
    school_date: string;
    lective: boolean;
    reason: string;
  },
  byUser: string
): Promise<CalendarDay> {
  if (!isValidSchoolDate(data.school_date)) {
    throw new ValidationError("Fecha inválida.");
  }

  const result = await client.query(
    `INSERT INTO school_calendar (school_date, lective, reason)
     VALUES ($1::date, $2, $3)
     ON CONFLICT (school_date)
     DO UPDATE SET lective = $2, reason = $3
     RETURNING *`,
    [data.school_date, data.lective, data.reason]
  );

  await logAudit(
    client,
    byUser,
    `Se actualizó el calendario del ${data.school_date} (${data.lective ? "lectivo" : "no lectivo"})`
  );

  const r = result.rows[0];
  return {
    school_date: r.school_date.toISOString().slice(0, 10),
    lective: r.lective,
    reason: r.reason,
  };
}

export async function deleteCalendarDay(
  client: PoolClient,
  date: string,
  byUser: string
): Promise<void> {
  const existing = await getCalendarDay(client, date);
  if (!existing) {
    throw new NotFoundError("Día del calendario no encontrado.");
  }

  await client.query(`DELETE FROM school_calendar WHERE school_date = $1`, [date]);

  await logAudit(client, byUser, `Se eliminó el día ${date} del calendario`);
}

export async function listTerms(
  client: PoolClient,
  yearId?: number
): Promise<Array<{ id: number; starts_on: Date; ends_on: Date; academic_year_id: number }>> {
  if (yearId) {
    const result = await client.query(
      `SELECT * FROM academic_terms WHERE academic_year_id = $1 ORDER BY id`,
      [yearId]
    );
    return result.rows;
  }
  const result = await client.query(`SELECT * FROM academic_terms ORDER BY id`);
  return result.rows;
}

export async function upsertTerms(
  client: PoolClient,
  terms: Array<{ starts_on: string; ends_on: string }>,
  yearId: number,
  byUser: string
): Promise<void> {
  // Validar que no se solapen y estén en orden
  for (let i = 0; i < terms.length; i++) {
    if (new Date(terms[i].starts_on) > new Date(terms[i].ends_on)) {
      throw new ValidationError(`El término ${i + 1} tiene fecha de inicio posterior a la de fin.`);
    }
    if (i > 0 && new Date(terms[i].starts_on) <= new Date(terms[i - 1].ends_on)) {
      throw new ValidationError(`El término ${i + 1} se solapa con el término anterior.`);
    }
  }

  const client2 = await pool.connect();
  try {
    await client2.query("DELETE FROM academic_terms WHERE academic_year_id = $1", [yearId]);

    for (let i = 0; i < terms.length; i++) {
      await client2.query(
        `INSERT INTO academic_terms (id, starts_on, ends_on, academic_year_id)
         VALUES ($1, $2::date, $3::date, $4)`,
        [i + 1, terms[i].starts_on, terms[i].ends_on, yearId]
      );
    }

    await logAudit(
      client2,
      byUser,
      `Se actualizaron los bimestres del año lectivo ${yearId}`
    );
  } finally {
    client2.release();
  }
}
