import { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../../core/db.js";
import { logAudit } from "../../core/auth.js";
import { AppError, ConflictError, ValidationError } from "../../core/errors.js";
import { generateAlertsForAbsence } from "../alerts/index.js";
import { isLectiveSchoolDay } from "../calendar/index.js";

export const schoolDateSchema = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});

export const attendanceEventSchema = z.object({
  clientEventId: z.string().uuid(),
  sectionId: z.string().min(1).max(12),
  studentId: z.string().regex(/^\d{14}$/),
  date: schoolDateSchema,
  status: z.enum(["present", "late", "absent", "excused", "permit"]),
  source: z.enum(["manual", "qr"]).default("manual"),
  recordedAt: z.string().datetime({ offset: true }),
});

export const attendanceStatuses = [
  "present",
  "late",
  "absent",
  "excused",
  "permit",
] as const;

export interface AttendanceEvent {
  clientEventId: string;
  sectionId: string;
  studentId: string;
  date: string;
  status: (typeof attendanceStatuses)[number];
  source: "manual" | "qr";
  recordedAt: string;
  demoProfile?: string;
}

async function findByClientEventId(
  client: PoolClient,
  eventId: string
): Promise<any | null> {
  const result = await client.query(
    `SELECT sa.id, sa.session_id AS "sessionId", sa.student_id AS "studentId",
            sa.status, sa.source, sa.recorded_at AS "recordedAt",
            sa.client_event_id AS "clientEventId"
       FROM student_attendance sa
      WHERE sa.client_event_id = $1`,
    [eventId]
  );
  return result.rows[0] ?? null;
}

