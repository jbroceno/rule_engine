/**
 * CA-012: tests de fixture (siempre ejecutan, sin red ni BD).
 * CA-013: tests live (se omiten si WF_TOKEN / WF_BASE_URL no están definidas).
 *
 * Los tests de fixture invocan el pipeline completo (adapter + rule_engine)
 * usando la configuración local rules.json. No arrancan un servidor HTTP.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";

import { normalizeConfig } from "../rule_engine.js";
import { initcheck, precheck, computeDerived, finalize } from "../rule_engine.js";
import { adaptWorkflowToMotor, adaptMotorToWorkflow } from "../api/services/workflow_adapter.js";

// ---------------------------------------------------------------------------
// Fixture config (rules.json — sin BD)
// ---------------------------------------------------------------------------

const ROOT = path.dirname(fileURLToPath(import.meta.url));

function loadFixtureConfig() {
  const raw = fs.readFileSync(path.join(ROOT, "../rules.json"), "utf8");
  return JSON.parse(raw);
}

function runPipeline(body) {
  const config = loadFixtureConfig();
  const { offers, paramsIndex } = normalizeConfig(config);
  const faseCd = String(body.faseCd ?? "").toUpperCase();
  const motorInput = adaptWorkflowToMotor(body);

  let motorResult;
  if (faseCd === "INIT") {
    const result = initcheck(motorInput, offers, paramsIndex);
    motorResult = { eligibleOffers: result.eligibleOffers, uiLimits: null, winner: null };
  } else if (faseCd === "PRE") {
    const inputFull = computeDerived(motorInput);
    const result = precheck(inputFull, offers, paramsIndex);
    motorResult = { eligibleOffers: result.eligibleOffers, uiLimits: result.uiLimits, winner: null };
  } else {
    const inputFull = computeDerived(motorInput);
    const preResult = precheck(inputFull, offers, paramsIndex);
    const finalResult = finalize(inputFull, offers, paramsIndex, preResult);
    motorResult = { eligibleOffers: preResult.eligibleOffers, uiLimits: preResult.uiLimits, winner: finalResult.winner };
  }

  return adaptMotorToWorkflow(motorResult);
}

// ---------------------------------------------------------------------------
// Casos de fixture — CA-012
// ---------------------------------------------------------------------------

const TITULAR_BASE = {
  ORDEN_NM: 1,
  NACIMIENTO_DT: "1999-03-25",
  ANTIGUEDAD_CLIENTE_DT: "2018-05-31",
  NUMERO_PAGAS_NM: 14,
  INGRESOS_INTERV_NM: 3200,
};

const BASE_REQUEST = {
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
  arrIntervinientes: [TITULAR_BASE],
};

test("CA-012: respuesta tiene estructura RESULTADO con tres claves", () => {
  const resp = runPipeline({ ...BASE_REQUEST, faseCd: "INIT" });
  assert.ok("RESULTADO" in resp, "falta RESULTADO");
  assert.ok("LIMITES" in resp.RESULTADO, "falta LIMITES");
  assert.ok("OFERTAS_ELEGIBLES" in resp.RESULTADO, "falta OFERTAS_ELEGIBLES");
  assert.ok("OFERTA_GANADORA" in resp.RESULTADO, "falta OFERTA_GANADORA");
});

test("CA-012 / CA-010: fase INIT devuelve OFERTA_GANADORA null (BR-008)", () => {
  const resp = runPipeline({ ...BASE_REQUEST, faseCd: "INIT" });
  assert.equal(resp.RESULTADO.OFERTA_GANADORA, null);
});

test("CA-012 / CA-010: fase INIT devuelve LIMITES null", () => {
  const resp = runPipeline({ ...BASE_REQUEST, faseCd: "INIT" });
  assert.equal(resp.RESULTADO.LIMITES, null);
});

test("CA-012 / CA-010: fase PRE devuelve OFERTA_GANADORA null (BR-008)", () => {
  const resp = runPipeline({ ...BASE_REQUEST, faseCd: "PRE" });
  assert.equal(resp.RESULTADO.OFERTA_GANADORA, null);
});

test("CA-012 / CA-011: fase FINAL devuelve estructura completa", () => {
  const resp = runPipeline({ ...BASE_REQUEST, faseCd: "FINAL" });
  assert.ok(Array.isArray(resp.RESULTADO.OFERTAS_ELEGIBLES));
  // OFERTA_GANADORA puede ser null si ninguna oferta es elegible en el fixture
  // pero la clave siempre existe
  assert.ok("OFERTA_GANADORA" in resp.RESULTADO);
});

test("CA-012: tipoAlta SUBROGACION reduce elegibles vs NUEVA", () => {
  const baseInit = runPipeline({ ...BASE_REQUEST, faseCd: "INIT" });
  const subroInit = runPipeline({ ...BASE_REQUEST, faseCd: "INIT", tipoAltaCd: "SUBROGACION" });
  // SUBROGACION suele eliminar ofertas que solo admiten tipos de alta específicos
  assert.ok(subroInit.RESULTADO.OFERTAS_ELEGIBLES.length <= baseInit.RESULTADO.OFERTAS_ELEGIBLES.length);
});

test("CA-012: OFERTAS_ELEGIBLES es array (puede estar vacío)", () => {
  const resp = runPipeline({ ...BASE_REQUEST, faseCd: "INIT" });
  assert.ok(Array.isArray(resp.RESULTADO.OFERTAS_ELEGIBLES));
});

test("CA-012: cada oferta elegible tiene offerCode y offer_rank", () => {
  const resp = runPipeline({ ...BASE_REQUEST, faseCd: "INIT" });
  for (const oferta of resp.RESULTADO.OFERTAS_ELEGIBLES) {
    assert.ok(typeof oferta.offerCode === "string", "offerCode debe ser string");
    assert.ok(typeof oferta.offer_rank === "number", "offer_rank debe ser number");
  }
});

// ---------------------------------------------------------------------------
// Tests live — CA-013 (skip si WF_TOKEN o WF_BASE_URL no definidos)
// ---------------------------------------------------------------------------

const WF_TOKEN = process.env.WF_TOKEN;
const WF_BASE_URL = process.env.WF_BASE_URL;
const hasLiveCredentials = Boolean(WF_TOKEN && WF_BASE_URL);

test("CA-013: test live INIT — skip si sin credenciales", { skip: !hasLiveCredentials }, async () => {
  const body = { ...BASE_REQUEST, faseCd: "INIT", token: WF_TOKEN };

  // Llamada al endpoint WF real
  const wfResp = await fetch(`${WF_BASE_URL}/ApiRest/GetOfertasHipotecas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.ok(wfResp.ok, `WF respondió ${wfResp.status}`);
  const wfJson = await wfResp.json();

  // Llamada al adaptador POC con misma entrada
  const pocResp = runPipeline(body);

  // Comparar campos clave
  assert.deepEqual(
    (pocResp.RESULTADO.OFERTAS_ELEGIBLES ?? []).map((o) => o.offerCode).sort(),
    ((wfJson.RESULTADO?.OFERTAS_ELEGIBLES ?? wfJson.OFERTAS_ELEGIBLES ?? [])
      .map((o) => o.offerCode ?? o.OFERTA_CD)
      .sort()),
    "OFERTAS_ELEGIBLES debe coincidir con Workflow real"
  );
});

test("CA-013: test live FINAL — skip si sin credenciales", { skip: !hasLiveCredentials }, async () => {
  const body = { ...BASE_REQUEST, faseCd: "FINAL", token: WF_TOKEN };

  const wfResp = await fetch(`${WF_BASE_URL}/ApiRest/GetOfertasHipotecas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.ok(wfResp.ok, `WF respondió ${wfResp.status}`);
  const wfJson = await wfResp.json();

  const pocResp = runPipeline(body);

  const wfWinner =
    wfJson.RESULTADO?.OFERTA_GANADORA ?? wfJson.OFERTA_GANADORA ?? null;
  const pocWinner = pocResp.RESULTADO.OFERTA_GANADORA;

  assert.equal(
    pocWinner?.offerCode ?? null,
    wfWinner?.offerCode ?? wfWinner?.OFERTA_CD ?? null,
    "OFERTA_GANADORA debe coincidir con Workflow real"
  );
});
