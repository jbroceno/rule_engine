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
 * therefore uses exact full paths (see buildPublicSet below).
 *
 * Design decision ADR-A1: explicit method+path predicate for public paths,
 * NOT a prefix or regex, to prevent:
 *   - /api/healthcheck accidentally matching /api/health
 *   - Future /api/auth/refresh accidentally becoming public
 *   - Wrong HTTP method (e.g. POST /api/health) bypassing auth
 *
 * Configurable auth modes (sdd/configurable-auth-modes — design.md ADR-D2):
 * ALWAYS_PUBLIC bypasses auth regardless of mode. PERMISSIVE_ONLY_PUBLIC
 * additionally bypasses auth ONLY when mode === "permissive". The factory
 * computes the effective public-path Set ONCE at creation time (not
 * per-request) from these two lists — /api/admin/* must NEVER appear in
 * either list, in any mode (see spec.md "Admin surface never public").
 */
import jwt from "jsonwebtoken"; // default import required — CJS interop
import { env } from "../config/env.js";
import { AppError } from "../utils/app_error.js";
import { normalizeAuthMode } from "../utils/rule_catalogs.js";

/** Public in BOTH modes. */
const ALWAYS_PUBLIC = [
  { method: "GET", path: "/api/health" },
  { method: "POST", path: "/api/auth/login" },
];

/** Public ONLY when mode === "permissive". Never includes /api/admin/*. */
const PERMISSIVE_ONLY_PUBLIC = [
  { method: "GET", path: "/api/config" },
  { method: "POST", path: "/api/simulate/init" },
  { method: "POST", path: "/api/simulate/pre" },
  { method: "POST", path: "/api/simulate/final" },
  { method: "POST", path: "/api/workflow/condiciones-hipotecas" },
  // sdd/permissive-config-readonly — design.md ADR-CR2: additive-only entries
  // for the new sibling-of-/api/config read surface (public_config_routes.js).
  // Additive data, not a logic change — buildPublicSet/exact-match unchanged.
  { method: "GET", path: "/api/config/rules" },
  { method: "GET", path: "/api/config/params" },
  { method: "GET", path: "/api/config/offers" },
  { method: "GET", path: "/api/config/fechas" },
];

function toKey({ method, path }) {
  return `${method} ${path}`;
}

/**
 * Build the effective public-path Set for a given mode. Computed once per
 * factory call (not per-request) — see createAuthMiddleware below.
 *
 * @param {string} mode - "permissive" | "secure" (any other value -> secure).
 * @returns {Set<string>}
 */
function buildPublicSet(mode) {
  const permissive = normalizeAuthMode(mode) === "permissive";
  const entries = permissive ? [...ALWAYS_PUBLIC, ...PERMISSIVE_ONLY_PUBLIC] : ALWAYS_PUBLIC;
  return new Set(entries.map(toKey));
}

/**
 * Factory that returns the auth middleware bound to a specific verifier.
 * Tests inject a fake `verify` to avoid real crypto and a live secret.
 *
 * @param {object} [opts]
 * @param {(token: string) => object} [opts.verify] - Synchronously verify token; throw on invalid.
 * @param {string} [opts.mode] - "permissive" | "secure". Defaults to env.auth.mode.
 * @returns {import('express').RequestHandler}
 */
export function createAuthMiddleware({
  verify = (token) => jwt.verify(token, env.auth.jwtSecret),
  mode = env.auth.mode,
} = {}) {
  // Computed ONCE at creation time, not per-request (design.md ADR-D2).
  const publicSet = buildPublicSet(mode);

  return function authMiddleware(req, _res, next) {
    // Public paths bypass auth entirely — next() with no error.
    if (publicSet.has(toKey({ method: req.method, path: req.path }))) return next();

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
