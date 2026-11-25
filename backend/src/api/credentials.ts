import { Router } from "express";
import { z } from "zod";
import {
  listCredentials,
  getCredential,
  reissueQr,
} from "../modules/credentials/index.js";
import { pool } from "../db.js";
import { authMiddleware } from "../core/auth.js";
import { AppError } from "../core/errors.js";

const router = Router();

const typeSchema = z.enum(["students", "staff"]);

router.get("/", authMiddleware(["direccion", "subdireccion", "pip", "oficina"]), async (req, res) => {
  const typeParsed = typeSchema.safeParse(req.query.type);
  if (!typeParsed.success) {
    res.status(400).json({ error: "Tipo inválido (students o staff)." });
    return;
  }
  const activeOnly = req.query.active !== "false";
  const client = await pool.connect();
  try {
    const credentials = await listCredentials(client, typeParsed.data, activeOnly);
    res.json(credentials);
  } finally {
    client.release();
  }
});

router.get("/:type/:id", authMiddleware(["direccion", "subdireccion", "pip", "oficina"]), async (req, res) => {
  const typeParsed = typeSchema.safeParse(req.params.type);
  if (!typeParsed.success) {
    res.status(400).json({ error: "Tipo inválido (students o staff)." });
    return;
  }
  const client = await pool.connect();
  try {
    const credential = await getCredential(client, typeParsed.data, req.params.id);
    if (!credential) {
      res.status(404).json({ error: "Credencial no encontrada." });
      return;
    }
    res.json(credential);
  } finally {
    client.release();
  }
});

router.post("/:type/:id/reissue", authMiddleware(["direccion", "subdireccion", "pip", "oficina"]), async (req: any, res) => {
  const typeParsed = typeSchema.safeParse(req.params.type);
  if (!typeParsed.success) {
    res.status(400).json({ error: "Tipo inválido (students o staff)." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await reissueQr(client, typeParsed.data, req.params.id, req.user?.username ?? "demo");
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
