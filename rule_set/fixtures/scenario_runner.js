/**
 * Runner compartido de escenarios de negocio.
 *
 * Carga rules.json una vez y expone runScenario(sc), que ejecuta el pipeline
 * INIT → PRE → FINAL (independiente o encadenado) y devuelve resultados + snapshot.
 *
 * Lo usan: test/offer_scenarios.test.js, scripts/freeze_scenarios.mjs y
 * scripts/gen_evidencia_report.mjs — una sola implementación, sin divergencias.
 */
import fs from "fs";
import { computeDerived, finalize, initcheck, normalizeConfig, precheck } from "../rule_engine.js";
import { OK } from "./business_scenarios.js";

const { offers, paramsIndex } = normalizeConfig(
  JSON.parse(fs.readFileSync(new URL("../rules.json", import.meta.url), "utf8"))
);

export { OK, offers, paramsIndex };

const eligibles = (allOffers, key) =>
  allOffers.filter((o) => o.dictamen[key] === true).map((o) => o.offerCode).sort();

export function runScenario(sc) {
  const chained = sc.mode === "chained";
  const input = { ...OK, ...sc.base };
  const initRes = initcheck(input, offers, paramsIndex);
  const preRes = precheck(input, offers, paramsIndex, chained ? { chained: true } : undefined);
  const derived = computeDerived({ ...input, ...sc.fin });
  const finalRes = finalize(derived, offers, paramsIndex, chained ? null : preRes, chained ? { chained: true } : undefined);
  return {
    input,
    derived,
    initRes,
    preRes,
    finalRes,
    snapshot: {
      initEligibles: eligibles(initRes.all, "initEligible"),
      preEligibles: eligibles(preRes.all, "preEligible"),
      finalEligibles: eligibles(finalRes.all, "eligible"),
      winner: finalRes.winner?.offerCode ?? null,
      uiLimits: finalRes.uiLimits ?? {},
    },
  };
}
