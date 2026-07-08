/**
 * Generador del informe de evidencias de la SUITE COMPLETA (entrega al cliente).
 *
 * - Escenarios de negocio: detalle por caso (entrada al motor → esperado → obtenido:
 *   elegibles INIT/PRE/FINAL, ganadora, uiLimits) desde la MISMA fuente que verifica
 *   el test (fixtures/business_scenarios.js + golden). Imposible que diverjan.
 * - Resto de ficheros: resumen y tabla de tests parseando la salida TAP por fichero.
 *
 * Uso (desde rule_set/):
 *   node --test > docs/evidencias/evidencia-full-<fecha>.txt 2>&1
 *   mkdir -p docs/evidencias/raw
 *   for f in test/*.test.js; do b=$(basename "$f" .test.js); node --test "$f" > docs/evidencias/raw/$b.tap 2>&1; done
 *   node scripts/gen_evidencia_report.mjs <fecha>
 */
import fs from "fs";
import { SCENARIOS } from "../fixtures/business_scenarios.js";
import { runScenario } from "../fixtures/scenario_runner.js";

const fecha = process.argv[2] ?? "2026-06-09";
const rawDir = new URL(`../docs/evidencias/raw/`, import.meta.url);
const outPath = new URL(`../docs/evidencias/informe-evidencias-full-${fecha}.md`, import.meta.url);

const golden = JSON.parse(
  fs.readFileSync(new URL("../fixtures/business_scenarios.golden.json", import.meta.url), "utf8")
);

// ─── Descripciones legibles por fichero de test ──────────────────────────────
const FILE_DESC = {
  rule_engine: "Motor de reglas — normalización, DNF, pipeline INIT/PRE/FINAL",
  offer_scenarios: "Escenarios de negocio — matriz de decisión ofertas × fases (detalle en §3)",
  config_cache: "Caché de configuración (SP wrapper, tamaño de historial)",
  motor_fechas: "Motor de fechas — vigencias y periodos",
  vigencia_utils: "Utilidades de vigencia (DATETIME2, rangos)",
  wf_restore_transform: "Transformación de restore WF → POC",
  workflow_adapter: "Adaptador de workflow (entrada/salida del motor)",
  workflow_publish: "Publicación de configuración a workflow",
  workflow_service: "Servicio de workflow (CA-012/013 — algunos live, se omiten sin credenciales)",
  workflow_snapshot_roundtrip: "Snapshot WF — ida y vuelta",
  workflow_upsert_match: "Matching de upsert en workflow",
};

// ─── Parseo de cada TAP por fichero ──────────────────────────────────────────
function parseTap(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(ok|not ok) (\d+) - (.*)$/);
    if (!m) continue;
    let [, status, n, name] = m;
    let estado = status === "ok" ? "PASS" : "FAIL";
    if (/#\s*SKIP\b/i.test(name)) { estado = "SKIP"; name = name.replace(/\s*#\s*SKIP.*$/i, ""); }
    else if (/#\s*TODO\b/i.test(name)) { estado = "TODO"; name = name.replace(/\s*#\s*TODO.*$/i, ""); }
    rows.push({ n: Number(n), name: name.trim(), estado });
  }
  return rows;
}
const ICON = { PASS: "✅ PASS", FAIL: "❌ FAIL", SKIP: "⏭️ SKIP", TODO: "📋 TODO" };

const files = fs.readdirSync(rawDir).filter((f) => f.endsWith(".tap")).map((f) => f.replace(/\.tap$/, "")).sort();
const perFile = files.map((base) => {
  const rows = parseTap(fs.readFileSync(new URL(`${base}.tap`, rawDir), "utf8"));
  return {
    base, desc: FILE_DESC[base] ?? base, rows,
    total: rows.length,
    pass: rows.filter((r) => r.estado === "PASS").length,
    fail: rows.filter((r) => r.estado === "FAIL").length,
    skip: rows.filter((r) => r.estado === "SKIP").length,
  };
});
const TOT = perFile.reduce((a, f) => ({ total: a.total + f.total, pass: a.pass + f.pass, fail: a.fail + f.fail, skip: a.skip + f.skip }), { total: 0, pass: 0, fail: 0, skip: 0 });

