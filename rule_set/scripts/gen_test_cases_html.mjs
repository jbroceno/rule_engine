/**
 * Genera test/offer_scenarios.test.html a partir de fixtures/business_scenarios.js
 * y fixtures/business_scenarios.golden.json — página estática de referencia visual
 * para offer_scenarios.test.js. No se usa en el runner (node --test no la ejecuta:
 * es .html, fuera del glob de test/), pero SÍ debe regenerarse cada vez que cambien
 * los escenarios o el golden, para no desincronizarse (ver gotcha en CLAUDE.md).
 *
 * Uso (desde rule_set/):  node scripts/gen_test_cases_html.mjs
 */
import fs from "fs";
import { OK, SCENARIOS } from "../fixtures/business_scenarios.js";

const golden = JSON.parse(
  fs.readFileSync(new URL("../fixtures/business_scenarios.golden.json", import.meta.url), "utf8")
);

const GROUP_META = {
  "A · INIT": { letter: "A", cls: "group-a", title: "Filtros INIT" },
  "B · PRE": { letter: "B", cls: "group-b", title: "Filtros PRE" },
  "C · FINAL": { letter: "C", cls: "group-c", title: "Matriz de decisión FINAL (ganadora por LTV × plazo)" },
  "D · LÍMITE": { letter: "D", cls: "group-d", title: "Valores límite FINAL" },
  "E · FIDELIZACION": { letter: "E", cls: "group-e", title: "Oferta FIDELIZACION — condiciones INIT (antigüedad y domiciliación); sin reglas PRE/FINAL propias" },
  "X · ENCADENADO": { letter: "X", cls: "group-x", title: "Modo encadenado <code>{ chained: true }</code> — fallos de INIT se propagan a PRE y FINAL por oferta" },
  "SDI · BOOL FLAG": { letter: "SDI", cls: "group-sdi", title: "Frontera SOLICITAR_DATOS_INTERVINIENTES (agregación OR booleana)" },
};

const GROUP_ORDER = ["A · INIT", "B · PRE", "C · FINAL", "D · LÍMITE", "E · FIDELIZACION", "X · ENCADENADO", "SDI · BOOL FLAG"];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtNum = (n) => (typeof n === "number" ? n.toLocaleString("es-ES") : esc(n));

function renderDelta(key, value) {
  let display = value;
  if (typeof value === "number") display = fmtNum(value);
  else if (typeof value === "boolean") display = value ? "true" : "false";
  else display = `"${value}"`;
  return `<span class="delta">${esc(key)}=${esc(display)}</span>`;
}

function renderOverrides(sc) {
  const baseKeys = Object.keys(sc.base ?? {});
  const finKeys = Object.keys(sc.fin ?? {});
  if (baseKeys.length === 0 && finKeys.length === 0) {
    return `<span class="ok-base">(usa OK sin overrides)</span>`;
  }
  const parts = [];
  if (baseKeys.length) {
    parts.push(baseKeys.map((k) => renderDelta(k, sc.base[k])).join(""));
  }
  if (finKeys.length) {
    parts.push(finKeys.map((k) => renderDelta(k, sc.fin[k])).join(""));
  }
  return parts.join(" ");
}

function renderPillList(codes, cls) {
  if (!codes || codes.length === 0) return `<span class="ok-base">—</span>`;
  return codes.map((c) => `<span class="pill ${cls}">${esc(c)}</span>`).join("");
}

function renderWinnerPill(winner) {
  if (!winner) return `<span class="pill pill-rej">null</span>`;
  return `<span class="pill pill-win">${esc(winner)}</span>`;
}

function renderSdiPill(value) {
  if (value === undefined) return `<span class="ok-base">ausente</span>`;
  return `<span class="pill ${value ? "pill-pass" : "pill-only"}">${value ? "true" : "false"}</span>`;
}

function renderRow(sc) {
  const snap = golden[sc.id];
  if (!snap) throw new Error(`Falta golden para ${sc.id} — ejecuta scripts/freeze_scenarios.mjs primero`);
  return `
        <tr>
          <td class="tc">${esc(sc.id)}</td>
          <td>${esc(sc.desc)}</td>
          <td>${sc.mode === "chained" ? `<span class="pill pill-only">chained</span>` : `<span class="ok-base">ind</span>`}</td>
          <td>${renderOverrides(sc)}</td>
          <td>${renderPillList(snap.initEligibles, "pill-pass")}</td>
          <td>${renderPillList(snap.preEligibles, "pill-pass")}</td>
          <td>${renderPillList(snap.finalEligibles, "pill-pass")}</td>
          <td>${renderWinnerPill(snap.winner)}</td>
          <td>${renderSdiPill(snap.uiLimits?.SOLICITAR_DATOS_INTERVINIENTES)}</td>
        </tr>`;
}

