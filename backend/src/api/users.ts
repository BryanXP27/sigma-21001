import { Router } from "express";
import { z } from "zod";
import {
  listUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
} from "../modules/users/index.js";
import { pool } from "../db.js";
import { authMiddleware } from "../core/auth.js";
import { AppError } from "../core/errors.js";

const router = Router();

const userIdSchema = z.string().uuid();

const createUserSchema = z.object({
  username: z.string().min(3, "El usuario debe tener al menos 3 caracteres."),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres."),
  full_name: z.string().min(1, "El nombre completo es requerido."),
  role: z.enum([
    "direccion", "subdireccion", "pip", "oficina", "docente", "auxiliar", "apoderado"
  ]),
  active: z.boolean().optional(),
  phone: z.string().regex(/^9\d{8}$/).optional(),
});

const updateUserSchema = z.object({
  full_name: z.string().min(1).optional(),
  role: z.enum([
    "direccion", "subdireccion", "pip", "oficina", "docente", "auxiliar", "apoderado"
  ]).optional(),
  active: z.boolean().optional(),
  password: z.string().min(6).optional(),
  phone: z.string().regex(/^9\d{8}$/).nullable().optional(),
});

router.get("/", authMiddleware(["direccion", "subdireccion", "pip", "oficina"]), async (_req, res) => {
  const client = await pool.connect();
  try {
    const users = await listUsers(client);
    res.json(users);
  } finally {
    client.release();
  }
});

router.get("/:id", authMiddleware(["direccion", "subdireccion", "pip", "oficina"]), async (req, res) => {
  const parsed = userIdSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ error: "ID de usuario inválido." });
    return;
  }
  const client = await pool.connect();
  try {
    const user = await getUser(client, parsed.data);
    if (!user) {
      res.status(404).json({ error: "Usuario no encontrado." });
      return;
    }
    res.json(user);
  } finally {
    client.release();
  }
});

router.post("/", authMiddleware(["direccion", "subdireccion", "pip", "oficina"]), async (req: any, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos de usuario inválidos.", details: parsed.error.flatten() });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const user = await createUser(client, parsed.data, req.user?.username ?? "demo");
    await client.query("COMMIT");
    res.status(201).json(user);
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
  const parsedId = userIdSchema.safeParse(req.params.id);
  const parsedBody = updateUserSchema.safeParse(req.body);
  if (!parsedId.success || !parsedBody.success) {
    res.status(400).json({ error: "Datos inválidos." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const user = await updateUser(client, parsedId.data, parsedBody.data, req.user?.username ?? "demo");
    await client.query("COMMIT");
    res.json(user);
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
  const parsed = userIdSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ error: "ID de usuario inválido." });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await deleteUser(client, parsed.data, req.user?.username ?? "demo");
    await client.query("COMMIT");
    res.json({ message: "Usuario eliminado." });
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
