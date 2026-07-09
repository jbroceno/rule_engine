/**
 * seed_data.js — DRY builders for the "seed reset" feature
 * (POST /api/admin/config/reset-seed, gated by env.enableSeedReset).
 *
 * Source of truth: sql/seed_offers.sql — this file is the SQL seed procedure
 * (#ins_joven_rules) and the FIDELIZACION/params INSERT blocks translated 1:1
 * into the JS rule-item shape applyConfig() (api/services/admin_service.js)
 * consumes, so resetToSeed() can rebuild the same 6-offer seed scheme without
 * re-running raw SQL.
 *
 * IMPORTANT — condition/action field names below match the REAL contract
 * consumed by applyConfig()/insertRuleConditions()/insertRuleAction() in
 * admin_service.js, verified by reading that code (not guessed):
 *   condition: { group_id, left_operand, operator, value_type, right_operand, value2 }
 *   action:    { action_type, action_payload: { field, value, value_type } }
 * (SET_DICTAMEN is a separate admin_service.js convenience unused by these
 * seed rules — every seed action here is a plain SET or APPEND.)
 */

// ---------------------------------------------------------------------------
// SEED_OFFERS — exact values from sql/seed_offers.sql § 1. OFERTAS
// ---------------------------------------------------------------------------
export const SEED_OFFERS = [
  { code: "FIDELIZACION", name: "Ofertas Hipotecarias - Fidelización de Clientes", offer_rank: 10, oferta_id: 12 },
  { code: "ALTO_RIESGO", name: "Ofertas Hipotecarias - Alto Riesgo", offer_rank: 90, oferta_id: 15 },
  { code: "PROMOCION", name: "Ofertas Hipotecarias - Promoción", offer_rank: 60, oferta_id: 16 },
  { code: "PROMOCION_HC", name: "Ofertas Hipotecarias - Promoción H.C.", offer_rank: 70, oferta_id: 17 },
  { code: "LARGO_PLAZO", name: "Ofertas Hipotecarias - Alto Plazo", offer_rank: 80, oferta_id: 18 },
  { code: "ULTRA_ALTO_RIESGO", name: "Ofertas Hipotecarias - Alto riesgo", offer_rank: 100, oferta_id: 19 },
];

