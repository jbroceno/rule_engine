/**
 * test/auth_middleware.test.js — TDD tests for auth_middleware.js
 *
 * Uses the createAuthMiddleware({ verify }) factory to inject a fake verifier.
 * No live JWT signing/verifying, no secret needed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../api/utils/app_error.js";

// ---------------------------------------------------------------------------
// Import factory (RED until the file exists)
// ---------------------------------------------------------------------------
const { createAuthMiddleware } = await import("../api/middleware/auth_middleware.js");

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Express-like req object.
 * @param {object} opts
 * @param {string} [opts.method]
 * @param {string} [opts.path]
 * @param {string} [opts.authHeader]
 */
function makeReq({ method = "GET", path = "/api/config", authHeader } = {}) {
  return {
    method,
    path,
    headers: authHeader ? { authorization: authHeader } : {},
  };
}

/**
 * Run the middleware and collect next() argument.
 * Returns { err, req } where err is undefined if next() called with no error.
 */
async function runMiddleware(mw, reqOpts) {
  const req = makeReq(reqOpts);
  let capturedErr;
  const next = (err) => { capturedErr = err; };
  mw(req, {}, next);
  return { err: capturedErr, req };
}

// ---------------------------------------------------------------------------
// Tests — missing / malformed header → 401
// ---------------------------------------------------------------------------

test("missing Authorization header → 401 AppError", async () => {
  const mw = createAuthMiddleware({ verify: () => { throw new Error("should not reach"); } });
  const { err } = await runMiddleware(mw, { path: "/api/config" });
  assert.ok(err instanceof AppError, "expected AppError");
  assert.equal(err.statusCode, 401);
});

test("malformed Authorization header (not 'Bearer ...') → 401", async () => {
  const mw = createAuthMiddleware({ verify: () => { throw new Error("should not reach"); } });
  const { err } = await runMiddleware(mw, {
    path: "/api/config",
    authHeader: "Token abc123",
  });
  assert.ok(err instanceof AppError);
  assert.equal(err.statusCode, 401);
});

test("empty token after 'Bearer ' → 401", async () => {
  const mw = createAuthMiddleware({ verify: () => { throw new Error("should not reach"); } });
  const { err } = await runMiddleware(mw, {
    path: "/api/config",
    authHeader: "Bearer ",
  });
  assert.ok(err instanceof AppError);
  assert.equal(err.statusCode, 401);
});

// ---------------------------------------------------------------------------
// Tests — verify throws → 401
// ---------------------------------------------------------------------------

test("injected verify throws → 401 AppError with statusCode 401", async () => {
  const mw = createAuthMiddleware({
    verify: () => { throw new Error("jwt malformed"); },
  });
  const { err } = await runMiddleware(mw, {
    path: "/api/config",
    authHeader: "Bearer invalid.token.here",
  });
  assert.ok(err instanceof AppError);
  assert.equal(err.statusCode, 401);
});

// ---------------------------------------------------------------------------
// Tests — valid token → req.user set + next() without error
// ---------------------------------------------------------------------------

test("valid token → req.user populated and next() called with no error", async () => {
  const payload = { sub: 42, email: "admin@example.com", role: "admin" };
  const mw = createAuthMiddleware({ verify: () => payload });
  const req = makeReq({ path: "/api/config", authHeader: "Bearer valid.token.here" });
  let capturedErr;
  const next = (err) => { capturedErr = err; };
  mw(req, {}, next);

  assert.equal(capturedErr, undefined, "next() should be called with no error");
  assert.deepEqual(req.user, { userId: 42, email: "admin@example.com", role: "admin" });
});

// ---------------------------------------------------------------------------
// Tests — public path bypass
// ---------------------------------------------------------------------------

test("GET /api/health bypasses middleware — no header → next() with no error", async () => {
  const mw = createAuthMiddleware({ verify: () => { throw new Error("should not reach"); } });
  const { err } = await runMiddleware(mw, { method: "GET", path: "/api/health" });
  assert.equal(err, undefined, "GET /api/health should bypass auth");
});

test("POST /api/auth/login bypasses middleware — no header → next() with no error", async () => {
  const mw = createAuthMiddleware({ verify: () => { throw new Error("should not reach"); } });
  const { err } = await runMiddleware(mw, { method: "POST", path: "/api/auth/login" });
  assert.equal(err, undefined, "POST /api/auth/login should bypass auth");
});

// ---------------------------------------------------------------------------
// Tests — exact-match safety (negative public path checks)
// ---------------------------------------------------------------------------

test("GET /api/healthcheck (not /api/health) with no token → 401 (no false bypass)", async () => {
  const mw = createAuthMiddleware({ verify: () => { throw new Error("should not reach"); } });
  const { err } = await runMiddleware(mw, { method: "GET", path: "/api/healthcheck" });
  assert.ok(err instanceof AppError, "expected AppError — /api/healthcheck is NOT public");
  assert.equal(err.statusCode, 401);
});

test("GET /api/health with wrong method (POST) → 401 (method-scoped bypass)", async () => {
  // Only GET /api/health is public — POST /api/health is NOT public
  const mw = createAuthMiddleware({ verify: () => { throw new Error("should not reach"); } });
  const { err } = await runMiddleware(mw, { method: "POST", path: "/api/health" });
  assert.ok(err instanceof AppError, "POST /api/health is not a public path");
  assert.equal(err.statusCode, 401);
});

// ---------------------------------------------------------------------------
// Configurable auth modes — permissive-mode public allowlist
// (sdd/configurable-auth-modes — design.md ADR-D2)
// ---------------------------------------------------------------------------

