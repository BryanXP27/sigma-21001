import { Router } from "express";
import { z } from "zod";
import {
  listAudit,
  countAudit,
  exportAudit,
} from "../modules/audit/index.js";
import { pool } from "../db.js";
import { authMiddleware } from "../core/auth.js";

const router = Router();

const auditQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).transform(Number).optional().default(100),
  offset: z.string().regex(/^\d+$/).transform(Number).optional().default(0),
  search: z.string().optional(),
});

router.get("/", authMiddleware(["direccion", "subdireccion", "oficina"]), async (req: any, res) => {
  const parsed = auditQuerySchema.safeParse({
    limit: req.query.limit,
    offset: req.query.offset,
    search: req.query.search,
  });
  if (!parsed.success) {
    res.status(400).json({ error: "Parámetros inválidos." });
    return;
  }

  const client = await pool.connect();
  try {
    const [logs, total] = await Promise.all([
      listAudit(client, parsed.data.limit, parsed.data.offset, parsed.data.search),
      countAudit(client, parsed.data.search),
    ]);
    res.json({ logs, total, limit: parsed.data.limit, offset: parsed.data.offset });
  } finally {
    client.release();
  }
});

router.get("/export", authMiddleware(["direccion", "subdireccion", "oficina"]), async (_req, res) => {
  const client = await pool.connect();
  try {
    const logs = await exportAudit(client);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="sigma-bitacora.csv"');
    const lines = ["Fecha y hora,Responsable,Evento"];
    for (const log of logs) {
      lines.push(`${log.at},"${log.by_user}","${log.event}"`);
    }
    res.send(lines.join("\r\n"));
  } finally {
    client.release();
  }
});

export default router;