// ---------------------------------------------------------------------------
// SEED_PARAMS — exact values from sql/seed_offers.sql § 2. PARÁMETROS
// (offer_date_id is stamped later by buildSeedConfig)
// ---------------------------------------------------------------------------
export const SEED_PARAMS = {
  FIDELIZACION: [
    { key: "MIN_ANTIGUEDAD", value_type: "NUMBER", value: "12" },
    { key: "MIN_PLAZO", value_type: "NUMBER", value: "3" },
    { key: "MAX_PLAZO", value_type: "NUMBER", value: "35" },
    { key: "MIN_HIPOTECA", value_type: "NUMBER", value: "20000" },
    { key: "MAX_HIPOTECA", value_type: "NUMBER", value: "2000000" },
    { key: "MAX_LTV", value_type: "NUMBER", value: "0.80" },
    { key: "EDAD_PLAZO", value_type: "NUMBER", value: "75" },
  ],
  ALTO_RIESGO: [
    { key: "MIN_ANTIGUEDAD", value_type: "NUMBER", value: "12" },
    { key: "MAX_EDAD", value_type: "NUMBER", value: "45" },
    { key: "MIN_PLAZO", value_type: "NUMBER", value: "3" },
    { key: "MAX_PLAZO", value_type: "NUMBER", value: "35" },
    { key: "MIN_LTV_EXCLUSIVE", value_type: "NUMBER", value: "0.80" },
    { key: "MAX_LTV", value_type: "NUMBER", value: "1.00" },
    { key: "MIN_HIPOTECA", value_type: "NUMBER", value: "50000" },
    { key: "MAX_HIPOTECA", value_type: "NUMBER", value: "1500000" },
    { key: "MIN_INGRESOS_1T", value_type: "NUMBER", value: "2700" },
    { key: "MIN_INGRESOS_2T", value_type: "NUMBER", value: "3700" },
    { key: "EDAD_PLAZO", value_type: "NUMBER", value: "75" },
    { key: "TIPO_ALTA_ADMITIDAS", value_type: "JSON", value: '["NOVACION","CAPTACION"]' },
  ],
  PROMOCION: [
    { key: "MIN_ANTIGUEDAD", value_type: "NUMBER", value: "0" },
    { key: "MAX_EDAD", value_type: "NUMBER", value: "45" },
    { key: "MIN_PLAZO", value_type: "NUMBER", value: "3" },
    { key: "MAX_PLAZO", value_type: "NUMBER", value: "35" },
    { key: "MIN_LTV_EXCLUSIVE", value_type: "NUMBER", value: "0" },
    { key: "MAX_LTV", value_type: "NUMBER", value: "0.80" },
    { key: "MIN_HIPOTECA", value_type: "NUMBER", value: "50000" },
    { key: "MAX_HIPOTECA", value_type: "NUMBER", value: "2000000" },
    { key: "MIN_INGRESOS_1T", value_type: "NUMBER", value: "0" },
    { key: "MIN_INGRESOS_2T", value_type: "NUMBER", value: "0" },
    { key: "EDAD_PLAZO", value_type: "NUMBER", value: "75" },
    { key: "TIPO_ALTA_ADMITIDAS", value_type: "JSON", value: '["NOVACION","CAPTACION"]' },
  ],
  LARGO_PLAZO: [
    { key: "MIN_ANTIGUEDAD", value_type: "NUMBER", value: "12" },
    { key: "MAX_EDAD", value_type: "NUMBER", value: "40" },
    { key: "MIN_PLAZO", value_type: "NUMBER", value: "36" },
    { key: "MAX_PLAZO", value_type: "NUMBER", value: "45" },
    { key: "MIN_LTV_EXCLUSIVE", value_type: "NUMBER", value: "0" },
    { key: "MAX_LTV", value_type: "NUMBER", value: "0.80" },
    { key: "MIN_HIPOTECA", value_type: "NUMBER", value: "50000" },
    { key: "MAX_HIPOTECA", value_type: "NUMBER", value: "1500000" },
    { key: "MIN_INGRESOS_1T", value_type: "NUMBER", value: "2500" },
    { key: "MIN_INGRESOS_2T", value_type: "NUMBER", value: "3500" },
    { key: "EDAD_PLAZO", value_type: "NUMBER", value: "80" },
    { key: "TIPO_ALTA_ADMITIDAS", value_type: "JSON", value: '["NOVACION","CAPTACION"]' },
  ],
  ULTRA_ALTO_RIESGO: [
    { key: "MIN_ANTIGUEDAD", value_type: "NUMBER", value: "12" },
    { key: "MAX_EDAD", value_type: "NUMBER", value: "40" },
    { key: "MIN_PLAZO", value_type: "NUMBER", value: "36" },
    { key: "MAX_PLAZO", value_type: "NUMBER", value: "40" },
    { key: "MIN_LTV_EXCLUSIVE", value_type: "NUMBER", value: "0.80" },
    { key: "MAX_LTV", value_type: "NUMBER", value: "0.90" },
    { key: "MIN_HIPOTECA", value_type: "NUMBER", value: "50000" },
    { key: "MAX_HIPOTECA", value_type: "NUMBER", value: "1500000" },
    { key: "MIN_INGRESOS_1T", value_type: "NUMBER", value: "2700" },
    { key: "MIN_INGRESOS_2T", value_type: "NUMBER", value: "3700" },
    { key: "EDAD_PLAZO", value_type: "NUMBER", value: "75" },
    { key: "TIPO_ALTA_ADMITIDAS", value_type: "JSON", value: '["NOVACION","CAPTACION"]' },
  ],
  PROMOCION_HC: [
    { key: "MIN_ANTIGUEDAD", value_type: "NUMBER", value: "12" },
    { key: "MAX_EDAD", value_type: "NUMBER", value: "45" },
    { key: "MIN_PLAZO", value_type: "NUMBER", value: "5" },
    { key: "MAX_PLAZO", value_type: "NUMBER", value: "35" },
    { key: "MIN_LTV_EXCLUSIVE", value_type: "NUMBER", value: "0" },
    { key: "MAX_LTV", value_type: "NUMBER", value: "0.80" },
    { key: "MIN_HIPOTECA", value_type: "NUMBER", value: "50000" },
    { key: "MAX_HIPOTECA", value_type: "NUMBER", value: "2000000" },
    { key: "MIN_INGRESOS_1T", value_type: "NUMBER", value: "2500" },
    { key: "MIN_INGRESOS_2T", value_type: "NUMBER", value: "3500" },
    { key: "EDAD_PLAZO", value_type: "NUMBER", value: "75" },
    { key: "TIPO_ALTA_ADMITIDAS", value_type: "JSON", value: '["NOVACION","CAPTACION"]' },
  ],
};

