import { Router } from "express";
import authRoutes from "./auth.js";
import sectionsRoutes from "./sections.js";
import studentsRoutes from "./students.js";
import attendanceRoutes from "./attendance.js";
import personnelRoutes from "./personnel.js";
import guardiansRoutes from "./guardians.js";
import alertsRoutes from "./alerts.js";
import futsRoutes from "./futs.js";
import reportsRoutes from "./reports.js";
import calendarRoutes from "./calendar.js";
import credentialsRoutes from "./credentials.js";
import usersRoutes from "./users.js";
import auditRoutes from "./audit.js";
import configRoutes from "./config.js";
import familyRoutes from "./family.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/sections", sectionsRoutes);
router.use("/students", studentsRoutes);
router.use("/attendance", attendanceRoutes);
router.use("/personnel", personnelRoutes);
router.use("/guardians", guardiansRoutes);
router.use("/alerts", alertsRoutes);
router.use("/futs", futsRoutes);
router.use("/reports", reportsRoutes);
router.use("/calendar", calendarRoutes);
router.use("/credentials", credentialsRoutes);
router.use("/users", usersRoutes);
router.use("/audit", auditRoutes);
router.use("/config", configRoutes);
router.use("/family", familyRoutes);

router.get("/health", async (_req, res) => {
  res.json({ status: "ok", service: "SIGMA 21001 API" });
});

export default router;
