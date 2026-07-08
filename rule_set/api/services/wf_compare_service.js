import { env } from "../config/env.js";
import { AppError } from "../utils/app_error.js";

function approxBirthDate(ageYears) {
  const year = new Date().getFullYear() - Math.max(0, Math.floor(ageYears ?? 0));
  return `${year}-01-01`;
}

function approxSeniorityDate(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - Math.max(0, Math.floor(months ?? 0)));
  return d.toISOString().split("T")[0];
}

// Normalizes input accepting both camelCase (legacy) and SCREAMING_SNAKE_CASE (motor engine) names.
function normalizeWfInput(input) {
  return {
    finalidad:              input.finalidad              ?? input.FINALIDAD_CD,
    tipoAlta:               input.tipoAlta               ?? input.TIPO_ALTA_CD,
    importeVivienda:        input.importeVivienda        ?? input.IMPORTE_VIVIENDA_NM,
    primeraViviendaHabitual: input.primeraViviendaHabitual ?? input.PRIMERA_VIVIENDA_HABITUAL_FL,
    domiciliaNominaT1:      input.domiciliaNominaT1      ?? input.DOMICILIA_NOMINA_T1_FL,
    edadT1:                 input.edadT1                 ?? input.EDAD_T1_NM,
    edadT2:                 input.edadT2                 ?? input.EDAD_T2_NM,
    antiguedadT1:           input.antiguedadT1           ?? input.ANTIGUEDAD_T1_NM,
    antiguedadT2:           input.antiguedadT2           ?? input.ANTIGUEDAD_T2_NM,
    ingresosT1:             input.ingresosT1             ?? input.INGRESO_T1_NM,
    ingresosT2:             input.ingresosT2             ?? input.INGRESO_T2_NM,
    numTitulares:           input.numTitulares           ?? input.NUM_TITULARES_NM,
  };
}

function normalizeWfFinalInput(finalInput) {
  if (!finalInput) return null;
  return {
    importeHipoteca: finalInput.importeHipoteca ?? finalInput.IMPORTE_HIPOTECA_NM,
    plazo:           finalInput.plazo           ?? finalInput.PLAZO_NM,
  };
}

function buildIntervinientes(input, numPersonaT1 = null, numPersonaT2 = null) {
  const t1 = {
    ORDEN_NM: 1,
    NACIMIENTO_DT: approxBirthDate(input.edadT1),
    ANTIGUEDAD_CLIENTE_DT: approxSeniorityDate(input.antiguedadT1),
    NUMERO_PAGAS_NM: 14,
    INGRESOS_INTERV_NM: input.ingresosT1 ?? 0,
  };
  if (numPersonaT1) t1.NUM_CLIENTE_CD = numPersonaT1;
  const result = [t1];

  if ((input.numTitulares ?? 1) === 2) {
    const t2 = {
      ORDEN_NM: 2,
      NACIMIENTO_DT: approxBirthDate(input.edadT2),
      ANTIGUEDAD_CLIENTE_DT: approxSeniorityDate(input.antiguedadT2),
      NUMERO_PAGAS_NM: 14,
      INGRESOS_INTERV_NM: input.ingresosT2 ?? 0,
    };
    if (numPersonaT2) t2.NUM_CLIENTE_CD = numPersonaT2;
    result.push(t2);
  }
  return result;
}

export function buildWfBody(faseCd, rawInput, token, tokenExpCd, rawFinalInput = null, comunidadAutonomaCd = null, numPersonaT1 = null, numPersonaT2 = null) {
  const input = normalizeWfInput(rawInput);
  const fin   = normalizeWfFinalInput(rawFinalInput);
  return {
    token,
    tokenExpCd,
    faseCd,
    finalidadCd: String(input.finalidad ?? ""),
    tipoAltaCd: input.tipoAlta ?? null,
    viviendaNuevaFl: false,
    importeViviendaNm: input.importeVivienda ?? null,
    importeHipotecaNm: fin?.importeHipoteca ?? null,
    plazoNm: fin?.plazo ?? null,
    tienecasaFl: input.primeraViviendaHabitual ? 0 : 1,
    comunidadAutonomaCd: comunidadAutonomaCd ?? null,
    primeraViviendaHabitualFl: input.primeraViviendaHabitual ? 1 : 0,
    domiciliaNomina: Boolean(input.domiciliaNominaT1),
    arrIntervinientes: buildIntervinientes(input, numPersonaT1, numPersonaT2),
  };
}

export async function callWfApi(wfBody) {
  if (!env.wfBaseUrl) {
    throw new AppError("WF_BASE_URL no configurado en .env.", 503);
  }

  const url = `${env.wfBaseUrl}/ApiRest/GetOfertasHipotecas`;

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(wfBody),
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    throw new AppError(`Error de red llamando a WF: ${error.message}. url= ${url}, body = ${JSON.stringify(wfBody)}`, 503);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new AppError(`WF respondió ${response.status}: ${text.substring(0, 200)}. url= ${url}, body = ${JSON.stringify(wfBody)}`, 502);
  }

  return response.json();
}