const PERMISSIVE_ONLY_ROUTES = [
  { method: "GET", path: "/api/config" },
  { method: "POST", path: "/api/simulate/init" },
  { method: "POST", path: "/api/simulate/pre" },
  { method: "POST", path: "/api/simulate/final" },
  { method: "POST", path: "/api/workflow/condiciones-hipotecas" },
];

for (const route of PERMISSIVE_ONLY_ROUTES) {
  test(`permissive mode: ${route.method} ${route.path} bypasses auth — no token → next() with no error`, async () => {
    const mw = createAuthMiddleware({
      verify: () => { throw new Error("should not reach"); },
      mode: "permissive",
    });
    const { err } = await runMiddleware(mw, { method: route.method, path: route.path });
    assert.equal(err, undefined, `${route.method} ${route.path} should bypass auth in permissive mode`);
  });
}

test("default mode (no 'mode' option) stays secure: GET /api/config without token → 401 (regression)", async () => {
  const mw = createAuthMiddleware({ verify: () => { throw new Error("should not reach"); } });
  const { err } = await runMiddleware(mw, { method: "GET", path: "/api/config" });
  assert.ok(err instanceof AppError, "expected AppError — default mode must stay secure");
  assert.equal(err.statusCode, 401);
});

test("explicit mode:'secure' behaves identically to unset: POST /api/workflow/condiciones-hipotecas without token → 401", async () => {
  const mw = createAuthMiddleware({
    verify: () => { throw new Error("should not reach"); },
    mode: "secure",
  });
  const { err } = await runMiddleware(mw, {
    method: "POST",
    path: "/api/workflow/condiciones-hipotecas",
  });
  assert.ok(err instanceof AppError, "expected AppError — explicit secure must behave like default");
  assert.equal(err.statusCode, 401);
});

test("admin-never-public: permissive mode + POST /api/admin/config/apply without token → still 401", async () => {
  const mw = createAuthMiddleware({
    verify: () => { throw new Error("should not reach"); },
    mode: "permissive",
  });
  const { err } = await runMiddleware(mw, {
    method: "POST",
    path: "/api/admin/config/apply",
  });
  assert.ok(err instanceof AppError, "expected AppError — /api/admin/* must never be public, any mode");
  assert.equal(err.statusCode, 401);
});

test("exact-match safety in permissive mode: GET /api/configuration (not /api/config) without token → 401", async () => {
  const mw = createAuthMiddleware({
    verify: () => { throw new Error("should not reach"); },
    mode: "permissive",
  });
  const { err } = await runMiddleware(mw, { method: "GET", path: "/api/configuration" });
  assert.ok(err instanceof AppError, "expected AppError — /api/configuration is NOT the allowlisted /api/config");
  assert.equal(err.statusCode, 401);
});

test("exact-match safety in permissive mode: GET /api/simulate/init (wrong method) without token → 401", async () => {
  const mw = createAuthMiddleware({
    verify: () => { throw new Error("should not reach"); },
    mode: "permissive",
  });
  const { err } = await runMiddleware(mw, { method: "GET", path: "/api/simulate/init" });
  assert.ok(err instanceof AppError, "expected AppError — only POST /api/simulate/init is allowlisted, not GET");
  assert.equal(err.statusCode, 401);
});

// ---------------------------------------------------------------------------
// Read-only Configurador + Períodos in permissive mode
// (sdd/permissive-config-readonly — design.md ADR-CR2)
//
// Four new sibling-of-/api/config read routes: rules, params, offers, fechas.
// Same exact-match, mode-scoped model as PERMISSIVE_ONLY_PUBLIC above —
// /api/admin/* must never be reachable through this list, in any mode.
// ---------------------------------------------------------------------------

const NEW_CONFIG_READ_ROUTES = [
  { method: "GET", path: "/api/config/rules" },
  { method: "GET", path: "/api/config/params" },
  { method: "GET", path: "/api/config/offers" },
  { method: "GET", path: "/api/config/fechas" },
];

for (const route of NEW_CONFIG_READ_ROUTES) {
  test(`permissive mode: ${route.method} ${route.path} bypasses auth — no token → next() with no error`, async () => {
    const mw = createAuthMiddleware({
      verify: () => { throw new Error("should not reach"); },
      mode: "permissive",
    });
    const { err } = await runMiddleware(mw, { method: route.method, path: route.path });
    assert.equal(err, undefined, `${route.method} ${route.path} should bypass auth in permissive mode`);
  });

  test(`secure mode (and default): ${route.method} ${route.path} without token → 401 (regression, not newly public in secure)`, async () => {
    const mw = createAuthMiddleware({ verify: () => { throw new Error("should not reach"); } });
    const { err } = await runMiddleware(mw, { method: route.method, path: route.path });
    assert.ok(err instanceof AppError, `expected AppError — ${route.path} must require auth in secure mode`);
    assert.equal(err.statusCode, 401);
  });
}

test("exact-match safety in permissive mode: GET /api/config/ruless (typo, not /api/config/rules) without token → 401", async () => {
  const mw = createAuthMiddleware({
    verify: () => { throw new Error("should not reach"); },
    mode: "permissive",
  });
  const { err } = await runMiddleware(mw, { method: "GET", path: "/api/config/ruless" });
  assert.ok(err instanceof AppError, "expected AppError — /api/config/ruless is NOT the allowlisted /api/config/rules");
  assert.equal(err.statusCode, 401);
});

test("exact-match safety in permissive mode: POST /api/config/rules (wrong method) without token → 401", async () => {
  const mw = createAuthMiddleware({
    verify: () => { throw new Error("should not reach"); },
    mode: "permissive",
  });
  const { err } = await runMiddleware(mw, { method: "POST", path: "/api/config/rules" });
  assert.ok(err instanceof AppError, "expected AppError — only GET /api/config/rules is allowlisted, not POST");
  assert.equal(err.statusCode, 401);
});
