import test from "node:test";
import assert from "node:assert/strict";

import {
  adaptWorkflowToMotor,
  adaptMotorToWorkflow,
} from "../api/services/workflow_adapter.js";

// ---------------------------------------------------------------------------
// adaptWorkflowToMotor — field mappings
// ---------------------------------------------------------------------------

const BASE_BODY = {
  faseCd: "INIT",
  tipoAltaCd: "NUEVA",
  finalidadCd: "15",
  primeraViviendaHabitualFl: 1,
  tienecasaFl: false,
  viviendaNuevaFl: false,
  importeHipotecaNm: 74000,
  importeViviendaNm: 110000,
  plazoNm: 15,
  comunidadAutonomaCd: 11,
  domiciliaNomina: true,
  arrIntervinientes: [
    {
      ORDEN_NM: 1,
      NACIMIENTO_DT: "1999-03-25",
      ANTIGUEDAD_CLIENTE_DT: "2018-05-31",
      NUMERO_PAGAS_NM: 14,
      INGRESOS_INTERV_NM: 3200,
    },
  ],
};

test("tipoAltaCd → tipoAlta (rename directo)", () => {
  const out = adaptWorkflowToMotor({ ...BASE_BODY, tipoAltaCd: "SUBROGACION" });
  assert.equal(out.tipoAlta, "SUBROGACION");
});

test("finalidadCd → finalidad como entero", () => {
  const out = adaptWorkflowToMotor(BASE_BODY);
  assert.equal(out.finalidad, 15);
  assert.equal(typeof out.finalidad, "number");
});

test("finalidadCd string no numérico → NaN (parseInt behavior)", () => {
  const out = adaptWorkflowToMotor({ ...BASE_BODY, finalidadCd: "X" });
  assert.ok(Number.isNaN(out.finalidad));
});

test("primeraViviendaHabitualFl 1 → primeraViviendaHabitual 1 y esViviendaHabitual true", () => {
  const out = adaptWorkflowToMotor({ ...BASE_BODY, primeraViviendaHabitualFl: 1 });
  assert.equal(out.primeraViviendaHabitual, 1);
  assert.equal(out.esViviendaHabitual, true);
});

test("primeraViviendaHabitualFl 0 → primeraViviendaHabitual 0", () => {
  const out = adaptWorkflowToMotor({ ...BASE_BODY, primeraViviendaHabitualFl: 0 });
  assert.equal(out.primeraViviendaHabitual, 0);
});

test("domiciliaNomina true → domiciliaNominaT1 y domiciliaNominaT2 ambos true", () => {
  const out = adaptWorkflowToMotor({ ...BASE_BODY, domiciliaNomina: true });
  assert.equal(out.domiciliaNominaT1, true);
  assert.equal(out.domiciliaNominaT2, true);
});

test("domiciliaNomina false → domiciliaNominaT1 y domiciliaNominaT2 ambos false", () => {
  const out = adaptWorkflowToMotor({ ...BASE_BODY, domiciliaNomina: false });
  assert.equal(out.domiciliaNominaT1, false);
  assert.equal(out.domiciliaNominaT2, false);
});

test("numTitulares = arrIntervinientes.length", () => {
  const out = adaptWorkflowToMotor(BASE_BODY);
  assert.equal(out.numTitulares, 1);
});

test("dos titulares → numTitulares = 2", () => {
  const body = {
    ...BASE_BODY,
    arrIntervinientes: [
      { ORDEN_NM: 1, NACIMIENTO_DT: "1990-01-01", ANTIGUEDAD_CLIENTE_DT: "2010-01-01", NUMERO_PAGAS_NM: 14, INGRESOS_INTERV_NM: 2000 },
      { ORDEN_NM: 2, NACIMIENTO_DT: "1992-06-15", ANTIGUEDAD_CLIENTE_DT: "2015-06-15", NUMERO_PAGAS_NM: 12, INGRESOS_INTERV_NM: 1800 },
    ],
  };
  const out = adaptWorkflowToMotor(body);
  assert.equal(out.numTitulares, 2);
});

