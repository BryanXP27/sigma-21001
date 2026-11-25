import { Router } from "express";
import { z } from "zod";
import {
  generateStudentReport,
  generateStaffReport,
  archiveReport,
  listArchivedReports,
  getArchivedReport,
} from "../modules/reports/index.js";
import { pool } from "../db.js";
import { authMiddleware } from "../core/auth.js";
import { AppError } from "../core/errors.js";
import { isValidSchoolDate } from "../core/time.js";

const router = Router();

const reportParamsSchema = z.object({
  from: z.string().refine(isValidSchoolDate, "Fecha inválida"),
  to: z.string().refine(isValidSchoolDate, "Fecha inválida"),
  section: z.string().optional(),
});

const archiveSchema = z.object({
  title: z.string().min(1),
  kind: z.enum(["students", "staff"]),
  from_date: z.string().refine(isValidSchoolDate),
  to_date: z.string().refine(isValidSchoolDate),
  headers: z.any(),
  rows: z.any(),
}).refine((value) => value.from_date <= value.to_date, {
  message: "La fecha de inicio no puede ser posterior a la fecha de fin.",
  path: ["to_date"],
});

router.get("/", authMiddleware(), async (req: any, res) => {
  const parsed = reportParamsSchema.safeParse({
    from: req.query.from,
    to: req.query.to,
    section: req.query.section,
  });
  if (!parsed.success) {
    res.status(400).json({ error: "Parámetros de reporte inválidos." });
    return;
  }

  const { from, to, section } = parsed.data;
  const modeParsed = z.enum(["students", "staff"]).safeParse(req.query.mode ?? "students");
  if (!modeParsed.success) {
    res.status(400).json({ error: "Tipo de reporte inválido." });
    return;
  }
  const mode = modeParsed.data;
  const teacherSection = ["docente", "auxiliar"].includes(req.user?.role)
    ? "3A"
    : undefined;
  if (teacherSection && (mode === "staff" || (section && section !== teacherSection))) {
    res.status(403).json({ error: "Este perfil solo puede consultar el reporte de estudiantes de su sección." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let result;
    if (mode === "staff") {
      result = await generateStaffReport(client, from, to, req.user?.username ?? "demo");
    } else {
      result = await generateStudentReport(
        client,
        from,
        to,
        teacherSection ?? section,
        req.user?.username ?? "demo"
      );
    }
    await client.query("COMMIT");
    res.json({
      headers: result.headers,
      columns: result.columns,
      rows: result.rows,
      mode,
      from,
      to,
    });
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

router.post("/archive", authMiddleware(["direccion", "subdireccion", "pip", "oficina"]), async (req: any, res) => {
  const parsed = archiveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos de archivo inválidos." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const archived = await archiveReport(
      client,
      {
        ...parsed.data,
        generated_by: req.user?.username ?? "demo",
        role: req.user?.role ?? "demo",
      },
      req.user?.username ?? "demo"
    );
    await client.query("COMMIT");
    res.status(201).json(archived);
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

router.get("/archives", authMiddleware(), async (req: any, res) => {
  const client = await pool.connect();
  try {
    const sectionId = ["docente", "auxiliar"].includes(req.user?.role) ? "3A" : undefined;
    const archives = await listArchivedReports(client, req.user?.role, sectionId);
    res.json(archives);
  } finally {
    client.release();
  }
});

router.get("/archives/:id", authMiddleware(), async (req: any, res) => {
  const client = await pool.connect();
  try {
    const archive = await getArchivedReport(client, req.params.id);
    if (!archive) {
      res.status(404).json({ error: "Reporte archivado no encontrado." });
      return;
    }
    if (
      ["docente", "auxiliar"].includes(req.user?.role) &&
      (archive.kind !== "students" || archive.section_id !== "3A")
    ) {
      res.status(404).json({ error: "Reporte archivado no encontrado." });
      return;
    }
    res.json(archive);
  } finally {
    client.release();
  }
});

export default router;