// ─── Helpers de formato ──────────────────────────────────────────────────────
const fmt = (n) => (typeof n === "number" ? n.toLocaleString("es-ES") : n);
const list = (arr) => (arr && arr.length ? arr.join(", ") : "—");
const uiStr = (ui) =>
  Object.keys(ui).length
    ? Object.entries(ui).map(([k, v]) => `${k}=${v}`).join(" · ")
    : "(sin límites — ninguna oferta elegible)";

function entradaSolicitante(input) {
  return Object.entries(input).map(([k, v]) => `${k}=${v}`).join(" · ");
}

// ─── Render Markdown ─────────────────────────────────────────────────────────
const L = [];
L.push("# Informe de evidencias — Suite completa · Ofertas Hipotecarias");
L.push("");
L.push(`**Fecha de ejecución:** ${fecha}  `);
L.push("**Comando:** `npm test` (`node --test`) — toda la suite  ");
L.push("**Configuración bajo prueba:** `rules.json`  ");
L.push(`**Resultado global:** ${TOT.pass}/${TOT.total} PASS · ${TOT.fail} FAIL · ${TOT.skip} SKIP ${TOT.fail === 0 ? "✅" : "❌"}`);
L.push("");
L.push("> Los 2 SKIP son tests *live* de `workflow_service` (CA-013) que requieren credenciales reales contra el entorno; se omiten en local por diseño, no son fallos.");
L.push("");
L.push("> **Trazabilidad:** los escenarios de negocio (§3) se generan desde la MISMA fuente que verifica el test");
L.push("> (`fixtures/business_scenarios.js` + golden). El \"esperado\" del informe es exactamente lo que el test exige.");
L.push("");
L.push("## 1. Resumen por fichero de test");
L.push("");
L.push("| Fichero | Cobertura | Tests | PASS | FAIL | SKIP |");
L.push("|---------|-----------|------:|-----:|-----:|-----:|");
for (const f of perFile) L.push(`| \`${f.base}.test.js\` | ${f.desc} | ${f.total} | ${f.pass} | ${f.fail} | ${f.skip} |`);
L.push(`| **TOTAL** | | **${TOT.total}** | **${TOT.pass}** | **${TOT.fail}** | **${TOT.skip}** |`);
L.push("");
L.push("## 2. Cambio de configuración verificado");
L.push("");
L.push("| Oferta | Parámetro | Antes | Ahora |");
L.push("|--------|-----------|-------|-------|");
L.push("| ULTRA_ALTO_RIESGO | MAX_LTV | 0.95 | **0.90** |");
L.push("| ULTRA_ALTO_RIESGO | Rango LTV efectivo | (0.80, 0.95] | **(0.80, 0.90]** |");
L.push("| FIDELIZACION | Acciones de decisión INIT/PRE/FINAL | — | **emite límites en dictamen** |");
L.push("");
L.push("Casos que cubren directamente el cambio: **TC-D7** (límite 0.90 inclusivo), **TC-D8** (regresión: 0.92 ya no es COMBINADA), **TC-E5** (FIDELIZACION informa límites). Detalle completo en §3.");
L.push("");

