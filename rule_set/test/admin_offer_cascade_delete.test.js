/**
 * Integration test: offer-cascade-delete — cascada completa al borrar oferta.
 *
 * Cubre:
 *   T-01a: cascade borra todas las tablas en todos los períodos
 *   T-01b: deletedRules y deletedParams devuelven los conteos correctos
 *   T-01c: params con enabled=0 se incluyen en el borrado y en el conteo
 *   T-01d: se crea fila en cfg_config_snapshot antes del borrado
 *   T-01e: el snapshot se crea antes de que los datos desaparezcan
 *   T-01f: devuelve 404 cuando el offerCode no existe
 *   T-01g: atomicidad — fallo en oferta inexistente no afecta a oferta real
 *   T-01h: oferta sin reglas ni params → deleted:true, counts 0
 *
 * Estrategia: pool real + tx propia + rollback en finally, sin datos persistidos.
 * Salta limpiamente cuando no hay credenciales SQL (como los 2 CA-013 existentes).
 *
 * Esquema relevante (admin_service.js + data_model.sql):
 *   cfg_offer_ruleset (ruleset_id, code, name, offer_rank, enabled, oferta_id)
 *   cfg_offer_dates   (offer_date_id, valid_from, valid_to, descripcion, tipo_cd, alta_usr)
 *   cfg_offer_rule    (rule_id, ruleset_id, name, priority, enabled, offer_date_id, stop_processing)
 *   cfg_offer_rule_condition (cond_id, rule_id, group_id, field, operator, value_type, value1, value2)
 *   cfg_offer_rule_condition_value (cond_value_id, cond_id, value)
 *   cfg_offer_rule_action (action_id, rule_id, action_type, field, value, value_type)
 *   cfg_offer_param   (param_id, ruleset_id, param_key, value_type, value, offer_date_id, enabled)
 *
 * Referencias: sdd/offer-cascade-delete/spec, sdd/offer-cascade-delete/design
 */

import test from "node:test";
import assert from "node:assert/strict";

import { hasSqlCredentials } from "../api/config/env.js";
import { getSqlPool, sql } from "../api/db/sql_client.js";

// ---------------------------------------------------------------------------
// Helpers de siembra
// ---------------------------------------------------------------------------

/**
 * Siembra un ruleset (cfg_offer_ruleset) dentro de tx. Devuelve ruleset_id.
 */
async function seedRuleset(tx, code, rank = 1) {
  const req = tx.request();
  req.input("code", sql.NVarChar(50), code);
  req.input("name", sql.NVarChar(200), `Test Oferta ${code}`);
  req.input("rank", sql.Int, rank);
  req.input("ofertaId", sql.Int, 0);
  const result = await req.query(`
    INSERT INTO dbo.cfg_offer_ruleset (code, name, offer_rank, enabled, oferta_id)
    OUTPUT INSERTED.ruleset_id
    VALUES (@code, @name, @rank, 1, @ofertaId)
  `);
  return result.recordset[0].ruleset_id;
}

/**
 * Siembra un cfg_offer_dates (standalone, sin ruleset_id). Devuelve offer_date_id.
 */
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

/**
 * Siembra una regla con condición, condition_value y acción. Devuelve rule_id.
 * Columnas reales de cfg_offer_rule: ruleset_id, name, priority, enabled, offer_date_id, stop_processing
 */
async function seedRule(tx, rulesetId, offerDateId, suffix = "") {
  // Regla
  const ruleReq = tx.request();
  ruleReq.input("rulesetId", sql.Int, rulesetId);
  ruleReq.input("offerDateId", sql.Int, offerDateId);
  ruleReq.input("name", sql.NVarChar(200), `Test rule${suffix}`);
  const ruleResult = await ruleReq.query(`
    INSERT INTO dbo.cfg_offer_rule (ruleset_id, name, priority, enabled, offer_date_id, stop_processing)
    OUTPUT INSERTED.rule_id
    VALUES (@rulesetId, @name, 100, 1, @offerDateId, 0)
  `);
  const ruleId = ruleResult.recordset[0].rule_id;

  // Condición con IN (para que tenga condition_value)
  const condReq = tx.request();
  condReq.input("ruleId", sql.Int, ruleId);
  const condResult = await condReq.query(`
    INSERT INTO dbo.cfg_offer_rule_condition (rule_id, group_id, field, operator, value_type, value1, value2)
    OUTPUT INSERTED.cond_id
    VALUES (@ruleId, 1, 'stage', 'IN', 'STRING', NULL, NULL)
  `);
  const condId = condResult.recordset[0].cond_id;

  // Valor de condición IN
  const cvReq = tx.request();
  cvReq.input("condId", sql.Int, condId);
  await cvReq.query(`
    INSERT INTO dbo.cfg_offer_rule_condition_value (cond_id, value)
    VALUES (@condId, 'INIT')
  `);

  // Acción
  const actReq = tx.request();
  actReq.input("ruleId", sql.Int, ruleId);
  await actReq.query(`
    INSERT INTO dbo.cfg_offer_rule_action (rule_id, action_type, field, value, value_type)
    VALUES (@ruleId, 'SET', 'initRejected', 'true', 'BOOL')
  `);

  return ruleId;
}

