import { getSqlPool, sql } from "../db/sql_client.js";
import { AppError } from "../utils/app_error.js";
import { normalizeVigenciaToSecond, toLocalWallClock } from "../utils/vigencia.js";

// subtractOneDay removed — period-close uses exact next valid_from (ADR-003, INV-COD-04).

export async function listFechas() {
  const pool = await getSqlPool();
  const result = await pool.request().query(`
    SELECT offer_date_id, valid_from, valid_to, descripcion, tipo_cd, alta_usr, alta_dt
    FROM dbo.cfg_offer_dates
    ORDER BY valid_from DESC
  `);
  // Serialize Date columns as naked local wall-clock strings (no "Z").
  // Otherwise res.json() → toISOString() would leak UTC and break the
  // local-wall-clock wire contract the frontend edit form relies on (ADR-005).
  const items = (result.recordset ?? []).map((row) => ({
    ...row,
    valid_from: toLocalWallClock(row.valid_from),
    valid_to: toLocalWallClock(row.valid_to),
    alta_dt: toLocalWallClock(row.alta_dt),
  }));
  return { items };
}

export async function createFecha(payload) {
  const pool = await getSqlPool();

  await checkOverlap(pool, payload.tipo_cd, payload.valid_from, payload.valid_to, null);

  const request = pool.request();
  // INV-COD-05: sql.DateTime2(0) + normalizeVigenciaToSecond — local wall-clock,
  // ms truncated, pairs with useUTC:false (ADR-002).
  request.input("validFrom", sql.DateTime2(0), normalizeVigenciaToSecond(payload.valid_from));
  request.input("validTo", sql.DateTime2(0), normalizeVigenciaToSecond(payload.valid_to ?? null));
  request.input("descripcion", sql.NVarChar(200), payload.descripcion);
  request.input("tipoCd", sql.VarChar(10), payload.tipo_cd);
  request.input("altaUsr", sql.NVarChar(100), payload.alta_usr ?? null);

  const result = await request.query(`
    INSERT INTO dbo.cfg_offer_dates (valid_from, valid_to, descripcion, tipo_cd, alta_usr)
    OUTPUT INSERTED.offer_date_id
    VALUES (@validFrom, @validTo, @descripcion, @tipoCd, @altaUsr)
  `);

  const id = result.recordset?.[0]?.offer_date_id;
  if (!id) {
    throw new AppError("No se pudo crear el período.", 500);
  }
  return { offer_date_id: id };
}

export async function updateFecha(id, payload) {
  const pool = await getSqlPool();

  await getFechaOrThrow(pool, id);
  await checkOverlap(pool, payload.tipo_cd, payload.valid_from, payload.valid_to, id);

  const request = pool.request();
  request.input("id", sql.Int, id);
  request.input("validFrom", sql.DateTime2(0), normalizeVigenciaToSecond(payload.valid_from));
  request.input("validTo", sql.DateTime2(0), normalizeVigenciaToSecond(payload.valid_to ?? null));
  request.input("descripcion", sql.NVarChar(200), payload.descripcion);
  request.input("tipoCd", sql.VarChar(10), payload.tipo_cd);
  request.input("altaUsr", sql.NVarChar(100), payload.alta_usr ?? null);

  const result = await request.query(`
    UPDATE dbo.cfg_offer_dates
    SET valid_from = @validFrom,
        valid_to   = @validTo,
        descripcion = @descripcion,
        tipo_cd    = @tipoCd,
        alta_usr   = @altaUsr
    WHERE offer_date_id = @id
  `);

  if ((result.rowsAffected?.[0] ?? 0) === 0) {
    throw new AppError(`No existe offer_date_id ${id}.`, 404);
  }
  return { offer_date_id: id, updated: true };
}

export async function deleteFecha(id, { pool: injectedPool } = {}) {
  const pool = injectedPool ?? await getSqlPool();

  await getFechaOrThrow(pool, id);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const t = () => transaction.request().input("id", sql.Int, id);

    await t().query(`
      DELETE cv FROM dbo.cfg_offer_rule_condition_value cv
      INNER JOIN dbo.cfg_offer_rule_condition c ON c.cond_id = cv.cond_id
      INNER JOIN dbo.cfg_offer_rule r ON r.rule_id = c.rule_id
      WHERE r.offer_date_id = @id
    `);
    await t().query(`
      DELETE c FROM dbo.cfg_offer_rule_condition c
      INNER JOIN dbo.cfg_offer_rule r ON r.rule_id = c.rule_id
      WHERE r.offer_date_id = @id
    `);
    await t().query(`
      DELETE a FROM dbo.cfg_offer_rule_action a
      INNER JOIN dbo.cfg_offer_rule r ON r.rule_id = a.rule_id
      WHERE r.offer_date_id = @id
    `);
    await t().query(`DELETE FROM dbo.cfg_offer_rule  WHERE offer_date_id = @id`);
    await t().query(`DELETE FROM dbo.cfg_offer_param WHERE offer_date_id = @id`);
    await t().query(`DELETE FROM dbo.cfg_offer_dates WHERE offer_date_id = @id`);

    await transaction.commit();
  } catch (e) {
    await transaction.rollback();
    throw e;
  }

  return { offer_date_id: id, deleted: true };
}

