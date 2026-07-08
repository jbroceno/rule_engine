/**
 * Validación de escenarios de negocio — Ofertas Hipotecarias (6 ofertas).
 *
 * Fuente de verdad: fixtures/business_scenarios.js  (entrada + ganadora esperada)
 * Golden snapshot:  fixtures/business_scenarios.golden.json  (elegibles + uiLimits)
 * Runner:           fixtures/scenario_runner.js
 *
 * Cada escenario verifica DOS cosas:
 *   1) Ganadora obtenida === ganadora ESPERADA (contrato de negocio, matriz de decisión).
 *   2) Snapshot completo (elegibles INIT/PRE/FINAL + uiLimits) === golden congelado.
 *      → bloquea regresiones en CUALQUIER oferta, no solo en la ganadora.
 *
 * Si cambia rules.json o un escenario: re-ejecutar `node scripts/freeze_scenarios.mjs`,
 * revisar el golden, y volver a correr esta suite.
 *
 * Ejecución:
 *   npm run test:scenarios
 *   npm run test:scenarios 2>&1 | tee evidencia.txt
 *
 * Salida por caso (t.diagnostic): elegibles ✓/✗ por fase + ganadora.
 *
 * Matriz de decisión FINAL (base OK: EDAD_MAX_NM=35, ant≥12, ingresos≥2300):
 *   LTV∈(0.80,0.95] + plazo[ 5,30]  →  ALTO_RIESGO(90)
 *   LTV∈(0.80,0.90] + plazo[31,40]  →  ULTRA_ALTO_RIESGO(100)
 *   LTV∈(0.90,0.95] + plazo[31,40]  →  FIDELIZACION (COMBINADA: LTV>0.90; ALTO_LTV: plazo>30)
 *   LTV∈(0,0.80]    + plazo[ 5,30]  →  PROMOCION_HC(70) / PROMOCION(60) si ingresos bajos
 *   LTV∈(0,0.80]    + plazo[31,40]  →  LARGO_PLAZO(80)
 *   LTV>0.95         (cualquiera)    →  FIDELIZACION(10)
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { SCENARIOS } from "../fixtures/business_scenarios.js";
import { runScenario, offers, paramsIndex, OK } from "../fixtures/scenario_runner.js";
import { initcheck } from "../rule_engine.js";

const golden = JSON.parse(
  fs.readFileSync(new URL("../fixtures/business_scenarios.golden.json", import.meta.url), "utf8")
);

function diag(t, res) {
  const line = (all, key) =>
    all.map((o) => `${o.offerCode}:${o.dictamen[key] === true ? "✓" : "✗"}`).join(" ");
  t.diagnostic(`  INIT   ${line(res.initRes.all, "initEligible")}`);
  t.diagnostic(`  PRE    ${line(res.preRes.all, "preEligible")}`);
  t.diagnostic(`  FINAL  ${line(res.finalRes.all, "eligible")}  →  ${res.finalRes.winner?.offerCode ?? "SIN GANADORA"}`);
}

for (const sc of SCENARIOS) {
  test(`${sc.id} | ${sc.grupo} | ${sc.desc}`, (t) => {
    const res = runScenario(sc);
    diag(t, res);

    // 1) Contrato de negocio: ganadora esperada
    assert.equal(
      res.finalRes.winner?.offerCode ?? null,
      sc.winner ?? null,
      `${sc.id}: ganadora esperada=${sc.winner ?? "null"} · obtenida=${res.finalRes.winner?.offerCode ?? "null"}`
    );

    // 2) Snapshot completo congelado (elegibles por fase + uiLimits)
    const expected = golden[sc.id];
    assert.ok(expected, `${sc.id}: falta golden — re-ejecutar scripts/freeze_scenarios.mjs`);
    assert.deepEqual(res.snapshot, expected, `${sc.id}: el snapshot del motor difiere del golden congelado`);

    // Comprobación extra: FIDELIZACION informa límites en el dictamen
    if (sc.checkClientesLimits) {
      const cli = initcheck(OK, offers, paramsIndex).all.find((o) => o.offerCode === "FIDELIZACION");
      assert.equal(cli.dictamen.MIN_HIPOTECA, 20000, "FIDELIZACION INIT: MIN_HIPOTECA");
      assert.equal(cli.dictamen.MAX_HIPOTECA, 2000000, "FIDELIZACION INIT: MAX_HIPOTECA");
      assert.equal(cli.dictamen.MIN_PLAZO, 3, "FIDELIZACION INIT: MIN_PLAZO");
      assert.equal(cli.dictamen.MAX_PLAZO, 35, "FIDELIZACION INIT: MAX_PLAZO");
      assert.equal(cli.dictamen.MAX_LTV, 0.8, "FIDELIZACION INIT: MAX_LTV");
      assert.equal(cli.dictamen.EDAD_PLAZO, 75, "FIDELIZACION INIT: EDAD_PLAZO");
      assert.equal(cli.dictamen.MIN_LTV_EXCLUSIVE, undefined, "FIDELIZACION no define MIN_LTV_EXCLUSIVE");
    }
  });
}
