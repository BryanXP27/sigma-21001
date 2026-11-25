import { Router } from "express";
import { z } from "zod";
import {
  listAlerts,
  getAlert,
  createAlert,
  updateAlertStatus,
  deleteAlert,
} from "../modules/alerts/index.js";
import { pool } from "../db.js";
import { authMiddleware, isStudentInSectionOnDate } from "../core/auth.js";
import { AppError } from "../core/errors.js";
import { isValidSchoolDate } from "../core/time.js";

const router = Router();

const alertIdSchema = z.string().uuid();
const toSchoolDate = (value: Date | string): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);

const createAlertSchema = z.object({
  student_id: z.string().regex(/^\d{14}$/, "Código SIAGIE de 14 dígitos"),
  alert_date: z.string().refine(isValidSchoolDate, "Fecha inválida"),
  kind: z.enum(["absence", "threshold"]),
  status: z.enum(["Pendiente", "Preparado", "Resuelta"]).optional(),
  count: z.number().int().nonnegative().optional(),
});

const updateAlertStatusSchema = z.object({
  status: z.enum(["Pendiente", "Preparado", "Resuelta"]),
});

router.get("/", authMiddleware(), async (req: any, res) => {
  const studentId = req.query.studentId as string | undefined;
  const status = req.query.status as string | undefined;
  const client = await pool.connect();
  try {
    const sectionId = ["docente", "auxiliar"].includes(req.user?.role) ? "3A" : undefined;
    const alerts = await listAlerts(client, studentId, status, sectionId);
    res.json(alerts);
  } finally {
    client.release();
  }
});

router.get("/:id", authMiddleware(), async (req: any, res) => {
  const parsed = alertIdSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ error: "ID de alerta inválido." });
    return;
  }
  const client = await pool.connect();
  try {
    const alert = await getAlert(client, parsed.data);
    if (!alert) {
      res.status(404).json({ error: "Alerta no encontrada." });
      return;
    }
    if (
      ["docente", "auxiliar"].includes(req.user?.role) &&
      !(await isStudentInSectionOnDate(
        client,
        alert.student_id,
        "3A",
        toSchoolDate(alert.alert_date)
      ))
    ) {
      res.status(404).json({ error: "Alerta no encontrada." });
      return;
    }
    res.json(alert);
  } finally {
    client.release();
  }
});

router.post("/:id/notify", authMiddleware(["direccion", "subdireccion", "pip", "oficina"]), async (req: any, res) => {
  const parsed = alertIdSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ error: "ID de alerta inválido." });
    return;
  }
  if (process.env.NODE_ENV === "production" || (process.env.SMS_PROVIDER ?? "sandbox") !== "sandbox") {
    res.status(503).json({ error: "No hay un proveedor de mensajería configurado para enviar alertas." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const alert = await client.query(
      `SELECT a.id, a.student_id, a.alert_date, a.kind, a.count, a.status,
              s.given_names, s.family_names
         FROM alerts a
         JOIN students s ON s.siagie_code = a.student_id
        WHERE a.id = $1
        FOR UPDATE OF a`,
      [parsed.data]
    );
    if ((alert.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Alerta no encontrada." });
      return;
    }
    if (alert.rows[0].status === "Resuelta") {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "No se puede notificar una alerta resuelta." });
      return;
    }
    const recipients = await client.query(
      `SELECT DISTINCT phone FROM guardians
        WHERE student_id = $1 AND phone IS NOT NULL AND phone ~ '^9[0-9]{8}$'`,
      [alert.rows[0].student_id]
    );
    if ((recipients.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      res.status(422).json({ error: "El estudiante no tiene un celular válido registrado." });
      return;
    }
    for (const recipient of recipients.rows) {
      await client.query(
        `INSERT INTO notification_outbox
           (alert_id, recipient_phone, channel, provider, status, created_by)
         VALUES ($1, $2, 'sms', 'sandbox', 'simulated', $3)`,
        [parsed.data, recipient.phone, req.user.username]
      );
    }
    await updateAlertStatus(
      client,
      parsed.data,
      "Preparado",
      req.user.username
    );
    await client.query("COMMIT");
    res.json({
      status: "simulated",
      sent: false,
      recipientCount: recipients.rowCount,
      message: "La simulación quedó registrada; no se envió ningún SMS.",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    throw error;
  } finally {
    client.release();
  }
});

router.post("/", authMiddleware(["direccion", "subdireccion", "pip", "oficina", "docente", "auxiliar"]), async (req: any, res) => {
  const parsed = createAlertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos de alerta inválidos.", details: parsed.error.flatten() });
    return;
  }

  const client = await pool.connect();
  try {
    if (
      ["docente", "auxiliar"].includes(req.user?.role) &&
      !(await isStudentInSectionOnDate(
        client,
        parsed.data.student_id,
        "3A",
        parsed.data.alert_date
      ))
    ) {
      res.status(404).json({ error: "Estudiante no encontrado." });
      return;
    }
    await client.query("BEGIN");
    const alert = await createAlert(client, parsed.data, req.user?.username ?? "demo");
    await client.query("COMMIT");
    res.status(201).json(alert);
  } catch (error: any) {
    await client.query("ROLLBACK");
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Error interno del servidor." });
  } finally {
    client.release();
  }
});

router.patch("/:id/status", authMiddleware(["direccion", "subdireccion", "pip", "oficina"]), async (req: any, res) => {
  const parsedId = alertIdSchema.safeParse(req.params.id);
  const parsedBody = updateAlertStatusSchema.safeParse(req.body);
  if (!parsedId.success || !parsedBody.success) {
    res.status(400).json({ error: "Datos inválidos." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const alert = await updateAlertStatus(client, parsedId.data, parsedBody.data.status, req.user?.username ?? "demo");
    await client.query("COMMIT");
    res.json(alert);
  } catch (error: any) {
    await client.query("ROLLBACK");
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Error interno del servidor." });
  } finally {
    client.release();
  }
});

router.delete("/:id", authMiddleware(["direccion", "subdireccion"]), async (req: any, res) => {
  const parsed = alertIdSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ error: "ID de alerta inválido." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await deleteAlert(client, parsed.data, req.user?.username ?? "demo");
    await client.query("COMMIT");
    res.json({ message: "Alerta eliminada." });
  } catch (error: any) {
    await client.query("ROLLBACK");
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Error interno del servidor." });
  } finally {
    client.release();
  }
});

export default router;
