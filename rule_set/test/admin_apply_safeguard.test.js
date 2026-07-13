/**
 * test/admin_apply_safeguard.test.js — TDD tests for the OWASP-02 apply safeguard
 * (confirmReplaceAll + read-only preview endpoint).
 *
 * Follows the patterns already established in this repo:
 *   - Unit tests (no DB, no live Express app): fake req/res/next, direct
 *     function calls — same style as test/require_role.test.js.
 *   - Integration tests (real SQL pool + own tx + rollback/cleanup in
 *     finally): same style as test/admin_offer_cascade_delete.test.js and
 *     test/admin_offers_period.test.js. Skips cleanly when SQL credentials
 *     are absent ({ skip: !hasSqlCredentials() }).
 *
 * Spec ref: openspec/changes/rbac-and-config-safeguards/specs/config-apply-safeguard/spec.md
 * Design ref: openspec/changes/rbac-and-config-safeguards/design.md
 *   § "Apply seguro (OWASP-02)", § "computeApplyImpact — read-only"
 */

import test from "node:test";
import assert from "node:assert/strict";

import { AppError } from "../api/utils/app_error.js";
import { hasSqlCredentials } from "../api/config/env.js";
import { getSqlPool, sql } from "../api/db/sql_client.js";

// ---------------------------------------------------------------------------
// Imports from the controller/service under test — RED until WU-6 implements
// validateApplyPayload's confirmReplaceAll gate, validatePreviewPayload,
// postAdminApplyPreview, and computeApplyImpact.
// ---------------------------------------------------------------------------
const {
  postAdminApply,
  postAdminApplyPreview,
  validateApplyPayload,
  validatePreviewPayload,
} = await import("../api/controllers/admin_apply_controller.js");

// deriveApplyScope — RED until the code-review fix extracts this shared helper
// (Bug A + Bug B root cause). Pure/synchronous, no DB — imported statically so
// its unit tests below never touch SQL.
const { deriveApplyScope } = await import("../api/services/admin_service.js");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function validRule(offerCode = "TEST_OFFER") {
  return {
    offerCode,
    rule_name: "Test rule",
    priority: 100,
    enabled: true,
    stop_processing: false,
    conditions: [
      { group_id: 1, left_operand: "stage", operator: "EQ", value_type: "STRING", right_operand: "INIT" },
    ],
    actions: [
      { action_type: "SET", action_payload: { field: "initRejected", value: "true", value_type: "BOOL" } },
    ],
  };
}

function validPayload(overrides = {}) {
  return {
    rules: [validRule()],
    comment: "Motivo de prueba",
    confirmReplaceAll: true,
    ...overrides,
  };
}

/** Runs a controller handler with a fake req/res/next; returns { err, status, body }. */
async function runHandler(handler, body) {
  let capturedErr;
  let status;
  let jsonBody;
  const req = { body };
  const res = {
    status(code) {
      status = code;
      return this;
    },
    json(payload) {
      jsonBody = payload;
      return this;
    },
  };
  const next = (err) => {
    capturedErr = err;
  };
  await handler(req, res, next);
  return { err: capturedErr, status, body: jsonBody };
}

// ---------------------------------------------------------------------------
// Unit (no DB) — validateApplyPayload: confirmReplaceAll gate
// ---------------------------------------------------------------------------

test("validateApplyPayload: confirmReplaceAll ausente -> AppError 400", () => {
  const payload = validPayload();
  delete payload.confirmReplaceAll;
  assert.throws(
    () => validateApplyPayload(payload),
    (err) => err instanceof AppError && err.statusCode === 400
  );
});

test("validateApplyPayload: confirmReplaceAll:false -> AppError 400", () => {
  const payload = validPayload({ confirmReplaceAll: false });
  assert.throws(
    () => validateApplyPayload(payload),
    (err) => err instanceof AppError && err.statusCode === 400
  );
});

test("validateApplyPayload: confirmReplaceAll:true pero comment ausente -> AppError 400 (validacion existente sigue aplicando)", () => {
  const payload = validPayload();
  delete payload.comment;
  assert.throws(
    () => validateApplyPayload(payload),
    (err) => err instanceof AppError && err.statusCode === 400
  );
});

test("validateApplyPayload: confirmReplaceAll:true pero comment vacio -> AppError 400", () => {
  const payload = validPayload({ comment: "   " });
  assert.throws(
    () => validateApplyPayload(payload),
    (err) => err instanceof AppError && err.statusCode === 400
  );
});

