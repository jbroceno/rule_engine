/**
 * test/admin_reset_seed_service.test.js — integration test for resetToSeed()
 * (api/services/admin_service.js), the "seed reset" feature.
 *
 * WARNING — unlike most other integration tests in this suite, resetToSeed()
 * is NOT rollback-friendly: it commits real changes across several internal
 * transactions/statements (deleteNonSeedOffers, ensureBaselinePeriod,
 * ensureSeedOffers, applyConfig, deleteExtraPeriods) and DELETES every
 * non-seed offer and every cfg_offer_dates period except the seed baseline.
 * Only run this against a disposable POC/test database — never against a
 * database holding real config you want to keep. Gated by hasSqlCredentials()
 * exactly like admin_offer_cascade_delete.test.js, so it skips cleanly (and
 * safely) when no SQL Server is configured.
 *
 * Strategy:
 *   1. "Priming" resetToSeed() call — ensures the 6 seed offers + baseline
 *      period exist, regardless of the DB's starting state. Not asserted.
 *   2. Disable one seed offer (PROMOCION_HC) to verify re-enable behavior.
 *   3. Seed a throwaway non-seed offer with a real rule + condition +
 *      condition_value + action + param, plus an extra cfg_offer_dates period.
 *   4. Call resetToSeed() — THE call under test — assert everything the task
 *      requires.
 *   5. Call resetToSeed() again — idempotency: zero removals, same baseline
 *      period reused.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { hasSqlCredentials } from "../api/config/env.js";
import { getSqlPool, sql } from "../api/db/sql_client.js";
import { SEED_OFFERS } from "../api/config/seed_data.js";

const EXTRA_OFFER_CODE = `TEST_EXTRA_${Date.now()}`;
const DISABLED_SEED_CODE = "PROMOCION_HC";

async function seedExtraOffer(pool) {
  const req = pool.request();
  req.input("code", sql.NVarChar(50), EXTRA_OFFER_CODE);
  req.input("name", sql.NVarChar(200), `Test Extra Offer ${EXTRA_OFFER_CODE}`);
  const result = await req.query(`
    INSERT INTO dbo.cfg_offer_ruleset (oferta_id, offer_rank, code, name, enabled, published_version)
    OUTPUT INSERTED.ruleset_id
    VALUES (0, 1, @code, @name, 1, 1)
  `);
  return result.recordset[0].ruleset_id;
}

async function seedExtraPeriod(pool, validFrom) {
  const req = pool.request();
  req.input("validFrom", sql.DateTime2(0), new Date(validFrom));
  const result = await req.query(`
    INSERT INTO dbo.cfg_offer_dates (valid_from, valid_to, descripcion, tipo_cd)
    OUTPUT INSERTED.offer_date_id
    VALUES (@validFrom, NULL, 'Test extra period (seed reset)', 'AMBOS')
  `);
  return result.recordset[0].offer_date_id;
}

async function seedExtraRuleWithConditionAndAction(pool, rulesetId, offerDateId) {
  const ruleReq = pool.request();
  ruleReq.input("rulesetId", sql.Int, rulesetId);
  ruleReq.input("offerDateId", sql.Int, offerDateId);
  const ruleResult = await ruleReq.query(`
    INSERT INTO dbo.cfg_offer_rule (ruleset_id, name, priority, enabled, offer_date_id, stop_processing)
    OUTPUT INSERTED.rule_id
    VALUES (@rulesetId, 'Test extra rule', 100, 1, @offerDateId, 0)
  `);
  const ruleId = ruleResult.recordset[0].rule_id;

  const condReq = pool.request();
  condReq.input("ruleId", sql.Int, ruleId);
  const condResult = await condReq.query(`
    INSERT INTO dbo.cfg_offer_rule_condition (rule_id, group_id, field, operator, value_type, value1, value2)
    OUTPUT INSERTED.cond_id
    VALUES (@ruleId, 0, 'stage', 'IN', 'STRING', NULL, NULL)
  `);
  const condId = condResult.recordset[0].cond_id;

  const cvReq = pool.request();
  cvReq.input("condId", sql.Int, condId);
  await cvReq.query(`
    INSERT INTO dbo.cfg_offer_rule_condition_value (cond_id, value) VALUES (@condId, 'INIT')
  `);

  const actReq = pool.request();
  actReq.input("ruleId", sql.Int, ruleId);
  await actReq.query(`
    INSERT INTO dbo.cfg_offer_rule_action (rule_id, action_type, field, value, value_type)
    VALUES (@ruleId, 'SET', 'initRejected', 'true', 'BOOL')
  `);

  return { ruleId, condId };
}

async function seedExtraParam(pool, rulesetId, offerDateId) {
  const req = pool.request();
  req.input("rulesetId", sql.Int, rulesetId);
  req.input("offerDateId", sql.Int, offerDateId);
  const result = await req.query(`
    INSERT INTO dbo.cfg_offer_param (ruleset_id, param_key, value_type, value, offer_date_id, enabled)
    OUTPUT INSERTED.param_id
    VALUES (@rulesetId, 'TEST_EXTRA_PARAM', 'NUMBER', '1', @offerDateId, 1)
  `);
  return result.recordset[0].param_id;
}

async function countRulesetRows(pool, rulesetId) {
  const req = pool.request();
  req.input("rulesetId", sql.Int, rulesetId);
  const result = await req.query(`
    SELECT COUNT(*) AS cnt FROM dbo.cfg_offer_ruleset WHERE ruleset_id = @rulesetId
  `);
  return result.recordset[0].cnt;
}

async function countRulesForRuleset(pool, rulesetId) {
  const req = pool.request();
  req.input("rulesetId", sql.Int, rulesetId);
  const result = await req.query(`
    SELECT COUNT(*) AS cnt FROM dbo.cfg_offer_rule WHERE ruleset_id = @rulesetId
  `);
  return result.recordset[0].cnt;
}

async function countConditionByRuleId(pool, ruleId) {
  const req = pool.request();
  req.input("ruleId", sql.Int, ruleId);
  const result = await req.query(`
    SELECT COUNT(*) AS cnt FROM dbo.cfg_offer_rule_condition WHERE rule_id = @ruleId
  `);
  return result.recordset[0].cnt;
}

async function countParamsForRuleset(pool, rulesetId) {
  const req = pool.request();
  req.input("rulesetId", sql.Int, rulesetId);
  const result = await req.query(`
    SELECT COUNT(*) AS cnt FROM dbo.cfg_offer_param WHERE ruleset_id = @rulesetId
  `);
  return result.recordset[0].cnt;
}

async function countPeriod(pool, offerDateId) {
  const req = pool.request();
  req.input("id", sql.Int, offerDateId);
  const result = await req.query(`
    SELECT COUNT(*) AS cnt FROM dbo.cfg_offer_dates WHERE offer_date_id = @id
  `);
  return result.recordset[0].cnt;
}

test(
  "resetToSeed(): full-scope reset removes non-seed offers/periods, restores/re-enables the 6 seed offers, is idempotent",
  { skip: !hasSqlCredentials() },
  async () => {
    const { resetToSeed, ensureBaselinePeriod } = await import("../api/services/admin_service.js");
    const pool = await getSqlPool();

    let extraRulesetId = null;
    let extraPeriodId = null;
    let extraRuleId = null;
    let extraCondId = null;

    try {
      // --- 1. Priming call: make sure the 6 seed offers + baseline period exist ---
      await resetToSeed({ createdBy: "test-priming" });

      // --- 2. Disable one seed offer to verify resetToSeed re-enables it ---
      await pool.request()
        .input("code", sql.NVarChar(50), DISABLED_SEED_CODE)
        .query(`UPDATE dbo.cfg_offer_ruleset SET enabled = 0 WHERE code = @code`);

      // --- 3. Seed a throwaway non-seed offer with real rule/condition/value/action/param ---
      extraRulesetId = await seedExtraOffer(pool);
      extraPeriodId = await seedExtraPeriod(pool, "2099-01-01");
      const { ruleId, condId } = await seedExtraRuleWithConditionAndAction(pool, extraRulesetId, extraPeriodId);
      extraRuleId = ruleId;
      extraCondId = condId;
      await seedExtraParam(pool, extraRulesetId, extraPeriodId);

      // --- 4. THE call under test ---
      const result = await resetToSeed({ createdBy: "test-main" });

      // Extra offer + its rule/condition/param/period are ALL gone.
      assert.equal(await countRulesetRows(pool, extraRulesetId), 0, "extra offer's ruleset row must be gone");
      assert.equal(await countRulesForRuleset(pool, extraRulesetId), 0, "extra offer's rules must be gone");
      assert.equal(await countConditionByRuleId(pool, extraRuleId), 0, "extra rule's conditions must be gone");
      assert.equal(await countParamsForRuleset(pool, extraRulesetId), 0, "extra offer's params must be gone");
      assert.equal(await countPeriod(pool, extraPeriodId), 0, "extra period must be gone");

      assert.ok(result.removedOfferCodes.includes(EXTRA_OFFER_CODE), "removedOfferCodes must include the extra offer's code");
      assert.ok(result.removedPeriodCount >= 1, "removedPeriodCount must be >= 1 (the extra period)");

      // All 6 seed offers exist, enabled, correct offer_rank.
      const offersResult = await pool.request().query(`
        SELECT code, enabled, offer_rank, oferta_id FROM dbo.cfg_offer_ruleset
        WHERE code IN (${SEED_OFFERS.map((o) => `'${o.code}'`).join(",")})
      `);
      const offersByCode = new Map(offersResult.recordset.map((r) => [r.code, r]));
      assert.equal(offersByCode.size, SEED_OFFERS.length, "all 6 seed offers must exist");
      for (const seedOffer of SEED_OFFERS) {
        const row = offersByCode.get(seedOffer.code);
        assert.ok(row, `seed offer ${seedOffer.code} must exist`);
        assert.equal(Boolean(row.enabled), true, `seed offer ${seedOffer.code} must be enabled`);
        assert.equal(Number(row.offer_rank), seedOffer.offer_rank, `seed offer ${seedOffer.code} must have offer_rank ${seedOffer.offer_rank}`);
      }
      // The explicitly-disabled offer must have been re-enabled.
      assert.equal(Boolean(offersByCode.get(DISABLED_SEED_CODE).enabled), true, `${DISABLED_SEED_CODE} must be re-enabled by resetToSeed`);

      // FIDELIZACION has exactly 5 rules.
      const fidelizacionRulesetId = offersByCode.get("FIDELIZACION")
        ? (await pool.request().input("code", sql.NVarChar(50), "FIDELIZACION").query(
            `SELECT ruleset_id FROM dbo.cfg_offer_ruleset WHERE code = @code`
          )).recordset[0].ruleset_id
        : null;
      assert.ok(fidelizacionRulesetId, "FIDELIZACION ruleset_id must be resolvable");
      assert.equal(await countRulesForRuleset(pool, fidelizacionRulesetId), 5, "FIDELIZACION must have exactly 5 rules");

      const firstOfferDateId = result.offer_date_id;

      // --- 5. Idempotent second call ---
      const secondResult = await resetToSeed({ createdBy: "test-idempotent" });
      assert.deepEqual(secondResult.removedOfferCodes, [], "second call must report zero removed offers");
      assert.equal(secondResult.removedPeriodCount, 0, "second call must report zero removed periods");
      assert.equal(secondResult.offer_date_id, firstOfferDateId, "second call must reuse the same baseline period");

      // Sanity: ensureBaselinePeriod is idempotent on its own too.
      const rebPeriodId = await ensureBaselinePeriod();
      assert.equal(rebPeriodId, firstOfferDateId, "ensureBaselinePeriod must resolve to the same baseline period id");

      // Cleared — nothing left to clean up for the extra offer/period/rule/param;
      // resetToSeed already removed them as part of the assertions above.
      extraRulesetId = null;
      extraPeriodId = null;
    } finally {
      // Defensive cleanup only (should be a no-op — resetToSeed already removed
      // these). NOT cleaning up the baseline period / 6 seed offers: leaving the
      // DB in the seed state is resetToSeed()'s whole purpose, not test pollution.
      if (extraRulesetId) {
        try {
          await pool.request().input("id", sql.Int, extraRulesetId).query(`DELETE FROM dbo.cfg_offer_param WHERE ruleset_id = @id`);
          await pool.request().input("id", sql.Int, extraRulesetId).query(`
            DELETE cv FROM dbo.cfg_offer_rule_condition_value cv
            INNER JOIN dbo.cfg_offer_rule_condition c ON c.cond_id = cv.cond_id
            INNER JOIN dbo.cfg_offer_rule r ON r.rule_id = c.rule_id
            WHERE r.ruleset_id = @id
          `);
          await pool.request().input("id", sql.Int, extraRulesetId).query(`
            DELETE c FROM dbo.cfg_offer_rule_condition c
            INNER JOIN dbo.cfg_offer_rule r ON r.rule_id = c.rule_id
            WHERE r.ruleset_id = @id
          `);
          await pool.request().input("id", sql.Int, extraRulesetId).query(`
            DELETE a FROM dbo.cfg_offer_rule_action a
            INNER JOIN dbo.cfg_offer_rule r ON r.rule_id = a.rule_id
            WHERE r.ruleset_id = @id
          `);
          await pool.request().input("id", sql.Int, extraRulesetId).query(`DELETE FROM dbo.cfg_offer_rule WHERE ruleset_id = @id`);
          await pool.request().input("id", sql.Int, extraRulesetId).query(`DELETE FROM dbo.cfg_offer_ruleset WHERE ruleset_id = @id`);
        } catch (_) { /* ignorar */ }
      }
      if (extraPeriodId) {
        try {
          await pool.request().input("id", sql.Int, extraPeriodId).query(`DELETE FROM dbo.cfg_offer_dates WHERE offer_date_id = @id`);
        } catch (_) { /* ignorar */ }
      }
    }
  },
);
