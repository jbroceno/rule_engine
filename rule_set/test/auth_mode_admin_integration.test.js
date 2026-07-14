/**
 * test/auth_mode_admin_integration.test.js — HTTP integration test proving
 * that the mode-aware auth middleware and the RBAC requireRole("admin") gate
 * COMPOSE correctly when AUTH_MODE=permissive (design.md ADR-D2, recommended
 * integration test in the "Strict TDD test strategy" section).
 *
 * Unit tests in test/auth_middleware.test.js already prove /api/admin/* is
 * never in the permissive-mode public allowlist in isolation. This test
 * additionally boots the REAL Express app (createApp(), real routes/index.js
 * mount points, real requireRole("admin")) with AUTH_MODE=permissive to prove
 * the admin surface still requires a valid admin JWT end-to-end — not just
 * at the unit level.
 *
 * PITFALL — same ESM import-timing pattern as test/rbac_http_integration.test.js:
 *   env.js reads process.env.AUTH_MODE / JWT_SECRET at import time, so both
 *   vars MUST be set BEFORE any static import of app.js/env.js. Static imports
 *   are hoisted above module-level code, so app.js is imported dynamically
 *   after the process.env assignments below.
 */

// 1. Set AUTH_MODE=permissive and JWT_SECRET BEFORE loading any app module.
process.env.AUTH_MODE = "permissive";
process.env.JWT_SECRET = process.env.JWT_SECRET || "integration-test-secret-auth-mode";

// 2. Imports that do NOT depend on env.js first (safe as static imports).
import test from "node:test";
import assert from "node:assert/strict";

// 3. Dynamic imports — guarantee env.js evaluates AFTER step 1.
const { createApp } = await import("../api/app.js");
const jwt = (await import("jsonwebtoken")).default;
const supertest = (await import("supertest")).default;

const TEST_SECRET = process.env.JWT_SECRET;

function signToken(role) {
  return jwt.sign({ sub: 1, email: `${role}@test.local`, role }, TEST_SECRET, {
    expiresIn: "1h",
  });
}

// Single agent — createApp() picks up the permissive-mode singleton
// authMiddleware since env.auth.mode was resolved to "permissive" above.
const agent = supertest(createApp());

test("AUTH_MODE=permissive: POST /api/admin/config/apply WITHOUT token → 401 (auth gate still applies)", async () => {
  const res = await agent.post("/api/admin/config/apply").send({});
  assert.equal(res.status, 401, `expected 401, got ${res.status}`);
});

test("AUTH_MODE=permissive: POST /api/admin/config/apply WITH viewer token → 403 (role gate still applies)", async () => {
  const res = await agent
    .post("/api/admin/config/apply")
    .set("Authorization", `Bearer ${signToken("viewer")}`)
    .send({});
  assert.equal(res.status, 403, `expected 403, got ${res.status}`);
});

test("AUTH_MODE=permissive: POST /api/admin/config/apply WITH admin token → gate passed (not 401/403)", async () => {
  const res = await agent
    .post("/api/admin/config/apply")
    .set("Authorization", `Bearer ${signToken("admin")}`)
    .send({});
  // Controller may fail downstream (no DB / missing payload fields in CI) —
  // we only assert neither gate rejected the admin caller.
  assert.notEqual(res.status, 401, "admin must not receive 401 from the auth gate");
  assert.notEqual(res.status, 403, "admin must not receive 403 from the role gate");
});

test("AUTH_MODE=permissive: GET /api/config WITHOUT token → NOT 401 (newly-public route bypasses auth)", async () => {
  const res = await agent.get("/api/config");
  assert.notEqual(
    res.status,
    401,
    "GET /api/config must bypass auth entirely in permissive mode, even without a token"
  );
});