test("validateApplyPayload: payload valido (confirmReplaceAll:true + comment + rules) no lanza", () => {
  assert.doesNotThrow(() => validateApplyPayload(validPayload()));
});

// ---------------------------------------------------------------------------
// Unit (no DB) — postAdminApply controller: 400 fires before any DB access
// (validateApplyPayload throws synchronously before createSnapshot/applyConfig
// are ever awaited, so these run without SQL credentials).
// ---------------------------------------------------------------------------

test("postAdminApply: confirmReplaceAll ausente -> next(AppError 400), sin llegar a crear snapshot", async () => {
  const payload = validPayload();
  delete payload.confirmReplaceAll;
  const { err } = await runHandler(postAdminApply, payload);
  assert.ok(err instanceof AppError, "se esperaba AppError");
  assert.equal(err.statusCode, 400);
});

test("postAdminApply: confirmReplaceAll:false -> next(AppError 400)", async () => {
  const { err } = await runHandler(postAdminApply, validPayload({ confirmReplaceAll: false }));
  assert.ok(err instanceof AppError, "se esperaba AppError");
  assert.equal(err.statusCode, 400);
});

test("postAdminApply: confirmReplaceAll:true pero sin comment -> next(AppError 400)", async () => {
  const payload = validPayload();
  delete payload.comment;
  const { err } = await runHandler(postAdminApply, payload);
  assert.ok(err instanceof AppError, "se esperaba AppError");
  assert.equal(err.statusCode, 400);
});

// ---------------------------------------------------------------------------
// Unit (no DB) — validatePreviewPayload / postAdminApplyPreview: rejects
// malformed `rules` with 400, without requiring comment/confirmReplaceAll.
// ---------------------------------------------------------------------------

test("validatePreviewPayload: sin rules -> AppError 400", () => {
  assert.throws(
    () => validatePreviewPayload({}),
    (err) => err instanceof AppError && err.statusCode === 400
  );
});

test("validatePreviewPayload: rules no es array -> AppError 400", () => {
  assert.throws(
    () => validatePreviewPayload({ rules: "not-an-array" }),
    (err) => err instanceof AppError && err.statusCode === 400
  );
});

test("validatePreviewPayload: payload valido SIN comment ni confirmReplaceAll no lanza", () => {
  assert.doesNotThrow(() => validatePreviewPayload({ rules: [validRule()] }));
});

test("postAdminApplyPreview: rules ausente -> next(AppError 400)", async () => {
  const { err } = await runHandler(postAdminApplyPreview, {});
  assert.ok(err instanceof AppError, "se esperaba AppError");
  assert.equal(err.statusCode, 400);
});

// ---------------------------------------------------------------------------
// Unit (no DB) — deriveApplyScope: shared scope derivation used by BOTH
// applyConfig and computeApplyImpact (code review, 2026-07-13). Pure/sync —
// no SQL pool touched, so these are genuinely environment-independent,
// unlike the integration-level computeApplyImpact tests further below.
//
// Bug A root cause: computeApplyImpact used to run a params-count query for
// every offer even when payload.params was entirely absent. Fix: the shared
// helper only derives paramOfferCodes / paramPeriodIdsCsv when
// Array.isArray(payload.params); callers must check `hasParams` before
// querying/deleting params.
//
// Bug B root cause: computeApplyImpact only iterated offerCodes (from
// payload.rules), so an offerCode present ONLY in payload.params (no rules
// entries for it) was invisible to the preview. Fix: the helper separately
// exposes paramOfferCodes so callers can iterate the union.
// ---------------------------------------------------------------------------

test("deriveApplyScope: payload sin 'params' -> paramOfferCodes vacio y hasParams:false (Bug A)", () => {
  const scope = deriveApplyScope({ rules: [validRule("OFERTA_A")] }, { deleteAllPeriods: true });
  assert.equal(scope.hasParams, false);
  assert.deepEqual(scope.paramOfferCodes, []);
  assert.deepEqual(scope.offerCodes, ["OFERTA_A"]);
});