// ── §3 Escenarios de negocio — detalle por caso ──────────────────────────────
L.push("## 3. Escenarios de negocio — detalle por caso");
L.push("");
L.push("Para cada escenario: entrada al motor, ganadora **esperada** (contrato de la matriz de decisión)");
L.push("y resultado **obtenido** por el motor (elegibles por fase, ganadora y `uiLimits`). Veredicto = coincidencia.");
L.push("");
L.push("### 3.1 Resumen");
L.push("");
L.push("| Caso | Modo | Entrada FINAL | Ganadora esperada | Ganadora obtenida | Veredicto |");
L.push("|------|------|---------------|-------------------|-------------------|-----------|");
const detalle = [];
for (const sc of SCENARIOS) {
  const res = runScenario(sc);
  const obt = res.finalRes.winner?.offerCode ?? null;
  const ok = obt === (sc.winner ?? null);
  const ltv = ((sc.fin.IMPORTE_HIPOTECA_NM / sc.fin.IMPORTE_VIVIENDA_NM) * 100).toFixed(0);
  const entradaFin = `LTV=${ltv}% · plazo=${sc.fin.PLAZO_NM}a`;
  L.push(`| ${sc.id} | ${sc.mode === "chained" ? "encadenado" : "independiente"} | ${entradaFin} | \`${sc.winner ?? "null"}\` | \`${obt ?? "null"}\` | ${ok ? "✅ OK" : "❌ KO"} |`);
  detalle.push({ sc, res, obt, ok, ltv });
}
L.push("");
L.push("### 3.2 Detalle");
L.push("");
for (const { sc, res, obt, ok, ltv } of detalle) {
  const snapMatch = JSON.stringify(res.snapshot) === JSON.stringify(golden[sc.id]);
  L.push(`#### ${sc.id} — ${sc.grupo}`);
  L.push("");
  L.push(`*${sc.desc}*`);
  L.push("");
  L.push(`- **Modo:** ${sc.mode === "chained" ? "encadenado (propaga fallos de etapa)" : "independiente"}`);
  L.push(`- **Entrada solicitante (INIT/PRE):** ${entradaSolicitante(res.input)}`);
  L.push(`- **Entrada FINAL:** IMPORTE_HIPOTECA_NM=${fmt(sc.fin.IMPORTE_HIPOTECA_NM)} · IMPORTE_VIVIENDA_NM=${fmt(sc.fin.IMPORTE_VIVIENDA_NM)} · PLAZO_NM=${sc.fin.PLAZO_NM} · LTV=${ltv}%`);
  L.push(`- **Elegibles INIT:** ${list(res.snapshot.initEligibles)}`);
  L.push(`- **Elegibles PRE:** ${list(res.snapshot.preEligibles)}`);
  L.push(`- **Elegibles FINAL:** ${list(res.snapshot.finalEligibles)}`);
  L.push(`- **uiLimits:** ${uiStr(res.snapshot.uiLimits)}`);
  L.push(`- **Ganadora:** esperada \`${sc.winner ?? "null"}\` · obtenida \`${obt ?? "null"}\` → ${ok ? "✅ OK" : "❌ KO"}`);
  L.push(`- **Snapshot vs golden congelado:** ${snapMatch ? "✅ coincide" : "❌ difiere"}`);
  L.push("");
}

// ── §4 Resto de ficheros ─────────────────────────────────────────────────────
L.push("## 4. Detalle del resto de ficheros de test");
L.push("");
for (const f of perFile) {
  if (f.base === "offer_scenarios") continue; // detallado en §3
  L.push(`### \`${f.base}.test.js\` — ${f.desc}`);
  L.push("");
  L.push(`${f.pass}/${f.total} PASS${f.skip ? ` · ${f.skip} SKIP` : ""}${f.fail ? ` · ${f.fail} FAIL` : ""}`);
  L.push("");
  L.push("| # | Test | Resultado |");
  L.push("|---|------|-----------|");
  for (const r of f.rows) L.push(`| ${r.n} | ${r.name.replace(/\|/g, "\\|")} | ${ICON[r.estado]} |`);
  L.push("");
}
L.push(`> Evidencia cruda fusionada: \`evidencia-full-${fecha}.txt\` · Evidencia cruda por fichero: \`raw/<fichero>.tap\``);
L.push("");

fs.writeFileSync(outPath, L.join("\n"), "utf8");
console.log(`Informe generado: ${outPath.pathname}`);
console.log(`Total suite: ${TOT.total} · PASS: ${TOT.pass} · FAIL: ${TOT.fail} · SKIP: ${TOT.skip}`);
console.log(`Escenarios detallados: ${SCENARIOS.length}`);