// ---------------------------------------------------------------------------
// Small builders — keep rule/condition/action literals readable below.
// ---------------------------------------------------------------------------

function stageCondition(stage, groupId = 0) {
  return { group_id: groupId, left_operand: "stage", operator: "EQ", value_type: "STRING", right_operand: stage, value2: null };
}

function cond(groupId, left_operand, operator, value_type, right_operand) {
  return { group_id: groupId, left_operand, operator, value_type, right_operand, value2: null };
}

function setAction(field, value, value_type) {
  return { action_type: "SET", action_payload: { field, value, value_type } };
}

function appendMotivo(code) {
  return { action_type: "APPEND", action_payload: { field: "motivos", value: `{"code":"${code}"}`, value_type: "JSON" } };
}

function rule({ offerCode, rule_name, priority, stop_processing = false, conditions, actions }) {
  return { offerCode, rule_name, priority, enabled: true, stop_processing, conditions, actions };
}

// ---------------------------------------------------------------------------
// buildFidelizacionRules — sql/seed_offers.sql lines ~453-537 (5 rules, INIT
// only has rejection logic; PRE/FINAL are decision-only, no MIN_LTV_EXCLUSIVE).
// ---------------------------------------------------------------------------
export function buildFidelizacionRules() {
  const offerCode = "FIDELIZACION";
  return [
    rule({
      offerCode,
      rule_name: "INIT Rechazo: neg. Antigüedad/Domiciliación",
      priority: 1000,
      conditions: [
        stageCondition("INIT"),
        cond(0, "ANTIGUEDAD_T1_NM", "LE", "NUMBER", "PARAM:MIN_ANTIGUEDAD"),
        cond(0, "ANTIGUEDAD_T2_NM", "LE", "NUMBER", "PARAM:MIN_ANTIGUEDAD"),
        cond(0, "DOMICILIA_NOMINA_T1_FL", "IS_FALSE", "BOOL", ""),
        cond(0, "DOMICILIA_NOMINA_T2_FL", "IS_FALSE", "BOOL", ""),
      ],
      actions: [setAction("initRejected", "true", "BOOL"), appendMotivo("ANTIGUEDAD")],
    }),
    rule({
      offerCode,
      rule_name: "INIT Decisión: initEligible + límites",
      priority: 10,
      stop_processing: true,
      conditions: [stageCondition("INIT"), cond(0, "initRejected", "IS_FALSE", "BOOL", "")],
      actions: [
        setAction("initEligible", "true", "BOOL"),
        setAction("MIN_HIPOTECA", "PARAM:MIN_HIPOTECA", "NUMBER"),
        setAction("MAX_HIPOTECA", "PARAM:MAX_HIPOTECA", "NUMBER"),
        setAction("MIN_PLAZO", "PARAM:MIN_PLAZO", "NUMBER"),
        setAction("MAX_PLAZO", "PARAM:MAX_PLAZO", "NUMBER"),
        setAction("MAX_LTV", "PARAM:MAX_LTV", "NUMBER"),
        setAction("EDAD_PLAZO", "PARAM:EDAD_PLAZO", "NUMBER"),
        setAction("SOLICITAR_DATOS_INTERVINIENTES", "false", "BOOL"),
      ],
    }),
    rule({
      offerCode,
      rule_name: "PRE Decisión: preEligible + límites",
      priority: 10,
      stop_processing: true,
      conditions: [stageCondition("PRE"), cond(0, "preRejected", "IS_FALSE", "BOOL", "")],
      actions: [
        setAction("preEligible", "true", "BOOL"),
        setAction("offerCode", offerCode, "STRING"),
        setAction("MIN_HIPOTECA", "PARAM:MIN_HIPOTECA", "NUMBER"),
        setAction("MAX_HIPOTECA", "PARAM:MAX_HIPOTECA", "NUMBER"),
        setAction("MIN_PLAZO", "PARAM:MIN_PLAZO", "NUMBER"),
        setAction("MAX_PLAZO", "PARAM:MAX_PLAZO", "NUMBER"),
        setAction("MAX_LTV", "PARAM:MAX_LTV", "NUMBER"),
        setAction("EDAD_PLAZO", "PARAM:EDAD_PLAZO", "NUMBER"),
        setAction("SOLICITAR_DATOS_INTERVINIENTES", "false", "BOOL"),
      ],
    }),
    rule({
      offerCode,
      rule_name: "FINAL Decisión: NO elegible",
      priority: 10,
      stop_processing: true,
      conditions: [stageCondition("FINAL"), cond(0, "rejected", "IS_TRUE", "BOOL", "")],
      actions: [setAction("eligible", "false", "BOOL"), setAction("selectedOffer", offerCode, "STRING")],
    }),
    rule({
      offerCode,
      rule_name: "FINAL Decisión: ELEGIBLE",
      priority: 1,
      stop_processing: true,
      conditions: [stageCondition("FINAL"), cond(0, "rejected", "IS_FALSE", "BOOL", "")],
      actions: [
        setAction("eligible", "true", "BOOL"),
        setAction("selectedOffer", offerCode, "STRING"),
        setAction("SOLICITAR_DATOS_INTERVINIENTES", "false", "BOOL"),
      ],
    }),
  ];
}

