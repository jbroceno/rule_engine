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
// requireRole("admin") gates the admin surface at the single mount point
// (design.md § "Punto de gate RBAC") — authMiddleware (app.js) already
// guarantees req.user for these non-public paths.
router.use("/admin", requireRole("admin"), adminRoutes);
// /workflow intentionally has NO role gate: workflow_routes.js only exposes
// POST /workflow/condiciones-hipotecas, a real-time eligibility query that is
// a peer of /simulate/* in privilege level (any authenticated role), not an
// admin/publish action. The actual WF-publish actions (postWorkflowSnapshot,
// postWorkflowPublicar) live under /api/admin/workflow/*, already covered by
// the /admin gate above. Corrected during PR1 code review — see
// openspec/changes/rbac-and-config-safeguards/proposal.md § Amendment.
router.use("/workflow", workflowRoutes);

export default router;
