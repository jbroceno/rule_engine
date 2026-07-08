/**
 * Tests for transformWfToPoc and computeNewValidTo (admin_service.js).
 *
 * Bug fixed: rule_name was hardcoded to "WF #<id>" instead of the rule's
 * descriptive name. The WF-snapshot SP now emits MOTORREGLA_DS in
 * NOMBRE_REGLA_TXT and the offer code in a separate OFERTA_CD field.
 *
 * WU-07: computeNewValidTo pure helper — period-close uses exact nextFrom
 * (half-open interval, ADR-003). No setUTCDate(-1), no DATEADD(day,-1,...).
 *
 * These tests exercise the REAL exported functions (no mirrors).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { transformWfToPoc, computeNewValidTo } from "../api/services/admin_service.js";

test("WF->POC new format: rule_name = NOMBRE_REGLA_TXT (MOTORREGLA_DS), offerCode from POC map", () => {
  const rulesJson = {
    ofertas: [{ OFERTA_ID: 10, OFERTA_CD: "WF_FIDELIZACION" }],
    reglas: [
      {
        REGLA_ID: 5,
        OFERTA_ID: 10,
        OFERTA_CD: "WF_FIDELIZACION",
        NOMBRE_REGLA_TXT: "neg.: EdadT1 < MAXEDAD",
        PRIORIDAD_NM: 20,
        STOP_PROCESSING_CD: 0,
        condiciones: [],
        acciones: [],
      },
    ],
    params: [],
  };
  const { rules } = transformWfToPoc(rulesJson, null, new Map([[10, "POC_FIDELIZACION"]]));
  assert.equal(rules[0].rule_name, "neg.: EdadT1 < MAXEDAD");
  assert.equal(rules[0].offerCode, "POC_FIDELIZACION"); // POC map wins
});

test("WF->POC new format without POC mapping: offerCode falls back to OFERTA_CD (not the rule name)", () => {
  const rulesJson = {
    ofertas: [{ OFERTA_ID: 10, OFERTA_CD: "WF_FIDELIZACION" }],
    reglas: [
      {
        REGLA_ID: 6,
        OFERTA_ID: 10,
        OFERTA_CD: "WF_FIDELIZACION",
        NOMBRE_REGLA_TXT: "regla descriptiva",
        PRIORIDAD_NM: 10,
        condiciones: [],
        acciones: [],
      },
    ],
    params: [],
  };
  const { rules } = transformWfToPoc(rulesJson, null, new Map());
  assert.equal(rules[0].rule_name, "regla descriptiva");
  assert.equal(rules[0].offerCode, "WF_FIDELIZACION"); // OFERTA_CD, NOT the rule name
});

test("WF->POC legacy snapshot (no OFERTA_CD): rule_name falls back to 'WF #<id>'", () => {
  // Legacy: NOMBRE_REGLA_TXT held the offer code, there is no rule name.
  const rulesJson = {
    ofertas: [{ OFERTA_ID: 10, NOMBRE_REGLA_TXT: "FIDELIZACION" }],
    reglas: [
      {
        REGLA_ID: 7,
        OFERTA_ID: 10,
        NOMBRE_REGLA_TXT: "FIDELIZACION",
        PRIORIDAD_NM: 10,
        condiciones: [],
        acciones: [],
      },
    ],
    params: [],
  };
  const { rules } = transformWfToPoc(rulesJson, null, new Map());
  assert.equal(rules[0].rule_name, "WF #7");
  assert.equal(rules[0].offerCode, "FIDELIZACION"); // legacy NOMBRE_REGLA_TXT = offer code
});

// ---------------------------------------------------------------------------
// WU-07 — computeNewValidTo: period-close = exact nextFrom (ADR-003)
// CA-COD-009/010: no -1 day arithmetic; half-open interval semantics.
// ---------------------------------------------------------------------------

test("(CA-COD-010) computeNewValidTo: null nextFrom → null (open-ended)", () => {
  const result = computeNewValidTo(null);
  assert.equal(result, null, "null nextFrom debe devolver null");
});

test("(CA-COD-010) computeNewValidTo: nextFrom date → retorna la misma fecha exacta (no -1 día)", () => {
  // ADR-003: newValidTo = nextFrom exactly. The old code did setUTCDate(-1).
  const nextFrom = new Date(2026, 5, 15, 14, 32, 7, 0); // 2026-06-15T14:32:07 local
  const result = computeNewValidTo(nextFrom);
  assert.ok(result instanceof Date, "debe devolver Date");
  assert.equal(result.getTime(), nextFrom.getTime(), "debe ser la misma fecha exacta que nextFrom");
});

test("(CA-COD-010) computeNewValidTo: midnight nextFrom — retorna medianoche exacta (no 23:59:59)", () => {
  const nextFrom = new Date(2026, 5, 1, 0, 0, 0, 0); // 2026-06-01T00:00:00
  const result = computeNewValidTo(nextFrom);
  // Must NOT be 2026-05-31T23:59:59 (old -1 day + EOD behavior)
  // Must NOT be 2026-05-31T00:00:00 (old -1 day behavior)
  assert.equal(result.getDate(), 1, "debe seguir siendo el día 1");
  assert.equal(result.getMonth(), 5, "debe seguir siendo junio");
  assert.equal(result.getFullYear(), 2026);
  assert.equal(result.getHours(), 0);
  assert.equal(result.getMinutes(), 0);
  assert.equal(result.getSeconds(), 0);
});

test("(CA-COD-010) computeNewValidTo: string nextFrom — acepta y normaliza a second-truncated Date", () => {
  const result = computeNewValidTo("2026-09-01T08:30:00");
  assert.ok(result instanceof Date, "debe devolver Date");
  assert.equal(result.getFullYear(), 2026);
  assert.equal(result.getMonth(), 8); // September = 8 (0-indexed)
  assert.equal(result.getDate(), 1);
  assert.equal(result.getHours(), 8);
  assert.equal(result.getMinutes(), 30);
  assert.equal(result.getMilliseconds(), 0, "ms deben ser 0");
});