function compareOfferSets(pocCodes, wfCodes) {
  const pocSet = new Set(pocCodes);
  const wfSet = new Set(wfCodes);
  return {
    poc: pocCodes,
    wf: wfCodes,
    soloEnPoc: pocCodes.filter((c) => !wfSet.has(c)),
    soloEnWf: wfCodes.filter((c) => !pocSet.has(c)),
    match: pocCodes.length === wfCodes.length && pocCodes.every((c) => wfSet.has(c)),
  };
}

// Boolean fields handled with special semantics — keep separate from the generic numeric loop.
const SDI_BOOL_FIELDS = ["SOLICITAR_DATOS_INTERVINIENTES"];

// Coerces any truthy/falsy value to boolean. undefined/null/absent → false.
function toBool(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return Boolean(v);
}

// Reads SOLICITAR_DATOS_INTERVINIENTES from a WF response using tolerant lookup.
// Returns undefined when the field is absent in all known locations.
function readWfSolicitarDatos(wfResult) {
  const limites = wfResult?.RESULTADO?.LIMITES ?? {};
  const candidates = [
    limites["SOLICITAR_DATOS_INTERVINIENTES"],
    limites["SOLICITAR_DATOS_INTERVINIENTES_FL"],
    limites["solicitarDatosIntervinientes"],
    wfResult?.RESULTADO?.["SOLICITAR_DATOS_INTERVINIENTES"],
  ];
  const found = candidates.find((c) => c !== undefined);
  return found; // undefined if all absent
}

function compareLimites(pocLimits, wfLimits, wfResult) {
  const all = new Set([...Object.keys(pocLimits ?? {}), ...Object.keys(wfLimits ?? {})]);
  const diferencias = [];

  for (const key of all) {
    // Boolean fields use their own comparison logic — skip them here.
    if (SDI_BOOL_FIELDS.includes(key)) continue;

    const pocVal = pocLimits?.[key] ?? null;
    const wfVal = wfLimits?.[key] ?? null;
    if (String(pocVal) !== String(wfVal)) {
      diferencias.push({ campo: key, poc: pocVal, wf: wfVal });
    }
  }

  // Special-case: SOLICITAR_DATOS_INTERVINIENTES — absence in WF ≡ false (RF-SDI-07).
  // Escenario A: POC=true, WF=true  → no diff
  // Escenario B: POC=false, WF=absent/false → no diff (ausencia ≡ false)
  // Escenario C: POC=true, WF=absent/false → real diff
  const pocSdi = pocLimits?.["SOLICITAR_DATOS_INTERVINIENTES"];
  if (pocSdi !== undefined) {
    const pocBool = toBool(pocSdi);
    const wfRaw = readWfSolicitarDatos(wfResult);
    const wfBool = toBool(wfRaw); // absent → false
    if (pocBool !== wfBool) {
      diferencias.push({
        campo: "SOLICITAR_DATOS_INTERVINIENTES",
        poc: pocBool,
        wf: wfRaw !== undefined ? wfBool : "absent (≡ false)",
      });
    }
  }

  return { match: diferencias.length === 0, diferencias };
}

export function compareResults(faseCd, pocResult, wfResult) {
  const wfCodes = (wfResult?.RESULTADO?.OFERTAS_ELEGIBLES ?? [])
    .map((o) => o.offerCode ?? o.OFERTA_CD ?? "")
    .filter(Boolean);
  const wfGanadora =
    wfResult?.RESULTADO?.OFERTA_GANADORA?.offerCode ??
    wfResult?.RESULTADO?.OFERTA_GANADORA?.OFERTA_CD ??
    null;
  const wfLimites = wfResult?.RESULTADO?.LIMITES ?? {};

  let pocElegibles, pocGanadora, pocLimites;

  if (faseCd === "INIT") {
    pocElegibles = (pocResult?.eligibleOffers ?? []).map((o) => o.offerCode);
    pocGanadora = null;
    pocLimites = pocResult?.uiLimits ?? {};
  } else if (faseCd === "PRE") {
    const pre = pocResult?.pre;
    pocElegibles = (pre?.eligibleOffers ?? pre?.preElegibles ?? []).map((o) => o.offerCode);
    pocGanadora = null;
    pocLimites = pre?.uiLimits ?? {};
  } else {
    const pre = pocResult?.pre;
    const final = pocResult?.final;
    pocElegibles = (final?.eligibleOffers ?? []).map((o) => o.offerCode);
    pocGanadora = final?.winner?.offerCode ?? null;
    pocLimites = final?.uiLimits ?? pre?.uiLimits ?? {};
  }

  const ofertasElegibles = compareOfferSets(pocElegibles, wfCodes);
  const limites = compareLimites(pocLimites, wfLimites, wfResult);

  let ofertaGanadora = null;
  let ganadoraMatch = true;
  if (faseCd === "FINAL") {
    ganadoraMatch = pocGanadora === wfGanadora;
    ofertaGanadora = { poc: pocGanadora, wf: wfGanadora, match: ganadoraMatch };
  }

  return {
    match: ofertasElegibles.match && limites.match && ganadoraMatch,
    ofertasElegibles,
    limites,
    ofertaGanadora,
  };
}
