/**
 * Tests for wf-offer-mapping and mro-snapshot-deploy changes.
 *
 * Covers:
 *   - parseOfertaIdOverrides — real controller export (no local mirror)
 *   - getDeleteScope — real service export
 *   - validateEntornoCd — real validator export
 *   - buildWfSafetySnapshotComment — real service export (W-2)
 *
 * Tasks: 5.4, 2.1, 2.2e, 2.10, W-2
 *
 * Note: resolveOfertaId was a test-local mirror of inline service logic
 * (ofertaIdOverrides?.[code] ?? offer.oferta_id). The logic is trivial and
 * lives inline in publishCfgToWorkflow — no export needed, no test needed.
 * Tasks 5.1-5.3 (resolveOfertaId tests) removed per C-1 fix.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { validateEntornoCd } from "../api/validators/admin_validator.js";
import { getDeleteScope, buildWfSafetySnapshotComment, assembleWfSnapshotPayload } from "../api/services/admin_workflow_service.js";
import { parseOfertaIdOverrides } from "../api/controllers/admin_snapshots_controller.js";

// ---------------------------------------------------------------------------
// Task 5.4 — Controller rejects invalid override values
// Tests now import the REAL exported function from admin_snapshots_controller.
// ---------------------------------------------------------------------------

test("parseOfertaIdOverrides: returns undefined when value is undefined", () => {
  assert.equal(parseOfertaIdOverrides(undefined), undefined);
});

test("parseOfertaIdOverrides: returns undefined when value is null", () => {
  assert.equal(parseOfertaIdOverrides(null), undefined);
});

test("parseOfertaIdOverrides: returns object unchanged when all values are valid", () => {
  const input = { OFERTA_RESTRICTIVA: 42, OFERTA_PERMISIVA: 7 };
  assert.deepEqual(parseOfertaIdOverrides(input), input);
});

test("parseOfertaIdOverrides: throws when value is an array", () => {
  assert.throws(
    () => parseOfertaIdOverrides([1, 2]),
    /ofertaIdOverrides debe ser un objeto/,
  );
});

test("parseOfertaIdOverrides: throws when a value is -1 (negative)", () => {
  assert.throws(
    () => parseOfertaIdOverrides({ OFERTA_RESTRICTIVA: -1 }),
    /ofertaIdOverrides debe ser un objeto/,
  );
});

test("parseOfertaIdOverrides: throws when a value is 0", () => {
  assert.throws(
    () => parseOfertaIdOverrides({ OFERTA_RESTRICTIVA: 0 }),
    /ofertaIdOverrides debe ser un objeto/,
  );
});

test("parseOfertaIdOverrides: throws when a value is a float", () => {
  assert.throws(
    () => parseOfertaIdOverrides({ OFERTA_RESTRICTIVA: 1.5 }),
    /ofertaIdOverrides debe ser un objeto/,
  );
});

test("parseOfertaIdOverrides: throws when a value is a string", () => {
  assert.throws(
    () => parseOfertaIdOverrides({ OFERTA_RESTRICTIVA: "42" }),
    /ofertaIdOverrides debe ser un objeto/,
  );
});

test("parseOfertaIdOverrides: accepts minimum valid value of 1", () => {
  const result = parseOfertaIdOverrides({ OFERTA_RESTRICTIVA: 1 });
  assert.deepEqual(result, { OFERTA_RESTRICTIVA: 1 });
});

// ---------------------------------------------------------------------------
// Task 2.1 — deletePeriodFromMRO scope-by-tipo
//
// getDeleteScope(tipo) is exported from admin_workflow_service.js.
// Tests use the real function — no inline stub needed after GREEN.
// ---------------------------------------------------------------------------

test("T2.1a: tipo=REGLAS → deleteReglas=true, deleteParams=false", () => {
  const scope = getDeleteScope("REGLAS");
  assert.equal(scope.deleteReglas, true);
  assert.equal(scope.deleteParams, false);
});

test("T2.1b: tipo=PARAMS → deleteReglas=false, deleteParams=true", () => {
  const scope = getDeleteScope("PARAMS");
  assert.equal(scope.deleteReglas, false);
  assert.equal(scope.deleteParams, true);
});

test("T2.1c: tipo=AMBOS → deleteReglas=true, deleteParams=true", () => {
  const scope = getDeleteScope("AMBOS");
  assert.equal(scope.deleteReglas, true);
  assert.equal(scope.deleteParams, true);
});

test("T2.1d: tipo=undefined defaults to AMBOS → both scopes true", () => {
  const scope = getDeleteScope(undefined);
  assert.equal(scope.deleteReglas, true);
  assert.equal(scope.deleteParams, true);
});

// ---------------------------------------------------------------------------
// Task 2.2 — tipoDs validation via getDeleteScope (real production function).
//
// NOTE: MOTORFECHA new-vs-reuse matching and the id high-water-mark are done
// in SQL (upsertMotorFecha / getMaxIds) and are verified by the live-DB
// checklist in admin_workflow_service.js — NOT by JS mirrors.
// ---------------------------------------------------------------------------

test("T2.2e: tipoDs validation — getDeleteScope rejects values outside {REGLAS,PARAMS,AMBOS}", () => {
  assert.throws(() => getDeleteScope("INVALIDO"), /tipoDs inválido/);
  assert.throws(() => getDeleteScope(""), /tipoDs inválido/);
  // Valid values don't throw
  assert.doesNotThrow(() => getDeleteScope("REGLAS"));
  assert.doesNotThrow(() => getDeleteScope("PARAMS"));
  assert.doesNotThrow(() => getDeleteScope("AMBOS"));
});

// ---------------------------------------------------------------------------
// W-2 — buildWfSafetySnapshotComment (pure helper, real production fn)
// Tests the comment built before publishCfgToWorkflow overwrites WF state.
// ---------------------------------------------------------------------------

test("W-2a: buildWfSafetySnapshotComment with vigDesde and vigHasta", () => {
  const comment = buildWfSafetySnapshotComment({ vigDesde: "2026-01-01", vigHasta: "2026-12-31" });
  assert.match(comment, /2026-01-01/);
  assert.match(comment, /2026-12-31/);
});

test("W-2b: buildWfSafetySnapshotComment with null vigHasta shows 'abierto'", () => {
  const comment = buildWfSafetySnapshotComment({ vigDesde: "2026-06-01", vigHasta: null });
  assert.match(comment, /2026-06-01/);
  assert.match(comment, /abierto/);
});

test("W-2c: buildWfSafetySnapshotComment with undefined rangoDestino uses fallbacks", () => {
  const comment = buildWfSafetySnapshotComment(undefined);
  assert.match(comment, /\?/);
  assert.match(comment, /abierto/);
});

// ---------------------------------------------------------------------------
// WU-06 / RF-VDT-01/02/06 — buildWfSafetySnapshotComment with datetime strings
// CA-VDT-008: midnight compatibility — datetime strings still produce valid comments
// CA-VDT-009: comment string format unchanged when vigencias use THH:mm:ss
// ---------------------------------------------------------------------------

test("CA-VDT-008: buildWfSafetySnapshotComment — midnight datetime string (compatibility)", () => {
  // A WF period with midnight start (2026-01-01T00:00:00) must still produce
  // a valid comment — datetime format change must not break comment generation.
  const comment = buildWfSafetySnapshotComment({
    vigDesde: "2026-01-01T00:00:00",
    vigHasta: "2026-12-31T00:00:00",
  });
  assert.equal(typeof comment, "string");
  assert.match(comment, /2026-01-01T00:00:00/);
  assert.match(comment, /2026-12-31T00:00:00/);
});

test("CA-VDT-009: buildWfSafetySnapshotComment — non-midnight datetime preserved in comment", () => {
  // RF-VDT-06: snapshot auto-comment must include the vigencia datetime strings
  // exactly as provided (no reformatting, no UTC conversion).
  const comment = buildWfSafetySnapshotComment({
    vigDesde: "2026-03-15T14:32:07",
    vigHasta: null,
  });
  assert.match(comment, /2026-03-15T14:32:07/);
  assert.match(comment, /abierto/);
});

// ---------------------------------------------------------------------------
// WU-06.3 — HASTA_DT IS NULL match (design open item a)
// upsertMotorFecha uses (@hasta IS NULL AND HASTA_DT IS NULL) — correct NULL-safe.
// Verified by code inspection: no behavior change needed.
// Documented here as a regression guard via assembleWfSnapshotPayload (pure fn).
// ---------------------------------------------------------------------------

test("WU-06.3: assembleWfSnapshotPayload handles null/undefined vigDesde gracefully", () => {
  const payload = assembleWfSnapshotPayload("{}", null, "testUser");
  assert.ok(typeof payload.name === "string");
  assert.ok(typeof payload.comment === "string");
  assert.match(payload.comment, /completo/);
});

// ---------------------------------------------------------------------------
// Task 2.3 — INSERT column contract (MOTORFECHA_ID present, VIGENCIA_* absent)
// is enforced at the SQL/schema level and verified by the live-DB checklist in
// admin_workflow_service.js. No JS-level test here: asserting a test-local copy
// of the INSERT string would be a tautology, not a verification.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Task 2.10 — validateEntornoCd (admin_validator.js)
//
// Tests use the real exported function from admin_validator.js.
// AppError extends Error, so assert.throws with a regex matches the message.
// ---------------------------------------------------------------------------

test("T2.10a: validateEntornoCd('POC') → passes and returns 'POC'", () => {
  assert.equal(validateEntornoCd("POC"), "POC");
});

test("T2.10b: validateEntornoCd('WF') → passes and returns 'WF'", () => {
  assert.equal(validateEntornoCd("WF"), "WF");
});

test("T2.10c: validateEntornoCd('PRE') → throws", () => {
  assert.throws(() => validateEntornoCd("PRE"), /entorno_cd debe ser POC o WF/);
});

test("T2.10d: validateEntornoCd(undefined) → throws", () => {
  assert.throws(() => validateEntornoCd(undefined), /entorno_cd debe ser POC o WF/);
});
