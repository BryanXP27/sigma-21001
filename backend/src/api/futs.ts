import { Router } from "express";
import { z } from "zod";
import {
  listFuts,
  getFut,
  createFut,
  resolveFut,
  deleteFut,
} from "../modules/futs/index.js";
import { pool } from "../db.js";
import { authMiddleware, isStudentInSectionOnDate } from "../core/auth.js";
import { AppError } from "../core/errors.js";
import { isValidSchoolDate } from "../core/time.js";

const router = Router();

const futIdSchema = z.string().uuid();

const createFutSchema = z.object({
  student_id: z.string().regex(/^\d{14}$/, "Código SIAGIE de 14 dígitos"),
  fut_date: z.string().refine(isValidSchoolDate, "Fecha inválida"),
  ref: z.string().min(1),
  reason: z.string().min(1),
  status: z.enum(["Pendiente", "Aprobada", "Rechazada"]).optional(),
});

const resolveFutSchema = z.object({
  result: z.enum(["Aprobada", "Rechazada"]),
});

router.get("/", authMiddleware(), async (req: any, res) => {
  const studentId = req.query.studentId as string | undefined;
  const status = req.query.status as string | undefined;
  const client = await pool.connect();
  try {
    const sectionId = ["docente", "auxiliar"].includes(req.user?.role) ? "3A" : undefined;
    const futs = await listFuts(client, studentId, status, sectionId);
    res.json(futs);
  } finally {
    client.release();
  }
});

router.get("/:id", authMiddleware(), async (req: any, res) => {
  const parsed = futIdSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ error: "ID de FUT inválido." });
    return;
  }
  const client = await pool.connect();
  try {
    const fut = await getFut(client, parsed.data);
    if (!fut) {
      res.status(404).json({ error: "Solicitud FUT no encontrada." });
      return;
    }
    if (
      ["docente", "auxiliar"].includes(req.user?.role) &&
      !(await isStudentInSectionOnDate(
        client,
        fut.student_id,
        "3A",
        fut.fut_date instanceof Date
          ? fut.fut_date.toISOString().slice(0, 10)
          : String(fut.fut_date).slice(0, 10)
      ))
    ) {
      res.status(404).json({ error: "Solicitud FUT no encontrada." });
      return;
    }
    res.json(fut);
  } finally {
    client.release();
  }
});

router.post("/", authMiddleware(["direccion", "subdireccion", "pip", "oficina", "docente", "auxiliar"]), async (req: any, res) => {
  const parsed = createFutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos de FUT inválidos.", details: parsed.error.flatten() });
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
        parsed.data.fut_date
      ))
    ) {
      res.status(404).json({ error: "Estudiante no encontrado." });
      return;
    }
    await client.query("BEGIN");
    const fut = await createFut(client, parsed.data, req.user?.username ?? "demo");
    await client.query("COMMIT");
    res.status(201).json(fut);
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

router.patch("/:id/resolve", authMiddleware(["direccion", "subdireccion"]), async (req: any, res) => {
  const parsedId = futIdSchema.safeParse(req.params.id);
  const parsedBody = resolveFutSchema.safeParse(req.body);
  if (!parsedId.success || !parsedBody.success) {
    res.status(400).json({ error: "Datos inválidos." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const fut = await resolveFut(client, parsedId.data, parsedBody.data.result, req.user?.username ?? "demo");
    await client.query("COMMIT");
    res.json(fut);
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
  const parsed = futIdSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ error: "ID de FUT inválido." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await deleteFut(client, parsed.data, req.user?.username ?? "demo");
    await client.query("COMMIT");
    res.json({ message: "Solicitud FUT eliminada." });
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
