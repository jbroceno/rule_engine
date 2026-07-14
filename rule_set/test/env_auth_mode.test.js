/**
 * test/env_auth_mode.test.js — TDD tests for env.auth.mode fail-fast/default
 * behavior (api/config/env.js).
 *
 * Gotcha (same as test/env_seed_reset.test.js): testing env.js by mutating
 * process.env and re-importing is fragile — dotenv.config() can repopulate a
 * deleted var from a local .env file on re-import. We therefore call the
 * exported pure helpers `resolveAuthMode` and `assertAuthMode` directly (no
 * process.env, no dotenv), per design.md ADR-D3.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveAuthMode, assertAuthMode, env } from "../api/config/env.js";

test("resolveAuthMode: unset (undefined) defaults to 'secure'", () => {
  assert.equal(resolveAuthMode(undefined), "secure");
});

test("resolveAuthMode: empty string defaults to 'secure'", () => {
  assert.equal(resolveAuthMode(""), "secure");
});

test("resolveAuthMode: normalizes case/whitespace when set to a valid mode", () => {
  assert.equal(resolveAuthMode("PERMISSIVE"), "permissive");
  assert.equal(resolveAuthMode(" secure "), "secure");
});

test("resolveAuthMode: set-but-invalid value is NOT silently coerced to 'secure'", () => {
  // Left uncoerced (normalized but still invalid) so assertAuthMode() can
  // catch it at boot — see design.md ADR-D3.
  assert.equal(resolveAuthMode("permisive"), "permisive");
});

test("assertAuthMode: throws for an invalid mode", () => {
  assert.throws(() => assertAuthMode("permisive"), /AUTH_MODE/);
});

test("assertAuthMode: does not throw for 'secure'", () => {
  assert.doesNotThrow(() => assertAuthMode("secure"));
});

test("assertAuthMode: does not throw for 'permissive'", () => {
  assert.doesNotThrow(() => assertAuthMode("permissive"));
});

test("env.auth.mode is a valid AUTH_MODE value (mirrors env.js's own resolution)", () => {
  assert.equal(env.auth.mode, resolveAuthMode(process.env.AUTH_MODE));
});