test("deriveApplyScope: 'params' referencia un offerCode ausente en 'rules' -> paramOfferCodes lo incluye (Bug B)", () => {
  const payload = {
    rules: [validRule("OFERTA_A")],
    params: [
      { offerCode: "OFERTA_B", paramValues: [{ key: "K", value: "1", value_type: "NUMBER" }] },
    ],
  };
  const scope = deriveApplyScope(payload, { deleteAllPeriods: true });
  assert.equal(scope.hasParams, true);
  assert.deepEqual(scope.offerCodes, ["OFERTA_A"]);
  assert.deepEqual(scope.paramOfferCodes, ["OFERTA_B"]);
});

// ---------------------------------------------------------------------------
// Integration (skip sin SQL) — seed helpers
// ---------------------------------------------------------------------------

async function seedRuleset(tx, code, rank = 1, enabled = 1) {
  const req = tx.request();
  req.input("code", sql.NVarChar(50), code);
  req.input("name", sql.NVarChar(200), `Test Oferta ${code}`);
  req.input("rank", sql.Int, rank);
  req.input("ofertaId", sql.Int, 0);
  req.input("enabled", sql.Bit, enabled);
  const result = await req.query(`
    INSERT INTO dbo.cfg_offer_ruleset (code, name, offer_rank, enabled, oferta_id)
    OUTPUT INSERTED.ruleset_id
    VALUES (@code, @name, @rank, @enabled, @ofertaId)
  `);
  return result.recordset[0].ruleset_id;
}

async function seedOfferDate(tx, validFrom = "2099-01-01") {
  const req = tx.request();
  req.input("validFrom", sql.DateTime2(0), new Date(validFrom));
  const result = await req.query(`
    INSERT INTO dbo.cfg_offer_dates (valid_from, valid_to, descripcion, tipo_cd)
    OUTPUT INSERTED.offer_date_id
    VALUES (@validFrom, NULL, 'Test period', 'AMBOS')
  `);
  return result.recordset[0].offer_date_id;
}

async function seedRule(tx, rulesetId, offerDateId, suffix = "") {
  const ruleReq = tx.request();
  ruleReq.input("rulesetId", sql.Int, rulesetId);
  ruleReq.input("offerDateId", sql.Int, offerDateId);
  ruleReq.input("name", sql.NVarChar(200), `Test rule${suffix}`);
  const ruleResult = await ruleReq.query(`
    INSERT INTO dbo.cfg_offer_rule (ruleset_id, name, priority, enabled, offer_date_id, stop_processing)
    OUTPUT INSERTED.rule_id
    VALUES (@rulesetId, @name, 100, 1, @offerDateId, 0)
  `);
  return ruleResult.recordset[0].rule_id;
}

async function seedParam(tx, rulesetId, offerDateId, keyName = "TEST_PARAM", enabled = 1) {
  const req = tx.request();
  req.input("rulesetId", sql.Int, rulesetId);
  req.input("offerDateId", sql.Int, offerDateId);
  req.input("key", sql.NVarChar(100), keyName);
  req.input("enabled", sql.Bit, enabled);
  const result = await req.query(`
    INSERT INTO dbo.cfg_offer_param (ruleset_id, param_key, value_type, value, offer_date_id, enabled)
    OUTPUT INSERTED.param_id
    VALUES (@rulesetId, @key, 'NUMBER', '42', @offerDateId, @enabled)
  `);
  return result.recordset[0].param_id;
}

/** Cleans up everything seeded for a ruleset — raw deletes, NOT deleteOffer
 *  (which would create an extra automatic snapshot and pollute the count
 *  assertions of these tests). */
async function cleanupRuleset(pool, rulesetId) {
  await pool.request().input("rulesetId", sql.Int, rulesetId).query(`
    DELETE cv
    FROM dbo.cfg_offer_rule_condition_value cv
    INNER JOIN dbo.cfg_offer_rule_condition c ON c.cond_id = cv.cond_id
    INNER JOIN dbo.cfg_offer_rule r ON r.rule_id = c.rule_id
    WHERE r.ruleset_id = @rulesetId
  `);
  await pool.request().input("rulesetId", sql.Int, rulesetId).query(`
    DELETE c FROM dbo.cfg_offer_rule_condition c
    INNER JOIN dbo.cfg_offer_rule r ON r.rule_id = c.rule_id
    WHERE r.ruleset_id = @rulesetId
  `);
  await pool.request().input("rulesetId", sql.Int, rulesetId).query(`
    DELETE a FROM dbo.cfg_offer_rule_action a
    INNER JOIN dbo.cfg_offer_rule r ON r.rule_id = a.rule_id
    WHERE r.ruleset_id = @rulesetId
  `);
  await pool.request().input("rulesetId", sql.Int, rulesetId).query(`
    DELETE FROM dbo.cfg_offer_rule WHERE ruleset_id = @rulesetId
  `);
  await pool.request().input("rulesetId", sql.Int, rulesetId).query(`
    DELETE FROM dbo.cfg_offer_param WHERE ruleset_id = @rulesetId
  `);
  await pool.request().input("rulesetId", sql.Int, rulesetId).query(`
    DELETE FROM dbo.cfg_offer_ruleset WHERE ruleset_id = @rulesetId
  `);
}