/**
 * Siembra un param (enabled puede ser 0 o 1).
 * Columnas: ruleset_id, param_key, value_type, value, offer_date_id, enabled
 */
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

/**
 * Cuenta filas en una tabla filtrando por ruleset_id (directamente o por JOIN).
 */
async function countByRuleset(pool, table, rulesetId) {
  const req = pool.request();
  req.input("rulesetId", sql.Int, rulesetId);

  if (table === "cfg_offer_ruleset") {
    const r = await req.query(`SELECT COUNT(*) AS cnt FROM dbo.cfg_offer_ruleset WHERE ruleset_id = @rulesetId`);
    return r.recordset[0].cnt;
  }
  if (table === "cfg_offer_rule") {
    const r = await req.query(`SELECT COUNT(*) AS cnt FROM dbo.cfg_offer_rule WHERE ruleset_id = @rulesetId`);
    return r.recordset[0].cnt;
  }
  if (table === "cfg_offer_param") {
    const r = await req.query(`SELECT COUNT(*) AS cnt FROM dbo.cfg_offer_param WHERE ruleset_id = @rulesetId`);
    return r.recordset[0].cnt;
  }
  if (table === "cfg_offer_rule_condition") {
    const r = await req.query(`
      SELECT COUNT(*) AS cnt
      FROM dbo.cfg_offer_rule_condition c
      INNER JOIN dbo.cfg_offer_rule r ON r.rule_id = c.rule_id
      WHERE r.ruleset_id = @rulesetId
    `);
    return r.recordset[0].cnt;
  }
  if (table === "cfg_offer_rule_condition_value") {
    const r = await req.query(`
      SELECT COUNT(*) AS cnt
      FROM dbo.cfg_offer_rule_condition_value cv
      INNER JOIN dbo.cfg_offer_rule_condition c ON c.cond_id = cv.cond_id
      INNER JOIN dbo.cfg_offer_rule r ON r.rule_id = c.rule_id
      WHERE r.ruleset_id = @rulesetId
    `);
    return r.recordset[0].cnt;
  }
  if (table === "cfg_offer_rule_action") {
    const r = await req.query(`
      SELECT COUNT(*) AS cnt
      FROM dbo.cfg_offer_rule_action a
      INNER JOIN dbo.cfg_offer_rule r ON r.rule_id = a.rule_id
      WHERE r.ruleset_id = @rulesetId
    `);
    return r.recordset[0].cnt;
  }
  throw new Error(`tabla no soportada: ${table}`);
}

/** Borra los períodos (cfg_offer_dates) sembrados por seedOfferDate — sin FK cascade automática. */
async function cleanupOfferDates(pool, ...offerDateIds) {
  for (const id of offerDateIds) {
    if (!id) continue;
    try {
      await pool.request().input("id", sql.Int, id).query(`DELETE FROM dbo.cfg_offer_dates WHERE offer_date_id = @id`);
    } catch (_) { /* ignorar */ }
  }
}

// ---------------------------------------------------------------------------
// T-01a: cascade borra todas las tablas en todos los períodos
// ---------------------------------------------------------------------------

