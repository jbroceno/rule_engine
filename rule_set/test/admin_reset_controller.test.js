/**
 * test/admin_reset_controller.test.js — unit tests for
 * createResetSeedHandler() (POST /api/admin/config/reset-seed).
 *
 * DI pattern mirrors createLoginHandler in auth_controller.js (ADR-A2): the
 * factory accepts fake createSnapshot/resetToSeed/env so these tests never
 * touch a live DB or the real feature flag.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../api/utils/app_error.js";
import { createResetSeedHandler } from "../api/controllers/admin_reset_controller.js";

/**
 * Build a minimal req/res/next triple and invoke the handler.
 * Returns { statusCode, body, nextErr, nextCalledWithNoArg }.
 */
async function callHandler(handler, body) {
  const req = { body };
  let statusCode = null;
  let bodyOut = null;
  let nextErr;
  let nextCallCount = 0;
  let nextCalledWithNoArg = false;

  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    json(data) {
      bodyOut = data;
      return res;
    },
  };
  const next = (err) => {
    nextCallCount++;
    if (err === undefined) {
      nextCalledWithNoArg = true;
    } else {
      nextErr = err;
    }
  };

  await handler(req, res, next);
  return { statusCode, body: bodyOut, nextErr, nextCalledWithNoArg, nextCallCount };
}

function unreachableFn(name) {
  return async () => {
    throw new Error(`${name} should not have been called`);
  };
}

// ---------------------------------------------------------------------------
// Flag disabled → next() with NO argument (generic 404 via notFoundHandler)
// ---------------------------------------------------------------------------

test("reset-seed: flag disabled → next() called with no argument, no status/json set", async () => {
  const handler = createResetSeedHandler({
    env: { enableSeedReset: false },
    createSnapshot: unreachableFn("createSnapshot"),
    resetToSeed: unreachableFn("resetToSeed"),
  });

  const { statusCode, body, nextErr, nextCalledWithNoArg, nextCallCount } = await callHandler(handler, {
    comment: "irrelevant — flag check must run first",
  });

  assert.equal(nextCallCount, 1, "next() must be called exactly once");
  assert.equal(nextCalledWithNoArg, true, "next() must be called with no argument when the flag is off");
  assert.equal(nextErr, undefined, "next() must not receive an error");
  assert.equal(statusCode, null, "res.status must never be called when the flag is off");
  assert.equal(body, null, "res.json must never be called when the flag is off");
});

test("reset-seed: flag disabled + missing comment → still next() with no argument (flag check wins)", async () => {
  // The 404-hides-existence contract must hold even for a malformed body —
  // otherwise a 400 vs 404 status difference would leak the route's existence.
  const handler = createResetSeedHandler({
    env: { enableSeedReset: false },
    createSnapshot: unreachableFn("createSnapshot"),
    resetToSeed: unreachableFn("resetToSeed"),
  });

  const { nextCalledWithNoArg, nextErr } = await callHandler(handler, {});

  assert.equal(nextCalledWithNoArg, true);
  assert.equal(nextErr, undefined);
});

// ---------------------------------------------------------------------------
// Flag enabled, missing/blank comment → 400
// ---------------------------------------------------------------------------

test("reset-seed: flag enabled, missing comment → 400 AppError", async () => {
  const handler = createResetSeedHandler({
    env: { enableSeedReset: true },
    createSnapshot: unreachableFn("createSnapshot"),
    resetToSeed: unreachableFn("resetToSeed"),
  });

  const { nextErr } = await callHandler(handler, {});

  assert.ok(nextErr instanceof AppError, "expected AppError for missing comment");
  assert.equal(nextErr.statusCode, 400);
});

test("reset-seed: flag enabled, blank comment → 400 AppError", async () => {
  const handler = createResetSeedHandler({
    env: { enableSeedReset: true },
    createSnapshot: unreachableFn("createSnapshot"),
    resetToSeed: unreachableFn("resetToSeed"),
  });

  const { nextErr } = await callHandler(handler, { comment: "   " });

  assert.ok(nextErr instanceof AppError, "expected AppError for blank comment");
  assert.equal(nextErr.statusCode, 400);
});

