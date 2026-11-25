import { Router } from "express";
import { z } from "zod";
import {
  listStudents,
  getStudent,
  createStudent,
  updateStudent,
  deleteStudent,
  importStudents,
} from "../modules/students/index.js";
import { pool } from "../db.js";
import { authMiddleware, resolveSectionForRole } from "../core/auth.js";
import { AppError } from "../core/errors.js";
import { isValidSchoolDate, peruTodayIso } from "../core/time.js";

const router = Router();

const studentIdSchema = z.string().regex(/^\d{14}$/, "Código SIAGIE de 14 dígitos");

const createStudentSchema = z.object({
  siagie_code: studentIdSchema,
  given_names: z.string().min(1),
  family_names: z.string().min(1),
  doc: z.string().optional(),
  sex: z.enum(["Hombre", "Mujer"]).optional(),
  birth: z.string().optional(),
  active: z.boolean().optional(),
  qr: z.number().int().nonnegative().optional(),
  section_id: z.string().optional(),
  starts_on: z.string().optional(),
});

const updateStudentSchema = z.object({
  given_names: z.string().min(1).optional(),
  family_names: z.string().min(1).optional(),
  doc: z.string().optional(),
  sex: z.enum(["Hombre", "Mujer"]).optional(),
  birth: z.string().optional(),
  active: z.boolean().optional(),
  qr: z.number().int().nonnegative().optional(),
  section_id: z.string().min(1).optional(),
  starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine(
  (value) => Boolean(value.section_id) === Boolean(value.starts_on),
  { message: "La sección y la fecha de cambio deben enviarse juntas." }
);

const directoryStatusSchema = z.enum(["active", "inactive", "all"]);
const dateSchema = z.string().refine(isValidSchoolDate);

router.get("/", authMiddleware(), async (req: any, res) => {
  const requestedSection = req.query.sectionId as string | undefined;
  const sectionId = resolveSectionForRole(
    req.user?.role,
    requestedSection
  );
  if (
    (req.user?.role === "docente" || req.user?.role === "auxiliar") &&
    requestedSection &&
    requestedSection !== sectionId
  ) {
    res.status(403).json({ error: "Solo puedes consultar tu sección asignada (3A)." });
    return;
  }
  const dateParsed = dateSchema.safeParse(req.query.date ?? peruTodayIso());
  const statusParsed = directoryStatusSchema.safeParse(req.query.status ?? "active");
  if (!dateParsed.success || !statusParsed.success) {
    res.status(400).json({ error: "Filtros de fecha o matrícula inválidos." });
    return;
  }
  if (
    ["docente", "auxiliar"].includes(req.user?.role) &&
    statusParsed.data !== "active"
  ) {
    res.status(403).json({ error: "Este perfil solo puede consultar matrículas activas." });
    return;
  }
  const client = await pool.connect();
  try {
    const students = await listStudents(
      client,
      sectionId,
      dateParsed.data,
      statusParsed.data
    );
    res.json(students);
  } finally {
    client.release();
  }
});

router.get("/:siagieCode", authMiddleware(), async (req: any, res) => {
  const parsed = studentIdSchema.safeParse(req.params.siagieCode);
  if (!parsed.success) {
    res.status(400).json({ error: "Código SIAGIE inválido (14 dígitos)." });
    return;
  }
  const client = await pool.connect();
  try {
    const student = await getStudent(client, parsed.data);
    if (
      student &&
      ["docente", "auxiliar"].includes(req.user?.role)
    ) {
      const enrollment = await client.query(
        `SELECT 1
           FROM enrollments
          WHERE student_id = $1 AND section_id = '3A' AND status = 'active'
            AND starts_on <= current_date
            AND (ends_on IS NULL OR ends_on > current_date)`,
        [parsed.data]
      );
      if ((enrollment.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "Estudiante no encontrado." });
        return;
      }
    }
    if (!student) {
      res.status(404).json({ error: "Estudiante no encontrado." });
      return;
    }
    res.json(student);
  } finally {
    client.release();
  }
});

router.post("/", authMiddleware(["direccion", "subdireccion", "pip", "oficina"]), async (req: any, res) => {
  const parsed = createStudentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos de estudiante inválidos.", details: parsed.error.flatten() });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const student = await createStudent(client, parsed.data, req.user?.username ?? "demo");
    await client.query("COMMIT");
    res.status(201).json(student);
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

router.put("/:siagieCode", authMiddleware(["direccion", "subdireccion", "pip", "oficina"]), async (req: any, res) => {
  const parsedId = studentIdSchema.safeParse(req.params.siagieCode);
  const parsedBody = updateStudentSchema.safeParse(req.body);
  if (!parsedId.success || !parsedBody.success) {
    res.status(400).json({ error: "Datos inválidos." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (parsedBody.data.section_id) {
      const section = await client.query(
        `SELECT 1 FROM sections WHERE id = $1`,
        [parsedBody.data.section_id]
      );
      if ((section.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "La sección seleccionada no existe." });
        return;
      }
    }
    const student = await updateStudent(client, parsedId.data, parsedBody.data, req.user?.username ?? "demo");
    await client.query("COMMIT");
    res.json(student);
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

router.delete("/:siagieCode", authMiddleware(["direccion", "subdireccion"]), async (req: any, res) => {
  const parsed = studentIdSchema.safeParse(req.params.siagieCode);
  if (!parsed.success) {
    res.status(400).json({ error: "Código SIAGIE inválido." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await deleteStudent(client, parsed.data, req.user?.username ?? "demo");
    await client.query("COMMIT");
    res.json({ message: "Estudiante eliminado." });
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

router.post("/import", authMiddleware(["direccion", "subdireccion", "pip", "oficina"]), async (req: any, res) => {
  const importSchema = z.object({
    rows: z.array(
      z.object({
        siagie_code: studentIdSchema,
        given_names: z.string().min(1),
        family_names: z.string().min(1),
        doc: z.string().optional(),
        section_id: z.string().optional(),
        active: z.boolean().optional(),
      })
    ),
  });

  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Formato de importación inválido." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await importStudents(client, parsed.data.rows, req.user?.username ?? "demo");
    await client.query("COMMIT");
    res.json(result);
  } catch (error: any) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Error interno del servidor." });
  } finally {
    client.release();
  }
});

export default router;