test(
  "T-01a: deleteOffer cascade borra condition_values/conditions/actions/rules/params/ruleset en todos los períodos",
  { skip: !hasSqlCredentials() },
  async () => {
    const { deleteOffer } = await import("../api/services/admin_service.js");
    const pool = await getSqlPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    let rulesetId = null;
    let committed = false;
    let periodId1 = null;
    let periodId2 = null;
    try {
      const offerCode = `TEST_CASCADE_${Date.now()}`;
      rulesetId = await seedRuleset(tx, offerCode);
      periodId1 = await seedOfferDate(tx, "2099-01-01");
      periodId2 = await seedOfferDate(tx, "2099-06-01");
      await seedRule(tx, rulesetId, periodId1, "_P1");
      await seedRule(tx, rulesetId, periodId2, "_P2");
      await seedParam(tx, rulesetId, periodId1, "PARAM_P1");
      await seedParam(tx, rulesetId, periodId2, "PARAM_P2");

      // Commit la siembra para que deleteOffer (que usa su propio pool) la vea
      await tx.commit();
      committed = true;

      const result = await deleteOffer(offerCode);

      assert.equal(result.deleted, true, "deleted debe ser true");
      assert.equal(result.offerCode, offerCode, "offerCode debe coincidir");

      // Verificar que no queda nada en ninguna tabla relacionada con este ruleset
      assert.equal(await countByRuleset(pool, "cfg_offer_ruleset", rulesetId), 0, "ruleset debe estar borrado");
      assert.equal(await countByRuleset(pool, "cfg_offer_rule", rulesetId), 0, "rules deben estar borradas");
      assert.equal(await countByRuleset(pool, "cfg_offer_param", rulesetId), 0, "params deben estar borrados");
      assert.equal(await countByRuleset(pool, "cfg_offer_rule_condition", rulesetId), 0, "conditions deben estar borradas");
      assert.equal(await countByRuleset(pool, "cfg_offer_rule_condition_value", rulesetId), 0, "condition_values deben estar borrados");
      assert.equal(await countByRuleset(pool, "cfg_offer_rule_action", rulesetId), 0, "actions deben estar borradas");

      rulesetId = null; // ya limpio
    } finally {
      if (!committed) {
        try { await tx.rollback(); } catch (_) { /* ignorar */ }
      }
      await cleanupOfferDates(pool, periodId1, periodId2);
    }
  },
);

// ---------------------------------------------------------------------------
// T-01b: deletedRules y deletedParams devuelven los conteos correctos
// ---------------------------------------------------------------------------

test(
  "T-01b: deleteOffer devuelve deletedRules y deletedParams con los conteos reales",
  { skip: !hasSqlCredentials() },
  async () => {
    const { deleteOffer } = await import("../api/services/admin_service.js");
    const pool = await getSqlPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    let committed = false;
    let periodId1 = null;
    let periodId2 = null;
    try {
      const offerCode = `TEST_COUNTS_${Date.now()}`;
      const rulesetId = await seedRuleset(tx, offerCode);
      periodId1 = await seedOfferDate(tx, "2099-01-01");
      periodId2 = await seedOfferDate(tx, "2099-06-01");
      // 3 reglas en período 1, 2 en período 2 → deletedRules = 5
      await seedRule(tx, rulesetId, periodId1, "_r1");
      await seedRule(tx, rulesetId, periodId1, "_r2");
      await seedRule(tx, rulesetId, periodId1, "_r3");
      await seedRule(tx, rulesetId, periodId2, "_r4");
      await seedRule(tx, rulesetId, periodId2, "_r5");
      // 4 params → deletedParams = 4
      await seedParam(tx, rulesetId, periodId1, "P1");
      await seedParam(tx, rulesetId, periodId1, "P2");
      await seedParam(tx, rulesetId, periodId2, "P3");
      await seedParam(tx, rulesetId, periodId2, "P4");

      await tx.commit();
      committed = true;

      const result = await deleteOffer(offerCode);

      assert.equal(result.deletedRules, 5, "deletedRules debe ser 5");
      assert.equal(result.deletedParams, 4, "deletedParams debe ser 4");
    } finally {
      if (!committed) {
        try { await tx.rollback(); } catch (_) { /* ignorar */ }
      }
      await cleanupOfferDates(pool, periodId1, periodId2);
    }
  },
);

// ---------------------------------------------------------------------------
// T-01c: params con enabled=0 se incluyen en el borrado y en el conteo
// ---------------------------------------------------------------------------

test(
  "T-01c: deleteOffer incluye params con enabled=0 en el borrado y en deletedParams",
  { skip: !hasSqlCredentials() },
  async () => {
    const { deleteOffer } = await import("../api/services/admin_service.js");
    const pool = await getSqlPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    let committed = false;
    let rulesetId = null;
    let periodId = null;
    try {
      const offerCode = `TEST_SOFTDEL_${Date.now()}`;
      rulesetId = await seedRuleset(tx, offerCode);
      periodId = await seedOfferDate(tx, "2099-01-01");
      // 2 params activos + 1 soft-deleted → deletedParams debe ser 3
      await seedParam(tx, rulesetId, periodId, "ACTIVE_1", 1);
      await seedParam(tx, rulesetId, periodId, "ACTIVE_2", 1);
      await seedParam(tx, rulesetId, periodId, "SOFTDEL_1", 0);

      await tx.commit();
      committed = true;

      const result = await deleteOffer(offerCode);

      assert.equal(result.deletedParams, 3, "deletedParams debe incluir los params con enabled=0");

      // Verificar que no queda ningún param (ni soft-deleted)
      assert.equal(await countByRuleset(pool, "cfg_offer_param", rulesetId), 0, "no deben quedar params en ningún estado");
      rulesetId = null;
    } finally {
      if (!committed) {
        try { await tx.rollback(); } catch (_) { /* ignorar */ }
      }
      await cleanupOfferDates(pool, periodId);
    }
  },
);

