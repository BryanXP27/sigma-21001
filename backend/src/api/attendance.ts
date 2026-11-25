import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { authMiddleware, resolveSectionForRole } from "../core/auth.js";
import { AppError } from "../core/errors.js";
import {
  recordAttendance,
  syncAttendance,
  closeAttendanceSession,
  reopenAttendanceSession,
  correctAttendance,
  attendanceEventSchema,
  schoolDateSchema,
  type AttendanceEvent,
} from "../modules/student-attendance/index.js";

const router = Router();

const sectionIdSchema = z.string().min(1).max(12);

const attendanceSyncSchema = z.object({
  events: z.array(attendanceEventSchema).min(1).max(200),
});

router.get("/", authMiddleware(), async (req: any, res) => {
  const requestedSection = req.query.sectionId as string | undefined;
  const resolvedSection = resolveSectionForRole(req.user?.role, requestedSection);
  if (
    ["docente", "auxiliar"].includes(req.user?.role) &&
    requestedSection &&
    requestedSection !== resolvedSection
  ) {
    res.status(403).json({ error: "Solo puedes consultar tu sección asignada (3A)." });
    return;
  }
  const parsedSection = sectionIdSchema.safeParse(resolvedSection);
  const parsedDate = schoolDateSchema.safeParse(req.query.date);
  if (!parsedSection.success || !parsedDate.success) {
    res.status(400).json({ error: "Indica una sección y una fecha válidas." });
    return;
  }

  const result = await pool.query(
    `SELECT ats.id AS "sessionId", ats.status AS "sessionStatus",
            sa.id, sa.student_id AS "studentId", sa.status,
            sa.source, sa.recorded_at AS "recordedAt",
            sa.client_event_id AS "clientEventId",
            sa.reason, sa.corrected_by AS "correctedBy",
            sa.corrected_at AS "correctedAt"
       FROM attendance_sessions ats
       LEFT JOIN student_attendance sa ON sa.session_id = ats.id
      WHERE ats.section_id = $1 AND ats.school_date = $2::date
      ORDER BY sa.recorded_at NULLS LAST`,
    [parsedSection.data, parsedDate.data]
  );

  const session = result.rows[0]?.sessionId
    ? { id: result.rows[0].sessionId, status: result.rows[0].sessionStatus }
    : null;
  res.json({
    session,
    records: result.rows.filter((row: any) => row.id !== null),
  });
});

router.post("/", authMiddleware(), async (req: any, res) => {
  const event = attendanceEventSchema.safeParse(req.body);
  if (!event.success) {
    res.status(400).json({ error: "Los datos de asistencia no son válidos." });
    return;
  }
  if (resolveSectionForRole(req.user?.role, event.data.sectionId) !== event.data.sectionId) {
    res.status(403).json({ error: "Solo puedes registrar asistencia en tu sección asignada (3A)." });
    return;
  }

  try {
    const attendance = await recordAttendance(
      event.data as AttendanceEvent,
      req.user?.username ?? "demo"
    );
    res.status(201).json(attendance);
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

router.post("/sync", authMiddleware(), async (req: any, res) => {
  const payload = attendanceSyncSchema.safeParse(req.body);
  if (!payload.success) {
    res.status(400).json({ error: "La cola de asistencia no es válida." });
    return;
  }
  if (payload.data.events.some(
    (event) => resolveSectionForRole(req.user?.role, event.sectionId) !== event.sectionId
  )) {
    res.status(403).json({ error: "Solo puedes sincronizar asistencia de tu sección asignada (3A)." });
    return;
  }

  try {
    const results = await syncAttendance(
      payload.data.events as AttendanceEvent[],
      req.user?.username ?? "demo"
    );
    res.json({ results });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

router.post("/sessions/:sectionId/close", authMiddleware(["direccion", "subdireccion", "pip", "oficina", "docente", "auxiliar"]), async (req: any, res) => {
  const sectionId = sectionIdSchema.safeParse(
    resolveSectionForRole(req.user?.role, req.params.sectionId)
  );
  const body = z.object({ date: schoolDateSchema }).safeParse(req.body);
  if (!sectionId.success || !body.success) {
    res.status(400).json({ error: "La solicitud de cierre no es válida." });
    return;
  }

  try {
    const result = await closeAttendanceSession(
      sectionId.data,
      body.data.date,
      req.user?.username ?? "demo"
    );
    res.json(result);
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

router.post(
  "/sessions/:sectionId/reopen",
  authMiddleware(["direccion", "subdireccion", "pip"]),
  async (req: any, res) => {
    const sectionId = sectionIdSchema.safeParse(
      resolveSectionForRole(req.user?.role, req.params.sectionId)
    );
    const body = z.object({ date: schoolDateSchema }).safeParse(req.body);
    if (!sectionId.success || !body.success) {
      res.status(400).json({ error: "La solicitud de reapertura no es válida." });
      return;
    }
    try {
      const result = await reopenAttendanceSession(
        sectionId.data,
        body.data.date,
        req.user?.username ?? "demo"
      );
      res.json(result);
    } catch (error: any) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: "Error interno del servidor." });
    }
  }
);

router.patch(
  "/:id/correct",
  authMiddleware(["direccion", "subdireccion", "pip"]),
  async (req: any, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const body = z
      .object({
        status: z.enum(["present", "late", "absent", "excused", "permit"]),
        reason: z.string().trim().min(3).max(500),
      })
      .safeParse(req.body);
    if (!id.success || !body.success) {
      res.status(400).json({ error: "La corrección no es válida." });
      return;
    }
    try {
      const result = await correctAttendance(
        id.data,
        body.data.status,
        body.data.reason,
        req.user?.username ?? "demo"
      );
      res.json(result);
    } catch (error: any) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: "Error interno del servidor." });
    }
  }
);

export default router;
