/**
 * api/middleware/require_role.js — role-based authorization middleware factory
 *
 * Mirrors the factory pattern established by createAuthMiddleware in
 * auth_middleware.js: a factory function that returns an Express middleware,
 * so it can be unit-tested in isolation with a fake req/res/next (no live
 * Express app, no JWT, no DB).
 *
 * Placement: mounted as the SECOND middleware at the router mount point in
 * routes/index.js (e.g. router.use("/admin", requireRole("admin"), adminRoutes)),
 * never per-controller — a single gate point protects the whole surface.
 *
 * Ordering guarantee: authMiddleware (app.js, mounted at app root before
 * app.use("/api", apiRoutes)) already runs first and attaches req.user for
 * any non-public path. requireRole therefore only reads req.user.role; the
 * defensive 401 branch below exists so this middleware is self-contained and
 * testable without mounting the full chain (design.md § Architecture
 * Decisions — "req.user ausente en requireRole").
 */
import { AppError } from "../utils/app_error.js";
import { ALLOWED_ROLES, normalizeRole } from "../utils/rule_catalogs.js";

/**
 * Factory that returns an Express middleware requiring req.user.role to be
 * one of the given allowed roles.
 *
 * @param {...string} roles - Allowed roles (e.g. "admin", "viewer").
 * @returns {import('express').RequestHandler}
 */
export function requireRole(...roles) {
  const normalizedRoles = roles.map(normalizeRole);
  const invalidRoles = normalizedRoles.filter((r) => !ALLOWED_ROLES.has(r));

  // Fail fast at construction time (app-init), not at request time: silently
  // dropping an unrecognized role here would produce a middleware whose
  // allow-set is empty (or smaller than intended), 403-ing EVERY request
  // forever with no startup signal — e.g. a typo'd requireRole("admni").
  // This is a programmer/config error, not an HTTP request error, so we throw
  // a plain Error rather than an AppError (matches assertAuthConfig() in
  // api/config/env.js, the existing convention for startup/config failures).
  if (invalidRoles.length > 0) {
    throw new Error(
      `requireRole(): rol(es) no reconocido(s) en ALLOWED_ROLES: ${invalidRoles.join(", ")}`
    );
  }

  const allowed = new Set(normalizedRoles);

  return function requireRoleMiddleware(req, _res, next) {
    // Defensive: requireRole must never assume req.user exists. authMiddleware
    // guarantees it in production, but this keeps the middleware self-contained.
    if (!req.user) {
      return next(new AppError("No autorizado: sesión no válida.", 401));
    }

    const role = normalizeRole(req.user.role);

    // Unrecognized role (not in ALLOWED_ROLES) or not in the allowed list for
    // this route → 403, never a 5xx.
    if (!allowed.has(role)) {
      return next(
        new AppError("No tienes permisos de administrador para realizar esta acción.", 403)
      );
    }

    return next();
  };
}
