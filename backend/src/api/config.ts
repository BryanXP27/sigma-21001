import { Router } from "express";
import { z } from "zod";
import {
  listConfig,
  updateConfig,
  resetConfig,
} from "../modules/config/index.js";
import { pool } from "../db.js";
import { authMiddleware } from "../core/auth.js";
import { AppError } from "../core/errors.js";
import { restoreDemoSeed } from "../modules/config/demo.js";

const router = Router();

const configUpdateSchema = z.record(z.string(), z.string());

router.get("/", authMiddleware(["direccion", "subdireccion"]), async (_req, res) => {
  const client = await pool.connect();
  try {
    const config = await listConfig(client);
    res.json(config);
  } finally {
    client.release();
  }
});

router.get("/backup", authMiddleware(["direccion", "subdireccion"]), async (_req, res) => {
  const tables = [
    "academic_years",
    "sections",
    "students",
    "enrollments",
    "users",
    "personnel",
    "guardians",
    "attendance_sessions",
    "student_attendance",
    "staff_logs",
    "alerts",
    "futs",
    "school_calendar",
    "academic_terms",
    "system_config",
    "audit_log",
    "report_archives",
    "closed_sessions",
    "notification_outbox",
  ] as const;
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const data: Record<string, unknown[]> = {};
    for (const table of tables) {
      const result = await client.query(`SELECT * FROM ${table}`);
      data[table] = result.rows;
    }
    await client.query("COMMIT");
    res.json({
      application: "SIGMA 21001",
      formatVersion: 1,
      generatedAt: new Date().toISOString(),
      containsPasswordHashes: true,
      excludedTransientData: ["auth_challenges"],
      tables: data,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

router.post("/", authMiddleware(["direccion", "subdireccion"]), async (req: any, res) => {
  const parsed = configUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos de configuración inválidos." });
    return;
  }
  const updates = parsed.data as Record<string, string>;
  if (!parsed.success) {
    res.status(400).json({ error: "Datos de configuración inválidos." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await updateConfig(client, updates, req.user?.username ?? "demo");
    await client.query("COMMIT");
    res.json(updated);
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

router.post("/reset", authMiddleware(["direccion"]), async (req: any, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await resetConfig(client, req.user?.username ?? "demo");
    await client.query("COMMIT");
    res.json({ message: "Configuración restablecida a valores predeterminados." });
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

router.post("/reset-demo", authMiddleware(["direccion"]), async (req: any, res) => {
  if (process.env.NODE_ENV === "production") {
    res.status(403).json({ error: "Restablecer datos de demostración está deshabilitado en producción." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await restoreDemoSeed(client, req.user.username);
    await client.query("COMMIT");
    res.json({
      message: "Se restauraron los registros semilla; las configuraciones y los datos adicionales se conservaron.",
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

export default router;