// ---------------------------------------------------------------------------
// buildStandardRules — translated from #ins_joven_rules (sql/seed_offers.sql
// lines ~26-300), shared by the 5 non-FIDELIZACION offers (16 rules each).
// ---------------------------------------------------------------------------
export function buildStandardRules(offerCode) {
  return [
    rule({
      offerCode,
      rule_name: "INIT Rechazo: neg. Antigüedad/Domiciliación",
      priority: 1000,
      conditions: [
        stageCondition("INIT"),
        cond(0, "ANTIGUEDAD_T1_NM", "LE", "NUMBER", "PARAM:MIN_ANTIGUEDAD"),
        cond(0, "ANTIGUEDAD_T2_NM", "LE", "NUMBER", "PARAM:MIN_ANTIGUEDAD"),
        cond(0, "DOMICILIA_NOMINA_T1_FL", "IS_FALSE", "BOOL", ""),
        cond(0, "DOMICILIA_NOMINA_T2_FL", "IS_FALSE", "BOOL", ""),
      ],
      actions: [setAction("initRejected", "true", "BOOL"), appendMotivo("ANTIGUEDAD")],
    }),
    rule({
      offerCode,
      rule_name: "INIT Rechazo: Tipo de alta no admitido",
      priority: 970,
      stop_processing: true,
      conditions: [stageCondition("INIT"), cond(0, "TIPO_ALTA_CD", "NOT_IN", "STRING", "PARAM:TIPO_ALTA_ADMITIDAS")],
      actions: [setAction("initRejected", "true", "BOOL"), appendMotivo("TIPO_ALTA")],
    }),
    rule({
      offerCode,
      rule_name: "INIT Rechazo: Finalidad ≠ 01 (no primera vivienda)",
      priority: 960,
      stop_processing: true,
      conditions: [stageCondition("INIT"), cond(0, "FINALIDAD_CD", "NE", "NUMBER", "1")],
      actions: [setAction("initRejected", "true", "BOOL"), appendMotivo("FINALIDAD")],
    }),
    rule({
      offerCode,
      rule_name: "INIT Rechazo: No es primera vivienda habitual",
      priority: 950,
      conditions: [stageCondition("INIT"), cond(0, "PRIMERA_VIVIENDA_HABITUAL_FL", "EQ", "NUMBER", "0")],
      actions: [setAction("initRejected", "true", "BOOL"), appendMotivo("NO_PRIMERA_VIVIENDA")],
    }),
    rule({
      offerCode,
      rule_name: "INIT Rechazo: edadMax >= MAX_EDAD",
      priority: 940,
      conditions: [stageCondition("INIT"), cond(0, "EDAD_MAX_NM", "GE", "NUMBER", "PARAM:MAX_EDAD")],
      actions: [setAction("initRejected", "true", "BOOL"), appendMotivo("EDAD")],
    }),
    rule({
      offerCode,
      rule_name: "INIT Rechazo: importeVivienda < importeVentaCA (mínimo CCAA)",
      priority: 930,
      conditions: [stageCondition("INIT"), cond(0, "IMPORTE_VIVIENDA_NM", "LT", "NUMBER", "FIELD:IMPORTE_VIVIENDA_CA_NM")],
      actions: [setAction("initRejected", "true", "BOOL"), appendMotivo("IMPORTE_VIVIENDA")],
    }),
    rule({
      offerCode,
      rule_name: "INIT Decisión: initEligible + límites",
      priority: 10,
      stop_processing: true,
      conditions: [stageCondition("INIT"), cond(0, "initRejected", "IS_FALSE", "BOOL", "")],
      actions: [
        setAction("initEligible", "true", "BOOL"),
        setAction("MIN_HIPOTECA", "PARAM:MIN_HIPOTECA", "NUMBER"),
        setAction("MAX_HIPOTECA", "PARAM:MAX_HIPOTECA", "NUMBER"),
        setAction("MIN_PLAZO", "PARAM:MIN_PLAZO", "NUMBER"),
        setAction("MAX_PLAZO", "PARAM:MAX_PLAZO", "NUMBER"),
        setAction("MIN_LTV_EXCLUSIVE", "PARAM:MIN_LTV_EXCLUSIVE", "NUMBER"),
        setAction("MAX_LTV", "PARAM:MAX_LTV", "NUMBER"),
        setAction("EDAD_PLAZO", "PARAM:EDAD_PLAZO", "NUMBER"),
        setAction("SOLICITAR_DATOS_INTERVINIENTES", "true", "BOOL"),
      ],
    }),
    rule({
      offerCode,
      rule_name: "PRE Rechazo: 1T ingresosT1 < MIN_INGRESOS_1T",
      priority: 900,
      conditions: [
        stageCondition("PRE"),
        cond(0, "NUM_TITULARES_NM", "EQ", "NUMBER", "1"),
        cond(0, "INGRESO_T1_NM", "LT", "NUMBER", "PARAM:MIN_INGRESOS_1T"),
      ],
      actions: [setAction("preRejected", "true", "BOOL"), appendMotivo("INGRESOS")],
    }),
    rule({
      offerCode,
      rule_name: "PRE Rechazo: 2T ingresosTotales ≤ MIN_INGRESOS_2T",
      priority: 890,
      conditions: [
        stageCondition("PRE"),
        cond(0, "NUM_TITULARES_NM", "EQ", "NUMBER", "2"),
        cond(0, "INGRESO_TOTAL_NM", "LE", "NUMBER", "PARAM:MIN_INGRESOS_2T"),
      ],
      actions: [setAction("preRejected", "true", "BOOL"), appendMotivo("INGRESOS")],
    }),
    rule({
      offerCode,
      rule_name: "PRE Decisión: preEligible + límites",
      priority: 10,
      stop_processing: true,
      conditions: [stageCondition("PRE"), cond(0, "preRejected", "IS_FALSE", "BOOL", "")],
      actions: [
        setAction("preEligible", "true", "BOOL"),
        setAction("offerCode", offerCode, "STRING"),
        setAction("MIN_HIPOTECA", "PARAM:MIN_HIPOTECA", "NUMBER"),
        setAction("MAX_HIPOTECA", "PARAM:MAX_HIPOTECA", "NUMBER"),
        setAction("MIN_PLAZO", "PARAM:MIN_PLAZO", "NUMBER"),
        setAction("MAX_PLAZO", "PARAM:MAX_PLAZO", "NUMBER"),
        setAction("MIN_LTV_EXCLUSIVE", "PARAM:MIN_LTV_EXCLUSIVE", "NUMBER"),
        setAction("MAX_LTV", "PARAM:MAX_LTV", "NUMBER"),
        setAction("EDAD_PLAZO", "PARAM:EDAD_PLAZO", "NUMBER"),
        setAction("SOLICITAR_DATOS_INTERVINIENTES", "true", "BOOL"),
      ],
    }),
    rule({
      offerCode,
      rule_name: "FINAL Rechazo: LTV fuera de rango (MIN_LTV_EXCL, MAX_LTV]",
      priority: 1000,
      conditions: [
        cond(1, "stage", "EQ", "STRING", "FINAL"),
        cond(1, "LTV_NM", "LE", "NUMBER", "PARAM:MIN_LTV_EXCLUSIVE"),
        cond(2, "stage", "EQ", "STRING", "FINAL"),
        cond(2, "LTV_NM", "GT", "NUMBER", "PARAM:MAX_LTV"),
      ],
      actions: [setAction("rejected", "true", "BOOL"), appendMotivo("LTV")],
    }),
    rule({
      offerCode,
      rule_name: "FINAL Rechazo: importeHipoteca fuera de rango",
      priority: 990,
      conditions: [
        cond(1, "stage", "EQ", "STRING", "FINAL"),
        cond(1, "IMPORTE_HIPOTECA_NM", "LT", "NUMBER", "PARAM:MIN_HIPOTECA"),
        cond(2, "stage", "EQ", "STRING", "FINAL"),
        cond(2, "IMPORTE_HIPOTECA_NM", "GT", "NUMBER", "PARAM:MAX_HIPOTECA"),
      ],
      actions: [setAction("rejected", "true", "BOOL"), appendMotivo("IMPORTE_HIPOTECA")],
    }),
    rule({
      offerCode,
      rule_name: "FINAL Rechazo: plazo fuera de rango (años)",
      priority: 980,
      conditions: [
        cond(1, "stage", "EQ", "STRING", "FINAL"),
        cond(1, "PLAZO_NM", "LT", "NUMBER", "PARAM:MIN_PLAZO"),
        cond(2, "stage", "EQ", "STRING", "FINAL"),
        cond(2, "PLAZO_NM", "GT", "NUMBER", "PARAM:MAX_PLAZO"),
      ],
      actions: [setAction("rejected", "true", "BOOL"), appendMotivo("PLAZO")],
    }),
    rule({
      offerCode,
      rule_name: "FINAL Rechazo: edadMasPlazo > EDAD_PLAZO",
      priority: 970,
      conditions: [stageCondition("FINAL"), cond(0, "EDAD_MAS_PLAZO_NM", "GT", "NUMBER", "PARAM:EDAD_PLAZO")],
      actions: [setAction("rejected", "true", "BOOL"), appendMotivo("EDAD_PLAZO")],
    }),
    rule({
      offerCode,
      rule_name: "FINAL Decisión: NO elegible",
      priority: 10,
      stop_processing: true,
      conditions: [stageCondition("FINAL"), cond(0, "rejected", "IS_TRUE", "BOOL", "")],
      actions: [setAction("eligible", "false", "BOOL"), setAction("selectedOffer", offerCode, "STRING")],
    }),
    rule({
      offerCode,
      rule_name: "FINAL Decisión: ELEGIBLE",
      priority: 1,
      stop_processing: true,
      conditions: [stageCondition("FINAL"), cond(0, "rejected", "IS_FALSE", "BOOL", "")],
      actions: [
        setAction("eligible", "true", "BOOL"),
        setAction("selectedOffer", offerCode, "STRING"),
        setAction("SOLICITAR_DATOS_INTERVINIENTES", "true", "BOOL"),
      ],
    }),
  ];
}

// ---------------------------------------------------------------------------
// buildSeedConfig — ready-to-apply payload for applyConfig(), every rule and
// param stamped with the given offerDateId (D4-EXT step 4).
// ---------------------------------------------------------------------------
export function buildSeedConfig(offerDateId) {
  const nonFidelizacionCodes = SEED_OFFERS.map((o) => o.code).filter((code) => code !== "FIDELIZACION");

  const rules = [
    ...buildFidelizacionRules(),
    ...nonFidelizacionCodes.flatMap((code) => buildStandardRules(code)),
  ].map((r) => ({ ...r, offer_date_id: offerDateId }));

  const params = Object.entries(SEED_PARAMS).map(([offerCode, paramValues]) => ({
    offerCode,
    paramValues: paramValues.map((p) => ({ ...p, offer_date_id: offerDateId })),
  }));

  return { rules, params };
}
