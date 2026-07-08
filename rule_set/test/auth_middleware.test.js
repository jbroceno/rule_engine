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
