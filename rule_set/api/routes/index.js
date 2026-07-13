import { Router } from "express";

import authRoutes from "./auth_routes.js";
import adminRoutes from "./admin_routes.js";
import workflowRoutes from "./workflow_routes.js";
import { getConfig } from "../controllers/config_controller.js";
import { getHealth } from "../controllers/health_controller.js";
import { simulateFinal, simulateInit, simulatePre } from "../controllers/simulate_controller.js";
import { requireRole } from "../middleware/require_role.js";

const router = Router();

router.get("/health", getHealth);
router.get("/config", getConfig);
router.post("/simulate/init", simulateInit);
router.post("/simulate/pre", simulatePre);
router.post("/simulate/final", simulateFinal);
router.use("/auth", authRoutes);
// requireRole("admin") gates the entire admin/workflow surface at the single
// mount point (design.md § "Punto de gate RBAC") — authMiddleware (app.js)
// already guarantees req.user for these non-public paths.
router.use("/admin", requireRole("admin"), adminRoutes);
router.use("/workflow", requireRole("admin"), workflowRoutes);

export default router;
