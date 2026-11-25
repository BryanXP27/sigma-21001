import { Router } from "express";
import { z } from "zod";
import {
  listPersonnel,
  getPersonnel,
  createPersonnel,
  updatePersonnel,
  deletePersonnel,
  markStaffAttendance,
} from "../modules/personnel/index.js";
import { pool } from "../db.js";
import { authMiddleware } from "../core/auth.js";
import { AppError } from "../core/errors.js";

const router = Router();

const personnelIdSchema = z.string().min(1);
const shiftSchema = z.enum(["Mañana", "Tarde"]);

const createPersonnelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  shift: shiftSchema,
  contact: z.string().optional(),
  doc: z.string().optional(),
  active: z.boolean().optional(),
  qr: z.number().int().nonnegative().optional(),
});

const updatePersonnelSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  shift: shiftSchema.optional(),
  contact: z.string().optional(),
  doc: z.string().optional(),
  active: z.boolean().optional(),
  qr: z.number().int().nonnegative().optional(),
});

const markStaffSchema = z.object({
  personnel_id: z.string().min(1),
  log_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  kind: z.enum(["in", "out"]),
  clock: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Hora inválida"),
  source: z.string().optional(),
});

router.get("/", authMiddleware(["direccion", "subdireccion", "pip", "oficina"]), async (req, res) => {
  const shift = req.query.shift as string | undefined;
  const client = await pool.connect();
  try {
    const personnel = await listPersonnel(client, shift);
    res.json(personnel);
  } finally {
    client.release();
  }
});

router.get("/logs", authMiddleware(["direccion", "subdireccion", "pip", "oficina"]), async (req, res) => {
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(req.query.date);
  if (!date.success) {
    res.status(400).json({ error: "Indica una fecha válida para las marcaciones." });
    return;
  }
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, personnel_id AS "personnelId",
              log_date::text AS "logDate",
              in_time AS "inTime", out_time AS "outTime", source
         FROM staff_logs
        WHERE log_date = $1::date
        ORDER BY personnel_id`,
      [date.data]
    );
    res.json(result.rows);
  } finally {
    client.release();
  }
});

router.get("/:id", authMiddleware(["direccion", "subdireccion", "pip", "oficina"]), async (req, res) => {
  const parsed = personnelIdSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ error: "ID de personal inválido." });
    return;
  }
  const client = await pool.connect();
  try {
    const person = await getPersonnel(client, parsed.data);
    if (!person) {
      res.status(404).json({ error: "Personal no encontrado." });
      return;
    }
    res.json(person);
  } finally {
    client.release();
  }
});

router.post("/", authMiddleware(["direccion", "subdireccion", "pip", "oficina"]), async (req: any, res) => {
  const parsed = createPersonnelSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos de personal inválidos.", details: parsed.error.flatten() });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const person = await createPersonnel(client, parsed.data, req.user?.username ?? "demo");
    await client.query("COMMIT");
    res.status(201).json(person);
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

router.put("/:id", authMiddleware(["direccion", "subdireccion", "pip", "oficina"]), async (req: any, res) => {
  const parsedId = personnelIdSchema.safeParse(req.params.id);
  const parsedBody = updatePersonnelSchema.safeParse(req.body);
  if (!parsedId.success || !parsedBody.success) {
    res.status(400).json({ error: "Datos inválidos." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const person = await updatePersonnel(client, parsedId.data, parsedBody.data, req.user?.username ?? "demo");
    await client.query("COMMIT");
    res.json(person);
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
  const parsed = personnelIdSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ error: "ID de personal inválido." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await deletePersonnel(client, parsed.data, req.user?.username ?? "demo");
    await client.query("COMMIT");
    res.json({ message: "Personal eliminado." });
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

router.post("/mark", authMiddleware(["direccion", "subdireccion", "pip", "oficina"]), async (req: any, res) => {
  const parsed = markStaffSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos de marcación inválidos.", details: parsed.error.flatten() });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await markStaffAttendance(client, parsed.data, req.user?.username ?? "demo");
    await client.query("COMMIT");
    res.json(result);
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
