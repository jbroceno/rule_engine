/**
 * api/routes/public_config_routes.js — read-only, public-adjacent config surface
 * (sdd/permissive-config-readonly — design.md ADR-CR1)
 *
 * Mounted at "/config" in routes/index.js, OUTSIDE the /api/admin/* mount, so
 * /api/admin/* reachability is completely untouched by this module.
 *
 * Re-registers the SAME thin, read-only admin controller handlers already used
 * by GET /api/admin/rules|params|offers|fechas — zero duplicated business
 * logic, single source of truth for read-response shape. Query filters
 * (offerCode/stage/q/offerDateId) pass through verbatim since the controllers
 * read req.query directly.
 *
 * Reachability for anonymous callers is opened ONLY in AUTH_MODE=permissive,
 * via 4 additive entries in auth_middleware.js's PERMISSIVE_ONLY_PUBLIC list
 * (exact method+path match, same mechanism as the existing /api/config entry).
 * This module does not gate anything itself — no requireRole here, by design
 * (see design.md ADR-CR1/CR2).
 */
import { Router } from "express";

import { getRules } from "../controllers/admin_rules_controller.js";
import { getParams } from "../controllers/admin_params_controller.js";
import { getOffers } from "../controllers/admin_offers_controller.js";
import { getFechas } from "../controllers/admin_fechas_controller.js";

const publicConfigRouter = Router();

publicConfigRouter.get("/rules", getRules);
publicConfigRouter.get("/params", getParams);
publicConfigRouter.get("/offers", getOffers);
publicConfigRouter.get("/fechas", getFechas);

export default publicConfigRouter;