export async function duplicateFecha(sourceId, newValidFrom) {
  const pool = await getSqlPool();

  // Load source period
  const srcReq = pool.request();
  srcReq.input("id", sql.Int, sourceId);
  const srcResult = await srcReq.query(`
    SELECT offer_date_id, valid_from, valid_to, descripcion, tipo_cd
    FROM dbo.cfg_offer_dates WHERE offer_date_id = @id
  `);
  const source = srcResult.recordset?.[0];
  if (!source) throw new AppError(`No existe offer_date_id ${sourceId}.`, 404);

  // Check overlap excluding source (it will be closed before the new one is created)
  await checkOverlap(pool, source.tipo_cd, newValidFrom, null, sourceId);

  // Load rules from source
  const rulesReq = pool.request();
  rulesReq.input("srcId", sql.Int, sourceId);
  const rules = (await rulesReq.query(`
    SELECT rule_id, ruleset_id, name, priority, enabled, stop_processing
    FROM dbo.cfg_offer_rule WHERE offer_date_id = @srcId
  `)).recordset ?? [];

  let conditions = [], conditionValues = [], actions = [];
  if (rules.length > 0) {
    const ruleIdsCsv = rules.map(r => r.rule_id).join(",");

    conditions = (await pool.request()
      .input("csv", sql.NVarChar(sql.MAX), ruleIdsCsv)
      .query(`
        SELECT cond_id, rule_id, group_id, field, operator, value_type, value1, value2
        FROM dbo.cfg_offer_rule_condition
        WHERE rule_id IN (SELECT TRY_CAST(value AS INT) FROM STRING_SPLIT(@csv, ','))
      `)).recordset ?? [];

    if (conditions.length > 0) {
      const condIdsCsv = conditions.map(c => c.cond_id).join(",");
      conditionValues = (await pool.request()
        .input("csv", sql.NVarChar(sql.MAX), condIdsCsv)
        .query(`
          SELECT cond_id, value FROM dbo.cfg_offer_rule_condition_value
          WHERE cond_id IN (SELECT TRY_CAST(value AS INT) FROM STRING_SPLIT(@csv, ','))
        `)).recordset ?? [];
    }

    actions = (await pool.request()
      .input("csv", sql.NVarChar(sql.MAX), ruleIdsCsv)
      .query(`
        SELECT action_id, rule_id, action_type, field, value, value_type
        FROM dbo.cfg_offer_rule_action
        WHERE rule_id IN (SELECT TRY_CAST(value AS INT) FROM STRING_SPLIT(@csv, ','))
      `)).recordset ?? [];
  }

  // Load params from source
  const params = (await pool.request()
    .input("srcId", sql.Int, sourceId)
    .query(`
      SELECT ruleset_id, param_key, value_type, value, enabled
      FROM dbo.cfg_offer_param WHERE offer_date_id = @srcId
    `)).recordset ?? [];

  // Transaction: close source (if open) + create new period + deep copy
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    if (!source.valid_to) {
      // ADR-003: close = exact next valid_from (half-open interval [from, to)).
      // No day subtraction — the read SPs use HASTA_DT > @DATE (strict >), so
      // setting valid_to = newValidFrom is gapless and non-overlapping.
      await transaction.request()
        .input("id", sql.Int, sourceId)
        .input("validTo", sql.DateTime2(0), normalizeVigenciaToSecond(newValidFrom))
        .query(`UPDATE dbo.cfg_offer_dates SET valid_to = @validTo WHERE offer_date_id = @id`);
    }

    const newOfferDateId = (await transaction.request()
      .input("validFrom", sql.DateTime2(0), normalizeVigenciaToSecond(newValidFrom))
      .input("descripcion", sql.NVarChar(200), source.descripcion)
      .input("tipoCd", sql.VarChar(10), source.tipo_cd)
      .query(`
        INSERT INTO dbo.cfg_offer_dates (valid_from, valid_to, descripcion, tipo_cd)
        OUTPUT INSERTED.offer_date_id
        VALUES (@validFrom, NULL, @descripcion, @tipoCd)
      `)).recordset?.[0]?.offer_date_id;
    if (!newOfferDateId) throw new AppError("No se pudo crear el período nuevo.", 500);

    // Copy rules: old_rule_id → new_rule_id
    const ruleIdMap = new Map();
    for (const rule of rules) {
      const newRuleId = (await transaction.request()
        .input("rulesetId", sql.Int, rule.ruleset_id)
        .input("name", sql.NVarChar(200), rule.name)
        .input("priority", sql.Int, rule.priority)
        .input("enabled", sql.Bit, rule.enabled ? 1 : 0)
        .input("offerDateId", sql.Int, newOfferDateId)
        .input("stopProcessing", sql.Bit, rule.stop_processing ? 1 : 0)
        .query(`
          INSERT INTO dbo.cfg_offer_rule (ruleset_id, name, priority, enabled, offer_date_id, stop_processing)
          OUTPUT INSERTED.rule_id
          VALUES (@rulesetId, @name, @priority, @enabled, @offerDateId, @stopProcessing)
        `)).recordset?.[0]?.rule_id;
      ruleIdMap.set(rule.rule_id, newRuleId);
    }

    // Copy conditions: old_cond_id → new_cond_id
    const condIdMap = new Map();
    for (const cond of conditions) {
      const newCondId = (await transaction.request()
        .input("ruleId", sql.Int, ruleIdMap.get(cond.rule_id))
        .input("groupId", sql.Int, cond.group_id)
        .input("field", sql.NVarChar(100), cond.field)
        .input("operator", sql.NVarChar(20), cond.operator)
        .input("valueType", sql.NVarChar(20), cond.value_type)
        .input("value1", sql.NVarChar(200), cond.value1 ?? null)
        .input("value2", sql.NVarChar(200), cond.value2 ?? null)
        .query(`
          INSERT INTO dbo.cfg_offer_rule_condition (rule_id, group_id, field, operator, value_type, value1, value2)
          OUTPUT INSERTED.cond_id
          VALUES (@ruleId, @groupId, @field, @operator, @valueType, @value1, @value2)
        `)).recordset?.[0]?.cond_id;
      condIdMap.set(cond.cond_id, newCondId);
    }

    // Copy condition values
    for (const cv of conditionValues) {
      await transaction.request()
        .input("condId", sql.Int, condIdMap.get(cv.cond_id))
        .input("value", sql.NVarChar(200), cv.value)
        .query(`
          INSERT INTO dbo.cfg_offer_rule_condition_value (cond_id, value) VALUES (@condId, @value)
        `);
    }

    // Copy actions
    for (const action of actions) {
      await transaction.request()
        .input("ruleId", sql.Int, ruleIdMap.get(action.rule_id))
        .input("actionType", sql.NVarChar(20), action.action_type)
        .input("field", sql.NVarChar(100), action.field)
        .input("value", sql.NVarChar(4000), action.value ?? null)
        .input("valueType", sql.NVarChar(20), action.value_type)
        .query(`
          INSERT INTO dbo.cfg_offer_rule_action (rule_id, action_type, field, value, value_type)
          VALUES (@ruleId, @actionType, @field, @value, @valueType)
        `);
    }

    // Copy params
    for (const param of params) {
      await transaction.request()
        .input("rulesetId", sql.Int, param.ruleset_id)
        .input("paramKey", sql.NVarChar(100), param.param_key)
        .input("valueType", sql.NVarChar(10), param.value_type)
        .input("value", sql.NVarChar(200), param.value ?? null)
        .input("offerDateId", sql.Int, newOfferDateId)
        .input("enabled", sql.Bit, param.enabled ? 1 : 0)
        .query(`
          INSERT INTO dbo.cfg_offer_param (ruleset_id, param_key, value_type, value, offer_date_id, enabled)
          VALUES (@rulesetId, @paramKey, @valueType, @value, @offerDateId, @enabled)
        `);
    }

    await transaction.commit();
    return { offer_date_id: newOfferDateId, rules_copied: rules.length, params_copied: params.length };
  } catch (e) {
    await transaction.rollback();
    throw e;
  }
}

