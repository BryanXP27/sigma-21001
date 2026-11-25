import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { authMiddleware, logAudit, resolveSectionForRole } from "../core/auth.js";
import { AppError } from "../core/errors.js";

const router = Router();

const sectionIdSchema = z.string().min(1).max(12);
const schoolDateSchema = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});

router.get("/", authMiddleware(), async (req: any, res) => {
  const scoped = resolveSectionForRole(req.user?.role, undefined);
  const params: string[] = [];
  let sql =
    `SELECT s.id, s.level, s.grade, s.label, s.shift, s.tutor,
            concat(s.grade, '° ', s.label) AS "displayName"
       FROM sections s
       JOIN academic_years ay ON ay.id = s.academic_year_id
      WHERE current_date BETWEEN ay.starts_on AND ay.ends_on`;
  if (scoped) {
    params.push(scoped);
    sql += ` AND s.id = $${params.length}`;
  }
  sql += ` ORDER BY s.level, s.grade, s.label`;
  const result = await pool.query(sql, params);
  res.json(result.rows);
});

router.get("/:id", authMiddleware(), async (req: any, res) => {
  const parsed = sectionIdSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ error: "ID de sección inválido." });
    return;
  }
  const allowedSection = resolveSectionForRole(req.user?.role, parsed.data);
  if (allowedSection !== parsed.data) {
    res.status(403).json({ error: "No tienes permiso para consultar esta sección." });
    return;
  }
  const result = await pool.query(
    `SELECT s.id, s.level, s.grade, s.label, s.shift, s.tutor,
            concat(s.grade, '° ', s.label) AS "displayName"
       FROM sections s
      WHERE s.id = $1`,
    [parsed.data]
  );
  if (result.rowCount === 0) {
    res.status(404).json({ error: "Sección no encontrada." });
    return;
  }
  res.json(result.rows[0]);
});

router.put(
  "/",
  authMiddleware(["direccion", "subdireccion"]),
  async (req: any, res) => {
    const schema = z.object({
      sections: z.array(
        z.object({
          id: sectionIdSchema,
          shift: z.enum(["Mañana", "Tarde"]),
          tutor: z.string().trim().max(120).nullable(),
        })
      ).min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Los datos de secciones no son válidos." });
      return;
    }

    const ids = parsed.data.sections.map((section) => section.id);
    if (new Set(ids).size !== ids.length) {
      res.status(400).json({ error: "No repitas secciones en una misma actualización." });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const section of parsed.data.sections) {
        const updated = await client.query(
          `UPDATE sections
              SET shift = $2, tutor = $3
            WHERE id = $1
            RETURNING id`,
          [section.id, section.shift, section.tutor || null]
        );
        if ((updated.rowCount ?? 0) === 0) {
          throw new AppError(`No se encontró la sección ${section.id}.`, 404);
        }
        await logAudit(
          client,
          req.user.username,
          `Se actualizó la sección ${section.id} (turno: ${section.shift}; tutor: ${section.tutor || "sin asignar"})`
        );
      }
      await client.query("COMMIT");
      res.json({ message: "Secciones y tutores guardados." });
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
  }
);

export default router;
