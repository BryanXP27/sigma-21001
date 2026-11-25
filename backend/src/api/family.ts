import { Router } from "express";
import { pool } from "../db.js";
import { authMiddleware } from "../core/auth.js";
import { getFamilyOverview } from "../modules/family/index.js";

const router = Router();

router.get("/overview", authMiddleware(["apoderado"]), async (req: any, res) => {
  const client = await pool.connect();
  try {
    const students = await getFamilyOverview(client, req.user.userId);
    res.json({
      guardianName: students[0]?.guardianName ?? null,
      students,
    });
  } finally {
    client.release();
  }
});

export default router;