async function countSnapshots(pool) {
  const r = await pool.request().query(`SELECT COUNT(*) AS cnt FROM dbo.cfg_config_snapshot`);
  return r.recordset[0].cnt;
}

async function countRulesForRuleset(pool, rulesetId) {
  const r = await pool.request().input("rulesetId", sql.Int, rulesetId).query(`
    SELECT COUNT(*) AS cnt FROM dbo.cfg_offer_rule WHERE ruleset_id = @rulesetId
  `);
  return r.recordset[0].cnt;
}

async function countParamsForRuleset(pool, rulesetId) {
  const r = await pool.request().input("rulesetId", sql.Int, rulesetId).query(`
    SELECT COUNT(*) AS cnt FROM dbo.cfg_offer_param WHERE ruleset_id = @rulesetId AND enabled = 1
  `);
  return r.recordset[0].cnt;
}

// ---------------------------------------------------------------------------
// Integration (skip sin SQL) — postAdminApply: 200 + snapshot_id cuando
// confirmReplaceAll:true y payload valido
// ---------------------------------------------------------------------------

test(
  "postAdminApply: confirmReplaceAll:true y payload valido -> 200 con snapshot_id",
  { skip: !hasSqlCredentials() },
  async () => {
    const { computeApplyImpact } = await import("../api/services/admin_service.js");
    void computeApplyImpact; // referenced to satisfy WU-5 RED for the export existing
    const pool = await getSqlPool();
    const code = `TEST_APPLY_${Date.now()}`;
    let rulesetId = null;
    let createdSnapshotId = null;

    try {
      const tx = new sql.Transaction(pool);
      await tx.begin();
      rulesetId = await seedRuleset(tx, code, 5);
      const offerDateId = await seedOfferDate(tx, "2099-04-01");
      await seedRule(tx, rulesetId, offerDateId, "_seed");
      await tx.commit();

      const snapshotCountBefore = await countSnapshots(pool);

      const payload = validPayload({ rules: [validRule(code)], comment: "Grabacion de prueba T-05" });
      const { status, body } = await runHandler(postAdminApply, payload);

      assert.equal(status, 200, "debe responder 200");
      assert.ok(body?.snapshot_id, "debe incluir snapshot_id en la respuesta");
      createdSnapshotId = body.snapshot_id;

      const snapshotCountAfter = await countSnapshots(pool);
      assert.equal(snapshotCountAfter, snapshotCountBefore + 1, "debe crearse exactamente 1 snapshot nuevo");
    } finally {
      if (rulesetId) {
        await cleanupRuleset(pool, rulesetId).catch(() => {});
      }
      if (createdSnapshotId) {
        await pool.request().input("id", sql.Int, createdSnapshotId)
          .query(`DELETE FROM dbo.cfg_config_snapshot WHERE snapshot_id = @id`)
          .catch(() => {});
      }
    }
  }
);

// ---------------------------------------------------------------------------
// Integration (skip sin SQL) — computeApplyImpact: conteos correctos,
// idempotente/repetible, sin efectos secundarios (no escribe, no crea snapshot).
// ---------------------------------------------------------------------------

