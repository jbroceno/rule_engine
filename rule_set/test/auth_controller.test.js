/**
 * test/auth_controller.test.js — TDD tests for auth_controller.js login handler
 *
 * Uses the createLoginHandler({ userService, sign }) factory to inject fake
 * dependencies. No live DB, no real JWT secret, no network calls.
 *
 * DI pattern mirrors createUserService / createAuthMiddleware already in this
 * project (ADR-A2).
 *
 * Covered scenarios (spec Domain C — all 5):
 *   1. Successful login (valid creds, enabled user) → 200 { token, expiresIn }
 *   2. Wrong password → 401 "Credenciales inválidas."
 *   3. Unknown email → 401 same generic message (no enumeration)
 *   4. Disabled user (service returns null) → 401 generic
 *   5. Missing fields (no email or no password) → 400
 */
import test from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../api/utils/app_error.js";

// ---------------------------------------------------------------------------
// Import the factory (RED until createLoginHandler is exported)
// ---------------------------------------------------------------------------
const { createLoginHandler } = await import("../api/controllers/auth_controller.js");

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal fake userService.
 * @param {object} opts
 * @param {object|null} opts.user - Row returned by findUserByEmail (null = not found / disabled)
 * @param {boolean} opts.passwordMatch - result of verifyPassword
 */
function makeFakeUserService({ user = null, passwordMatch = false } = {}) {
  return {
    async findUserByEmail(_email) {
      return user;
    },
    async verifyPassword(_plain, _hash) {
      return passwordMatch;
    },
  };
}

/** Stub sign function — returns a predictable fake token string. */
function fakeSign(_payload, _secret, _opts) {
  return "stub.jwt.token";
}

/** Fake sign that records the payload for assertion. */
function makeRecordingSign() {
  let lastPayload = null;
  return {
    sign(payload, _secret, _opts) {
      lastPayload = payload;
      return "stub.jwt.token";
    },
    getLastPayload() { return lastPayload; },
  };
}

/**
 * Build a minimal req/res/next triple and invoke the handler.
 * Returns { statusCode, body, nextErr } after the async handler settles.
 */
async function callHandler(handler, body) {
  const req = { body };
  let statusCode = null;
  let body_out = null;
  let nextErr = undefined;

  const res = {
    status(code) {
      statusCode = code;
      return res; // allow chaining: res.status(200).json(...)
    },
    json(data) {
      body_out = data;
      return res;
    },
  };
  const next = (err) => { nextErr = err; };

  await handler(req, res, next);
  return { statusCode, body: body_out, nextErr };
}

// ---------------------------------------------------------------------------
// A valid user fixture (as returned by user_service.findUserByEmail)
// ---------------------------------------------------------------------------
const VALID_USER = {
  user_id: 7,
  email: "user@bank.com",
  password_hash: "$2b$10$fakehash",
  role: "admin",
  enabled: 1,
};

// ---------------------------------------------------------------------------
// Scenario 1 — Successful login → 200 { token, expiresIn }
// ---------------------------------------------------------------------------

test("login: valid credentials → 200 with { token, expiresIn }", async () => {
  const fakeUserService = makeFakeUserService({ user: VALID_USER, passwordMatch: true });
  const handler = createLoginHandler({ userService: fakeUserService, sign: fakeSign });

  const { statusCode, body, nextErr } = await callHandler(handler, {
    email: "user@bank.com",
    password: "secret123",
  });

  assert.equal(nextErr, undefined, "next() should not be called with error on success");
  assert.equal(statusCode, 200);
  assert.ok(body != null, "response body must be non-null");

  // token must be a non-empty string
  assert.equal(typeof body.token, "string", "token must be a string");
  assert.ok(body.token.length > 0, "token must not be empty");

  // expiresIn must be present
  assert.ok("expiresIn" in body, "response must include expiresIn");

  // password_hash must NEVER appear in the response (security)
  const bodyStr = JSON.stringify(body);
  assert.ok(
    !bodyStr.includes("password"),
    "response body must not contain 'password' (hash must not leak)"
  );
});

// ---------------------------------------------------------------------------
// Scenario 2 — Wrong password → 401 generic message
// ---------------------------------------------------------------------------