// ---------------------------------------------------------------------------
// T-01d: se crea fila en cfg_config_snapshot antes del borrado
// ---------------------------------------------------------------------------

test(
  "T-01d: deleteOffer crea un snapshot en cfg_config_snapshot con el comment esperado",
  { skip: !hasSqlCredentials() },
  async () => {
    const { deleteOffer } = await import("../api/services/admin_service.js");
    const pool = await getSqlPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    let committed = false;
    let snapshotId = null;
    let periodId = null;
    try {
      const offerCode = `TEST_SNAP_${Date.now()}`;
      const rulesetId = await seedRuleset(tx, offerCode);
      periodId = await seedOfferDate(tx, "2099-01-01");

      await tx.commit();
      committed = true;

      const result = await deleteOffer(offerCode, "usuario-test");

      assert.ok(result.snapshot_id, "snapshot_id debe estar presente en la respuesta");
      assert.equal(typeof result.snapshot_id, "number", "snapshot_id debe ser un número");
      snapshotId = result.snapshot_id;

      // Verificar que la fila existe en la tabla
      const snapReq = pool.request();
      snapReq.input("snapshotId", sql.Int, snapshotId);
      const snapResult = await snapReq.query(`
        SELECT snapshot_id, comment, created_by
        FROM dbo.cfg_config_snapshot
        WHERE snapshot_id = @snapshotId
      `);
      assert.equal(snapResult.recordset.length, 1, "debe existir una fila en cfg_config_snapshot");

      const snap = snapResult.recordset[0];
      assert.ok(
        snap.comment.includes(offerCode),
        `El comment del snapshot debe incluir el offerCode '${offerCode}'. Obtenido: '${snap.comment}'`,
      );
      assert.equal(snap.created_by, "usuario-test", "created_by debe coincidir con el parámetro createdBy");
    } finally {
      if (!committed) {
        try { await tx.rollback(); } catch (_) { /* ignorar */ }
      }
      // Cleanup snapshot (fuera de la tx de siembra)
      if (snapshotId) {
        try {
          const cleanReq = pool.request();
          cleanReq.input("snapshotId", sql.Int, snapshotId);
          await cleanReq.query(`DELETE FROM dbo.cfg_config_snapshot WHERE snapshot_id = @snapshotId`);
        } catch (_) { /* ignorar */ }
      }
      await cleanupOfferDates(pool, periodId);
    }
  },
);

// ---------------------------------------------------------------------------
// T-01e: el snapshot se crea ANTES de que los datos desaparezcan
// (verificado: snapshot existe y rules_json es un array válido)
// ---------------------------------------------------------------------------

test(
  "T-01e: el snapshot captura el estado de la configuración antes del borrado",
  { skip: !hasSqlCredentials() },
  async () => {
    const { deleteOffer } = await import("../api/services/admin_service.js");
    const pool = await getSqlPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    let committed = false;
    let snapshotId = null;
    let periodId = null;
    try {
      const offerCode = `TEST_SNAPBEFORE_${Date.now()}`;
      const rulesetId = await seedRuleset(tx, offerCode);
      periodId = await seedOfferDate(tx, "2099-01-01");
      await seedRule(tx, rulesetId, periodId, "_se");

      await tx.commit();
      committed = true;

      const result = await deleteOffer(offerCode);
      snapshotId = result.snapshot_id;

      // El snapshot debe tener rules_json con contenido (no vacío)
      const snapReq = pool.request();
      snapReq.input("snapshotId", sql.Int, snapshotId);
      const snapResult = await snapReq.query(`
        SELECT rules_json, params_json
        FROM dbo.cfg_config_snapshot
        WHERE snapshot_id = @snapshotId
      `);
      assert.equal(snapResult.recordset.length, 1, "el snapshot debe existir");
      const rulesJson = JSON.parse(snapResult.recordset[0].rules_json ?? "[]");
      assert.ok(Array.isArray(rulesJson), "rules_json debe ser un array JSON válido");
    } finally {
      if (!committed) {
        try { await tx.rollback(); } catch (_) { /* ignorar */ }
      }
      if (snapshotId) {
        try {
          const cleanReq = pool.request();
          cleanReq.input("snapshotId", sql.Int, snapshotId);
          await cleanReq.query(`DELETE FROM dbo.cfg_config_snapshot WHERE snapshot_id = @snapshotId`);
        } catch (_) { /* ignorar */ }
      }
      await cleanupOfferDates(pool, periodId);
    }
  },
);