test(
  "computeApplyImpact: conteos por offerCode correctos, idempotente y sin efectos secundarios",
  { skip: !hasSqlCredentials() },
  async () => {
    const { computeApplyImpact } = await import("../api/services/admin_service.js");
    const pool = await getSqlPool();
    const code = `TEST_PREVIEW_${Date.now()}`;
    let rulesetId = null;

    try {
      const tx = new sql.Transaction(pool);
      await tx.begin();
      rulesetId = await seedRuleset(tx, code, 5);
      const offerDateId = await seedOfferDate(tx, "2099-05-01");
      await seedRule(tx, rulesetId, offerDateId, "_existing1");
      await seedRule(tx, rulesetId, offerDateId, "_existing2");
      await seedParam(tx, rulesetId, offerDateId, "EXISTING_PARAM");
      await tx.commit();

      const rulesBefore = await countRulesForRuleset(pool, rulesetId);
      const paramsBefore = await countParamsForRuleset(pool, rulesetId);
      const snapshotCountBefore = await countSnapshots(pool);

      const payload = {
        rules: [validRule(code), validRule(code)],
        params: [
          {
            offerCode: code,
            paramValues: [
              { key: "NEW_PARAM_A", value: "1", value_type: "NUMBER" },
              { key: "NEW_PARAM_B", value: "2", value_type: "NUMBER" },
              { key: "NEW_PARAM_A", value: "1-dup", value_type: "NUMBER" }, // duplicate key — must be deduped
            ],
          },
        ],
      };

      const impact1 = await computeApplyImpact(payload, { deleteAllPeriods: true });
      const impact2 = await computeApplyImpact(payload, { deleteAllPeriods: true });

      assert.deepEqual(impact1, impact2, "llamadas repetidas deben devolver conteos identicos (idempotente)");

      assert.deepEqual(impact1.offerCodes, [code]);
      assert.equal(impact1.rulesToDelete, 2, "debe contar las 2 reglas existentes sembradas");
      assert.equal(impact1.paramsToDelete, 1, "debe contar el param existente habilitado");
      assert.equal(impact1.rulesToInsert, 2, "debe contar las 2 reglas del payload");
      assert.equal(impact1.paramsToInsert, 2, "debe deduplicar por key (3 params -> 2 unicos)");

      assert.equal(impact1.perOffer.length, 1);
      assert.equal(impact1.perOffer[0].offerCode, code);
      assert.equal(impact1.perOffer[0].rulesToDelete, 2);
      assert.equal(impact1.perOffer[0].paramsToDelete, 1);
      assert.equal(impact1.perOffer[0].rulesToInsert, 2);
      assert.equal(impact1.perOffer[0].paramsToInsert, 2);

      // No side effects: DB state unchanged, no snapshot created.
      const rulesAfter = await countRulesForRuleset(pool, rulesetId);
      const paramsAfter = await countParamsForRuleset(pool, rulesetId);
      const snapshotCountAfter = await countSnapshots(pool);
      assert.equal(rulesAfter, rulesBefore, "computeApplyImpact NO debe modificar las reglas existentes");
      assert.equal(paramsAfter, paramsBefore, "computeApplyImpact NO debe modificar los params existentes");
      assert.equal(snapshotCountAfter, snapshotCountBefore, "computeApplyImpact NO debe crear ningun snapshot");
    } finally {
      if (rulesetId) {
        await cleanupRuleset(pool, rulesetId).catch(() => {});
      }
    }
  }
);

test(
  "computeApplyImpact: offerCode inexistente propaga 404 (misma semantica que applyConfig)",
  { skip: !hasSqlCredentials() },
  async () => {
    const { computeApplyImpact } = await import("../api/services/admin_service.js");
    const payload = { rules: [validRule(`NO_EXISTE_${Date.now()}`)] };
    await assert.rejects(
      () => computeApplyImpact(payload, { deleteAllPeriods: true }),
      (err) => err instanceof AppError && err.statusCode === 404
    );
  }
);

// ---------------------------------------------------------------------------
// Integration (skip sin SQL) — Bug A: payload solo con 'rules' (sin 'params')
// no debe contar params a borrar (antes del fix, computeApplyImpact corria la
// query de conteo de params incondicionalmente para cada offer).
// ---------------------------------------------------------------------------