// ---------------------------------------------------------------------------
// Flag enabled, happy path → 200, passthrough fields unchanged
// ---------------------------------------------------------------------------

test("reset-seed: flag enabled, happy path → 200 with removedOfferCodes/removedPeriodCount passthrough", async () => {
  const fakeResult = {
    applied: { rules: 85, params: 66 },
    offerCodes: ["FIDELIZACION", "ALTO_RIESGO", "PROMOCION", "PROMOCION_HC", "LARGO_PLAZO", "ULTRA_ALTO_RIESGO"],
    offer_date_id: 42,
    removedOfferCodes: ["EXTRA_TESTER_OFFER"],
    removedPeriodCount: 2,
  };

  let snapshotArgs = null;
  let resetArgs = null;

  const handler = createResetSeedHandler({
    env: { enableSeedReset: true },
    createSnapshot: async (name, comment, createdBy) => {
      snapshotArgs = { name, comment, createdBy };
      return 999;
    },
    resetToSeed: async (args) => {
      resetArgs = args;
      return fakeResult;
    },
  });

  const { statusCode, body, nextErr } = await callHandler(handler, {
    comment: "  Reset para QA  ",
    createdBy: "tester",
  });

  assert.equal(nextErr, undefined, "next() must not receive an error on success");
  assert.equal(statusCode, 200);
  assert.ok(body != null);

  assert.equal(body.snapshot_id, 999, "snapshot_id from createSnapshot must be included in the response");
  assert.deepEqual(body.removedOfferCodes, fakeResult.removedOfferCodes, "removedOfferCodes must pass through unchanged");
  assert.equal(body.removedPeriodCount, fakeResult.removedPeriodCount, "removedPeriodCount must pass through unchanged");
  assert.deepEqual(body.applied, fakeResult.applied);
  assert.deepEqual(body.offerCodes, fakeResult.offerCodes);
  assert.equal(body.offer_date_id, fakeResult.offer_date_id);

  assert.ok(snapshotArgs, "createSnapshot must have been called");
  assert.equal(snapshotArgs.comment, "Reset para QA", "comment must be trimmed before being passed to createSnapshot");
  assert.equal(snapshotArgs.createdBy, "tester");

  assert.ok(resetArgs, "resetToSeed must have been called");
  assert.equal(resetArgs.createdBy, "tester");
});

test("reset-seed: createdBy omitted → passed through as undefined/absent, comment still trimmed", async () => {
  let snapshotArgs = null;

  const handler = createResetSeedHandler({
    env: { enableSeedReset: true },
    createSnapshot: async (name, comment, createdBy) => {
      snapshotArgs = { name, comment, createdBy };
      return 1;
    },
    resetToSeed: async () => ({
      applied: { rules: 0, params: 0 },
      offerCodes: [],
      offer_date_id: 1,
      removedOfferCodes: [],
      removedPeriodCount: 0,
    }),
  });

  const { statusCode } = await callHandler(handler, { comment: "solo motivo" });

  assert.equal(statusCode, 200);
  assert.equal(snapshotArgs.createdBy, null, "createdBy must normalize to null when absent");
});

// ---------------------------------------------------------------------------
// Service error propagation
// ---------------------------------------------------------------------------

test("reset-seed: resetToSeed throwing propagates via next(error)", async () => {
  const boom = new AppError("fallo simulado", 500);
  const handler = createResetSeedHandler({
    env: { enableSeedReset: true },
    createSnapshot: async () => 1,
    resetToSeed: async () => {
      throw boom;
    },
  });

  const { nextErr, statusCode } = await callHandler(handler, { comment: "test" });

  assert.equal(nextErr, boom);
  assert.equal(statusCode, null, "res.status must not be called when resetToSeed throws");
});
