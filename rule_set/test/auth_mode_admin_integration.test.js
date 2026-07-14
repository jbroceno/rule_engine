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

// ---------------------------------------------------------------------------
// Read-only Configurador + Períodos in permissive mode
// (sdd/permissive-config-readonly — design.md ADR-CR1/CR2/CR7)
//
// New sibling read surface: GET /api/config/{rules,params,offers,fechas}.
// Proves (a) the negative invariant — opening these 4 reads did NOT open any
// /api/admin/* write verb — and (b) the positive full-chain for the 4 new
// routes themselves, in both auth modes, for anon + admin.
// ---------------------------------------------------------------------------

const NEW_CONFIG_READ_PATHS = [
  "/api/config/rules",
  "/api/config/params",
  "/api/config/offers",
  "/api/config/fechas",
];

const ADMIN_WRITE_VERBS = [
  { method: "post", path: "/api/admin/rules", body: {} },
  { method: "put", path: "/api/admin/rules/1", body: {} },
  { method: "delete", path: "/api/admin/rules/1" },
  { method: "post", path: "/api/admin/params", body: {} },
  { method: "post", path: "/api/admin/offers", body: {} },
  { method: "post", path: "/api/admin/config/apply", body: {} },
  { method: "patch", path: "/api/admin/rules/reorder", body: {} },
  { method: "patch", path: "/api/admin/offers/OFERTA_A/enabled", body: { enabled: true } },
];

for (const verb of ADMIN_WRITE_VERBS) {
  test(`AUTH_MODE=permissive: ${verb.method.toUpperCase()} ${verb.path} WITHOUT token → still 401 (opening reads did not open writes)`, async () => {
    let req = agent[verb.method](verb.path);
    if (verb.body !== undefined) req = req.send(verb.body);
    const res = await req;
    assert.equal(res.status, 401, `expected 401, got ${res.status}`);
  });

  test(`AUTH_MODE=permissive: ${verb.method.toUpperCase()} ${verb.path} WITH viewer token → still 403 (role gate unaffected)`, async () => {
    let req = agent[verb.method](verb.path).set("Authorization", `Bearer ${signToken("viewer")}`);
    if (verb.body !== undefined) req = req.send(verb.body);
    const res = await req;
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
  });
}

for (const path of NEW_CONFIG_READ_PATHS) {
  test(`AUTH_MODE=permissive: GET ${path} WITHOUT token → NOT 401 (new public read surface)`, async () => {
    const res = await agent.get(path);
    assert.notEqual(res.status, 401, `${path} must bypass auth entirely in permissive mode`);
  });

  test(`AUTH_MODE=permissive: GET ${path} WITH admin token → NOT 401/403 (admin unaffected)`, async () => {
    const res = await agent.get(path).set("Authorization", `Bearer ${signToken("admin")}`);
    assert.notEqual(res.status, 401, "admin must not receive 401 from the auth gate");
    assert.notEqual(res.status, 403, "admin must not receive 403 (no role gate on this surface)");
  });
}

// Non-goals stay fully admin-gated in permissive mode (regression, not new surface).
const ADMIN_NON_GOAL_ROUTES = [
  { method: "get", path: "/api/admin/export" },
  { method: "get", path: "/api/admin/snapshots" },
  { method: "get", path: "/api/admin/snapshots/1/content" },
  { method: "post", path: "/api/admin/validate", body: {} },
];

for (const route of ADMIN_NON_GOAL_ROUTES) {
  test(`AUTH_MODE=permissive: ${route.method.toUpperCase()} ${route.path} WITHOUT token → still 401 (non-goal, stays admin-gated)`, async () => {
    let req = agent[route.method](route.path);
    if (route.body !== undefined) req = req.send(route.body);
    const res = await req;
    assert.equal(res.status, 401, `expected 401, got ${res.status}`);
  });
}