test("edadMax = edad del titular más antiguo (mayor edad)", () => {
  const body = {
    ...BASE_BODY,
    arrIntervinientes: [
      { ORDEN_NM: 1, NACIMIENTO_DT: "1990-01-01", ANTIGUEDAD_CLIENTE_DT: "2010-01-01", NUMERO_PAGAS_NM: 14, INGRESOS_INTERV_NM: 2000 },
      { ORDEN_NM: 2, NACIMIENTO_DT: "1985-06-15", ANTIGUEDAD_CLIENTE_DT: "2005-06-15", NUMERO_PAGAS_NM: 14, INGRESOS_INTERV_NM: 2500 },
    ],
  };
  const out = adaptWorkflowToMotor(body);
  // T2 nacido en 1985 tiene más edad
  assert.ok(out.edadMax >= out.antiguedadT1 / 12);
  const ageT1 = Math.floor((new Date() - new Date("1990-01-01")) / (365.25 * 24 * 3600 * 1000));
  const ageT2 = Math.floor((new Date() - new Date("1985-06-15")) / (365.25 * 24 * 3600 * 1000));
  assert.equal(out.edadMax, Math.max(ageT1, ageT2));
});

test("ingresoTotal14: normalización a 14 pagas — 1 titular, 14 pagas", () => {
  const out = adaptWorkflowToMotor(BASE_BODY);
  // 3200 × 14 / 14 = 3200
  assert.equal(out.ingresoTotal14, 3200);
});

test("ingresoTotal14: normalización a 14 pagas — 1 titular, 12 pagas", () => {
  const body = {
    ...BASE_BODY,
    arrIntervinientes: [
      { ORDEN_NM: 1, NACIMIENTO_DT: "1990-01-01", ANTIGUEDAD_CLIENTE_DT: "2010-01-01", NUMERO_PAGAS_NM: 12, INGRESOS_INTERV_NM: 2000 },
    ],
  };
  const out = adaptWorkflowToMotor(body);
  // 2000 × 12 / 14 ≈ 1714.28
  assert.ok(Math.abs(out.ingresoTotal14 - (2000 * 12 / 14)) < 0.01);
});

test("ingresoTotal14: suma de dos titulares normalizados", () => {
  const body = {
    ...BASE_BODY,
    arrIntervinientes: [
      { ORDEN_NM: 1, NACIMIENTO_DT: "1990-01-01", ANTIGUEDAD_CLIENTE_DT: "2010-01-01", NUMERO_PAGAS_NM: 14, INGRESOS_INTERV_NM: 2000 },
      { ORDEN_NM: 2, NACIMIENTO_DT: "1992-01-01", ANTIGUEDAD_CLIENTE_DT: "2015-01-01", NUMERO_PAGAS_NM: 14, INGRESOS_INTERV_NM: 1500 },
    ],
  };
  const out = adaptWorkflowToMotor(body);
  assert.equal(out.ingresoTotal14, 3500);
});

test("antiguedadT1: meses calculados desde ANTIGUEDAD_CLIENTE_DT", () => {
  const fixedDate = "2020-05-01";
  const body = {
    ...BASE_BODY,
    arrIntervinientes: [
      { ORDEN_NM: 1, NACIMIENTO_DT: "1990-01-01", ANTIGUEDAD_CLIENTE_DT: fixedDate, NUMERO_PAGAS_NM: 14, INGRESOS_INTERV_NM: 2000 },
    ],
  };
  const out = adaptWorkflowToMotor(body);
  assert.ok(typeof out.antiguedadT1 === "number");
  // Debe ser un número positivo (antiguedad desde 2020)
  assert.ok(out.antiguedadT1 > 0);
});

test("antiguedadT2 = 0 cuando hay un solo titular", () => {
  const out = adaptWorkflowToMotor(BASE_BODY);
  assert.equal(out.antiguedadT2, 0);
});

