/**
 * test/require_role.test.js — TDD tests for require_role.js
 *
 * Follows the pattern established by test/auth_middleware.test.js: a minimal
 * fake req/res/next, no live Express app, no DB, no JWT signing.
 *
 * Spec ref: openspec/changes/rbac-and-config-safeguards/specs/admin-rbac/spec.md
 *   - "Usuario viewer recibe 403 en ruta admin"
 *   - "Sin token sigue siendo 401, no 403"
 *   - "Rol permitido en lista de varios roles"
 *   - "Rol no reconocido en el catálogo"
 */
import test from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../api/utils/app_error.js";

// ---------------------------------------------------------------------------
// Import factory (RED until the file exists)
// ---------------------------------------------------------------------------
const { requireRole } = await import("../api/middleware/require_role.js");

/**
 * Run the middleware and collect next() argument.
 * Returns { err } where err is undefined if next() called with no error.
 */
function runMiddleware(mw, req) {
  let capturedErr;
  let nextCalled = false;
  const next = (err) => {
    nextCalled = true;
    capturedErr = err;
  };
  mw(req, {}, next);
  return { err: capturedErr, nextCalled };
}

// ---------------------------------------------------------------------------
// 403 for wrong role
// ---------------------------------------------------------------------------

test("req.user.role = 'viewer' against requireRole('admin') → 403 AppError", () => {
  const mw = requireRole("admin");
  const req = { user: { userId: 1, email: "v@example.com", role: "viewer" } };
  const { err } = runMiddleware(mw, req);
  assert.ok(err instanceof AppError, "expected AppError");
  assert.equal(err.statusCode, 403);
});

// ---------------------------------------------------------------------------
// next() called with no error for allowed role
// ---------------------------------------------------------------------------

test("req.user.role = 'admin' against requireRole('admin') → next() with no error", () => {
  const mw = requireRole("admin");
  const req = { user: { userId: 2, email: "a@example.com", role: "admin" } };
  const { err, nextCalled } = runMiddleware(mw, req);
  assert.equal(nextCalled, true, "next() should be called");
  assert.equal(err, undefined, "next() should be called with no error");
});

// ---------------------------------------------------------------------------
// 401 defensive when req.user is missing
// ---------------------------------------------------------------------------

test("req.user absent → 401 AppError (defensive, requireRole never runs unauthenticated)", () => {
  const mw = requireRole("admin");
  const req = {};
  const { err } = runMiddleware(mw, req);
  assert.ok(err instanceof AppError, "expected AppError");
  assert.equal(err.statusCode, 401);
});

// ---------------------------------------------------------------------------
// Multi-role list: requireRole("admin","viewer") passes a viewer
// ---------------------------------------------------------------------------

test("requireRole('admin','viewer') with role='viewer' → next() with no error", () => {
  const mw = requireRole("admin", "viewer");
  const req = { user: { userId: 3, email: "v2@example.com", role: "viewer" } };
  const { err, nextCalled } = runMiddleware(mw, req);
  assert.equal(nextCalled, true, "next() should be called");
  assert.equal(err, undefined, "next() should be called with no error");
});

// ---------------------------------------------------------------------------
// Unrecognized role (not in ALLOWED_ROLES) still 403, not 5xx
// ---------------------------------------------------------------------------

test("unrecognized role (not in ALLOWED_ROLES) → 403, not a 5xx error", () => {
  const mw = requireRole("admin");
  const req = { user: { userId: 4, email: "x@example.com", role: "superuser" } };
  const { err } = runMiddleware(mw, req);
  assert.ok(err instanceof AppError, "expected AppError, not an uncaught exception");
  assert.equal(err.statusCode, 403);
});

// ---------------------------------------------------------------------------
// Fail-fast at construction time when requireRole(...) is called with a role
// argument not in ALLOWED_ROLES (e.g. a typo'd call site) — silently dropping
// it would produce a middleware whose allow-set is empty and that therefore
// 403s EVERY request forever, with no startup signal.
// ---------------------------------------------------------------------------

test("requireRole('not-a-real-role') throws synchronously at construction time", () => {
  assert.throws(
    () => requireRole("not-a-real-role"),
    /not-a-real-role/,
    "expected a construction-time throw naming the invalid role"
  );
});

test("requireRole('admin', 'not-a-real-role') throws — one invalid role among valid ones still fails fast", () => {
  assert.throws(() => requireRole("admin", "not-a-real-role"), /not-a-real-role/);
});
