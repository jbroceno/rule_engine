/**
 * test/env_seed_reset.test.js — env.enableSeedReset / asBoolean unit tests.
 *
 * Gotcha (documented in CLAUDE.md, re-discovered while building this test):
 * testing env.enableSeedReset by deleting process.env.ENABLE_SEED_RESET and
 * re-importing env.js with cache-busting is fragile — dotenv.config() can
 * repopulate the var from a local .env file on re-import, making the test
 * flaky depending on the machine's local rule_set/api/.env contents. We
 * therefore call the exported `asBoolean` helper directly (pure function,
 * no process.env, no dotenv) for the core assertions, and only make a
 * best-effort/non-flaky assertion against the live `env.enableSeedReset`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { asBoolean, env } from "../api/config/env.js";

test("asBoolean: returns defaultValue when value is undefined", () => {
  assert.equal(asBoolean(undefined, false), false);
  assert.equal(asBoolean(undefined, true), true);
});

test("asBoolean: returns true only for the literal 'true' (case-insensitive, trimmed)", () => {
  assert.equal(asBoolean("true", false), true);
  assert.equal(asBoolean("TRUE", false), true);
  assert.equal(asBoolean(" True ", false), true);
});

test("asBoolean: returns false for anything else, including '1' and 'yes'", () => {
  assert.equal(asBoolean("false", true), false);
  assert.equal(asBoolean("1", true), false);
  assert.equal(asBoolean("yes", true), false);
  assert.equal(asBoolean("", true), false);
});

test("env.enableSeedReset is a boolean (default false unless ENABLE_SEED_RESET=true is set for this process)", () => {
  assert.equal(typeof env.enableSeedReset, "boolean");
  // Non-flaky: this mirrors exactly how env.js computes the flag — same
  // asBoolean call, same process.env read — so it can never disagree with
  // env.js's own logic regardless of what a local .env file contains.
  assert.equal(env.enableSeedReset, asBoolean(process.env.ENABLE_SEED_RESET, false));
});
