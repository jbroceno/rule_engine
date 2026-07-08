import fs from "fs";
import util from "util";

import { computeDerived, finalize, normalizeConfig, initcheck, precheck } from "./rule_engine.js";

const DEBUG = process.env.RULE_ENGINE_DEBUG === "1";
const USE_COLORS = process.stdout.isTTY;

function loadConfig() {
  const raw = fs.readFileSync("./rules.json", "utf8");
  return JSON.parse(raw);
}

function runDemo() {
  const cfg = loadConfig();
  const { offers, paramsIndex } = normalizeConfig(cfg);

  const base = {
    numTitulares: 2,
    edadMax: 41,
    finalidad: 1,
    primeraViviendaHabitual: 1,
    ingresoTotal14: 45000,
    esViviendaHabitual: true,
    tipoAlta: "NOVACION",
  };

  console.log("\nINITCHECK:");
  const init = initcheck(base, offers, paramsIndex, { debug: DEBUG });
  console.log(util.inspect(init, { depth: null, colors: USE_COLORS }));

  console.log("\nPRECHECK:");
  const pre = precheck(base, offers, paramsIndex, { debug: DEBUG });
  console.log(util.inspect(pre, { depth: null, colors: USE_COLORS }));

  const full = computeDerived({
    ...base,
    importeHipoteca: 400000,
    importeCompraventa: 1250000,
    importeTasacion: 440000,
    plazoMeses: 420,
  });

  console.log("\nFINALIZE:");
  const result = finalize(full, offers, paramsIndex, pre, { debug: DEBUG });
  console.log(util.inspect(result, { depth: null, colors: USE_COLORS }));

  if (result.winner) {
    console.log(`WINNER: oferta ${result.winner.oferta_id}`);
  } else {
    console.log("WINNER: NOT FOUND");
  }
}

runDemo();