async function getFechaOrThrow(pool, id) {
  const request = pool.request();
  request.input("id", sql.Int, id);
  const result = await request.query(`
    SELECT offer_date_id FROM dbo.cfg_offer_dates WHERE offer_date_id = @id
  `);
  if (!result.recordset?.length) {
    throw new AppError(`No existe offer_date_id ${id}.`, 404);
  }
}

// Two periods [vF, vT) and [exVF, exVT) overlap when vF < (exVT ?? ∞) AND exVF < (vT ?? ∞).
async function checkOverlap(pool, tipoCd, validFrom, validTo, excludeId) {
  const request = pool.request();
  request.input("tipoCd", sql.VarChar(10), tipoCd);
  request.input("validFrom", sql.DateTime2(0), normalizeVigenciaToSecond(validFrom));
  request.input("validTo", sql.DateTime2(0), normalizeVigenciaToSecond(validTo ?? null));
  request.input("excludeId", sql.Int, excludeId ?? 0);

  const result = await request.query(`
    SELECT COUNT(*) AS total
    FROM dbo.cfg_offer_dates
    WHERE offer_date_id <> @excludeId
      AND tipo_cd = @tipoCd
      AND (valid_to   IS NULL OR @validFrom < valid_to)
      AND (@validTo   IS NULL OR valid_from < @validTo)
  `);

  if (Number(result.recordset?.[0]?.total ?? 0) > 0) {
    throw new AppError(
      "El período se solapa con un período existente del mismo tipo.",
      409
    );
  }
}