function renderSection(grupo, scenarios) {
  const meta = GROUP_META[grupo];
  return `
<div class="section">
  <div class="section-header">
    <span class="group-badge ${meta.cls}">${esc(meta.letter)}</span>
    <span class="section-title">${meta.title}</span>
    <span class="section-count">${scenarios.length} casos</span>
  </div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>TC</th><th>Descripción</th><th>Modo</th><th>Overrides (entrada)</th>
          <th>INIT elegibles</th><th>PRE elegibles</th><th>FINAL elegibles</th>
          <th>Ganadora</th><th>SDI</th>
        </tr>
      </thead>
      <tbody>${scenarios.map(renderRow).join("")}
      </tbody>
    </table>
  </div>
</div>`;
}

const byGroup = new Map();
for (const sc of SCENARIOS) {
  if (!byGroup.has(sc.grupo)) byGroup.set(sc.grupo, []);
  byGroup.get(sc.grupo).push(sc);
}

const offerCodes = [...new Set(SCENARIOS.flatMap((sc) => golden[sc.id]?.finalEligibles ?? []))].sort();

const sectionsHtml = GROUP_ORDER.filter((g) => byGroup.has(g))
  .map((g) => renderSection(g, byGroup.get(g)))
  .join("\n");

const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Casos de prueba — Ofertas Hipotecarias (offer_scenarios.test.js)</title>
  <style>
    :root {
      --c-bg:        #f8f9fa;
      --c-surface:   #ffffff;
      --c-border:    #dee2e6;
      --c-header-bg: #212529;
      --c-header-fg: #ffffff;
      --c-group-a:   #0d6efd;
      --c-group-b:   #6610f2;
      --c-group-c:   #198754;
      --c-group-d:   #fd7e14;
      --c-group-e:   #0dcaf0;
      --c-group-x:   #dc3545;
      --c-group-sdi: #6f42c1;
      --c-row-odd:   #f8f9fa;
      --c-row-even:  #ffffff;
      --c-ok:        #d1e7dd;
      --c-ko:        #f8d7da;
      --c-warn:      #fff3cd;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      background: var(--c-bg);
      color: #212529;
      padding: 24px;
    }

    h1 { font-size: 1.4rem; margin-bottom: 6px; }

    .subtitle { color: #6c757d; margin-bottom: 20px; font-size: 0.9rem; }

    .base-card {
      background: var(--c-surface);
      border: 1px solid var(--c-border);
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 28px;
      display: inline-block;
      min-width: 420px;
    }

    .base-card h2 {
      font-size: 0.95rem;
      text-transform: uppercase;
      letter-spacing: .05em;
      color: #495057;
      margin-bottom: 10px;
    }

    .base-grid { display: grid; grid-template-columns: repeat(4, auto); gap: 4px 24px; }
    .base-grid dt { color: #6c757d; font-size: 0.82rem; }
    .base-grid dd { font-weight: 600; font-size: 0.85rem; }

    .section { margin-bottom: 32px; }

    .section-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }

    .group-badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 20px;
      color: #fff;
      font-weight: 700;
      font-size: 0.78rem;
      letter-spacing: .04em;
      text-transform: uppercase;
      flex-shrink: 0;
    }

    .group-a   { background: var(--c-group-a); }
    .group-b   { background: var(--c-group-b); }
    .group-c   { background: var(--c-group-c); }
    .group-d   { background: var(--c-group-d); }
    .group-e   { background: var(--c-group-e); color: #212529; }
    .group-x   { background: var(--c-group-x); }
    .group-sdi { background: var(--c-group-sdi); }

    .section-title { font-size: 1rem; font-weight: 600; }
    .section-count { color: #6c757d; font-size: 0.85rem; }

    .table-wrap {
      overflow-x: auto;
      border-radius: 8px;
      border: 1px solid var(--c-border);
      box-shadow: 0 1px 3px rgba(0,0,0,.06);
    }

    table { width: 100%; border-collapse: collapse; background: var(--c-surface); }

    thead th {
      background: var(--c-header-bg);
      color: var(--c-header-fg);
      text-align: left;
      padding: 9px 12px;
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: .05em;
      white-space: nowrap;
    }

    tbody tr:nth-child(odd)  { background: var(--c-row-odd); }
    tbody tr:nth-child(even) { background: var(--c-row-even); }
    tbody tr:hover { background: #e9f0ff; }

    td { padding: 8px 12px; border-top: 1px solid var(--c-border); vertical-align: top; line-height: 1.45; }

    .tc { font-weight: 700; font-size: 0.82rem; white-space: nowrap; }

    .delta {
      display: inline-block;
      background: #e9ecef;
      border-radius: 4px;
      padding: 1px 6px;
      font-size: 0.78rem;
      font-family: ui-monospace, monospace;
      white-space: nowrap;
      margin: 1px 2px 1px 0;
    }

    .ok-base { color: #6c757d; font-style: italic; font-size: 0.82rem; }

    .pill {
      display: inline-block;
      border-radius: 4px;
      padding: 2px 7px;
      font-size: 0.8rem;
      font-weight: 600;
      margin: 1px 2px 1px 0;
      white-space: nowrap;
    }

    .pill-win  { background: #d1e7dd; color: #0f5132; }
    .pill-rej  { background: #f8d7da; color: #842029; }
    .pill-pass { background: #cfe2ff; color: #084298; }
    .pill-only { background: #fff3cd; color: #664d03; }

    footer {
      margin-top: 32px;
      font-size: 0.78rem;
      color: #adb5bd;
      border-top: 1px solid var(--c-border);
      padding-top: 12px;
    }
  </style>
</head>
<body>

<h1>Casos de prueba — Ofertas Hipotecarias</h1>
<p class="subtitle">
  Fichero: <code>rule_set/test/offer_scenarios.test.js</code> &nbsp;·&nbsp;
  ${SCENARIOS.length} casos &nbsp;·&nbsp; Motor: 6 ofertas (${offerCodes.join(" · ")})
  &nbsp;·&nbsp; Generado automáticamente por <code>scripts/gen_test_cases_html.mjs</code> desde
  <code>fixtures/business_scenarios.js</code> + <code>fixtures/business_scenarios.golden.json</code>
</p>

<div class="base-card">
  <h2>Objeto base <code>OK</code> (compartido por todos los tests)</h2>
  <dl class="base-grid">
    <dt>TIPO_ALTA_CD</dt>              <dd>"${esc(OK.TIPO_ALTA_CD)}"</dd>
    <dt>FINALIDAD_CD</dt>              <dd>${esc(OK.FINALIDAD_CD)}</dd>
    <dt>PRIMERA_VIVIENDA_HABITUAL_FL</dt><dd>${esc(OK.PRIMERA_VIVIENDA_HABITUAL_FL)}</dd>
    <dt>EDAD_MAX_NM</dt>               <dd>${esc(OK.EDAD_MAX_NM)}</dd>
    <dt>IMPORTE_VIVIENDA_NM</dt>       <dd>${fmtNum(OK.IMPORTE_VIVIENDA_NM)} €</dd>
    <dt>IMPORTE_VIVIENDA_CA_NM</dt>    <dd>${fmtNum(OK.IMPORTE_VIVIENDA_CA_NM)} €</dd>
    <dt>ANTIGUEDAD_T1/T2_NM</dt>       <dd>${esc(OK.ANTIGUEDAD_T1_NM)} meses</dd>
    <dt>DOMICILIA_NOMINA_T1/T2_FL</dt> <dd>${esc(OK.DOMICILIA_NOMINA_T1_FL)}</dd>
    <dt>NUM_TITULARES_NM</dt>          <dd>${esc(OK.NUM_TITULARES_NM)}</dd>
    <dt>INGRESO_T1/TOTAL_NM</dt>       <dd>${fmtNum(OK.INGRESO_T1_NM)} €</dd>
  </dl>
</div>
${sectionsHtml}

<footer>
  Página de referencia visual, no ejecutada por <code>node --test</code> (extensión <code>.html</code>,
  fuera del glob de test/). Regenerar tras cualquier cambio en los escenarios o el golden con:
  <code>node scripts/gen_test_cases_html.mjs</code>.
</footer>

</body>
</html>
`;

const outPath = new URL("../test/offer_scenarios.test.html", import.meta.url);
fs.writeFileSync(outPath, html, "utf8");
console.log(`HTML escrito: ${outPath.pathname}`);
console.log(`Escenarios: ${SCENARIOS.length} en ${byGroup.size} grupos`);