test("antiguedadT2 > 0 cuando hay dos titulares", () => {
  const body = {
    ...BASE_BODY,
    arrIntervinientes: [
      { ORDEN_NM: 1, NACIMIENTO_DT: "1990-01-01", ANTIGUEDAD_CLIENTE_DT: "2010-01-01", NUMERO_PAGAS_NM: 14, INGRESOS_INTERV_NM: 2000 },
      { ORDEN_NM: 2, NACIMIENTO_DT: "1992-01-01", ANTIGUEDAD_CLIENTE_DT: "2015-01-01", NUMERO_PAGAS_NM: 14, INGRESOS_INTERV_NM: 1500 },
    ],
  };
  const out = adaptWorkflowToMotor(body);
  assert.ok(out.antiguedadT2 > 0);
});

test("importeHipotecaNm → importeHipoteca", () => {
  const out = adaptWorkflowToMotor(BASE_BODY);
  assert.equal(out.importeHipoteca, 74000);
});

test("importeViviendaNm → importeVivienda", () => {
  const out = adaptWorkflowToMotor(BASE_BODY);
  assert.equal(out.importeVivienda, 110000);
});

test("plazoNm → plazo", () => {
  const out = adaptWorkflowToMotor(BASE_BODY);
  assert.equal(out.plazo, 15);
});

test("sin arrIntervinientes → valores null/0 por defecto", () => {
  const body = { faseCd: "INIT", tipoAltaCd: "NUEVA" };
  const out = adaptWorkflowToMotor(body);
  assert.equal(out.numTitulares, 0);
  assert.equal(out.edadMax, null);
  assert.equal(out.ingresoTotal14, 0);
  assert.equal(out.antiguedadT1, 0);
  assert.equal(out.antiguedadT2, 0);
});

// ---------------------------------------------------------------------------
// adaptMotorToWorkflow — response envelope
// ---------------------------------------------------------------------------

test("CA-010: OFERTA_GANADORA es null en respuesta (INIT/PRE)", () => {
  const out = adaptMotorToWorkflow({
    eligibleOffers: [{ offerCode: "ULTRA_ALTO_RIESGO", offer_rank: 100 }],
    uiLimits: null,
    winner: null,
  });
  assert.equal(out.RESULTADO.OFERTA_GANADORA, null);
});

test("CA-011: OFERTA_GANADORA no es null cuando hay winner (FINAL)", () => {
  const out = adaptMotorToWorkflow({
    eligibleOffers: [{ offerCode: "ULTRA_ALTO_RIESGO", offer_rank: 100 }],
    uiLimits: { ltv: 0.85 },
    winner: { offerCode: "ULTRA_ALTO_RIESGO", offer_rank: 100 },
  });
  assert.equal(out.RESULTADO.OFERTA_GANADORA?.offerCode, "ULTRA_ALTO_RIESGO");
});

test("estructura de respuesta tiene las tres claves requeridas", () => {
  const out = adaptMotorToWorkflow({ eligibleOffers: [], uiLimits: null, winner: null });
  assert.ok("RESULTADO" in out);
  assert.ok("LIMITES" in out.RESULTADO);
  assert.ok("OFERTAS_ELEGIBLES" in out.RESULTADO);
  assert.ok("OFERTA_GANADORA" in out.RESULTADO);
});

test("OFERTAS_ELEGIBLES mapea offerCode y offer_rank", () => {
  const out = adaptMotorToWorkflow({
    eligibleOffers: [
      { offerCode: "ULTRA_ALTO_RIESGO", offer_rank: 100 },
      { offerCode: "OFERTA_RESTRINGIDA", offer_rank: 10 },
    ],
    uiLimits: null,
    winner: null,
  });
  assert.equal(out.RESULTADO.OFERTAS_ELEGIBLES.length, 2);
  assert.equal(out.RESULTADO.OFERTAS_ELEGIBLES[0].offerCode, "ULTRA_ALTO_RIESGO");
});

test("LIMITES refleja uiLimits del motor", () => {
  const limits = { ltvMax: 0.95, plazoMax: 30 };
  const out = adaptMotorToWorkflow({ eligibleOffers: [], uiLimits: limits, winner: null });
  assert.deepEqual(out.RESULTADO.LIMITES, limits);
});

test("LIMITES es null cuando uiLimits es null (INIT)", () => {
  const out = adaptMotorToWorkflow({ eligibleOffers: [], uiLimits: null, winner: null });
  assert.equal(out.RESULTADO.LIMITES, null);
});
