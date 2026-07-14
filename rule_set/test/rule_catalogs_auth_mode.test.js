/**
 * test/rule_catalogs_auth_mode.test.js — TDD tests for ALLOWED_AUTH_MODES /
 * normalizeAuthMode in api/utils/rule_catalogs.js.
 *
 * Mirrors the existing ALLOWED_ROLES / normalizeRole convention in the same
 * file — see design.md ADR-D1 (sdd/configurable-auth-modes/design).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_AUTH_MODES, normalizeAuthMode } from "../api/utils/rule_catalogs.js";

test("ALLOWED_AUTH_MODES contains exactly 'permissive' and 'secure'", () => {
  assert.deepEqual([...ALLOWED_AUTH_MODES].sort(), ["permissive", "secure"]);
});

test("normalizeAuthMode trims and lowercases a valid value", () => {
  assert.equal(normalizeAuthMode(" PERMISSIVE "), "permissive");
  assert.equal(normalizeAuthMode("Secure"), "secure");
});

test("normalizeAuthMode returns '' for non-string input (defensive)", () => {
  assert.equal(normalizeAuthMode(undefined), "");
  assert.equal(normalizeAuthMode(null), "");
  assert.equal(normalizeAuthMode(123), "");
});
