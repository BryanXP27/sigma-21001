import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "./db.js";

export const attendanceStatuses = [
  "present",
  "late",
  "absent",
  "excused",
  "permit",
] as const;

export const schoolDateSchema = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}, "Usa una fecha válida con formato AAAA-MM-DD.");

export const attendanceEventSchema = z.object({
  clientEventId: z.string().uuid(),
  sectionId: z.string().min(1).max(12),
  studentId: z.string().regex(/^\d{14}$/),
  date: schoolDateSchema,
  status: z.enum(attendanceStatuses),
  source: z.enum(["manual", "qr"]).default("manual"),
  recordedAt: z.string().datetime({ offset: true }),
  demoProfile: z.enum([
    "direccion",
    "subdireccion",
    "pip",
    "oficina",
    "docente",
    "auxiliar",
    "apoderado",
  ]),
});

export const attendanceSyncSchema = z.object({
  events: z.array(attendanceEventSchema).min(1).max(200),
});

export type AttendanceEvent = z.infer<typeof attendanceEventSchema>;

export class AttendanceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

async function findByClientEventId(client: PoolClient, eventId: string) {
  const result = await client.query(
    `SELECT sa.id, sa.session_id AS "sessionId", sa.student_id AS "studentId",
            sa.status, sa.source, sa.recorded_at AS "recordedAt",
            sa.client_event_id AS "clientEventId"
       FROM student_attendance sa
      WHERE sa.client_event_id = $1`,
    [eventId],
  );
  return result.rows[0] ?? null;
}

export async function recordAttendance(event: AttendanceEvent) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const alreadyRecorded = await findByClientEventId(
      client,
      event.clientEventId,
    );
    if (alreadyRecorded) {
      await client.query("COMMIT");
      return alreadyRecorded;
    }

    const section = await client.query(
      `SELECT s.id
         FROM sections s
         JOIN academic_years ay ON ay.id = s.academic_year_id
        WHERE s.id = $1
          AND ay.starts_on <= $2::date
          AND ay.ends_on >= $2::date`,
      [event.sectionId, event.date],
    );
    if (section.rowCount === 0) {
      throw new AttendanceError(
        "La sección no está habilitada para esa fecha.",
        422,
      );
    }

    const enrollment = await client.query(
      `SELECT e.id
         FROM enrollments e
         JOIN students s ON s.siagie_code = e.student_id
        WHERE e.student_id = $1
          AND e.section_id = $2
          AND e.status = 'active'
          AND s.active
          AND e.starts_on <= $3::date
          AND (e.ends_on IS NULL OR e.ends_on > $3::date)
        LIMIT 1`,
      [event.studentId, event.sectionId, event.date],
    );
    if (enrollment.rowCount === 0) {
      throw new AttendanceError(
        "El estudiante no tiene matrícula vigente en esta sección y fecha.",
        422,
      );
    }

    await client.query(
      `INSERT INTO attendance_sessions (section_id, school_date)
       VALUES ($1, $2::date)
       ON CONFLICT (section_id, school_date) DO NOTHING`,
      [event.sectionId, event.date],
    );

    const sessionResult = await client.query(
      `SELECT id, status
         FROM attendance_sessions
        WHERE section_id = $1 AND school_date = $2::date
        FOR UPDATE`,
      [event.sectionId, event.date],
    );
    const session = sessionResult.rows[0] as
      | { id: string; status: "open" | "closed" }
      | undefined;

    if (!session || session.status !== "open") {
      throw new AttendanceError("La jornada está cerrada.", 409);
    }

    const result = await client.query(
      `INSERT INTO student_attendance
         (session_id, student_id, status, source, recorded_at, recorded_by, client_event_id)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7)
       RETURNING id, session_id AS "sessionId", student_id AS "studentId",
                 status, source, recorded_at AS "recordedAt",
                 client_event_id AS "clientEventId"`,
      [
        session.id,
        event.studentId,
        event.status,
        event.source,
        event.recordedAt,
        event.demoProfile,
        event.clientEventId,
      ],
    );

    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      const alreadyRecorded = await pool.query(
        `SELECT id, session_id AS "sessionId", student_id AS "studentId",
                status, source, recorded_at AS "recordedAt",
                client_event_id AS "clientEventId"
           FROM student_attendance
          WHERE client_event_id = $1`,
        [event.clientEventId],
      );
      if (alreadyRecorded.rowCount) return alreadyRecorded.rows[0];
      throw new AttendanceError(
        "Ya existe una asistencia para este estudiante y jornada.",
        409,
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function syncAttendance(events: AttendanceEvent[]) {
  const results = [];

  for (const event of events) {
    try {
      const attendance = await recordAttendance(event);
      results.push({
        clientEventId: event.clientEventId,
        outcome: "saved" as const,
        attendance,
      });
    } catch (error) {
      if (error instanceof AttendanceError) {
        results.push({
          clientEventId: event.clientEventId,
          outcome: error.statusCode === 409 ? ("conflict" as const) : ("rejected" as const),
          message: error.message,
        });
      } else {
        throw error;
      }
    }
  }

  return results;
}

export async function closeAttendanceSession(
  sectionId: string,
  date: string,
  demoProfile: string,
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO attendance_sessions (section_id, school_date)
       VALUES ($1, $2::date)
       ON CONFLICT (section_id, school_date) DO NOTHING`,
      [sectionId, date],
    );

    const sessionResult = await client.query(
      `SELECT id, status FROM attendance_sessions
        WHERE section_id = $1 AND school_date = $2::date
        FOR UPDATE`,
      [sectionId, date],
    );
    const session = sessionResult.rows[0] as
      | { id: string; status: "open" | "closed" }
      | undefined;
    if (!session) {
      throw new AttendanceError("No se pudo abrir la jornada.", 500);
    }
    if (session.status === "closed") {
      throw new AttendanceError("La jornada ya está cerrada.", 409);
    }

    const section = await client.query(
      `SELECT 1 FROM sections s
        JOIN academic_years ay ON ay.id = s.academic_year_id
       WHERE s.id = $1 AND ay.starts_on <= $2::date AND ay.ends_on >= $2::date`,
      [sectionId, date],
    );
    if (section.rowCount === 0) {
      throw new AttendanceError(
        "La sección no está habilitada para esa fecha.",
        422,
      );
    }

    const inserted = await client.query(
      `INSERT INTO student_attendance
         (session_id, student_id, status, source, recorded_at, recorded_by, client_event_id)
       SELECT $1, e.student_id, 'absent', 'closure', now(), $4, gen_random_uuid()
         FROM enrollments e
         JOIN students s ON s.siagie_code = e.student_id
        WHERE e.section_id = $2
          AND e.status = 'active'
          AND s.active
          AND e.starts_on <= $3::date
          AND (e.ends_on IS NULL OR e.ends_on > $3::date)
       ON CONFLICT (session_id, student_id) DO NOTHING
       RETURNING id`,
      [session.id, sectionId, date, demoProfile],
    );

    await client.query(
      `UPDATE attendance_sessions
          SET status = 'closed', closed_at = now(), closed_by = $2
        WHERE id = $1`,
      [session.id, demoProfile],
    );
    await client.query("COMMIT");

    return { sessionId: session.id, absencesCreated: inserted.rowCount ?? 0 };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function newAttendanceEventId() {
  return randomUUID();
}
