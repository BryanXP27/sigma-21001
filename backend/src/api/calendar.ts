import { Router } from "express";
import { z } from "zod";
import {
  listCalendar,
  getCalendarDay,
  upsertCalendarDay,
  deleteCalendarDay,
  listTerms,
  upsertTerms,
} from "../modules/calendar/index.js";
import { pool } from "../db.js";
import { authMiddleware } from "../core/auth.js";
import { AppError } from "../core/errors.js";
import { isValidSchoolDate } from "../core/time.js";

const router = Router();

const calendarDaySchema = z.object({
  school_date: z.string().refine(isValidSchoolDate, "Fecha inválida"),
  lective: z.boolean(),
  reason: z.string().optional(),
});

const termsSchema = z.object({
  yearId: z.number().int().positive(),
  terms: z.array(
    z.object({
      starts_on: z.string().refine(isValidSchoolDate),
      ends_on: z.string().refine(isValidSchoolDate),
    })
  ),
});

router.get("/", authMiddleware(), async (req, res) => {
  const year = req.query.year as string | undefined;
  const month = req.query.month as string | undefined;
  const client = await pool.connect();
  try {
    const days = await listCalendar(client, year, month);
    res.json(days);
  } finally {
    client.release();
  }
});

router.get("/terms", authMiddleware(), async (req, res) => {
  const yearId = req.query.yearId ? Number(req.query.yearId) : undefined;
  const client = await pool.connect();
  try {
    const terms = await listTerms(client, yearId);
    res.json(terms);
  } finally {
    client.release();
  }
});

router.put("/terms", authMiddleware(["direccion", "subdireccion"]), async (req: any, res) => {
  const parsed = termsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos de bimestres inválidos.", details: parsed.error.flatten() });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await upsertTerms(client, parsed.data.terms, parsed.data.yearId, req.user?.username ?? "demo");
    await client.query("COMMIT");
    res.json({ message: "Bimestres actualizados." });
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

router.get("/:date", authMiddleware(), async (req, res) => {
  const client = await pool.connect();
  try {
    const day = await getCalendarDay(client, req.params.date);
    if (!day) {
      res.status(404).json({ error: "Día no encontrado en el calendario." });
      return;
    }
    res.json(day);
  } finally {
    client.release();
  }
});

router.put("/:date", authMiddleware(["direccion", "subdireccion", "pip", "oficina"]), async (req: any, res) => {
  const parsed = calendarDaySchema.safeParse({ ...req.body, school_date: req.params.date });
  if (!parsed.success) {
    res.status(400).json({ error: "Datos inválidos.", details: parsed.error.flatten() });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const day = await upsertCalendarDay(client, parsed.data as { school_date: string; lective: boolean; reason: string }, (req as any).user?.username ?? "demo");
    await client.query("COMMIT");
    res.json(day);
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

router.delete("/:date", authMiddleware(["direccion", "subdireccion"]), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await deleteCalendarDay(client, req.params.date, (req as any).user?.username ?? "demo");
    await client.query("COMMIT");
    res.json({ message: "Día eliminado del calendario." });
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
