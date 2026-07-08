/**
 * Fuente de verdad de los escenarios de negocio — Ofertas Hipotecarias.
 *
 * Consumido por:
 *   - test/offer_scenarios.test.js  → verifica (assert) ganadora + snapshot de elegibles/uiLimits
 *   - scripts/gen_evidencia_report.mjs → documenta entrada/esperado/obtenido para el cliente
 *
 * Por qué aquí y no en test/: `node --test` ejecuta TODO lo que cuelga de test/
 * (glob `**​/test/**​/*.{js,mjs,cjs}`). Un módulo de datos en test/ se ejecutaría
 * como si fuera un test. Los datos/fixtures viven fuera de test/.
 *
 * Campos de cada escenario:
 *   id        — identificador (TC-…)
 *   grupo     — agrupación funcional (A INIT, B PRE, C/D FINAL, E FIDELIZACION, X encadenado)
 *   desc      — descripción legible
 *   mode      — "ind" (etapas independientes) | "chained" (propaga fallos de etapa)
 *   base      — overrides sobre el solicitante OK (entrada a INIT/PRE)
 *   fin       — overrides de la fase FINAL (importes y plazo)
 *   winner    — ganadora ESPERADA (contrato de negocio derivado de la matriz de decisión).
 *               `null` es un resultado válido (sin oferta ganadora).
 */

// Solicitante modelo: joven, primera vivienda, antigüedad ≥12m, ingresos OK, alta admitida.
export const OK = {
  TIPO_ALTA_CD: "NOVACION",
  FINALIDAD_CD: 1,
  PRIMERA_VIVIENDA_HABITUAL_FL: 1,
  EDAD_MAX_NM: 35,
  IMPORTE_VIVIENDA_NM: 250_000,
  IMPORTE_VIVIENDA_CA_NM: 200_000,
  ANTIGUEDAD_T1_NM: 15,
  ANTIGUEDAD_T2_NM: 15,
  DOMICILIA_NOMINA_T1_FL: false,
  DOMICILIA_NOMINA_T2_FL: false,
  NUM_TITULARES_NM: 1,
  INGRESO_T1_NM: 3_000,
  INGRESO_TOTAL_NM: 3_000,
};

const FIN_20 = { IMPORTE_HIPOTECA_NM: 220_000, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 20 };