test(
  "computeApplyImpact: payload solo con 'rules' (sin 'params') -> paramsToDelete:0 en total y por oferta (Bug A)",
  { skip: !hasSqlCredentials() },
  async () => {
    const { computeApplyImpact } = await import("../api/services/admin_service.js");
    const pool = await getSqlPool();
    const code = `TEST_BUGA_${Date.now()}`;
    let rulesetId = null;

    try {
      const tx = new sql.Transaction(pool);
      await tx.begin();
      rulesetId = await seedRuleset(tx, code, 5);
      const offerDateId = await seedOfferDate(tx, "2099-06-01");
      await seedRule(tx, rulesetId, offerDateId, "_existing");
      // Existing ENABLED params for this offer — a rules-only apply must NOT
      // report these as "to delete", since applyConfig's params block is
      // entirely skipped when payload.params is absent.
      await seedParam(tx, rulesetId, offerDateId, "EXISTING_PARAM_A");
      await seedParam(tx, rulesetId, offerDateId, "EXISTING_PARAM_B");
      await tx.commit();

      // No 'params' key at all — mirrors a "rules-only" apply from the UI.
      const payload = { rules: [validRule(code)] };

      const impact = await computeApplyImpact(payload, { deleteAllPeriods: true });

      assert.equal(impact.paramsToDelete, 0, "total paramsToDelete debe ser 0 sin 'params' en el payload");
      assert.equal(impact.paramsToInsert, 0, "total paramsToInsert debe ser 0 sin 'params' en el payload");
      assert.equal(impact.perOffer.length, 1);
      assert.equal(impact.perOffer[0].offerCode, code);
      assert.equal(impact.perOffer[0].paramsToDelete, 0, "perOffer paramsToDelete debe ser 0 para la unica oferta");
      assert.equal(impact.perOffer[0].paramsToInsert, 0);
      // rulesToDelete IS still counted — unaffected by the params guard.
      assert.equal(impact.perOffer[0].rulesToDelete, 1);
    } finally {
      if (rulesetId) {
        await cleanupRuleset(pool, rulesetId).catch(() => {});
      }
    }
  }
);

// ---------------------------------------------------------------------------
// Integration (skip sin SQL) — Bug B: un offerCode presente SOLO en 'params'
// (sin entradas en 'rules') debe aparecer en perOffer con sus conteos reales
// (antes del fix, el loop solo iteraba offerCodes derivado de payload.rules,
// dejando este offerCode invisible pese a que applyConfig SI le tocaria los
// params).
// ---------------------------------------------------------------------------

test(
  "computeApplyImpact: offerCode presente solo en 'params' (sin 'rules') aparece en perOffer con conteos reales (Bug B)",
  { skip: !hasSqlCredentials() },
  async () => {
    const { computeApplyImpact } = await import("../api/services/admin_service.js");
    const pool = await getSqlPool();
    const codeWithRules = `TEST_BUGB_RULES_${Date.now()}`;
    const codeParamsOnly = `TEST_BUGB_PARAMS_${Date.now()}`;
    let rulesetIdRules = null;
    let rulesetIdParamsOnly = null;

    try {
      const tx = new sql.Transaction(pool);
      await tx.begin();
      rulesetIdRules = await seedRuleset(tx, codeWithRules, 5);
      rulesetIdParamsOnly = await seedRuleset(tx, codeParamsOnly, 6);
      const offerDateId = await seedOfferDate(tx, "2099-07-01");
      await seedRule(tx, rulesetIdRules, offerDateId, "_existing");
      // Existing enabled param for the offer that has NO rules in the payload.
      await seedParam(tx, rulesetIdParamsOnly, offerDateId, "EXISTING_PARAM_ONLY");
      await tx.commit();

      const payload = {
        rules: [validRule(codeWithRules)],
        params: [
          {
            offerCode: codeParamsOnly,
            paramValues: [
              { key: "NEW_PARAM_X", value: "1", value_type: "NUMBER" },
              { key: "NEW_PARAM_Y", value: "2", value_type: "NUMBER" },
            ],
          },
        ],
      };

      const impact = await computeApplyImpact(payload, { deleteAllPeriods: true });

      // Top-level totals must include the params-only offer's counts.
      assert.equal(impact.paramsToDelete, 1, "debe contar el param existente de la oferta solo-params");
      assert.equal(impact.paramsToInsert, 2, "debe contar los 2 params nuevos de la oferta solo-params");
      assert.ok(
        impact.offerCodes.includes(codeParamsOnly),
        "el offerCode solo-params debe aparecer en el listado top-level de offerCodes afectados"
      );

      const paramsOnlyEntry = impact.perOffer.find((o) => o.offerCode === codeParamsOnly);
      assert.ok(paramsOnlyEntry, "la oferta solo-params debe tener su propia entrada en perOffer");
      assert.equal(paramsOnlyEntry.rulesToDelete, 0, "no tiene reglas en el payload -> 0 a borrar");
      assert.equal(paramsOnlyEntry.rulesToInsert, 0, "no tiene reglas en el payload -> 0 a insertar");
      assert.equal(paramsOnlyEntry.paramsToDelete, 1);
      assert.equal(paramsOnlyEntry.paramsToInsert, 2);

      const rulesEntry = impact.perOffer.find((o) => o.offerCode === codeWithRules);
      assert.ok(rulesEntry, "la oferta con reglas debe seguir apareciendo en perOffer");
      assert.equal(rulesEntry.rulesToDelete, 1);
      assert.equal(rulesEntry.paramsToDelete, 0, "esta oferta no tiene grupo en 'params' -> 0 a borrar");
    } finally {
      if (rulesetIdRules) {
        await cleanupRuleset(pool, rulesetIdRules).catch(() => {});
      }
      if (rulesetIdParamsOnly) {
        await cleanupRuleset(pool, rulesetIdParamsOnly).catch(() => {});
      }
    }
  }
);

