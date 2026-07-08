/**
 * test/user_service.test.js — TDD tests for user_service.js
 *
 * Uses dependency-injection factories (no live DB, no mock.module).
 * bcrypt hash fixture precomputed once for "secret123" at cost 10:
 *   node -e "import('bcryptjs').then(b=>b.default.hash('secret123',10).then(console.log))"
 * Do NOT regenerate — the hash is stable for a given plaintext + cost.
 */
import test from "node:test";
import assert from "node:assert/strict";

// Precomputed bcrypt hash for the literal string "secret123" (cost factor 10).
// Plaintext: "secret123"
// Generated with: node -e "import('bcryptjs').then(b=>b.default.hash('secret123',10).then(console.log))"
const HASH_FOR_secret123 =
  "$2b$10$p4TQNh/YPaIFBNsr1SgGNuOj3Lk01m28N5b5RGN4EuQKoOps4jCTi";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a fake mssql pool that returns `rows` from any query.
 * Mirrors the pool.request().input(…).query(…) idiom used in admin_service.js.
 */
function makeFakePool(rows) {
  return {
    request() {
      const req = {
        input(_name, _type, _value) {
          return req; // chainable
        },
        async query(_sql) {
          return { recordset: rows };
        },
      };
      return req;
    },
  };
}

// ---------------------------------------------------------------------------
// Import the service factory (will fail RED until the file exists)
// ---------------------------------------------------------------------------
const { createUserService } = await import("../api/services/user_service.js");

// ---------------------------------------------------------------------------
// findUserByEmail
// ---------------------------------------------------------------------------
test("findUserByEmail returns the row for an existing enabled user", async () => {
  const fakeRow = {
    user_id: 1,
    email: "admin@example.com",
    password_hash: HASH_FOR_secret123,
    role: "admin",
    enabled: 1,
  };
  const pool = makeFakePool([fakeRow]);
  const svc = createUserService({ poolGetter: async () => pool });

  const result = await svc.findUserByEmail("admin@example.com");
  assert.deepEqual(result, fakeRow);
});

test("findUserByEmail returns null when recordset is empty (user not found or disabled)", async () => {
  const pool = makeFakePool([]);
  const svc = createUserService({ poolGetter: async () => pool });

  const result = await svc.findUserByEmail("nobody@example.com");
  assert.equal(result, null);
});

test("findUserByEmail returns null for null/empty email without calling the pool", async () => {
  let poolCalled = false;
  const pool = {
    request() {
      poolCalled = true;
      return { input() { return this; }, async query() { return { recordset: [] }; } };
    },
  };
  const svc = createUserService({ poolGetter: async () => pool });

  const r1 = await svc.findUserByEmail(null);
  const r2 = await svc.findUserByEmail("");
  assert.equal(r1, null);
  assert.equal(r2, null);
  assert.equal(poolCalled, false, "pool should not be called for invalid email");
});

// ---------------------------------------------------------------------------
// verifyPassword
// ---------------------------------------------------------------------------
test("verifyPassword returns true when plain matches the precomputed hash (real bcryptjs)", async () => {
  // Uses the REAL bcryptjs compare injected from bcryptjs default import.
  // This test proves the actual crypto integration works end-to-end.
  const bcrypt = await import("bcryptjs");
  const realCompare = bcrypt.default.compare.bind(bcrypt.default);
  const svc = createUserService({ compare: realCompare });

  const result = await svc.verifyPassword("secret123", HASH_FOR_secret123);
  assert.equal(result, true);
});

test("verifyPassword returns false when plain does NOT match the hash (real bcryptjs)", async () => {
  const bcrypt = await import("bcryptjs");
  const realCompare = bcrypt.default.compare.bind(bcrypt.default);
  const svc = createUserService({ compare: realCompare });

  const result = await svc.verifyPassword("wrongpassword", HASH_FOR_secret123);
  assert.equal(result, false);
});

test("verifyPassword returns false for empty/null inputs without calling compare", async () => {
  let compareCalled = false;
  const fakeCompare = async () => { compareCalled = true; return true; };
  const svc = createUserService({ compare: fakeCompare });

  const r1 = await svc.verifyPassword("", HASH_FOR_secret123);
  const r2 = await svc.verifyPassword("plain", null);
  assert.equal(r1, false);
  assert.equal(r2, false);
  assert.equal(compareCalled, false, "compare should not be called for empty inputs");
});

test("verifyPassword uses the injected compare function (DI seam verification)", async () => {
  let capturedArgs = null;
  const fakeCompare = async (plain, hash) => {
    capturedArgs = { plain, hash };
    return true;
  };
  const svc = createUserService({ compare: fakeCompare });

  const result = await svc.verifyPassword("mypassword", HASH_FOR_secret123);
  assert.equal(result, true);
  assert.deepEqual(capturedArgs, { plain: "mypassword", hash: HASH_FOR_secret123 });
});
