/**
 * api/routes/auth_routes.js — Authentication routes
 * Mounted at /api/auth in routes/index.js.
 */
import { Router } from "express";
import { login } from "../controllers/auth_controller.js";

const router = Router();

router.post("/login", login);

export default router;