// ---------------------------------------------------------------------------
// Integration (skip sin SQL) — Code review fix 1 (2026-07-14): computeApplyImpact's
// preview resolver diverged from applyConfig's real write path.
//
// computeApplyImpact resolved EVERY offerCode in `allOfferCodes` via
// findRulesetIdByOfferCode (WHERE enabled = 1, 404 otherwise). But applyConfig's
// params disable/insert loops resolve offerCodes drawn from `payload.params` via
// resolveRulesetId (no enabled filter). Consequence: a payload whose `params`
// references an offerCode with NO corresponding `payload.rules` entries, whose
// ruleset currently has enabled = 0, made the preview 404 while the real apply
// would succeed — permanently blocking a legitimate save, since the frontend
// gates the confirm button on the preview succeeding.
//
// Fix: computeApplyImpact now resolves a code present in `offerCodes` (i.e. it
// has rules in the payload) via findRulesetIdByOfferCode (matches applyConfig's
// rulesetIdCache build loop, which 404s on disabled offers with rules), and a
// code present ONLY in `paramOfferCodes` via resolveRulesetId (matches
// applyConfig's params-only resolution, which does not filter on enabled).
// ---------------------------------------------------------------------------

test(
  "computeApplyImpact: offerCode solo en 'params' con ruleset enabled=0 NO debe dar 404 (Fix 1, preview/apply resolver divergence)",
  { skip: !hasSqlCredentials() },
  async () => {
    const { computeApplyImpact } = await import("../api/services/admin_service.js");
    const pool = await getSqlPool();
    const codeWithRules = `TEST_FIX1_RULES_${Date.now()}`;
    const codeParamsOnlyDisabled = `TEST_FIX1_DISABLED_${Date.now()}`;
    let rulesetIdRules = null;
    let rulesetIdDisabled = null;

    try {
      const tx = new sql.Transaction(pool);
      await tx.begin();
      rulesetIdRules = await seedRuleset(tx, codeWithRules, 5, 1);
      // enabled = 0 — this offer is disabled, but only referenced via `params`,
      // never via `rules`, in the payload below.
      rulesetIdDisabled = await seedRuleset(tx, codeParamsOnlyDisabled, 6, 0);
      const offerDateId = await seedOfferDate(tx, "2099-08-01");
      await seedRule(tx, rulesetIdRules, offerDateId, "_existing");
      await seedParam(tx, rulesetIdDisabled, offerDateId, "EXISTING_PARAM_DISABLED");
      await tx.commit();

      const payload = {
        rules: [validRule(codeWithRules)],
        params: [
          {
            offerCode: codeParamsOnlyDisabled,
            paramValues: [{ key: "NEW_PARAM", value: "1", value_type: "NUMBER" }],
          },
        ],
      };

      // Must NOT throw — applyConfig would succeed for this same payload
      // (its params loop resolves codeParamsOnlyDisabled via resolveRulesetId,
      // which has no enabled filter).
      const impact = await computeApplyImpact(payload, { deleteAllPeriods: true });

      const disabledEntry = impact.perOffer.find((o) => o.offerCode === codeParamsOnlyDisabled);
      assert.ok(disabledEntry, "la oferta deshabilitada (solo-params) debe aparecer en perOffer, no dar 404");
      assert.equal(disabledEntry.paramsToDelete, 1, "debe contar el param existente habilitado de la oferta deshabilitada");
      assert.equal(disabledEntry.paramsToInsert, 1);
    } finally {
      if (rulesetIdRules) {
        await cleanupRuleset(pool, rulesetIdRules).catch(() => {});
      }
      if (rulesetIdDisabled) {
        await cleanupRuleset(pool, rulesetIdDisabled).catch(() => {});
      }
    }
  }
);