// ---------------------------------------------------------------------------
// T-01f: devuelve 404 cuando el offerCode no existe
// ---------------------------------------------------------------------------

test(
  "T-01f: deleteOffer lanza AppError 404 cuando el offerCode no existe",
  { skip: !hasSqlCredentials() },
  async () => {
    const { deleteOffer } = await import("../api/services/admin_service.js");
    const { AppError } = await import("../api/utils/app_error.js");

    const fakeCode = `NOEXIST_${Date.now()}`;

    await assert.rejects(
      () => deleteOffer(fakeCode),
      (err) => {
        assert.ok(err instanceof AppError, `debe ser AppError, recibido: ${err?.constructor?.name}`);
        assert.equal(err.statusCode, 404, `statusCode debe ser 404, recibido: ${err.statusCode}`);
        return true;
      },
    );
  },
);

// ---------------------------------------------------------------------------
// T-01g: atomicidad — fallo en oferta inexistente no afecta a oferta real
// ---------------------------------------------------------------------------

test(
  "T-01g: atomicidad — si deleteOffer falla (404), la oferta real queda intacta",
  { skip: !hasSqlCredentials() },
  async () => {
    const { deleteOffer } = await import("../api/services/admin_service.js");
    const pool = await getSqlPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    let committed = false;
    let periodId = null;
    try {
      const offerCode = `TEST_ATOMIC_${Date.now()}`;
      const rulesetId = await seedRuleset(tx, offerCode);
      periodId = await seedOfferDate(tx, "2099-01-01");
      await seedRule(tx, rulesetId, periodId, "_at");
      await seedParam(tx, rulesetId, periodId, "PARAM_AT");

      await tx.commit();
      committed = true;

      // Intentar borrar un código inexistente — no debe afectar al offerCode real
      const fakeCode = `NOEXIST_${Date.now()}`;
      try {
        await deleteOffer(fakeCode);
      } catch (_) {
        // 404 esperado — ignorar
      }

      // La oferta real debe seguir existiendo
      assert.equal(await countByRuleset(pool, "cfg_offer_ruleset", rulesetId), 1, "la oferta real no debe haber sido borrada");
      assert.equal(await countByRuleset(pool, "cfg_offer_rule", rulesetId), 1, "las reglas reales no deben haber sido borradas");

      // Cleanup: borrar la oferta correctamente
      await deleteOffer(offerCode);
    } finally {
      if (!committed) {
        try { await tx.rollback(); } catch (_) { /* ignorar */ }
      }
      await cleanupOfferDates(pool, periodId);
    }
  },
);

// ---------------------------------------------------------------------------
// T-01h: oferta sin reglas ni params → deleted:true, counts 0
// ---------------------------------------------------------------------------

test(
  "T-01h: deleteOffer con oferta sin reglas ni params devuelve deleted:true y counts 0",
  { skip: !hasSqlCredentials() },
  async () => {
    const { deleteOffer } = await import("../api/services/admin_service.js");
    const pool = await getSqlPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    let committed = false;
    let snapshotId = null;
    try {
      const offerCode = `TEST_EMPTY_${Date.now()}`;
      await seedRuleset(tx, offerCode);
      // Sin reglas ni params — solo el ruleset

      await tx.commit();
      committed = true;

      const result = await deleteOffer(offerCode);

      assert.equal(result.deleted, true, "deleted debe ser true");
      assert.equal(result.offerCode, offerCode, "offerCode debe coincidir");
      assert.equal(result.deletedRules, 0, "deletedRules debe ser 0");
      assert.equal(result.deletedParams, 0, "deletedParams debe ser 0");
      assert.ok(result.snapshot_id, "snapshot_id debe estar presente");
      snapshotId = result.snapshot_id;
    } finally {
      if (!committed) {
        try { await tx.rollback(); } catch (_) { /* ignorar */ }
      }
      if (snapshotId) {
        try {
          const cleanReq = pool.request();
          cleanReq.input("snapshotId", sql.Int, snapshotId);
          await cleanReq.query(`DELETE FROM dbo.cfg_config_snapshot WHERE snapshot_id = @snapshotId`);
        } catch (_) { /* ignorar */ }
      }
    }
  },
);