test("login: wrong password → 401 'Credenciales inválidas.'", async () => {
  const fakeUserService = makeFakeUserService({ user: VALID_USER, passwordMatch: false });
  const handler = createLoginHandler({ userService: fakeUserService, sign: fakeSign });

  const { nextErr } = await callHandler(handler, {
    email: "user@bank.com",
    password: "wrongpassword",
  });

  assert.ok(nextErr instanceof AppError, "expected AppError for wrong password");
  assert.equal(nextErr.statusCode, 401);
  assert.equal(nextErr.message, "Credenciales inválidas.");
});

// ---------------------------------------------------------------------------
// Scenario 3 — Unknown email → 401 same generic message (no enumeration)
// ---------------------------------------------------------------------------

test("login: unknown email → 401 'Credenciales inválidas.' (same as wrong password)", async () => {
  // findUserByEmail returns null → user not found
  const fakeUserService = makeFakeUserService({ user: null, passwordMatch: false });
  const handler = createLoginHandler({ userService: fakeUserService, sign: fakeSign });

  const { nextErr } = await callHandler(handler, {
    email: "ghost@nowhere.com",
    password: "anypassword",
  });

  assert.ok(nextErr instanceof AppError, "expected AppError for unknown email");
  assert.equal(nextErr.statusCode, 401);
  assert.equal(nextErr.message, "Credenciales inválidas.");
});

// ---------------------------------------------------------------------------
// Scenario 4 — Disabled user (service returns null — enabled=1 filter in SQL)
// ---------------------------------------------------------------------------

test("login: disabled user (service returns null) → 401 generic", async () => {
  // The SQL query filters enabled=1 → disabled user produces an empty recordset
  // → findUserByEmail returns null. Controller cannot distinguish this from
  // unknown email, so it returns the same generic 401.
  const fakeUserService = makeFakeUserService({ user: null, passwordMatch: false });
  const handler = createLoginHandler({ userService: fakeUserService, sign: fakeSign });

  const { nextErr } = await callHandler(handler, {
    email: "locked@bank.com",
    password: "correct_password",
  });

  assert.ok(nextErr instanceof AppError, "expected AppError for disabled user");
  assert.equal(nextErr.statusCode, 401);
  assert.equal(nextErr.message, "Credenciales inválidas.");
});

// ---------------------------------------------------------------------------
// Scenario 5 — Missing fields → 400
// ---------------------------------------------------------------------------

test("login: missing email → 400", async () => {
  const fakeUserService = makeFakeUserService();
  const handler = createLoginHandler({ userService: fakeUserService, sign: fakeSign });

  const { nextErr } = await callHandler(handler, { password: "secret123" });

  assert.ok(nextErr instanceof AppError, "expected AppError for missing email");
  assert.equal(nextErr.statusCode, 400);
});

test("login: missing password → 400", async () => {
  const fakeUserService = makeFakeUserService();
  const handler = createLoginHandler({ userService: fakeUserService, sign: fakeSign });

  const { nextErr } = await callHandler(handler, { email: "user@bank.com" });

  assert.ok(nextErr instanceof AppError, "expected AppError for missing password");
  assert.equal(nextErr.statusCode, 400);
});

test("login: empty body → 400", async () => {
  const fakeUserService = makeFakeUserService();
  const handler = createLoginHandler({ userService: fakeUserService, sign: fakeSign });

  const { nextErr } = await callHandler(handler, {});

  assert.ok(nextErr instanceof AppError, "expected AppError for empty body");
  assert.equal(nextErr.statusCode, 400);
});

// ---------------------------------------------------------------------------
// Extra — verify token payload does not include password_hash (via recording sign)
// ---------------------------------------------------------------------------

test("login: JWT payload contains sub, email, role — never password_hash", async () => {
  const fakeUserService = makeFakeUserService({ user: VALID_USER, passwordMatch: true });
  const recorder = makeRecordingSign();
  const handler = createLoginHandler({ userService: fakeUserService, sign: recorder.sign });

  const { statusCode } = await callHandler(handler, {
    email: "user@bank.com",
    password: "secret123",
  });

  assert.equal(statusCode, 200);
  const payload = recorder.getLastPayload();
  assert.ok(payload != null, "sign must have been called with a payload");
  assert.equal(payload.sub, VALID_USER.user_id, "payload.sub must be user_id");
  assert.equal(payload.email, VALID_USER.email, "payload.email must match");
  assert.equal(payload.role, VALID_USER.role, "payload.role must match");
  assert.ok(!("password_hash" in payload), "payload must not contain password_hash");
  assert.ok(!("password" in payload), "payload must not contain password");
});