export const SCENARIOS = [
  // ── GRUPO A — Filtros INIT (modo independiente) ──────────────────────────
  { id: "TC-A1", grupo: "A · INIT", mode: "ind", desc: "solicitante OK → 6/6 ofertas elegibles INIT",
    base: {}, fin: FIN_20, winner: "ALTO_RIESGO" },
  { id: "TC-A2", grupo: "A · INIT", mode: "ind", desc: "FINALIDAD_CD=20 (no primera vivienda) → solo FIDELIZACION pasa INIT",
    base: { FINALIDAD_CD: 20 }, fin: FIN_20, winner: "ALTO_RIESGO" },
  { id: "TC-A3", grupo: "A · INIT", mode: "ind", desc: "PRIMERA_VIVIENDA_HABITUAL_FL=0 → 5 rechazadas INIT; FIDELIZACION pasa",
    base: { PRIMERA_VIVIENDA_HABITUAL_FL: 0 }, fin: FIN_20, winner: "ALTO_RIESGO" },
  { id: "TC-A4", grupo: "A · INIT", mode: "ind", desc: "TIPO_ALTA_CD=SUBROGACION (no admitido) → solo FIDELIZACION pasa INIT",
    base: { TIPO_ALTA_CD: "SUBROGACION" }, fin: FIN_20, winner: "ALTO_RIESGO" },
  { id: "TC-A5", grupo: "A · INIT", mode: "ind", desc: "EDAD_MAX_NM=40 → LARGO_PLAZO/ULTRA_ALTO_RIESGO rechazadas (MAX_EDAD=40); resto pasa (MAX_EDAD=45); ALTO_RIESGO gana por LTV/plazo",
    base: { EDAD_MAX_NM: 40 }, fin: FIN_20, winner: "ALTO_RIESGO" },
  { id: "TC-A6", grupo: "A · INIT", mode: "ind", desc: "EDAD_MAX_NM=45 → todas las distintas a FIDELIZACION rechazadas (GE dispara); solo FIDELIZACION",
    base: { EDAD_MAX_NM: 45 }, fin: FIN_20, winner: "ALTO_RIESGO" },
  { id: "TC-A7", grupo: "A · INIT", mode: "ind", desc: "ant=7 dom=false → 5 rechazadas INIT (MIN_ANT=12, incl. FIDELIZACION); solo PROMOCION (MIN_ANT=0) pasa",
    base: { ANTIGUEDAD_T1_NM: 7, ANTIGUEDAD_T2_NM: 7 }, fin: FIN_20, winner: "ALTO_RIESGO" },
  { id: "TC-A8", grupo: "A · INIT", mode: "ind", desc: "IMPORTE_VIVIENDA_NM(150k) < mínimo CCAA(200k) → 5 rechazadas INIT; FIDELIZACION pasa",
    base: { IMPORTE_VIVIENDA_NM: 150_000, IMPORTE_VIVIENDA_CA_NM: 200_000 },
    fin: { IMPORTE_HIPOTECA_NM: 100_000, IMPORTE_VIVIENDA_NM: 150_000, PLAZO_NM: 20 }, winner: "PROMOCION_HC" },
  { id: "TC-A9", grupo: "A · INIT", mode: "ind", desc: "domiciliación T1=true compensa antigüedad=0 → 6/6 pasan INIT",
    base: { ANTIGUEDAD_T1_NM: 0, ANTIGUEDAD_T2_NM: 0, DOMICILIA_NOMINA_T1_FL: true }, fin: FIN_20, winner: "ALTO_RIESGO" },

  // ── GRUPO B — Filtros PRE (modo independiente) ───────────────────────────
  { id: "TC-B1", grupo: "B · PRE", mode: "ind", desc: "1T ingresos=2000 (<2500) → 4 rechazadas PRE; PROMOCION+FIDELIZACION pasan",
    base: { NUM_TITULARES_NM: 1, INGRESO_T1_NM: 2_000 }, fin: FIN_20, winner: "FIDELIZACION" },
  { id: "TC-B2", grupo: "B · PRE", mode: "ind", desc: "2T ingresos totales=3000 (<3500) → 4 rechazadas PRE; PROMOCION+FIDELIZACION pasan",
    base: { NUM_TITULARES_NM: 2, INGRESO_TOTAL_NM: 3_000 }, fin: FIN_20, winner: "FIDELIZACION" },

  // ── GRUPO C — Matriz de decisión FINAL (ganadora por LTV × plazo) ────────
  { id: "TC-C1", grupo: "C · FINAL", mode: "ind", desc: "LTV=88% plazo=20a → ALTO_RIESGO (rank 90)",
    base: {}, fin: { IMPORTE_HIPOTECA_NM: 220_000, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 20 }, winner: "ALTO_RIESGO" },
  { id: "TC-C2", grupo: "C · FINAL", mode: "ind", desc: "LTV=72% plazo=38a → LARGO_PLAZO (rank 80)",
    base: {}, fin: { IMPORTE_HIPOTECA_NM: 180_000, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 38 }, winner: "LARGO_PLAZO" },
  { id: "TC-C3", grupo: "C · FINAL", mode: "ind", desc: "LTV=88% plazo=38a → ULTRA_ALTO_RIESGO (rank 100) — dentro de (0.80,0.90]",
    base: {}, fin: { IMPORTE_HIPOTECA_NM: 220_000, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 38 }, winner: "ULTRA_ALTO_RIESGO" },
  { id: "TC-C4", grupo: "C · FINAL", mode: "ind", desc: "LTV=72% plazo=20a → PROMOCION_HC (rank 70)",
    base: {}, fin: { IMPORTE_HIPOTECA_NM: 180_000, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 20 }, winner: "PROMOCION_HC" },
  { id: "TC-C5", grupo: "C · FINAL", mode: "ind", desc: "LTV=105% plazo=35a → FIDELIZACION (LTV fuera de rango en todas las Joven, incl. ALTO_RIESGO ≤100%)",
    base: {}, fin: { IMPORTE_HIPOTECA_NM: 262_500, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 35 }, winner: "FIDELIZACION" },
  { id: "TC-C6", grupo: "C · FINAL", mode: "ind", desc: "1T ingresos=2000 + LTV=72% plazo=20a → PROMOCION (rank 60)",
    base: { NUM_TITULARES_NM: 1, INGRESO_T1_NM: 2_000 }, fin: { IMPORTE_HIPOTECA_NM: 180_000, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 20 }, winner: "PROMOCION" },

  // ── GRUPO D — Valores límite FINAL ───────────────────────────────────────
  { id: "TC-D1", grupo: "D · LÍMITE", mode: "ind", desc: "LTV=80% exacto plazo=20a → PROMOCION_HC; ALTO_RIESGO rechazada (límite inferior exclusivo)",
    base: {}, fin: { IMPORTE_HIPOTECA_NM: 200_000, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 20 }, winner: "PROMOCION_HC" },
  { id: "TC-D2", grupo: "D · LÍMITE", mode: "ind", desc: "LTV=80.4% plazo=20a → ALTO_RIESGO (PROMOCION_HC supera 0.80; ULTRA_ALTO_RIESGO plazo<36)",
    base: {}, fin: { IMPORTE_HIPOTECA_NM: 201_000, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 20 }, winner: "ALTO_RIESGO" },
  { id: "TC-D3", grupo: "D · LÍMITE", mode: "ind", desc: "plazo=35a exacto LTV=72% → PROMOCION_HC (35≤MAX_PLAZO); LARGO_PLAZO fuera (35<MIN_PLAZO=36)",
    base: {}, fin: { IMPORTE_HIPOTECA_NM: 180_000, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 35 }, winner: "PROMOCION_HC" },
  { id: "TC-D4", grupo: "D · LÍMITE", mode: "ind", desc: "plazo=36a exacto LTV=72% → LARGO_PLAZO (36≥MIN_PLAZO); PROMOCION_HC fuera (36>MAX_PLAZO=35)",
    base: {}, fin: { IMPORTE_HIPOTECA_NM: 180_000, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 36 }, winner: "LARGO_PLAZO" },
  { id: "TC-D5", grupo: "D · LÍMITE", mode: "ind", desc: "EDAD_MAS_PLAZO=81 (>EDAD_PLAZO LARGO_PLAZO=80) → LARGO_PLAZO rechazada; FIDELIZACION gana",
    base: { EDAD_MAX_NM: 39 }, fin: { IMPORTE_HIPOTECA_NM: 180_000, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 42 }, winner: "FIDELIZACION" },
  { id: "TC-D6", grupo: "D · LÍMITE", mode: "ind", desc: "EDAD_MAS_PLAZO=80 (=EDAD_PLAZO LARGO_PLAZO=80) → LARGO_PLAZO elegible (GT no dispara en límite exacto)",
    base: { EDAD_MAX_NM: 38 }, fin: { IMPORTE_HIPOTECA_NM: 180_000, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 42 }, winner: "LARGO_PLAZO" },
  { id: "TC-D7", grupo: "D · LÍMITE", mode: "ind", desc: "LTV=90% exacto plazo=38a → ULTRA_ALTO_RIESGO (límite superior inclusivo MAX_LTV=0.90)",
    base: {}, fin: { IMPORTE_HIPOTECA_NM: 225_000, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 38 }, winner: "ULTRA_ALTO_RIESGO" },
  { id: "TC-D8", grupo: "D · LÍMITE", mode: "ind", desc: "LTV=92% plazo=38a → FIDELIZACION (REGRESIÓN: MAX_LTV ULTRA_ALTO_RIESGO=0.90 se rechaza)",
    base: {}, fin: { IMPORTE_HIPOTECA_NM: 230_000, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 38 }, winner: "FIDELIZACION" },

  // ── GRUPO E — Oferta FIDELIZACION (modo independiente) ───────────────────────
  { id: "TC-E1", grupo: "E · FIDELIZACION", mode: "ind", desc: "ant=7 dom=false → FIDELIZACION pasa INIT (7>MIN_ANT=6); gana FINAL",
    base: { ANTIGUEDAD_T1_NM: 7, ANTIGUEDAD_T2_NM: 7, INGRESO_T1_NM: 500 }, fin: { IMPORTE_HIPOTECA_NM: 242_500, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 20 }, winner: "FIDELIZACION" },
  { id: "TC-E2", grupo: "E · FIDELIZACION", mode: "ind", desc: "ant=3 dom=false → FIDELIZACION falla INIT (3≤6) pero gana FINAL (etapas independientes)",
    base: { ANTIGUEDAD_T1_NM: 3, ANTIGUEDAD_T2_NM: 3, INGRESO_T1_NM: 500 }, fin: { IMPORTE_HIPOTECA_NM: 242_500, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 20 }, winner: "FIDELIZACION" },
  { id: "TC-E3", grupo: "E · FIDELIZACION", mode: "ind", desc: "ant=6 dom=false → FIDELIZACION falla INIT (límite exacto 6≤6) pero gana FINAL",
    base: { ANTIGUEDAD_T1_NM: 6, ANTIGUEDAD_T2_NM: 6, INGRESO_T1_NM: 500 }, fin: { IMPORTE_HIPOTECA_NM: 242_500, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 20 }, winner: "FIDELIZACION" },
  { id: "TC-E4", grupo: "E · FIDELIZACION", mode: "ind", desc: "ant=0 dom=true → FIDELIZACION pasa INIT (domiciliación compensa); gana FINAL",
    base: { ANTIGUEDAD_T1_NM: 0, ANTIGUEDAD_T2_NM: 0, DOMICILIA_NOMINA_T1_FL: true, INGRESO_T1_NM: 500 }, fin: { IMPORTE_HIPOTECA_NM: 242_500, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 20 }, winner: "FIDELIZACION" },
  { id: "TC-E5", grupo: "E · FIDELIZACION", mode: "ind", desc: "FIDELIZACION informa límites en dictamen INIT/PRE (MIN/MAX_HIPOTECA, MIN/MAX_PLAZO, MAX_LTV=0.80, EDAD_PLAZO=75)",
    base: {}, fin: FIN_20, winner: "ALTO_RIESGO", checkClientesLimits: true },

  // ── GRUPO X — Modo encadenado ────────────────────────────────────────────
  { id: "TC-X1", grupo: "X · ENCADENADO", mode: "chained", desc: "solicitante OK → idéntico al modo independiente (ALTO_RIESGO)",
    base: {}, fin: FIN_20, winner: "ALTO_RIESGO" },
  { id: "TC-X2", grupo: "X · ENCADENADO", mode: "chained", desc: "FINALIDAD_CD=20 → 5 Joven bloqueadas PRE; FIDELIZACION gana",
    base: { FINALIDAD_CD: 20 }, fin: FIN_20, winner: "FIDELIZACION" },
  { id: "TC-X3", grupo: "X · ENCADENADO", mode: "chained", desc: "TIPO_ALTA_CD=SUBROGACION → 5 Joven bloqueadas PRE; FIDELIZACION gana",
    base: { TIPO_ALTA_CD: "SUBROGACION" }, fin: FIN_20, winner: "FIDELIZACION" },
  { id: "TC-X4", grupo: "X · ENCADENADO", mode: "chained", desc: "EDAD_MAX=40 + LTV=72% plazo=20a → PROMOCION_HC gana",
    base: { EDAD_MAX_NM: 40 }, fin: { IMPORTE_HIPOTECA_NM: 180_000, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 20 }, winner: "PROMOCION_HC" },
  { id: "TC-X5", grupo: "X · ENCADENADO", mode: "chained", desc: "PRIMERA_VIVIENDA=0 → todas las Joven bloqueadas PRE; FIDELIZACION gana",
    base: { PRIMERA_VIVIENDA_HABITUAL_FL: 0 }, fin: { IMPORTE_HIPOTECA_NM: 180_000, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 20 }, winner: "FIDELIZACION" },
  { id: "TC-X6", grupo: "X · ENCADENADO", mode: "chained", desc: "EDAD_MAX=40 + LTV=72% plazo=36a → LARGO_PLAZO bloqueada (MAX_EDAD=40); FIDELIZACION gana",
    base: { EDAD_MAX_NM: 40 }, fin: { IMPORTE_HIPOTECA_NM: 180_000, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 36 }, winner: "FIDELIZACION" },
  { id: "TC-X7", grupo: "X · ENCADENADO", mode: "chained", desc: "EDAD_MAX=40 + LTV=88% plazo=36a → ULTRA_ALTO_RIESGO bloqueada (MAX_EDAD=40); resto fuera de rango; FIDELIZACION gana",
    base: { EDAD_MAX_NM: 40 }, fin: { IMPORTE_HIPOTECA_NM: 220_000, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 36 }, winner: "FIDELIZACION" },
  { id: "TC-X8", grupo: "X · ENCADENADO", mode: "chained", desc: "INIT OK · LTV=88% plazo=38a → ULTRA_ALTO_RIESGO gana",
    base: {}, fin: { IMPORTE_HIPOTECA_NM: 220_000, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 38 }, winner: "ULTRA_ALTO_RIESGO" },
  { id: "TC-X9", grupo: "X · ENCADENADO", mode: "chained", desc: "INIT OK · LTV=88% plazo=20a → ALTO_RIESGO gana",
    base: {}, fin: { IMPORTE_HIPOTECA_NM: 220_000, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 20 }, winner: "ALTO_RIESGO" },
  { id: "TC-X10", grupo: "X · ENCADENADO", mode: "chained", desc: "INIT OK · LTV=72% plazo=38a → LARGO_PLAZO gana",
    base: {}, fin: { IMPORTE_HIPOTECA_NM: 180_000, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 38 }, winner: "LARGO_PLAZO" },
  { id: "TC-X11", grupo: "X · ENCADENADO", mode: "chained", desc: "INIT OK · LTV=72% plazo=20a → PROMOCION_HC gana",
    base: {}, fin: { IMPORTE_HIPOTECA_NM: 180_000, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 20 }, winner: "PROMOCION_HC" },
  { id: "TC-X12", grupo: "X · ENCADENADO", mode: "chained", desc: "1T ingresos=2000 + LTV=72% plazo=20a → PROMOCION gana (exclusión PRE de ingresos)",
    base: { NUM_TITULARES_NM: 1, INGRESO_T1_NM: 2_000 }, fin: { IMPORTE_HIPOTECA_NM: 180_000, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 20 }, winner: "PROMOCION" },
  { id: "TC-X13", grupo: "X · ENCADENADO", mode: "chained", desc: "ant=3 dom=false → FIDELIZACION bloqueada por cadena; PROMOCION gana (contraste con TC-E2)",
    base: { ANTIGUEDAD_T1_NM: 3, ANTIGUEDAD_T2_NM: 3, INGRESO_T1_NM: 500 }, fin: { IMPORTE_HIPOTECA_NM: 180_000, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 20 }, winner: "PROMOCION" },
  { id: "TC-X14", grupo: "X · ENCADENADO", mode: "chained", desc: "ant=3 dom=false + LTV=88% plazo=20a → winner=null (resultado válido)",
    base: { ANTIGUEDAD_T1_NM: 3, ANTIGUEDAD_T2_NM: 3, INGRESO_T1_NM: 500 }, fin: { IMPORTE_HIPOTECA_NM: 220_000, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 20 }, winner: null },
  { id: "TC-X15", grupo: "X · ENCADENADO", mode: "chained", desc: "ant=6 dom=false → FIDELIZACION falla INIT (límite exacto); winner=null",
    base: { ANTIGUEDAD_T1_NM: 6, ANTIGUEDAD_T2_NM: 6, INGRESO_T1_NM: 500 }, fin: { IMPORTE_HIPOTECA_NM: 220_000, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 20 }, winner: null },
  { id: "TC-X16", grupo: "X · ENCADENADO", mode: "chained", desc: "ant=3 dom=true + FINALIDAD=20 → FIDELIZACION pasa INIT (domiciliación); gana FINAL",
    base: { ANTIGUEDAD_T1_NM: 3, ANTIGUEDAD_T2_NM: 3, DOMICILIA_NOMINA_T1_FL: true, FINALIDAD_CD: 20 }, fin: { IMPORTE_HIPOTECA_NM: 180_000, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 20 }, winner: "FIDELIZACION" },

  // ── GRUPO SDI — Frontera SOLICITAR_DATOS_INTERVINIENTES ──────────────────
  // Verifica la agregación OR booleana en uiLimits (RF-SDI-01, CA-SDI-01..03).
  { id: "SDI-ONLY-FIDELIZACION", grupo: "SDI · BOOL FLAG", mode: "ind",
    desc: "LTV=105% → solo FIDELIZACION elegible FINAL → SOLICITAR_DATOS_INTERVINIENTES=false",
    base: {}, fin: { IMPORTE_HIPOTECA_NM: 262_500, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 35 },
    winner: "FIDELIZACION" },

  { id: "SDI-OFERTA-WINS", grupo: "SDI · BOOL FLAG", mode: "ind",
    desc: "LTV=88% plazo=20a → ALTO_RIESGO gana → SOLICITAR_DATOS_INTERVINIENTES=true",
    base: {}, fin: { IMPORTE_HIPOTECA_NM: 220_000, IMPORTE_VIVIENDA_NM: 250_000, PLAZO_NM: 20 },
    winner: "ALTO_RIESGO" },

  { id: "SDI-MIXED", grupo: "SDI · BOOL FLAG", mode: "ind",
    desc: "6/6 ofertas eligibles FINAL → ALTO_RIESGO gana (rank 90); mix ofertas+FIDELIZACION → true",
    base: {}, fin: FIN_20,
    winner: "ALTO_RIESGO" },
];