export async function recordAttendance(
  event: AttendanceEvent,
  recordedBy: string
): Promise<any> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    if (!(await isLectiveSchoolDay(client, event.date))) {
      throw new AppError("No se puede registrar asistencia en un día no lectivo.", 422);
    }

    const alreadyRecorded = await findByClientEventId(client, event.clientEventId);
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
      [event.sectionId, event.date]
    );
    if ((section.rowCount ?? 0) === 0) {
      throw new AppError(
        "La sección no está habilitada para esa fecha.",
        422
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
      [event.studentId, event.sectionId, event.date]
    );
    if ((enrollment.rowCount ?? 0) === 0) {
      throw new AppError(
        "El estudiante no tiene matrícula vigente en esta sección y fecha.",
        422
      );
    }

    await client.query(
      `INSERT INTO attendance_sessions (section_id, school_date)
       VALUES ($1, $2::date)
       ON CONFLICT (section_id, school_date) DO NOTHING`,
      [event.sectionId, event.date]
    );

    const sessionResult = await client.query(
      `SELECT id, status
         FROM attendance_sessions
        WHERE section_id = $1 AND school_date = $2::date
        FOR UPDATE`,
      [event.sectionId, event.date]
    );
    const session = sessionResult.rows[0] as
      | { id: string; status: "open" | "closed" }
      | undefined;

    if (!session || session.status !== "open") {
      throw new ConflictError("La jornada está cerrada.");
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
        recordedBy,
        event.clientEventId,
      ]
    );

    await logAudit(
      client,
      recordedBy,
      `Asistencia registrada: ${event.studentId} - ${event.status}`
    );

    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as any).code === "23505"
    ) {
      const alreadyRecorded = await pool.query(
        `SELECT id, session_id AS "sessionId", student_id AS "studentId",
                status, source, recorded_at AS "recordedAt",
                client_event_id AS "clientEventId"
           FROM student_attendance
          WHERE client_event_id = $1`,
        [event.clientEventId]
      );
      if ((alreadyRecorded.rowCount ?? 0) > 0) return alreadyRecorded.rows[0];
      throw new ConflictError(
        "Ya existe una asistencia para este estudiante y jornada."
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function syncAttendance(
  events: AttendanceEvent[],
  recordedBy: string
): Promise<Array<{ clientEventId: string; outcome: "saved" | "conflict" | "rejected"; message?: string; attendance?: any }>> {
  const results = [];

  for (const event of events) {
    try {
      const attendance = await recordAttendance(event, recordedBy);
      results.push({
        clientEventId: event.clientEventId,
        outcome: "saved" as const,
        attendance,
      });
    } catch (error) {
      if (error instanceof AppError) {
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
  closedBy: string
): Promise<{ sessionId: string; absencesCreated: number; alertsCreated: number }> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    if (!(await isLectiveSchoolDay(client, date))) {
      throw new AppError("No se puede cerrar asistencia en un día no lectivo.", 422);
    }

    await client.query(
      `INSERT INTO attendance_sessions (section_id, school_date)
       VALUES ($1, $2::date)
       ON CONFLICT (section_id, school_date) DO NOTHING`,
      [sectionId, date]
    );

    const sessionResult = await client.query(
      `SELECT id, status FROM attendance_sessions
        WHERE section_id = $1 AND school_date = $2::date
        FOR UPDATE`,
      [sectionId, date]
    );
    const session = sessionResult.rows[0] as
      | { id: string; status: "open" | "closed" }
      | undefined;

    if (!session) {
      throw new AppError("No se pudo abrir la jornada.", 500);
    }
    if (session.status === "closed") {
      throw new ConflictError("La jornada ya está cerrada.");
    }

    const section = await client.query(
      `SELECT 1 FROM sections s
        JOIN academic_years ay ON ay.id = s.academic_year_id
       WHERE s.id = $1 AND ay.starts_on <= $2::date AND ay.ends_on >= $2::date`,
      [sectionId, date]
    );
    if ((section.rowCount ?? 0) === 0) {
      throw new AppError(
        "La sección no está habilitada para esa fecha.",
        422
      );
    }

    const inserted = await client.query(
      `INSERT INTO student_attendance
         (session_id, student_id, status, source, recorded_at, recorded_by, client_event_id)
       SELECT $1, e.student_id, 'absent', 'closure',
              ($3::date + time '14:00') AT TIME ZONE 'UTC',
              $4, gen_random_uuid()
         FROM enrollments e
         JOIN students s ON s.siagie_code = e.student_id
        WHERE e.section_id = $2
          AND e.status = 'active'
          AND s.active
          AND e.starts_on <= $3::date
          AND (e.ends_on IS NULL OR e.ends_on > $3::date)
       ON CONFLICT (session_id, student_id) DO NOTHING
       RETURNING id, student_id`,
      [session.id, sectionId, date, closedBy]
    );

    await client.query(
      `UPDATE attendance_sessions
          SET status = 'closed', closed_at = now(), closed_by = $2
        WHERE id = $1`,
      [session.id, closedBy]
    );

    // Generar alertas automáticas para cada falta nueva registrada por cierre.
    const thresholdResult = await client.query(
      `SELECT value FROM system_config WHERE key = 'threshold'`
    );
    const threshold = parseInt(thresholdResult.rows[0]?.value ?? "3", 10);
    let alertsCreated = 0;

    for (const row of inserted.rows) {
      try {
        await generateAlertsForAbsence(
          client,
          row.student_id,
          date,
          Number.isFinite(threshold) ? threshold : 3,
          closedBy
        );
        alertsCreated += 1;
      } catch (alertError) {
        // Ya existe una alerta para ese estudiante y fecha: no es un error de cierre.
        if (!(alertError instanceof ValidationError)) throw alertError;
      }
    }

    await logAudit(
      client,
      closedBy,
      `Se cerró la asistencia de ${sectionId} del ${date}`
    );

    await client.query("COMMIT");

    return {
      sessionId: session.id,
      absencesCreated: inserted.rowCount ?? 0,
      alertsCreated,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Reabre una jornada cerrada. Los registros existentes se conservan. */
export async function reopenAttendanceSession(
  sectionId: string,
  date: string,
  reopenedBy: string
): Promise<{ sessionId: string; status: "open" }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!(await isLectiveSchoolDay(client, date))) {
      throw new AppError("No se puede reabrir asistencia en un día no lectivo.", 422);
    }
    const result = await client.query(
      `UPDATE attendance_sessions
          SET status = 'open', closed_at = NULL, closed_by = NULL
        WHERE section_id = $1 AND school_date = $2::date AND status = 'closed'
        RETURNING id`,
      [sectionId, date]
    );
    if ((result.rowCount ?? 0) === 0) {
      const exists = await client.query(
        `SELECT 1 FROM attendance_sessions
          WHERE section_id = $1 AND school_date = $2::date`,
        [sectionId, date]
      );
      if ((exists.rowCount ?? 0) === 0) {
        throw new AppError("No existe una jornada para esa sección y fecha.", 404);
      }
      throw new ConflictError("La jornada ya estaba abierta.");
    }
    await logAudit(
      client,
      reopenedBy,
      `Se reabrió la asistencia de ${sectionId} del ${date}`
    );
    await client.query("COMMIT");
    return { sessionId: result.rows[0].id, status: "open" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Una autoridad corrige el estado de un registro ya guardado. */
export async function correctAttendance(
  attendanceId: string,
  status: (typeof attendanceStatuses)[number],
  reason: string,
  correctedBy: string
): Promise<any> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE student_attendance
          SET status = $2,
              reason = $3,
              corrected_by = $4,
              corrected_at = now()
        WHERE id = $1
        RETURNING id, session_id AS "sessionId", student_id AS "studentId",
                  status, source, reason,
                  corrected_by AS "correctedBy",
                  corrected_at AS "correctedAt",
                  recorded_at AS "recordedAt",
                  client_event_id AS "clientEventId"`,
      [attendanceId, status, reason, correctedBy]
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new AppError("No se encontró el registro de asistencia.", 404);
    }
    await logAudit(
      client,
      correctedBy,
      `Se corrigió la asistencia ${attendanceId} a ${status}: ${reason}`
    );
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