test(
  "computeApplyImpact: offerCode inexistente presente SOLO en 'params' (ninguna ruleset con ese code) sigue propagando 404 (Fix 1 regression guard)",
  { skip: !hasSqlCredentials() },
  async () => {
    const { computeApplyImpact } = await import("../api/services/admin_service.js");
    const payload = {
      rules: [validRule(`TEST_FIX1_EXISTS_${Date.now()}`)],
      params: [
        {
          offerCode: `NO_EXISTE_PARAMS_ONLY_${Date.now()}`,
          paramValues: [{ key: "K", value: "1", value_type: "NUMBER" }],
        },
      ],
    };
    // The rules-referenced offer above also doesn't exist in the DB in this
    // test (no seeding), so this exercises the "truly not found, neither in
    // rules nor params, anywhere" 404 path for both resolvers used by
    // computeApplyImpact — must still 404, same as applyConfig would.
    await assert.rejects(
      () => computeApplyImpact(payload, { deleteAllPeriods: true }),
      (err) => err instanceof AppError && err.statusCode === 404
    );
  }
);

// ---------------------------------------------------------------------------
// Code review fix 2 (2026-07-14): the "dedupe params by key within a group,
// first-seen wins" logic was hand-duplicated as two separate inline
// `seenKeys` blocks (applyConfig's insert loop, computeApplyImpact's count
// loop). Extracted into a single shared `dedupeParamsByKey` helper, called
// from both. Pure/sync — no SQL — genuinely environment-independent.
// ---------------------------------------------------------------------------

test("dedupeParamsByKey: conserva el primer valor visto por key y descarta duplicados posteriores", async () => {
  const { dedupeParamsByKey } = await import("../api/services/admin_service.js");
  const paramValues = [
    { key: "A", value: "first" },
    { key: "B", value: "only" },
    { key: "A", value: "duplicate-should-be-dropped" },
  ];
  const result = dedupeParamsByKey(paramValues);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((p) => p.key), ["A", "B"]);
  assert.equal(result[0].value, "first", "el primer valor visto para una key duplicada debe ganar");
});

test("dedupeParamsByKey: array vacio o ausente no lanza y devuelve []", async () => {
  const { dedupeParamsByKey } = await import("../api/services/admin_service.js");
  assert.deepEqual(dedupeParamsByKey([]), []);
  assert.deepEqual(dedupeParamsByKey(undefined), []);
});

// ---------------------------------------------------------------------------
// Integration (skip sin SQL) — regression guard: applyConfig (real write) and
// computeApplyImpact (preview) must agree on the deduped param count for the
// SAME payload, now that both delegate to the shared dedupeParamsByKey helper.
// A future re-divergence (e.g. someone re-inlining a slightly different
// seenKeys block in only one of the two call sites) would make this fail.
// ---------------------------------------------------------------------------

test(
  "applyConfig y computeApplyImpact coinciden en el conteo de params deduplicados para el mismo payload (Fix 2 regression guard)",
  { skip: !hasSqlCredentials() },
  async () => {
    const { applyConfig, computeApplyImpact } = await import("../api/services/admin_service.js");
    const pool = await getSqlPool();
    const code = `TEST_FIX2_DEDUPE_${Date.now()}`;
    let rulesetId = null;

    try {
      const tx = new sql.Transaction(pool);
      await tx.begin();
      rulesetId = await seedRuleset(tx, code, 5);
      await tx.commit();

      const payload = {
        rules: [validRule(code)],
        params: [
          {
            offerCode: code,
            paramValues: [
              { key: "P_A", value: "1", value_type: "NUMBER" },
              { key: "P_B", value: "2", value_type: "NUMBER" },
              { key: "P_A", value: "1-dup", value_type: "NUMBER" },
              { key: "P_A", value: "1-dup2", value_type: "NUMBER" },
            ],
          },
        ],
      };

      const impact = await computeApplyImpact(payload, { deleteAllPeriods: true });
      const applyResult = await applyConfig(payload, { deleteAllPeriods: true });

      assert.equal(impact.paramsToInsert, 2, "preview debe deduplicar 4 valores (2 duplicados de P_A) a 2");
      assert.equal(
        applyResult.applied.params,
        impact.paramsToInsert,
        "applyConfig y computeApplyImpact deben coincidir en el conteo deduplicado"
      );
    } finally {
      if (rulesetId) {
        await cleanupRuleset(pool, rulesetId).catch(() => {});
      }
    }
  }
);
