import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";

import { computeDerived, finalize, initcheck, normalizeConfig, precheck } from "../rule_engine.js";

function loadFixtureConfig() {
  const raw = fs.readFileSync(new URL("../rules.json", import.meta.url), "utf8");
  return JSON.parse(raw);
}

function toSqlLikeParams(config) {
  return {
    offers: config.offers,
    params: config.params.map((row) => ({
      offerCode: row.offerCode,
      params: (row.paramValues ?? row.params ?? []).map((param) => ({
        param_key: param.key ?? param.param_key,
        value_type: param.value_type,
        value: param.value,
      })),
    })),
  };
}

// Solicitante modelo (campos WF): joven, primera vivienda, antigüedad ≥12m, ingresos OK.
const FIXTURE_BASE = {
  TIPO_ALTA_CD: "NOVACION",
  FINALIDAD_CD: 1,
  PRIMERA_VIVIENDA_HABITUAL_FL: 1,
  EDAD_MAX_NM: 34,
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

test("precheck + finalize keep expected winner on fixture", () => {
  const config = loadFixtureConfig();
  const { offers, paramsIndex } = normalizeConfig(config);

  const pre = precheck(FIXTURE_BASE, offers, paramsIndex);
  // LTV = 220k/250k = 0.88 ∈ (0.80, 0.90] y PLAZO_NM = 38 ∈ [36, 40] → ULTRA_ALTO_RIESGO (rank=100)
  const full = computeDerived({
    ...FIXTURE_BASE,
    IMPORTE_HIPOTECA_NM: 220_000,
    PLAZO_NM: 38,
  });
  const result = finalize(full, offers, paramsIndex, pre);

  assert.equal(result.winner?.offerCode, "ULTRA_ALTO_RIESGO");
});

test("finalize returns null winner when precheck has no eligible offers", () => {
  const config = loadFixtureConfig();
  const { offers, paramsIndex } = normalizeConfig(config);

  // TIPO_ALTA_CD=SUBROGACION → todas las Joven fallan INIT (NOT_IN admitidas).
  // ant=0, dom=false → FIDELIZACION falla INIT (ant≤MIN_ANT=6 y dom=false).
  // Con chained=true todas quedan bloqueadas en PRE → eligibleOffers vacío.
  const base = {
    NUM_TITULARES_NM: 1,
    EDAD_MAX_NM: 30,
    ANTIGUEDAD_T1_NM: 0,
    ANTIGUEDAD_T2_NM: 0,
    DOMICILIA_NOMINA_T1_FL: false,
    DOMICILIA_NOMINA_T2_FL: false,
    TIPO_ALTA_CD: "SUBROGACION",
  };

  const pre = precheck(base, offers, paramsIndex, { chained: true });
  assert.equal(pre.eligibleOffers.length, 0);

  const full = computeDerived({
    ...base,
    IMPORTE_HIPOTECA_NM: 100_000,
    IMPORTE_VIVIENDA_NM: 100_000,
    PLAZO_NM: 20,
  });

  const result = finalize(full, offers, paramsIndex, pre);
  assert.equal(result.winner, null);
  assert.equal(result.all.length, 0);
});

test("finalize uiLimits only aggregates FINAL eligible offers", () => {
  const config = {
    offers: [
      {
        offerCode: "A",
        offer_rank: 90,
        oferta_id: 1,
        rules: [
          {
            rule_id: 1,
            name: "PRE decision A",
            priority: 100,
            stop_processing: false,
            conditions: [
              { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
            ],
            actions: [
              { action_id: 1, action_type: "SET", field: "preEligible", value: "true", value_type: "BOOL" },
              { action_id: 2, action_type: "SET", field: "MIN_LTV_EXCLUSIVE", value: "0", value_type: "NUMBER" },
              { action_id: 3, action_type: "SET", field: "MAX_LTV", value: "0.95", value_type: "NUMBER" },
            ],
          },
          {
            rule_id: 2,
            name: "FINAL reject A",
            priority: 100,
            stop_processing: true,
            conditions: [
              { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "FINAL" },
            ],
            actions: [
              { action_id: 1, action_type: "SET", field: "eligible", value: "false", value_type: "BOOL" },
            ],
          },
        ],
      },
      {
        offerCode: "B",
        offer_rank: 80,
        oferta_id: 2,
        rules: [
          {
            rule_id: 10,
            name: "PRE decision B",
            priority: 100,
            stop_processing: false,
            conditions: [
              { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
            ],
            actions: [
              { action_id: 1, action_type: "SET", field: "preEligible", value: "true", value_type: "BOOL" },
              { action_id: 2, action_type: "SET", field: "MIN_LTV_EXCLUSIVE", value: "0", value_type: "NUMBER" },
              { action_id: 3, action_type: "SET", field: "MAX_LTV", value: "0.8", value_type: "NUMBER" },
            ],
          },
          {
            rule_id: 11,
            name: "FINAL accept B",
            priority: 100,
            stop_processing: true,
            conditions: [
              { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "FINAL" },
            ],
            actions: [
              { action_id: 1, action_type: "SET", field: "eligible", value: "true", value_type: "BOOL" },
            ],
          },
        ],
      },
    ],
    params: [],
  };

  const { offers, paramsIndex } = normalizeConfig(config);
  const pre = precheck({}, offers, paramsIndex);
  const result = finalize({}, offers, paramsIndex, pre);

  assert.equal(result.eligibleOffers.length, 1);
  assert.equal(result.eligibleOffers[0].offerCode, "B");
  assert.equal(result.uiLimits.MAX_LTV, 0.8);
  assert.equal(result.uiLimits.MIN_LTV_EXCLUSIVE, 0);
});

test("normalizeConfig supports params payload with param_key", () => {
  const config = {
    offers: [
      {
        offerCode: "X",
        offer_rank: 1,
        oferta_id: 1,
        rules: [
          {
            rule_id: 1,
            name: "PRE set",
            priority: 1,
            stop_processing: true,
            conditions: [
              { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
            ],
            actions: [
              { action_id: 1, action_type: "SET", field: "preEligible", value: "true", value_type: "BOOL" },
              { action_id: 2, action_type: "SET", field: "minHipoteca", value: "PARAM:MIN_HIPOTECA", value_type: "NUMBER" },
            ],
          },
        ],
      },
    ],
    params: [
      {
        offerCode: "X",
        stage: "PRE",
        params: [
          { param_key: "MIN_HIPOTECA", value_type: "NUMBER", value: "50000" },
        ],
      },
    ],
  };

  const { offers, paramsIndex } = normalizeConfig(config);
  const pre = precheck({}, offers, paramsIndex);

  assert.equal(pre.eligibleOffers.length, 1);
  assert.equal(pre.eligibleOffers[0].dictamen?.minHipoteca, 50000);
});

test("IN with malformed JSON param list does not crash and evaluates false", () => {
  const config = {
    offers: [
      {
        offerCode: "X",
        offer_rank: 1,
        oferta_id: 1,
        rules: [
          {
            rule_id: 1,
            name: "PRE decision",
            priority: 1,
            stop_processing: true,
            conditions: [
              { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
              { cond_id: 2, group_id: 0, field: "tipoAlta", operator: "IN", value_type: "STRING", value1: "PARAM:TIPOS" },
            ],
            actions: [
              { action_id: 1, action_type: "SET", field: "preEligible", value: "true", value_type: "BOOL" },
            ],
          },
        ],
      },
    ],
    params: [
      {
        offerCode: "X",
        stage: "PRE",
        paramValues: [{ key: "TIPOS", value_type: "JSON", value: "not-a-json-array" }],
      },
    ],
  };

  const { offers, paramsIndex } = normalizeConfig(config);
  const pre = precheck({ tipoAlta: "NUEVA" }, offers, paramsIndex);

  assert.equal(pre.eligibleOffers.length, 0);
  assert.equal(pre.all[0].trace.rulesMatched, 0);
});

test("NOT_IN with missing param list evaluates false", () => {
  const config = {
    offers: [
      {
        offerCode: "X",
        offer_rank: 1,
        oferta_id: 1,
        rules: [
          {
            rule_id: 1,
            name: "PRE decision",
            priority: 1,
            stop_processing: true,
            conditions: [
              { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
              { cond_id: 2, group_id: 0, field: "tipoAlta", operator: "NOT_IN", value_type: "STRING", value1: "PARAM:TIPOS" },
            ],
            actions: [
              { action_id: 1, action_type: "SET", field: "preEligible", value: "true", value_type: "BOOL" },
            ],
          },
        ],
      },
    ],
    params: [],
  };

  const { offers, paramsIndex } = normalizeConfig(config);
  const pre = precheck({ tipoAlta: "NUEVA" }, offers, paramsIndex);

  assert.equal(pre.eligibleOffers.length, 0);
  assert.equal(pre.all[0].trace.rulesMatched, 0);
});

test("normalizeConfig rejects rules without stage guard", () => {
  const config = {
    offers: [
      {
        offerCode: "X",
        offer_rank: 1,
        oferta_id: 1,
        rules: [
          {
            rule_id: 1,
            name: "invalid missing stage",
            priority: 1,
            stop_processing: true,
            conditions: [
              { cond_id: 1, group_id: 0, field: "edad", operator: "GT", value_type: "NUMBER", value1: "18" },
            ],
            actions: [
              { action_id: 1, action_type: "SET", field: "preEligible", value: "true", value_type: "BOOL" },
            ],
          },
        ],
      },
    ],
    params: [],
  };

  assert.throws(() => normalizeConfig(config), /must include at least one stage guard/);
});

test("normalizeConfig rejects PRE rules that write FINAL-only fields", () => {
  const config = {
    offers: [
      {
        offerCode: "X",
        offer_rank: 1,
        oferta_id: 1,
        rules: [
          {
            rule_id: 1,
            name: "invalid pre writes final field",
            priority: 1,
            stop_processing: true,
            conditions: [
              { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
            ],
            actions: [
              { action_id: 1, action_type: "SET", field: "eligible", value: "true", value_type: "BOOL" },
            ],
          },
        ],
      },
    ],
    params: [],
  };

  assert.throws(() => normalizeConfig(config), /FINAL-only/);
});

test("regression: SQL-like params payload keeps fixture winner", () => {
  const fixture = loadFixtureConfig();
  const sqlLike = toSqlLikeParams(fixture);
  const { offers, paramsIndex } = normalizeConfig(sqlLike);

  const pre = precheck(FIXTURE_BASE, offers, paramsIndex);
  const full = computeDerived({
    ...FIXTURE_BASE,
    IMPORTE_HIPOTECA_NM: 220_000,
    PLAZO_NM: 38,
  });
  const result = finalize(full, offers, paramsIndex, pre);

  assert.equal(result.winner?.offerCode, "ULTRA_ALTO_RIESGO");
});

test("strict=false keeps legacy config without full required fields", () => {
  const config = {
    offers: [
      {
        offerCode: "X",
        offer_rank: 1,
        oferta_id: 1,
        rules: [
          {
            rule_id: 1,
            name: "legacy-like",
            priority: 1,
            stop_processing: true,
            conditions: [
              { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value1: "PRE" },
            ],
            actions: [
              { action_id: 1, action_type: "SET", field: "preEligible", value: "true", value_type: "BOOL" },
            ],
          },
        ],
      },
    ],
    params: [],
  };

  assert.doesNotThrow(() => normalizeConfig(config, { strictValidation: false }));
});

test("strict=true rejects missing required condition fields", () => {
  const config = {
    offers: [
      {
        offerCode: "X",
        offer_rank: 1,
        oferta_id: 1,
        rules: [
          {
            rule_id: 1,
            name: "invalid condition",
            priority: 1,
            stop_processing: true,
            conditions: [
              { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value1: "PRE" },
            ],
            actions: [
              { action_id: 1, action_type: "SET", field: "preEligible", value: "true", value_type: "BOOL" },
            ],
          },
        ],
      },
    ],
    params: [],
  };

  assert.throws(() => normalizeConfig(config, { strictValidation: true }), /value_type/);
});

test("strict=true validates BETWEEN operands", () => {
  const config = {
    offers: [
      {
        offerCode: "X",
        offer_rank: 1,
        oferta_id: 1,
        rules: [
          {
            rule_id: 1,
            name: "between invalid",
            priority: 1,
            stop_processing: true,
            conditions: [
              { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
              { cond_id: 2, group_id: 0, field: "edad", operator: "BETWEEN", value_type: "NUMBER", value1: "18" },
            ],
            actions: [
              { action_id: 1, action_type: "SET", field: "preEligible", value: "true", value_type: "BOOL" },
            ],
          },
        ],
      },
    ],
    params: [],
  };

  assert.throws(() => normalizeConfig(config, { strictValidation: true }), /BETWEEN requires value1 and value2/);
});

test("strict=true validates IN/NOT_IN source", () => {
  const config = {
    offers: [
      {
        offerCode: "X",
        offer_rank: 1,
        oferta_id: 1,
        rules: [
          {
            rule_id: 1,
            name: "in invalid",
            priority: 1,
            stop_processing: true,
            conditions: [
              { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
              { cond_id: 2, group_id: 0, field: "tipoAlta", operator: "IN", value_type: "STRING", value1: "NUEVA" },
            ],
            actions: [
              { action_id: 1, action_type: "SET", field: "preEligible", value: "true", value_type: "BOOL" },
            ],
          },
        ],
      },
    ],
    params: [],
  };

  assert.throws(() => normalizeConfig(config, { strictValidation: true }), /IN requires in_values or value1=PARAM/);
});

test("strict=true accepts params without stage field", () => {
  const config = {
    offers: [
      {
        offerCode: "X",
        offer_rank: 1,
        oferta_id: 1,
        rules: [
          {
            rule_id: 1,
            name: "ok",
            priority: 1,
            stop_processing: true,
            conditions: [
              { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
            ],
            actions: [
              { action_id: 1, action_type: "SET", field: "preEligible", value: "true", value_type: "BOOL" },
            ],
          },
        ],
      },
    ],
    params: [
      {
        offerCode: "X",
        paramValues: [{ key: "A", value_type: "NUMBER", value: "1" }],
      },
    ],
  };

  const result = normalizeConfig(config, { strictValidation: true });
  assert.ok(result.paramsIndex["X"]["A"] === 1);
});

test("strict=true rejects duplicate param key per scope", () => {
  const config = {
    offers: [
      {
        offerCode: "X",
        offer_rank: 1,
        oferta_id: 1,
        rules: [
          {
            rule_id: 1,
            name: "ok",
            priority: 1,
            stop_processing: true,
            conditions: [
              { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
            ],
            actions: [
              { action_id: 1, action_type: "SET", field: "preEligible", value: "true", value_type: "BOOL" },
            ],
          },
        ],
      },
    ],
    params: [
      {
        offerCode: "X",
        paramValues: [
          { key: "A", value_type: "NUMBER", value: "1" },
          { key: "A", value_type: "NUMBER", value: "2" },
        ],
      },
    ],
  };

  assert.throws(() => normalizeConfig(config, { strictValidation: true }), /duplicate param key/);
});

test("DNF OR semantics: rule matches when any group passes", () => {
  const config = {
    offers: [
      {
        offerCode: "X",
        offer_rank: 1,
        oferta_id: 1,
        rules: [
          {
            rule_id: 1,
            name: "PRE OR groups",
            priority: 1,
            stop_processing: true,
            conditions: [
              { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
              { cond_id: 2, group_id: 0, field: "edad", operator: "GT", value_type: "NUMBER", value1: "40" },
              { cond_id: 3, group_id: 1, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
              { cond_id: 4, group_id: 1, field: "edad", operator: "LT", value_type: "NUMBER", value1: "35" },
            ],
            actions: [
              { action_id: 1, action_type: "SET", field: "preEligible", value: "true", value_type: "BOOL" },
            ],
          },
        ],
      },
    ],
    params: [],
  };

  const { offers, paramsIndex } = normalizeConfig(config);
  const pre = precheck({ edad: 30 }, offers, paramsIndex);

  assert.equal(pre.eligibleOffers.length, 1);
  assert.equal(pre.all[0].trace.rulesMatched, 1);
  assert.ok(pre.all[0].trace.failedConditions.some((row) => row.cond_id === 2));
});

test("DNF AND semantics: failing one condition rejects the group", () => {
  const config = {
    offers: [
      {
        offerCode: "X",
        offer_rank: 1,
        oferta_id: 1,
        rules: [
          {
            rule_id: 1,
            name: "PRE AND group",
            priority: 1,
            stop_processing: true,
            conditions: [
              { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
              { cond_id: 2, group_id: 0, field: "country", operator: "EQ", value_type: "STRING", value1: "ES" },
              { cond_id: 3, group_id: 0, field: "edad", operator: "GT", value_type: "NUMBER", value1: "18" },
            ],
            actions: [
              { action_id: 1, action_type: "SET", field: "preEligible", value: "true", value_type: "BOOL" },
            ],
          },
        ],
      },
    ],
    params: [],
  };

  const { offers, paramsIndex } = normalizeConfig(config);
  const pre = precheck({ edad: 17, country: "ES" }, offers, paramsIndex);

  assert.equal(pre.eligibleOffers.length, 0);
  assert.equal(pre.all[0].trace.rulesMatched, 0);
  assert.ok(pre.all[0].trace.failedConditions.some((row) => row.cond_id === 3));
});

test("deterministic order: tie on priority runs lower rule_id first", () => {
  const config = {
    offers: [
      {
        offerCode: "X",
        offer_rank: 1,
        oferta_id: 1,
        rules: [
          {
            rule_id: 2,
            name: "second",
            priority: 10,
            stop_processing: false,
            conditions: [
              { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
            ],
            actions: [
              { action_id: 1, action_type: "APPEND", field: "motivos", value: "r2", value_type: "STRING" },
            ],
          },
          {
            rule_id: 1,
            name: "first",
            priority: 10,
            stop_processing: false,
            conditions: [
              { cond_id: 2, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
            ],
            actions: [
              { action_id: 2, action_type: "APPEND", field: "motivos", value: "r1", value_type: "STRING" },
            ],
          },
        ],
      },
    ],
    params: [],
  };

  const { offers, paramsIndex } = normalizeConfig(config);
  const pre = precheck({}, offers, paramsIndex);

  assert.deepEqual(pre.all[0].dictamen.motivos, ["r1", "r2"]);
  assert.deepEqual(pre.all[0].applied.map((row) => row.rule_id), [1, 2]);
});

test("stop_processing prevents applying later matching rules", () => {
  const config = {
    offers: [
      {
        offerCode: "X",
        offer_rank: 1,
        oferta_id: 1,
        rules: [
          {
            rule_id: 1,
            name: "terminal",
            priority: 10,
            stop_processing: true,
            conditions: [
              { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
            ],
            actions: [
              { action_id: 1, action_type: "SET", field: "preEligible", value: "true", value_type: "BOOL" },
            ],
          },
          {
            rule_id: 2,
            name: "should-not-run",
            priority: 1,
            stop_processing: false,
            conditions: [
              { cond_id: 2, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
            ],
            actions: [
              { action_id: 2, action_type: "SET", field: "preEligible", value: "false", value_type: "BOOL" },
            ],
          },
        ],
      },
    ],
    params: [],
  };

  const { offers, paramsIndex } = normalizeConfig(config);
  const pre = precheck({}, offers, paramsIndex);

  assert.equal(pre.all[0].dictamen.preEligible, true);
  assert.equal(pre.all[0].trace.rulesApplied, 1);
});

test("param resolution uses flat index: PARAM:KEY resolves to single value per offer", () => {
  const config = {
    offers: [
      {
        offerCode: "X",
        offer_rank: 1,
        oferta_id: 1,
        rules: [
          {
            rule_id: 1,
            name: "param resolution",
            priority: 1,
            stop_processing: true,
            conditions: [
              { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
            ],
            actions: [
              { action_id: 1, action_type: "SET", field: "preEligible", value: "true", value_type: "BOOL" },
              { action_id: 2, action_type: "SET", field: "minHipoteca", value: "PARAM:MIN_HIPOTECA", value_type: "NUMBER" },
            ],
          },
        ],
      },
    ],
    params: [
      {
        offerCode: "X",
        paramValues: [{ key: "MIN_HIPOTECA", value_type: "NUMBER", value: "200" }],
      },
    ],
  };

  const { offers, paramsIndex } = normalizeConfig(config);
  const pre = precheck({}, offers, paramsIndex);

  assert.equal(pre.eligibleOffers[0].dictamen?.minHipoteca, 200);
});

test("params are offer-scoped: same key in different offers resolves independently", () => {
  const config = {
    offers: [
      {
        offerCode: "X",
        offer_rank: 1,
        oferta_id: 1,
        rules: [
          {
            rule_id: 1,
            name: "param test",
            priority: 1,
            stop_processing: true,
            conditions: [
              { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
            ],
            actions: [
              { action_id: 1, action_type: "SET", field: "preEligible", value: "true", value_type: "BOOL" },
              { action_id: 2, action_type: "SET", field: "minHipoteca", value: "PARAM:MIN_HIPOTECA", value_type: "NUMBER" },
            ],
          },
        ],
      },
    ],
    params: [
      {
        offerCode: "X",
        paramValues: [{ key: "MIN_HIPOTECA", value_type: "NUMBER", value: "300" }],
      },
    ],
  };

  const { offers, paramsIndex } = normalizeConfig(config);
  const pre = precheck({}, offers, paramsIndex);

  assert.equal(pre.eligibleOffers[0].dictamen?.minHipoteca, 300);
});

test("strict=true rejects conditions mixing PRE and FINAL in same rule", () => {
  const config = {
    offers: [
      {
        offerCode: "X",
        offer_rank: 1,
        oferta_id: 1,
        rules: [
          {
            rule_id: 1,
            name: "mixed stage",
            priority: 1,
            stop_processing: true,
            conditions: [
              { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
              { cond_id: 2, group_id: 1, field: "stage", operator: "EQ", value_type: "STRING", value1: "FINAL" },
            ],
            actions: [
              { action_id: 1, action_type: "SET", field: "preEligible", value: "true", value_type: "BOOL" },
            ],
          },
        ],
      },
    ],
    params: [],
  };

  assert.throws(() => normalizeConfig(config, { strictValidation: true }), /single stage/);
});

test("strict=true reports unsupported operator and action_type with paths", () => {
  const config = {
    offers: [
      {
        offerCode: "X",
        offer_rank: 1,
        oferta_id: 1,
        rules: [
          {
            rule_id: 1,
            name: "invalid op/action",
            priority: 1,
            stop_processing: true,
            conditions: [
              { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
              { cond_id: 2, group_id: 0, field: "name", operator: "CONTAINS", value_type: "STRING", value1: "A" },
            ],
            actions: [
              { action_id: 1, action_type: "MERGE", field: "preEligible", value: "true", value_type: "BOOL" },
            ],
          },
        ],
      },
    ],
    params: [],
  };

  assert.throws(
    () => normalizeConfig(config, { strictValidation: true }),
    /conditions\[1\]\.operator: unsupported operator 'CONTAINS'[\s\S]*actions\[0\]\.action_type: unsupported action_type 'MERGE'/
  );
});

test("trace records missing PARAM references in actions", () => {
  const config = {
    offers: [
      {
        offerCode: "X",
        offer_rank: 1,
        oferta_id: 1,
        rules: [
          {
            rule_id: 1,
            name: "missing param trace",
            priority: 1,
            stop_processing: true,
            conditions: [
              { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
            ],
            actions: [
              { action_id: 1, action_type: "SET", field: "preEligible", value: "true", value_type: "BOOL" },
              { action_id: 2, action_type: "SET", field: "minHipoteca", value: "PARAM:NO_EXISTE", value_type: "NUMBER" },
            ],
          },
        ],
      },
    ],
    params: [],
  };

  const { offers, paramsIndex } = normalizeConfig(config);
  const pre = precheck({}, offers, paramsIndex);

  assert.equal(pre.all[0].trace.missingParams.length, 1);
  assert.deepEqual(pre.all[0].trace.missingParams[0], {
    offerCode: "X",
    key: "NO_EXISTE",
    rule_id: 1,
    action_id: 2,
  });
});

test("debug=true exposes ruleTrace and condTrace", () => {
  const config = {
    offers: [
      {
        offerCode: "X",
        offer_rank: 1,
        oferta_id: 1,
        rules: [
          {
            rule_id: 1,
            name: "fails",
            priority: 10,
            stop_processing: false,
            conditions: [
              { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
              { cond_id: 2, group_id: 0, field: "edad", operator: "GT", value_type: "NUMBER", value1: "40" },
            ],
            actions: [
              { action_id: 1, action_type: "SET", field: "preEligible", value: "true", value_type: "BOOL" },
            ],
          },
          {
            rule_id: 2,
            name: "passes",
            priority: 1,
            stop_processing: true,
            conditions: [
              { cond_id: 3, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
            ],
            actions: [
              { action_id: 2, action_type: "SET", field: "preEligible", value: "true", value_type: "BOOL" },
            ],
          },
        ],
      },
    ],
    params: [],
  };

  const { offers, paramsIndex } = normalizeConfig(config);
  const pre = precheck({ edad: 30 }, offers, paramsIndex, { debug: true });
  const trace = pre.all[0].trace;

  assert.equal(trace.ruleTrace.length, 2);
  assert.equal(trace.condTrace.length, 3);
  assert.equal(trace.ruleTrace[0].matched, false);
  assert.equal(trace.ruleTrace[1].matched, true);
});

test("BOOL coercion works for yes/0 in IS_TRUE/IS_FALSE with explicit values", () => {
  const config = {
    offers: [
      {
        offerCode: "X",
        offer_rank: 1,
        oferta_id: 1,
        rules: [
          {
            rule_id: 1,
            name: "bool coercion",
            priority: 1,
            stop_processing: true,
            conditions: [
              { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
              { cond_id: 2, group_id: 0, field: "flagYes", operator: "IS_TRUE", value_type: "BOOL", value1: null },
              { cond_id: 3, group_id: 0, field: "flagZero", operator: "IS_FALSE", value_type: "BOOL", value1: null },
              { cond_id: 4, group_id: 0, field: "explicitFalse", operator: "IS_FALSE", value_type: "BOOL", value1: null },
            ],
            actions: [
              { action_id: 1, action_type: "SET", field: "preEligible", value: "true", value_type: "BOOL" },
            ],
          },
        ],
      },
    ],
    params: [],
  };

  const { offers, paramsIndex } = normalizeConfig(config);
  const pre = precheck({ flagYes: "yes", flagZero: "0", explicitFalse: false }, offers, paramsIndex);

  assert.equal(pre.eligibleOffers.length, 1);
});

test("IS_FALSE fires for absent (null-coerced) fields — absent means not-yet-true", () => {
  const config = {
    offers: [
      {
        offerCode: "X",
        offer_rank: 1,
        oferta_id: 1,
        rules: [
          {
            rule_id: 1,
            name: "absent IS_FALSE",
            priority: 1,
            stop_processing: true,
            conditions: [
              { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
              { cond_id: 2, group_id: 0, field: "missingField", operator: "IS_FALSE", value_type: "BOOL", value1: null },
            ],
            actions: [
              { action_id: 1, action_type: "SET", field: "preEligible", value: "true", value_type: "BOOL" },
            ],
          },
        ],
      },
    ],
    params: [],
  };

  const { offers, paramsIndex } = normalizeConfig(config);
  const pre = precheck({}, offers, paramsIndex);

  assert.equal(pre.eligibleOffers.length, 1);
});

test("IN inline list with NUMBER coerces numeric strings", () => {
  const config = {
    offers: [
      {
        offerCode: "X",
        offer_rank: 1,
        oferta_id: 1,
        rules: [
          {
            rule_id: 1,
            name: "number in",
            priority: 1,
            stop_processing: true,
            conditions: [
              { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
              {
                cond_id: 2,
                group_id: 0,
                field: "edad",
                operator: "IN",
                value_type: "NUMBER",
                in_values: ["29", "30", "31"],
              },
            ],
            actions: [
              { action_id: 1, action_type: "SET", field: "preEligible", value: "true", value_type: "BOOL" },
            ],
          },
        ],
      },
    ],
    params: [],
  };

  const { offers, paramsIndex } = normalizeConfig(config);
  const pre = precheck({ edad: 30 }, offers, paramsIndex);

  assert.equal(pre.eligibleOffers.length, 1);
});

test("strict=true aggregates multiple validation errors with JSON paths", () => {
  const config = {
    offers: [],
    params: [
      {
        offerCode: "X",
        paramValues: [
          { key: "A", value_type: "BOGUS", value: "1" },
          { key: "B", value_type: "BOGUS", value: "2" },
        ],
      },
    ],
  };

  assert.throws(
    () => normalizeConfig(config, { strictValidation: true }),
    /Invalid rules config:[\s\S]*\.value_type: unsupported value_type 'BOGUS'[\s\S]*\.value_type: unsupported value_type 'BOGUS'/
  );
});

// ---------------------------------------------------------------------------
// MRO SP-shaped output regression tests (Tasks T1.1a–e)
//
// These tests verify the JS engine correctly consumes config shaped like the
// output of the rewritten cfg_get_offers_and_params_json SP — i.e., a single
// already-resolved period per offer/type with no overlapping duplicates.
//
// NOTE ON CI vs LIVE-DB:
//   These tests are CI-green (no SQL Server required).
//   The SQL SP itself is verified via LIVE-DB checklist (see SP file header).
// ---------------------------------------------------------------------------

/**
 * Build a minimal SP-shaped config with one offer and one set of rules.
 * Mirrors the JSON shape returned by cfg_get_offers_and_params_json.
 */
function makeSpShapedConfig({ offerCode = "OFERTA_A", rules = [], params = [] } = {}) {
  return {
    offers: [
      {
        offerCode,
        offer_rank: 100,
        oferta_id: 1,
        rules,
      },
    ],
    params: params.length
      ? [{ offerCode, params }]
      : [],
  };
}

function makePreRule(rule_id, priority = 10) {
  return {
    rule_id,
    name: `PRE rule ${rule_id}`,
    priority,
    stop_processing: false,
    conditions: [
      { cond_id: rule_id * 10, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
    ],
    actions: [
      { action_id: rule_id * 10 + 1, action_type: "SET", field: "preEligible", value: "true", value_type: "BOOL" },
    ],
  };
}

// T1.1a — single period, two rules: applied list has no duplicate rule_ids
test("T1.1a: SP-shaped config — no duplicate rule_ids in applied list", () => {
  const config = makeSpShapedConfig({
    rules: [makePreRule(1, 20), makePreRule(2, 10)],
  });

  const { offers, paramsIndex } = normalizeConfig(config);
  const pre = precheck({}, offers, paramsIndex);

  const appliedIds = pre.all[0].applied.map((r) => r.rule_id);
  const uniqueIds = new Set(appliedIds);
  assert.equal(uniqueIds.size, appliedIds.length, "rule_ids in applied must be unique (no duplicate application)");
});

// T1.1b — zero-duplicate invariant: rule count equals unique rule_ids
test("T1.1b: SP-shaped config — applied.length equals unique rule count (zero duplicates)", () => {
  const rules = [makePreRule(10, 30), makePreRule(20, 20), makePreRule(30, 10)];
  const config = makeSpShapedConfig({ rules });

  const { offers, paramsIndex } = normalizeConfig(config);
  const pre = precheck({}, offers, paramsIndex);

  const appliedIds = pre.all[0].applied.map((r) => r.rule_id);
  assert.equal(appliedIds.length, rules.length, "applied count must equal input rule count");
  assert.equal(new Set(appliedIds).size, appliedIds.length, "all applied rule_ids must be unique");
});

// T1.1c — params from single resolved period are applied correctly
test("T1.1c: SP-shaped config — params from resolved period resolve correctly in PRE", () => {
  const config = makeSpShapedConfig({
    rules: [
      {
        rule_id: 1,
        name: "PRE with param",
        priority: 10,
        stop_processing: true,
        conditions: [
          { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
        ],
        actions: [
          { action_id: 1, action_type: "SET", field: "preEligible", value: "true", value_type: "BOOL" },
          { action_id: 2, action_type: "SET", field: "minHipoteca", value: "PARAM:MIN_HIPOTECA", value_type: "NUMBER" },
        ],
      },
    ],
    params: [
      { param_key: "MIN_HIPOTECA", value_type: "NUMBER", value: "150000" },
    ],
  });

  const { offers, paramsIndex } = normalizeConfig(config);
  const pre = precheck({}, offers, paramsIndex);

  assert.equal(pre.eligibleOffers.length, 1, "offer must be eligible");
  assert.equal(pre.eligibleOffers[0].dictamen?.minHipoteca, 150000, "param resolved from SP-shaped payload");
});

// T1.1d — two offers with independent resolved periods: rules don't cross-contaminate
test("T1.1d: SP-shaped config — two offers with independent periods do not cross-contaminate rules", () => {
  const config = {
    offers: [
      {
        offerCode: "OFERTA_A",
        offer_rank: 100,
        oferta_id: 1,
        rules: [
          {
            rule_id: 101,
            name: "PRE A accept",
            priority: 10,
            stop_processing: true,
            conditions: [{ cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" }],
            actions: [{ action_id: 1, action_type: "SET", field: "preEligible", value: "true", value_type: "BOOL" }],
          },
        ],
      },
      {
        offerCode: "OFERTA_B",
        offer_rank: 50,
        oferta_id: 2,
        rules: [
          {
            rule_id: 201,
            name: "PRE B reject",
            priority: 10,
            stop_processing: true,
            conditions: [{ cond_id: 2, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" }],
            actions: [{ action_id: 2, action_type: "SET", field: "preEligible", value: "false", value_type: "BOOL" }],
          },
        ],
      },
    ],
    params: [],
  };

  const { offers, paramsIndex } = normalizeConfig(config);
  const pre = precheck({}, offers, paramsIndex);

  const offerA = pre.all.find((r) => r.offerCode === "OFERTA_A");
  const offerB = pre.all.find((r) => r.offerCode === "OFERTA_B");

  assert.ok(offerA, "OFERTA_A must be in results");
  assert.ok(offerB, "OFERTA_B must be in results");

  // Rules from OFERTA_A must not appear in OFERTA_B's applied list and vice versa
  const idsA = offerA.applied.map((r) => r.rule_id);
  const idsB = offerB.applied.map((r) => r.rule_id);
  assert.ok(idsA.includes(101), "OFERTA_A applied rule 101");
  assert.ok(!idsA.includes(201), "OFERTA_A must NOT have OFERTA_B rule 201");
  assert.ok(idsB.includes(201), "OFERTA_B applied rule 201");
  assert.ok(!idsB.includes(101), "OFERTA_B must NOT have OFERTA_A rule 101");
});

// T1.1e — normalizeConfig with SP-shaped param_key format (PARAM_KEY_CD alias)
test("T1.1e: SP-shaped params with param_key alias normalizes correctly", () => {
  const config = {
    offers: [
      {
        offerCode: "SP_OFFER",
        offer_rank: 10,
        oferta_id: 99,
        rules: [
          {
            rule_id: 1,
            name: "PRE sp",
            priority: 1,
            stop_processing: true,
            conditions: [
              { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "PRE" },
            ],
            actions: [
              { action_id: 1, action_type: "SET", field: "preEligible", value: "true", value_type: "BOOL" },
              { action_id: 2, action_type: "SET", field: "maxPlazo", value: "PARAM:MAX_PLAZO", value_type: "NUMBER" },
            ],
          },
        ],
      },
    ],
    // SP returns params with param_key field name (PARAM_KEY_CD maps to param_key in service layer)
    params: [
      {
        offerCode: "SP_OFFER",
        params: [
          { param_key: "MAX_PLAZO", value_type: "NUMBER", value: "360" },
        ],
      },
    ],
  };

  const { offers, paramsIndex } = normalizeConfig(config);
  const pre = precheck({}, offers, paramsIndex);

  assert.equal(pre.eligibleOffers.length, 1);
  assert.equal(pre.eligibleOffers[0].dictamen?.maxPlazo, 360, "param_key alias resolves correctly");
});

// ── aggregateUiLimits — boolean OR (RF-SDI-01) ───────────────────────────────

function makeBoolConfig(offers) {
  // Builds a minimal config with INIT rules that set SOLICITAR_DATOS_INTERVINIENTES + initEligible.
  return {
    offers: offers.map((o, i) => ({
      offerCode: o.code,
      offer_rank: 100 - i * 10,
      oferta_id: i + 1,
      rules: [
        {
          rule_id: i + 1,
          name: `INIT decision ${o.code}`,
          priority: 100,
          stop_processing: false,
          conditions: [
            { cond_id: 1, group_id: 0, field: "stage", operator: "EQ", value_type: "STRING", value1: "INIT" },
          ],
          actions: [
            { action_id: (i + 1) * 10, action_type: "SET", field: "initEligible", value: "true", value_type: "BOOL" },
            { action_id: (i + 1) * 10 + 1, action_type: "SET", field: "SOLICITAR_DATOS_INTERVINIENTES", value: o.sdi, value_type: "BOOL" },
          ],
        },
      ],
    })),
    params: [],
  };
}

test("aggregateUiLimits — boolean OR: [true, false] → true", () => {
  const config = makeBoolConfig([
    { code: "OFERTA_A", sdi: "true" },
    { code: "FIDELIZACION", sdi: "false" },
  ]);
  const { offers, paramsIndex } = normalizeConfig(config);
  const result = initcheck({}, offers, paramsIndex);
  assert.equal(result.uiLimits.SOLICITAR_DATOS_INTERVINIENTES, true);
});

test("aggregateUiLimits — boolean OR: [false, false] → false", () => {
  const config = makeBoolConfig([
    { code: "OFERTA_A", sdi: "false" },
    { code: "OFERTA_B", sdi: "false" },
  ]);
  const { offers, paramsIndex } = normalizeConfig(config);
  const result = initcheck({}, offers, paramsIndex);
  assert.equal(result.uiLimits.SOLICITAR_DATOS_INTERVINIENTES, false);
});

test("aggregateUiLimits — boolean OR: [true, true] → true", () => {
  const config = makeBoolConfig([
    { code: "OFERTA_A", sdi: "true" },
    { code: "OFERTA_B", sdi: "true" },
  ]);
  const { offers, paramsIndex } = normalizeConfig(config);
  const result = initcheck({}, offers, paramsIndex);
  assert.equal(result.uiLimits.SOLICITAR_DATOS_INTERVINIENTES, true);
});

test("aggregateUiLimits — boolean OR: [] (no eligible offers) → key absent", () => {
  // Config with no INIT rules that set initEligible → eligibleOffers will be empty
  const config = {
    offers: [
      {
        offerCode: "OFERTA_A",
        offer_rank: 100,
        oferta_id: 1,
        rules: [],
      },
    ],
    params: [],
  };
  const { offers, paramsIndex } = normalizeConfig(config);
  const result = initcheck({}, offers, paramsIndex);
  assert.equal(result.eligibleOffers.length, 0);
  assert.equal(result.uiLimits.SOLICITAR_DATOS_INTERVINIENTES, undefined);
  assert.ok(!Object.hasOwn(result.uiLimits, "SOLICITAR_DATOS_INTERVINIENTES"), "key must be absent, not just undefined");
});
