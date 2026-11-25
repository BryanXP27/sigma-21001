import { Router } from "express";
import { z } from "zod";
import {
  listGuardians,
  getGuardian,
  createGuardian,
  updateGuardian,
  deleteGuardian,
} from "../modules/guardians/index.js";
import { pool } from "../db.js";
import { authMiddleware } from "../core/auth.js";
import { AppError } from "../core/errors.js";

const router = Router();

const guardianIdSchema = z.string().uuid();

const createGuardianSchema = z.object({
  student_id: z.string().regex(/^\d{14}$/, "Código SIAGIE de 14 dígitos"),
  name: z.string().min(1),
  doc: z.string().optional(),
  phone: z.string().optional(),
  relation: z.string().optional(),
  email: z.string().email().optional(),
});

const updateGuardianSchema = z.object({
  name: z.string().min(1).optional(),
  doc: z.string().optional(),
  phone: z.string().optional(),
  relation: z.string().optional(),
  email: z.string().email().optional(),
});

router.get("/", authMiddleware(["direccion", "subdireccion", "oficina"]), async (req, res) => {
  const studentId = req.query.studentId as string | undefined;
  const client = await pool.connect();
  try {
    const guardians = await listGuardians(client, studentId);
    res.json(guardians);
  } finally {
    client.release();
  }
});

router.get("/:id", authMiddleware(["direccion", "subdireccion", "oficina"]), async (req, res) => {
  const parsed = guardianIdSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ error: "ID de apoderado inválido." });
    return;
  }
  const client = await pool.connect();
  try {
    const guardian = await getGuardian(client, parsed.data);
    if (!guardian) {
      res.status(404).json({ error: "Apoderado no encontrado." });
      return;
    }
    res.json(guardian);
  } finally {
    client.release();
  }
});

router.post("/", authMiddleware(["direccion", "subdireccion", "oficina"]), async (req: any, res) => {
  const parsed = createGuardianSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos de apoderado inválidos.", details: parsed.error.flatten() });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const guardian = await createGuardian(client, parsed.data, req.user?.username ?? "demo");
    await client.query("COMMIT");
    res.status(201).json(guardian);
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

router.put("/:id", authMiddleware(["direccion", "subdireccion", "oficina"]), async (req: any, res) => {
  const parsedId = guardianIdSchema.safeParse(req.params.id);
  const parsedBody = updateGuardianSchema.safeParse(req.body);
  if (!parsedId.success || !parsedBody.success) {
    res.status(400).json({ error: "Datos inválidos." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const guardian = await updateGuardian(client, parsedId.data, parsedBody.data, req.user?.username ?? "demo");
    await client.query("COMMIT");
    res.json(guardian);
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

router.delete("/:id", authMiddleware(["direccion", "subdireccion", "oficina"]), async (req: any, res) => {
  const parsed = guardianIdSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ error: "ID de apoderado inválido." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await deleteGuardian(client, parsed.data, req.user?.username ?? "demo");
    await client.query("COMMIT");
    res.json({ message: "Apoderado eliminado." });
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
