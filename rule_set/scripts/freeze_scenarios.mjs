/**
 * Congela (golden snapshot) la salida del motor para cada escenario de negocio.
 *
 * Escribe fixtures/business_scenarios.golden.json con, por escenario:
 *   { initEligibles, preEligibles, finalEligibles, winner, uiLimits }
 *
 * y compara la ganadora calculada por el motor contra la `winner` ESPERADA
 * declarada a mano en business_scenarios.js. Cualquier discrepancia se reporta
 * (y el proceso sale con código 1) — así un error de transcripción no pasa silencioso.
 *
 * Re-ejecutar tras cambiar rules.json o los escenarios, y revisar el golden.
 *
 * Uso (desde rule_set/):  node scripts/freeze_scenarios.mjs
 */
import fs from "fs";
import { SCENARIOS } from "../fixtures/business_scenarios.js";
import { runScenario } from "../fixtures/scenario_runner.js";

const golden = {};
const mismatches = [];
for (const sc of SCENARIOS) {
  const { snapshot } = runScenario(sc);
  golden[sc.id] = snapshot;
  if (snapshot.winner !== (sc.winner ?? null)) {
    mismatches.push(`${sc.id}: esperado=${sc.winner ?? "null"} · motor=${snapshot.winner ?? "null"}`);
  }
}

const outPath = new URL("../fixtures/business_scenarios.golden.json", import.meta.url);
fs.writeFileSync(outPath, JSON.stringify(golden, null, 2) + "\n", "utf8");

console.log(`Golden escrito: ${outPath.pathname}`);
console.log(`Escenarios congelados: ${SCENARIOS.length}`);
if (mismatches.length) {
  console.error(`\n❌ DISCREPANCIAS ganadora esperada vs motor (${mismatches.length}):`);
  for (const m of mismatches) console.error("  - " + m);
  process.exit(1);
}
console.log("✅ Todas las ganadoras esperadas coinciden con el motor.");
