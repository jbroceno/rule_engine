import { Router } from "express";

import authRoutes from "./auth_routes.js";
import adminRoutes from "./admin_routes.js";
import workflowRoutes from "./workflow_routes.js";
import { getConfig } from "../controllers/config_controller.js";
import { getHealth } from "../controllers/health_controller.js";
import { simulateFinal, simulateInit, simulatePre } from "../controllers/simulate_controller.js";

const router = Router();

router.get("/health", getHealth);
router.get("/config", getConfig);
router.post("/simulate/init", simulateInit);
router.post("/simulate/pre", simulatePre);
router.post("/simulate/final", simulateFinal);
router.use("/auth", authRoutes);
router.use("/admin", adminRoutes);
router.use("/workflow", workflowRoutes);

export default router;
