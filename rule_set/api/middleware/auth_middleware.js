/**
 * api/middleware/auth_middleware.js — JWT Bearer-token auth middleware
 *
 * PITFALL (CJS interop): jsonwebtoken ships CommonJS. Under type:module use the
 * default import — named imports (`import { verify } from "jsonwebtoken"`) do NOT
 * resolve under ESM interop and would silently be undefined.
 *
 * Placement in app.js:
 *   AFTER  express.json({ limit: "1mb" })
 *   BEFORE app.use("/api", apiRoutes)
 * Mounted at app root (app.use(authMiddleware)) — no path prefix — so
 * req.path contains the full path including "/api". Public-path matching
 * therefore uses exact full paths (see isPublic below).
 *
 * Design decision ADR-A1: explicit method+path predicate for public paths,
 * NOT a prefix or regex, to prevent:
 *   - /api/healthcheck accidentally matching /api/health
 *   - Future /api/auth/refresh accidentally becoming public
 *   - Wrong HTTP method (e.g. POST /api/health) bypassing auth
 */
import jwt from "jsonwebtoken"; // default import required — CJS interop
import { env } from "../config/env.js";
import { AppError } from "../utils/app_error.js";

/**
 * Public-path predicate.
 * Only exact method+path pairs bypass authentication.
 *
 * @param {{ method: string, path: string }} req
 * @returns {boolean}
 */
function isPublic(req) {
  if (req.method === "GET" && req.path === "/api/health") return true;
  if (req.method === "POST" && req.path === "/api/auth/login") return true;
  return false;
}

/**
 * Factory that returns the auth middleware bound to a specific verifier.
 * Tests inject a fake `verify` to avoid real crypto and a live secret.
 *
 * @param {object} [opts]
 * @param {(token: string) => object} [opts.verify] - Synchronously verify token; throw on invalid.
 * @returns {import('express').RequestHandler}
 */
export function createAuthMiddleware({
  verify = (token) => jwt.verify(token, env.auth.jwtSecret),
} = {}) {
  return function authMiddleware(req, _res, next) {
    // Public paths bypass auth entirely — next() with no error.
    if (isPublic(req)) return next();

    const header = req.headers?.["authorization"] || "";

    // Must start with "Bearer " (note the space).
    if (!header.startsWith("Bearer ")) {
      return next(new AppError("No autorizado: falta el token Bearer.", 401));
    }

    // The token is everything after "Bearer " — reject empty strings.
    const token = header.slice("Bearer ".length).trim();
    if (!token) {
      return next(new AppError("No autorizado: token vacío.", 401));
    }

    try {
      const payload = verify(token);
      // Attach user info to req — available to downstream handlers.
      req.user = {
        userId: payload.sub,
        email: payload.email,
        role: payload.role,
      };
      return next();
    } catch (_err) {
      // jwt.JsonWebTokenError / jwt.TokenExpiredError both treated as uniform 401.
      // Distinguishing classes is optional/diagnostic only (ADR-A1).
      return next(new AppError("No autorizado: token inválido o expirado.", 401));
    }
  };
}

/** Default singleton — mounted in app.js. */
export const authMiddleware = createAuthMiddleware();
