import { getSqlPool, sql } from "../db/sql_client.js";
import { AppError } from "../utils/app_error.js";
import { publishSnapshotToWorkflow } from "./admin_workflow_service.js";
import { normalizeVigenciaToSecond } from "../utils/vigencia.js";
import {
  normalizeActionType,
  normalizeOperator,
  normalizeValueType,
} from "../utils/rule_catalogs.js";
import { SEED_OFFERS, buildSeedConfig } from "../config/seed_data.js";
import { env } from "../config/env.js";
import { computeSnapshotChecksum, verifySnapshotChecksum } from "../utils/snapshot_integrity.js";

// Baseline vigencia for the seed-reset period — matches sql/seed_offers.sql's @VF.
const SEED_BASELINE_VALID_FROM = "2026-01-01";

function toSqlDateOnly(value = new Date()) {
  return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
}

async function findRulesetIdByOfferCode(requestOrTransaction, offerCode) {
  const request = requestOrTransaction.request();
  request.input("offerCode", sql.NVarChar(50), offerCode);
  const result = await request.query(`
    SELECT TOP 1 ruleset_id
    FROM dbo.cfg_offer_ruleset
    WHERE code = @offerCode
      AND enabled = 1
  `);

  const rulesetId = result.recordset?.[0]?.ruleset_id;
  if (!rulesetId) {
    throw new AppError(`No existe ruleset habilitado para offerCode '${offerCode}'.`, 404);
  }

  return rulesetId;
}

async function resolveRulesetId(requestOrTransaction, offerCode) {
  const request = requestOrTransaction.request();
  request.input("offerCode", sql.NVarChar(50), offerCode);
  const result = await request.query(`
    SELECT TOP 1 ruleset_id FROM dbo.cfg_offer_ruleset WHERE code = @offerCode
  `);
  const rulesetId = result.recordset?.[0]?.ruleset_id;
  if (!rulesetId) {
    throw new AppError(`No existe oferta con código '${offerCode}'.`, 404);
  }
  return rulesetId;
}

function normalizeActionForStorage(action) {
  const actionTypeRaw = normalizeActionType(action?.action_type);

  if (actionTypeRaw === "SET_DICTAMEN") {
    return {
      actionType: "SET",
      field: "dictamen",
      value: String(action?.action_payload?.dictamen ?? ""),
      valueType: "STRING",
    };
  }

  const payload = action?.action_payload ?? {};
  return {
    actionType: actionTypeRaw,
    field: String(payload.field ?? action.field ?? "").trim(),
    value: String(payload.value ?? action.value ?? ""),
    valueType: normalizeValueType(payload.value_type ?? action.value_type),
  };
}

async function insertRuleConditions(requestOrTransaction, ruleId, conditions) {
  for (const condition of conditions) {
    const normalizedOperator = normalizeOperator(condition.operator);
    const conditionRequest = requestOrTransaction.request();
    conditionRequest.input("ruleId", sql.Int, ruleId);
    conditionRequest.input("groupId", sql.Int, condition.group_id);
    conditionRequest.input("field", sql.NVarChar(100), String(condition.left_operand).trim());
    conditionRequest.input("operator", sql.NVarChar(20), normalizedOperator);
    conditionRequest.input("valueType", sql.NVarChar(20), normalizeValueType(condition.value_type));

    const isInOperator = normalizedOperator === "IN" || normalizedOperator === "NOT_IN";
    const rightOperandIsParamRef = isInOperator
      && typeof condition.right_operand === "string"
      && condition.right_operand.trim().startsWith("PARAM:");
    const values = isInOperator && !rightOperandIsParamRef
      ? (Array.isArray(condition.right_operand)
        ? condition.right_operand.map((item) => String(item))
        : String(condition.right_operand)
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean))
      : [];

    conditionRequest.input(
      "value1",
      sql.NVarChar(200),
      isInOperator && !rightOperandIsParamRef ? null : String(condition.right_operand ?? "")
    );
    conditionRequest.input("value2", sql.NVarChar(200), condition.value2 ?? null);

    const conditionResult = await conditionRequest.query(`
      INSERT INTO dbo.cfg_offer_rule_condition (rule_id, group_id, field, operator, value_type, value1, value2)
      OUTPUT INSERTED.cond_id
      VALUES (@ruleId, @groupId, @field, @operator, @valueType, @value1, @value2)
    `);

    const condId = conditionResult.recordset?.[0]?.cond_id;
    if (!condId) {
      throw new AppError("No se pudo insertar condicion de regla.", 500);
    }

    if (isInOperator) {
      for (const listValue of values) {
        const valueRequest = requestOrTransaction.request();
        valueRequest.input("condId", sql.Int, condId);
        valueRequest.input("value", sql.NVarChar(200), listValue);
        await valueRequest.query(`
          INSERT INTO dbo.cfg_offer_rule_condition_value (cond_id, value)
          VALUES (@condId, @value)
        `);
      }
    }
  }
}

async function insertRuleAction(requestOrTransaction, ruleId, action) {
  const normalizedAction = normalizeActionForStorage(action);
  const request = requestOrTransaction.request();
  request.input("ruleId", sql.Int, ruleId);
  request.input("actionType", sql.NVarChar(20), normalizedAction.actionType);
  request.input("field", sql.NVarChar(100), normalizedAction.field);
  request.input("value", sql.NVarChar(4000), normalizedAction.value);
  request.input("valueType", sql.NVarChar(20), normalizedAction.valueType);

  await request.query(`
    INSERT INTO dbo.cfg_offer_rule_action (rule_id, action_type, field, value, value_type)
    VALUES (@ruleId, @actionType, @field, @value, @valueType)
  `);
}

function applyRulesFilterParams(request, filters) {
  const where = ["r.enabled IN (0,1)"];

  if (filters.offerCode) {
    where.push("rs.code = @offerCode");
    request.input("offerCode", sql.NVarChar(50), filters.offerCode);
  }

  if (filters.enabled !== undefined) {
    where.push("r.enabled = @enabled");
    request.input("enabled", sql.Bit, filters.enabled ? 1 : 0);
  }

  if (filters.q) {
    where.push("(r.name LIKE @query OR rs.code LIKE @query)");
    request.input("query", sql.NVarChar(220), `%${filters.q}%`);
  }

  if (filters.stage) {
    where.push(`
      EXISTS (
        SELECT 1
        FROM dbo.cfg_offer_rule_condition sc
        WHERE sc.rule_id = r.rule_id
          AND sc.field = 'stage'
          AND sc.operator = 'EQ'
          AND UPPER(sc.value1) = @stage
      )
    `);
    request.input("stage", sql.NVarChar(10), filters.stage);
  }

  if (filters.offerDateId) {
    where.push("r.offer_date_id = @offerDateId");
    request.input("offerDateId", sql.Int, filters.offerDateId);
  }

  return where.join(" AND ");
}

function mapActionFromRow(row) {
  if (!row.action_type) {
    return null;
  }

  if (String(row.action_type).toUpperCase() === "SET" && row.action_field === "dictamen") {
    return {
      action_type: "SET_DICTAMEN",
      action_payload: {
        dictamen: row.action_value,
      },
    };
  }

  return {
    action_type: row.action_type,
    action_payload: {
      field: row.action_field,
      value: row.action_value,
      value_type: row.action_value_type,
    },
  };
}

function inferStage(conditions) {
  const stageCondition = conditions.find(
    (condition) => String(condition.left_operand).toLowerCase() === "stage"
      && condition.operator === "EQ"
      && typeof condition.right_operand === "string"
  );

  return stageCondition ? String(stageCondition.right_operand).toUpperCase() : null;
}

export async function listRules(filters) {
  const pool = await getSqlPool();

  const countRequest = pool.request();
  const whereSql = applyRulesFilterParams(countRequest, filters);
  const totalResult = await countRequest.query(`
    SELECT COUNT(*) AS total
    FROM dbo.cfg_offer_rule r
    INNER JOIN dbo.cfg_offer_ruleset rs ON rs.ruleset_id = r.ruleset_id
    WHERE ${whereSql}
  `);
  const total = Number(totalResult.recordset?.[0]?.total ?? 0);

  const offset = (filters.page - 1) * filters.pageSize;
  const idsRequest = pool.request();
  const idsWhereSql = applyRulesFilterParams(idsRequest, filters);
  idsRequest.input("offset", sql.Int, offset);
  idsRequest.input("pageSize", sql.Int, filters.pageSize);

  const pageIdsResult = await idsRequest.query(`
    SELECT r.rule_id
    FROM dbo.cfg_offer_rule r
    INNER JOIN dbo.cfg_offer_ruleset rs ON rs.ruleset_id = r.ruleset_id
    WHERE ${idsWhereSql}
    ORDER BY r.priority DESC, r.rule_id ASC
    OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
  `);

  const pageRuleIds = (pageIdsResult.recordset ?? []).map((row) => Number(row.rule_id));
  if (pageRuleIds.length === 0) {
    return {
      items: [],
      pagination: {
        page: filters.page,
        pageSize: filters.pageSize,
        total,
      },
    };
  }

  const detailRequest = pool.request();
  detailRequest.input("ruleIdsCsv", sql.NVarChar(sql.MAX), pageRuleIds.join(","));
  const result = await detailRequest.query(`
    SELECT
      rs.code AS offerCode,
      r.rule_id,
      r.name AS rule_name,
      r.priority,
      r.enabled,
      r.stop_processing,
      r.offer_date_id,
      c.cond_id,
      c.group_id,
      c.field AS left_operand,
      c.operator,
      c.value_type,
      c.value1,
      c.value2,
      cv.value AS in_value,
      a.action_id,
      a.action_type,
      a.field AS action_field,
      a.value AS action_value,
      a.value_type AS action_value_type
    FROM dbo.cfg_offer_rule r
    INNER JOIN dbo.cfg_offer_ruleset rs ON rs.ruleset_id = r.ruleset_id
    LEFT JOIN dbo.cfg_offer_rule_condition c ON c.rule_id = r.rule_id
    LEFT JOIN dbo.cfg_offer_rule_condition_value cv ON cv.cond_id = c.cond_id
    LEFT JOIN dbo.cfg_offer_rule_action a ON a.rule_id = r.rule_id
    WHERE r.rule_id IN (
      SELECT TRY_CAST(value AS INT)
      FROM STRING_SPLIT(@ruleIdsCsv, ',')
      WHERE TRY_CAST(value AS INT) IS NOT NULL
    )
    ORDER BY r.priority DESC, r.rule_id ASC, c.cond_id ASC, a.action_id ASC
  `);

  const rulesMap = new Map();
  const conditionKeys = new Set();
  const actionKeys = new Set();

  for (const row of result.recordset ?? []) {
    const ruleId = row.rule_id;
    if (!rulesMap.has(ruleId)) {
      rulesMap.set(ruleId, {
        rule_id: ruleId,
        offerCode: row.offerCode,
        stage: null,
        rule_name: row.rule_name,
        priority: row.priority,
        enabled: row.enabled === true,
        stop_processing: row.stop_processing === true,
        offer_date_id: row.offer_date_id,
        actions: [],
        conditions: [],
      });
    }

    const rule = rulesMap.get(ruleId);

    if (row.action_id) {
      const actionKey = `${ruleId}:${row.action_id}`;
      if (!actionKeys.has(actionKey)) {
        actionKeys.add(actionKey);
        const action = mapActionFromRow(row);
        if (action) {
          rule.actions.push(action);
        }
      }
    }

    if (!row.cond_id) {
      continue;
    }

    const conditionKey = `${ruleId}:${row.cond_id}`;
    if (!conditionKeys.has(conditionKey)) {
      conditionKeys.add(conditionKey);
      const isInOperator = row.operator === "IN" || row.operator === "NOT_IN";
      const isParamRef = isInOperator && typeof row.value1 === "string" && row.value1.startsWith("PARAM:");
      rule.conditions.push({
        cond_id: row.cond_id,
        group_id: row.group_id,
        left_operand: row.left_operand,
        operator: row.operator,
        value_type: row.value_type,
        right_operand: isInOperator ? (isParamRef ? row.value1 : []) : row.value1,
        value2: row.value2,
      });
    }

    if (row.in_value !== null && row.in_value !== undefined) {
      const condition = rule.conditions.find((item) => item.cond_id === row.cond_id);
      if (condition && Array.isArray(condition.right_operand)) {
        condition.right_operand.push(row.in_value);
      }
    }
  }

  const items = Array.from(rulesMap.values()).map((rule) => {
    const stage = inferStage(rule.conditions);
    return {
      ...rule,
      stage,
      conditions: rule.conditions.map(({ cond_id, ...condition }) => condition),
    };
  });

  return {
    items,
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
    },
  };
}

export async function createRule(payload) {
  const pool = await getSqlPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    const rulesetId = await findRulesetIdByOfferCode(tx, payload.offerCode);
    const insertRuleRequest = tx.request();
    insertRuleRequest.input("rulesetId", sql.Int, rulesetId);
    insertRuleRequest.input("name", sql.NVarChar(200), payload.rule_name);
    insertRuleRequest.input("priority", sql.Int, payload.priority);
    insertRuleRequest.input("enabled", sql.Bit, payload.enabled ? 1 : 0);
    insertRuleRequest.input("offerDateId", sql.Int, payload.offer_date_id);

    insertRuleRequest.input("stopProcessing", sql.Bit, payload.stop_processing ? 1 : 0);

    const insertRuleResult = await insertRuleRequest.query(`
      INSERT INTO dbo.cfg_offer_rule (ruleset_id, name, priority, enabled, offer_date_id, stop_processing)
      OUTPUT INSERTED.rule_id
      VALUES (@rulesetId, @name, @priority, @enabled, @offerDateId, @stopProcessing)
    `);

    const ruleId = insertRuleResult.recordset?.[0]?.rule_id;
    if (!ruleId) {
      throw new AppError("No se pudo crear la regla.", 500);
    }

    await insertRuleConditions(tx, ruleId, payload.conditions);
    for (const action of (Array.isArray(payload.actions) ? payload.actions : [])) {
      await insertRuleAction(tx, ruleId, action);
    }

    await tx.commit();
    return { rule_id: ruleId };
  } catch (error) {
    await tx.rollback();
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("Error creando regla en SQL Server.", 500, { cause: error.message });
  }
}

export async function updateRule(ruleId, payload) {
  const pool = await getSqlPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    const request = tx.request();
    request.input("ruleId", sql.Int, ruleId);
    const existing = await request.query(`
      SELECT rule_id
      FROM dbo.cfg_offer_rule
      WHERE rule_id = @ruleId
    `);
    if (!existing.recordset?.length) {
      throw new AppError(`No existe rule_id ${ruleId}.`, 404);
    }

    const rulesetId = await findRulesetIdByOfferCode(tx, payload.offerCode);

    const updateRequest = tx.request();
    updateRequest.input("ruleId", sql.Int, ruleId);
    updateRequest.input("rulesetId", sql.Int, rulesetId);
    updateRequest.input("name", sql.NVarChar(200), payload.rule_name);
    updateRequest.input("priority", sql.Int, payload.priority);
    updateRequest.input("enabled", sql.Bit, payload.enabled ? 1 : 0);
    updateRequest.input("stopProcessing", sql.Bit, payload.stop_processing ? 1 : 0);
    updateRequest.input("offerDateId", sql.Int, payload.offer_date_id);
    await updateRequest.query(`
      UPDATE dbo.cfg_offer_rule
      SET
        ruleset_id      = @rulesetId,
        name            = @name,
        priority        = @priority,
        enabled         = @enabled,
        stop_processing = @stopProcessing,
        offer_date_id = @offerDateId
      WHERE rule_id = @ruleId
    `);

    const deleteValuesRequest = tx.request();
    deleteValuesRequest.input("ruleId", sql.Int, ruleId);
    await deleteValuesRequest.query(`
      DELETE cv
      FROM dbo.cfg_offer_rule_condition_value cv
      INNER JOIN dbo.cfg_offer_rule_condition c ON c.cond_id = cv.cond_id
      WHERE c.rule_id = @ruleId
    `);

    const deleteConditionsRequest = tx.request();
    deleteConditionsRequest.input("ruleId", sql.Int, ruleId);
    await deleteConditionsRequest.query(`
      DELETE FROM dbo.cfg_offer_rule_condition
      WHERE rule_id = @ruleId
    `);

    const deleteActionsRequest = tx.request();
    deleteActionsRequest.input("ruleId", sql.Int, ruleId);
    await deleteActionsRequest.query(`
      DELETE FROM dbo.cfg_offer_rule_action
      WHERE rule_id = @ruleId
    `);

    await insertRuleConditions(tx, ruleId, payload.conditions);
    for (const action of (Array.isArray(payload.actions) ? payload.actions : [])) {
      await insertRuleAction(tx, ruleId, action);
    }

    await tx.commit();
    return { rule_id: ruleId, updated: true };
  } catch (error) {
    await tx.rollback();
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("Error actualizando regla en SQL Server.", 500, { cause: error.message });
  }
}

export async function deleteRule(ruleId) {
  const pool = await getSqlPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    const deleteValuesRequest = tx.request();
    deleteValuesRequest.input("ruleId", sql.Int, ruleId);
    await deleteValuesRequest.query(`
      DELETE cv
      FROM dbo.cfg_offer_rule_condition_value cv
      INNER JOIN dbo.cfg_offer_rule_condition c ON c.cond_id = cv.cond_id
      WHERE c.rule_id = @ruleId
    `);

    const deleteConditionsRequest = tx.request();
    deleteConditionsRequest.input("ruleId", sql.Int, ruleId);
    await deleteConditionsRequest.query(`
      DELETE FROM dbo.cfg_offer_rule_condition
      WHERE rule_id = @ruleId
    `);

    const deleteActionsRequest = tx.request();
    deleteActionsRequest.input("ruleId", sql.Int, ruleId);
    await deleteActionsRequest.query(`
      DELETE FROM dbo.cfg_offer_rule_action
      WHERE rule_id = @ruleId
    `);

    const deleteRuleRequest = tx.request();
    deleteRuleRequest.input("ruleId", sql.Int, ruleId);
    const result = await deleteRuleRequest.query(`
      DELETE FROM dbo.cfg_offer_rule
      WHERE rule_id = @ruleId
    `);

    if ((result.rowsAffected?.[0] ?? 0) === 0) {
      throw new AppError(`No existe rule_id ${ruleId}.`, 404);
    }

    await tx.commit();
    return { rule_id: ruleId, deleted: true };
  } catch (error) {
    await tx.rollback();
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("Error eliminando regla en SQL Server.", 500, { cause: error.message });
  }
}

export async function setRuleEnabled(ruleId, enabled) {
  const pool = await getSqlPool();
  const request = pool.request();
  request.input("ruleId", sql.Int, ruleId);
  request.input("enabled", sql.Bit, enabled ? 1 : 0);

  const result = await request.query(`
    UPDATE dbo.cfg_offer_rule
    SET enabled = @enabled
    WHERE rule_id = @ruleId
  `);

  if ((result.rowsAffected?.[0] ?? 0) === 0) {
    throw new AppError(`No existe rule_id ${ruleId}.`, 404);
  }

  return {
    rule_id: ruleId,
    enabled,
  };
}

export async function reorderRules(payload) {
  const pool = await getSqlPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    const rulesetId = await findRulesetIdByOfferCode(tx, payload.offerCode);

    for (const item of payload.items) {
      const updateRequest = tx.request();
      updateRequest.input("ruleId", sql.Int, item.rule_id);
      updateRequest.input("priority", sql.Int, item.priority);
      updateRequest.input("rulesetId", sql.Int, rulesetId);
      updateRequest.input("stage", sql.NVarChar(10), String(payload.stage).toUpperCase());

      const result = await updateRequest.query(`
        UPDATE r
        SET r.priority = @priority
        FROM dbo.cfg_offer_rule r
        WHERE r.rule_id = @ruleId
          AND r.ruleset_id = @rulesetId
          AND EXISTS (
            SELECT 1
            FROM dbo.cfg_offer_rule_condition c
            WHERE c.rule_id = r.rule_id
              AND c.field = 'stage'
              AND c.operator = 'EQ'
              AND UPPER(c.value1) = @stage
          )
      `);

      if ((result.rowsAffected?.[0] ?? 0) === 0) {
        throw new AppError(
          `No se puede reordenar rule_id ${item.rule_id}: no pertenece a ${payload.offerCode}/${payload.stage}.`,
          409
        );
      }
    }

    await tx.commit();
    return { updated: payload.items.length };
  } catch (error) {
    await tx.rollback();
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("Error reordenando reglas.", 500, { cause: error.message });
  }
}

export async function listParams(filters) {
  const pool = await getSqlPool();
  const request = pool.request();
  const where = ["p.enabled = 1"];

  if (filters.offerCode) {
    where.push("rs.code = @offerCode");
    request.input("offerCode", sql.NVarChar(50), filters.offerCode);
  }

  if (filters.offerDateId) {
    where.push("p.offer_date_id = @offerDateId");
    request.input("offerDateId", sql.Int, filters.offerDateId);
  }

  const result = await request.query(`
    SELECT p.param_id, rs.code AS offer_code, p.param_key, p.value_type, p.value, p.offer_date_id
    FROM dbo.cfg_offer_param p
    INNER JOIN dbo.cfg_offer_ruleset rs ON rs.ruleset_id = p.ruleset_id
    WHERE ${where.join(" AND ")}
    ORDER BY rs.code ASC, p.param_key ASC
  `);

  const grouped = new Map();
  for (const row of result.recordset ?? []) {
    if (!grouped.has(row.offer_code)) {
      grouped.set(row.offer_code, {
        offerCode: row.offer_code,
        paramValues: [],
      });
    }

    grouped.get(row.offer_code).paramValues.push({
      param_id: row.param_id,
      key: row.param_key,
      value: row.value,
      value_type: row.value_type,
      offer_date_id: row.offer_date_id ?? null,
    });
  }

  return {
    items: Array.from(grouped.values()),
  };
}

export async function validateRuleParamReferences(payload) {
  const references = [];

  for (const [index, condition] of (Array.isArray(payload?.conditions) ? payload.conditions : []).entries()) {
    const operand = String(condition?.right_operand ?? "").trim();
    if (operand.toUpperCase().startsWith("PARAM:")) {
      references.push({ field: `conditions[${index}].right_operand`, key: operand.slice(6).trim() });
    }
    const secondOperand = String(condition?.value2 ?? "").trim();
    if (secondOperand.toUpperCase().startsWith("PARAM:")) {
      references.push({ field: `conditions[${index}].value2`, key: secondOperand.slice(6).trim() });
    }
  }

  for (const [actionIndex, action] of (Array.isArray(payload?.actions) ? payload.actions : []).entries()) {
    const actionPayload = action?.action_payload ?? {};
    const actionValue = String(actionPayload.value ?? "").trim();
    if (actionValue.toUpperCase().startsWith("PARAM:")) {
      references.push({ field: `actions[${actionIndex}].action_payload.value`, key: actionValue.slice(6).trim() });
    }
  }

  const refList = references.filter((reference) => reference.key);
  if (refList.length === 0) {
    return [];
  }

  const params = await listParams({
    offerCode: payload.offerCode,
  });

  const availableKeys = new Set(
    params.items.flatMap((item) => item.paramValues.map((param) => String(param.key).trim().toUpperCase()))
  );

  const errors = [];
  for (const reference of refList) {
    if (!availableKeys.has(reference.key.toUpperCase())) {
      errors.push({
        field: reference.field,
        message: `La referencia PARAM:${reference.key} no existe en parametros para ${payload.offerCode}/${payload.stage}.`,
      });
    }
  }

  return errors;
}

export async function createParam(payload) {
  const pool = await getSqlPool();

  const rulesetId = await resolveRulesetId(pool, payload.offerCode);

  const request = pool.request();
  request.input("rulesetId", sql.Int, rulesetId);
  request.input("key", sql.NVarChar(100), payload.key);
  request.input("valueType", sql.NVarChar(10), normalizeValueType(payload.value_type));
  request.input("value", sql.NVarChar(200), String(payload.value));
  request.input("offerDateId", sql.Int, payload.offer_date_id);

  const insertResult = await request.query(`
    INSERT INTO dbo.cfg_offer_param (ruleset_id, param_key, value_type, value, offer_date_id, enabled)
    OUTPUT INSERTED.param_id
    SELECT @rulesetId, @key, @valueType, @value, @offerDateId, 1
    WHERE NOT EXISTS (
      SELECT 1 FROM dbo.cfg_offer_param
      WHERE ruleset_id = @rulesetId
        AND param_key = @key
        AND enabled = 1
    )
  `);

  const paramId = insertResult.recordset?.[0]?.param_id;
  if (!paramId) {
    throw new AppError("Ya existe un parametro activo con offerCode/stage/key.", 409);
  }

  return { param_id: paramId };
}

export async function updateParam(paramId, payload) {
  const pool = await getSqlPool();
  const request = pool.request();
  request.input("paramId", sql.Int, paramId);

  const exists = await request.query(`
    SELECT param_id
    FROM dbo.cfg_offer_param
    WHERE param_id = @paramId
  `);
  if (!exists.recordset?.length) {
    throw new AppError(`No existe param_id ${paramId}.`, 404);
  }

  const fields = [];
  if (payload.offerCode !== undefined) {
    const rulesetId = await resolveRulesetId(pool, payload.offerCode);
    fields.push("ruleset_id = @rulesetId");
    request.input("rulesetId", sql.Int, rulesetId);
  }
  if (payload.key !== undefined) {
    fields.push("param_key = @key");
    request.input("key", sql.NVarChar(100), payload.key);
  }
  if (payload.value_type !== undefined) {
    fields.push("value_type = @valueType");
    request.input("valueType", sql.NVarChar(10), normalizeValueType(payload.value_type));
  }
  if (payload.value !== undefined) {
    fields.push("value = @value");
    request.input("value", sql.NVarChar(200), String(payload.value));
  }
  if (payload.offer_date_id !== undefined) {
    fields.push("offer_date_id = @offerDateId");
    request.input("offerDateId", sql.Int, payload.offer_date_id);
  }

  fields.push("updated_at = SYSDATETIME()");

  const updateResult = await request.query(`
    UPDATE dbo.cfg_offer_param
    SET ${fields.join(", ")}
    WHERE param_id = @paramId
  `);

  if ((updateResult.rowsAffected?.[0] ?? 0) === 0) {
    throw new AppError(`No se pudo actualizar param_id ${paramId}.`, 500);
  }

  return { param_id: paramId, updated: true };
}

export async function deleteParam(paramId) {
  const pool = await getSqlPool();
  const request = pool.request();
  request.input("paramId", sql.Int, paramId);

  const result = await request.query(`
    UPDATE dbo.cfg_offer_param
    SET enabled = 0,
        updated_at = SYSDATETIME()
    WHERE param_id = @paramId
      AND enabled = 1
  `);

  if ((result.rowsAffected?.[0] ?? 0) === 0) {
    throw new AppError(`No existe param_id activo ${paramId}.`, 404);
  }

  return { param_id: paramId, deleted: true };
}

// ---------------------------------------------------------------------------
// Offers (cfg_offer_ruleset)
// ---------------------------------------------------------------------------

export async function listOffers() {
  const pool = await getSqlPool();
  const result = await pool.request().query(`
    SELECT ruleset_id, code AS offerCode, name, offer_rank, enabled, oferta_id
    FROM dbo.cfg_offer_ruleset
    ORDER BY offer_rank DESC, code ASC
  `);
  return { items: result.recordset ?? [] };
}

export async function listOffersInPeriod(offerDateId) {
  const pool = await getSqlPool();
  const request = pool.request();
  request.input("offerDateId", sql.Int, offerDateId);
  const result = await request.query(`
    SELECT DISTINCT
      rs.ruleset_id,
      rs.code AS offerCode,
      rs.name,
      rs.offer_rank,
      rs.enabled,
      rs.oferta_id
    FROM dbo.cfg_offer_rule r
    INNER JOIN dbo.cfg_offer_ruleset rs ON rs.ruleset_id = r.ruleset_id
    WHERE r.offer_date_id = @offerDateId
    ORDER BY rs.offer_rank DESC, rs.code ASC
  `);
  return { items: result.recordset ?? [] };
}

export async function createOffer(payload) {
  const pool = await getSqlPool();
  const request = pool.request();
  request.input("code", sql.NVarChar(50), String(payload.code).trim().toUpperCase());
  request.input("name", sql.NVarChar(200), payload.name);
  request.input("offerRank", sql.Int, Number(payload.offer_rank) || 0);
  request.input("enabled", sql.Bit, payload.enabled ? 1 : 0);
  request.input("ofertaId", sql.Int, Number(payload.oferta_id) || 0);

  const result = await request.query(`
    INSERT INTO dbo.cfg_offer_ruleset (oferta_id, offer_rank, code, name, enabled, published_version)
    OUTPUT INSERTED.ruleset_id
    VALUES (@ofertaId, @offerRank, @code, @name, @enabled, 1)
  `);

  const rulesetId = result.recordset?.[0]?.ruleset_id;
  if (!rulesetId) {
    throw new AppError("No se pudo crear la oferta.", 500);
  }
  return { ruleset_id: rulesetId, offerCode: String(payload.code).trim().toUpperCase() };
}

export async function updateOffer(offerCode, payload) {
  const pool = await getSqlPool();
  const request = pool.request();
  request.input("offerCode", sql.NVarChar(50), offerCode);

  const fields = [];
  if (payload.code !== undefined) {
    fields.push("code = @newCode");
    request.input("newCode", sql.NVarChar(50), String(payload.code).trim().toUpperCase());
  }
  if (payload.name !== undefined) {
    fields.push("name = @name");
    request.input("name", sql.NVarChar(200), payload.name);
  }
  if (payload.offer_rank !== undefined) {
    fields.push("offer_rank = @offerRank");
    request.input("offerRank", sql.Int, Number(payload.offer_rank));
  }
  if (payload.enabled !== undefined) {
    fields.push("enabled = @enabled");
    request.input("enabled", sql.Bit, payload.enabled ? 1 : 0);
  }
  if (payload.oferta_id !== undefined) {
    fields.push("oferta_id = @ofertaId");
    request.input("ofertaId", sql.Int, Number(payload.oferta_id));
  }

  if (fields.length === 0) {
    throw new AppError("No se proporcionaron campos para actualizar.", 400);
  }

  const result = await request.query(`
    UPDATE dbo.cfg_offer_ruleset
    SET ${fields.join(", ")}
    WHERE code = @offerCode
  `);

  if ((result.rowsAffected?.[0] ?? 0) === 0) {
    throw new AppError(`No existe oferta con código '${offerCode}'.`, 404);
  }

  const newCode = payload.code ? String(payload.code).trim().toUpperCase() : null;
  return { offerCode: newCode ?? offerCode, updated: true };
}

export async function deleteOffer(offerCode, createdBy = null) {
  // 1. Snapshot automático ANTES de abrir la transacción (captura estado intacto).
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const snapshotName = `Grabacion ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const snapshotComment = `Auto: antes de borrar oferta ${offerCode} (cascada)`;
  const snapshot_id = await createSnapshot(snapshotName, snapshotComment, createdBy);

  // 2. Transacción para el borrado en cascada.
  const pool = await getSqlPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    // 3. Resolver ruleset_id sin filtro enabled (ofertas deshabilitadas también son borrables).
    const rulesetId = await resolveRulesetId(tx, offerCode);

    // 4. Seis DELETE ordenados por FK, todos keyed por @rulesetId.

    // 4a. condition_values (via JOIN: condition_value → condition → rule → ruleset)
    const delCvReq = tx.request();
    delCvReq.input("rulesetId", sql.Int, rulesetId);
    await delCvReq.query(`
      DELETE cv
      FROM dbo.cfg_offer_rule_condition_value cv
      INNER JOIN dbo.cfg_offer_rule_condition c ON c.cond_id = cv.cond_id
      INNER JOIN dbo.cfg_offer_rule r ON r.rule_id = c.rule_id
      WHERE r.ruleset_id = @rulesetId
    `);

    // 4b. conditions (via JOIN: condition → rule → ruleset)
    const delCondReq = tx.request();
    delCondReq.input("rulesetId", sql.Int, rulesetId);
    await delCondReq.query(`
      DELETE c
      FROM dbo.cfg_offer_rule_condition c
      INNER JOIN dbo.cfg_offer_rule r ON r.rule_id = c.rule_id
      WHERE r.ruleset_id = @rulesetId
    `);

    // 4c. actions (via JOIN: action → rule → ruleset)
    const delActReq = tx.request();
    delActReq.input("rulesetId", sql.Int, rulesetId);
    await delActReq.query(`
      DELETE a
      FROM dbo.cfg_offer_rule_action a
      INNER JOIN dbo.cfg_offer_rule r ON r.rule_id = a.rule_id
      WHERE r.ruleset_id = @rulesetId
    `);

    // 4d. rules → capturar deletedRules
    const delRulesReq = tx.request();
    delRulesReq.input("rulesetId", sql.Int, rulesetId);
    const rulesResult = await delRulesReq.query(`
      DELETE FROM dbo.cfg_offer_rule WHERE ruleset_id = @rulesetId
    `);
    const deletedRules = rulesResult.rowsAffected?.[0] ?? 0;

    // 4e. params (sin filtro enabled, incluye soft-deleted) → capturar deletedParams
    const delParamsReq = tx.request();
    delParamsReq.input("rulesetId", sql.Int, rulesetId);
    const paramsResult = await delParamsReq.query(`
      DELETE FROM dbo.cfg_offer_param WHERE ruleset_id = @rulesetId
    `);
    const deletedParams = paramsResult.rowsAffected?.[0] ?? 0;

    // 4f. ruleset
    const delRulesetReq = tx.request();
    delRulesetReq.input("rulesetId", sql.Int, rulesetId);
    await delRulesetReq.query(`
      DELETE FROM dbo.cfg_offer_ruleset WHERE ruleset_id = @rulesetId
    `);

    await tx.commit();
    return { offerCode, deleted: true, snapshot_id, deletedRules, deletedParams };
  } catch (error) {
    await tx.rollback();
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("Error eliminando oferta en SQL Server.", 500, { cause: error.message });
  }
}

export async function deleteRulesForOfferInPeriod(offerCode, offerDateId, createdBy = null) {
  // 1. Snapshot automático ANTES de abrir la transacción (ADR-3: patrón idéntico a deleteOffer).
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const snapshotName = `Grabacion ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const snapshotComment = `Auto: antes de borrar reglas de oferta ${offerCode} en período ${offerDateId}`;
  const snapshot_id = await createSnapshot(snapshotName, snapshotComment, createdBy);

  // 2. Transacción para el borrado en cascada (period-scoped).
  const pool = await getSqlPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    // 3. Resolver ruleset_id (sin filtro enabled — igual que deleteOffer).
    const rulesetId = await resolveRulesetId(tx, offerCode);

    // 4. Cinco DELETE ordenados por FK, todos keyed por @rulesetId AND @offerDateId.

    // 4a. condition_values (cv → condition → rule → ruleset AND offer_date_id)
    const delCvReq = tx.request();
    delCvReq.input("rulesetId", sql.Int, rulesetId);
    delCvReq.input("offerDateId", sql.Int, offerDateId);
    await delCvReq.query(`
      DELETE cv
      FROM dbo.cfg_offer_rule_condition_value cv
      INNER JOIN dbo.cfg_offer_rule_condition c ON c.cond_id = cv.cond_id
      INNER JOIN dbo.cfg_offer_rule r ON r.rule_id = c.rule_id
      WHERE r.ruleset_id = @rulesetId
        AND r.offer_date_id = @offerDateId
    `);

    // 4b. conditions (condition → rule → ruleset AND offer_date_id)
    const delCondReq = tx.request();
    delCondReq.input("rulesetId", sql.Int, rulesetId);
    delCondReq.input("offerDateId", sql.Int, offerDateId);
    await delCondReq.query(`
      DELETE c
      FROM dbo.cfg_offer_rule_condition c
      INNER JOIN dbo.cfg_offer_rule r ON r.rule_id = c.rule_id
      WHERE r.ruleset_id = @rulesetId
        AND r.offer_date_id = @offerDateId
    `);

    // 4c. actions (action → rule → ruleset AND offer_date_id)
    const delActReq = tx.request();
    delActReq.input("rulesetId", sql.Int, rulesetId);
    delActReq.input("offerDateId", sql.Int, offerDateId);
    await delActReq.query(`
      DELETE a
      FROM dbo.cfg_offer_rule_action a
      INNER JOIN dbo.cfg_offer_rule r ON r.rule_id = a.rule_id
      WHERE r.ruleset_id = @rulesetId
        AND r.offer_date_id = @offerDateId
    `);

    // 4d. rules → capturar deletedRules
    const delRulesReq = tx.request();
    delRulesReq.input("rulesetId", sql.Int, rulesetId);
    delRulesReq.input("offerDateId", sql.Int, offerDateId);
    const rulesResult = await delRulesReq.query(`
      DELETE FROM dbo.cfg_offer_rule
      WHERE ruleset_id = @rulesetId
        AND offer_date_id = @offerDateId
    `);
    const deletedRules = rulesResult.rowsAffected?.[0] ?? 0;

    // 4e. params (sin filtro enabled, incluye soft-deleted) → capturar deletedParams
    const delParamsReq = tx.request();
    delParamsReq.input("rulesetId", sql.Int, rulesetId);
    delParamsReq.input("offerDateId", sql.Int, offerDateId);
    const paramsResult = await delParamsReq.query(`
      DELETE FROM dbo.cfg_offer_param
      WHERE ruleset_id = @rulesetId
        AND offer_date_id = @offerDateId
    `);
    const deletedParams = paramsResult.rowsAffected?.[0] ?? 0;

    // cfg_offer_ruleset NO se toca (ADR-2).

    await tx.commit();
    return { offerCode, offerDateId, deleted: true, snapshot_id, deletedRules, deletedParams };
  } catch (error) {
    await tx.rollback();
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("Error eliminando reglas de oferta en SQL Server.", 500, { cause: error.message });
  }
}

export async function setOfferEnabled(offerCode, enabled) {
  const pool = await getSqlPool();
  const request = pool.request();
  request.input("offerCode", sql.NVarChar(50), offerCode);
  request.input("enabled", sql.Bit, enabled ? 1 : 0);

  const result = await request.query(`
    UPDATE dbo.cfg_offer_ruleset SET enabled = @enabled WHERE code = @offerCode
  `);

  if ((result.rowsAffected?.[0] ?? 0) === 0) {
    throw new AppError(`No existe oferta con código '${offerCode}'.`, 404);
  }

  return { offerCode, enabled };
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export async function createSnapshot(name, comment, createdBy) {
  const { rules, params } = await exportConfig();

  const pool = await getSqlPool();
  const request = pool.request();
  request.input("name", sql.NVarChar(200), name);
  request.input("comment", sql.NVarChar(1000), comment ?? null);
  request.input("createdBy", sql.NVarChar(100), createdBy ?? null);
  // OWASP-10: rulesJson/paramsJson MUST be the exact strings passed to the
  // INSERT below — computeSnapshotChecksum is never called on a re-serialized
  // object (see design.md's critical invariant).
  const rulesJson = JSON.stringify(rules);
  const paramsJson = JSON.stringify(params);
  request.input("rulesJson", sql.NVarChar(sql.MAX), rulesJson);
  request.input("paramsJson", sql.NVarChar(sql.MAX), paramsJson);
  const checksum = computeSnapshotChecksum(rulesJson, paramsJson, env.snapshot.hmacSecret);
  request.input("checksum", sql.NVarChar(64), checksum);

  const result = await request.query(`
    INSERT INTO dbo.cfg_config_snapshot (snapshot_name, comment, created_by, rules_json, params_json, checksum)
    OUTPUT INSERTED.snapshot_id
    VALUES (@name, @comment, @createdBy, @rulesJson, @paramsJson, @checksum)
  `);

  const snapshotId = result.recordset?.[0]?.snapshot_id;
  if (!snapshotId) {
    throw new AppError("No se pudo crear el snapshot.", 500);
  }
  return snapshotId;
}

export async function listSnapshots(filters) {
  const pool = await getSqlPool();

  function buildWhere(request) {
    const where = ["1=1"];
    if (filters.dateFrom) {
      where.push("created_at >= @dateFrom");
      request.input("dateFrom", sql.DateTime2, new Date(filters.dateFrom));
    }
    if (filters.dateTo) {
      where.push("created_at < DATEADD(day, 1, CAST(@dateTo AS DATE))");
      request.input("dateTo", sql.NVarChar(20), String(filters.dateTo).substring(0, 10));
    }
    if (filters.q) {
      where.push(
        "(snapshot_name LIKE @q OR ISNULL(comment, '') LIKE @q OR ISNULL(created_by, '') LIKE @q)"
      );
      request.input("q", sql.NVarChar(220), `%${filters.q}%`);
    }
    if (filters.entorno) {
      where.push("ISNULL(entorno_cd, 'POC') = @entorno");
      request.input("entorno", sql.VarChar(5), String(filters.entorno).toUpperCase());
    }
    return where.join(" AND ");
  }

  const countReq = pool.request();
  const countWhere = buildWhere(countReq);
  const countResult = await countReq.query(
    `SELECT COUNT(*) AS total FROM dbo.cfg_config_snapshot WHERE ${countWhere}`
  );
  const total = Number(countResult.recordset?.[0]?.total ?? 0);

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const dataReq = pool.request();
  const dataWhere = buildWhere(dataReq);
  dataReq.input("offset", sql.Int, offset);
  dataReq.input("pageSize", sql.Int, pageSize);

  const dataResult = await dataReq.query(`
    SELECT snapshot_id, snapshot_name, comment, created_by, created_at, ISNULL(entorno_cd, 'POC') AS entorno_cd
    FROM dbo.cfg_config_snapshot
    WHERE ${dataWhere}
    ORDER BY created_at DESC
    OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
  `);

  return {
    items: dataResult.recordset ?? [],
    pagination: { page, pageSize, total },
  };
}

export async function deleteSnapshot(snapshotId) {
  const pool = await getSqlPool();
  const request = pool.request();
  request.input("snapshotId", sql.Int, snapshotId);
  const result = await request.query(`
    DELETE FROM dbo.cfg_config_snapshot WHERE snapshot_id = @snapshotId
  `);
  if ((result.rowsAffected?.[0] ?? 0) === 0) {
    throw new AppError(`No existe snapshot_id ${snapshotId}.`, 404);
  }
  return { snapshot_id: snapshotId, deleted: true };
}

// ---------------------------------------------------------------------------
// Pure helper: compute the new period's valid_to when it needs to be capped
// by the next existing period's valid_from.
//
// ADR-003: half-open interval [from, to) — close = exact next valid_from.
// NO setUTCDate(-1), no day subtraction, no DATEADD(day,-1,...).
// The read SPs use HASTA_DT > @DATE (strict >), so valid_to = nextFrom is
// gapless: the closing period excludes [nextFrom, ∞) and the next period
// includes [nextFrom, ...).
//
// Exported for unit testing (no DB, no I/O).
//
// @param {Date|string|null} nextFrom — valid_from of the next period
// @returns {Date|null}
// ---------------------------------------------------------------------------
export function computeNewValidTo(nextFrom) {
  if (!nextFrom) return null;
  return normalizeVigenciaToSecond(nextFrom);
}

export function transformWfToPoc(rulesJson, paramsJson, ofertaIdToPocCode = new Map()) {
  const isArray = Array.isArray(rulesJson);
  const ofertas = isArray ? [] : (rulesJson.ofertas ?? []);
  const reglas = isArray ? rulesJson : (rulesJson.reglas ?? []);
  const wfParams = isArray ? (Array.isArray(paramsJson) ? paramsJson : []) : (rulesJson.params ?? []);

  // Build WF oferta_id → offer code map. POC code (from cfg_offer_ruleset via ofertaIdToPocCode)
  // takes precedence over the WF offer code (OFERTA_CD), which may differ from the POC code.
  // Legacy snapshots (pre OFERTA_CD field) carry the offer code in NOMBRE_REGLA_TXT, so we
  // fall back to it. Falls back to WF code if no POC mapping found.
  const ofertaIdToCode = new Map();
  for (const o of ofertas) {
    if (o.OFERTA_ID != null) {
      const pocCode = ofertaIdToPocCode.get(Number(o.OFERTA_ID));
      ofertaIdToCode.set(Number(o.OFERTA_ID), pocCode ?? String(o.OFERTA_CD ?? o.NOMBRE_REGLA_TXT ?? ""));
    }
  }
  for (const r of reglas) {
    if (r.OFERTA_ID != null) {
      const pocCode = ofertaIdToPocCode.get(Number(r.OFERTA_ID));
      ofertaIdToCode.set(Number(r.OFERTA_ID), pocCode ?? String(r.OFERTA_CD ?? r.NOMBRE_REGLA_TXT ?? ""));
    }
  }

  const rules = reglas.map((r) => ({
    offerCode: ofertaIdToCode.get(Number(r.OFERTA_ID)) ?? String(r.OFERTA_CD ?? r.NOMBRE_REGLA_TXT ?? ""),
    // NOMBRE_REGLA_TXT now carries the rule description (MOTORREGLA_DS). Presence of
    // OFERTA_CD marks a new-format snapshot; legacy snapshots put the offer code in
    // NOMBRE_REGLA_TXT and have no rule name, so we fall back to "WF #<id>".
    rule_name:
      r.OFERTA_CD != null && String(r.NOMBRE_REGLA_TXT ?? "").trim() !== ""
        ? String(r.NOMBRE_REGLA_TXT)
        : `WF #${r.REGLA_ID ?? "?"}`,
    priority: Number(r.PRIORIDAD_NM ?? 0),
    enabled: 1,
    stop_processing: r.STOP_PROCESSING_CD ? 1 : 0,
    offer_date_id: null,
    conditions: (r.condiciones ?? []).map((c) => {
      const op = String(c.OPERADOR_TXT ?? "").toUpperCase();
      const isIn = op === "IN" || op === "NOT_IN";
      const hasValues = isIn && (c.valores ?? []).length > 0;
      return {
        group_id: Number(c.GRUPO_ID ?? 0),
        left_operand: String(c.CAMPO_TXT ?? ""),
        operator: op,
        value_type: String(c.TIPO_VALOR_TXT ?? "STRING"),
        right_operand: hasValues ? c.valores.map((v) => String(v.VALOR_TXT ?? "")) : (c.VALOR1_TXT ?? null),
        value2: c.VALOR2_TEXT ?? null,
      };
    }),
    actions: (r.acciones ?? []).map((a) => ({
      action_type: String(a.TIPO_ACCION_TXT ?? "SET"),
      field: String(a.CAMPO_TXT ?? ""),
      value: String(a.VALOR_TXT ?? ""),
      value_type: String(a.TIPO_VALOR_TXT ?? "STRING"),
    })),
  }));

  // Use Map<key, param> per offerCode to deduplicate — WF snapshots taken without a
  // date filter include params from multiple vigencia periods, which would create
  // duplicate param keys for the same offer when inserted into a single POC period.
  const paramsByCode = new Map();
  for (const p of wfParams) {
    const offerCode = ofertaIdToCode.get(Number(p.OFERTA_ID)) ?? "";
    if (!offerCode) continue;
    if (!paramsByCode.has(offerCode)) paramsByCode.set(offerCode, new Map());
    const key = String(p.PARAM_KEY_TXT ?? "");
    paramsByCode.get(offerCode).set(key, {
      key,
      value_type: String(p.TIPO_VALOR_TXT ?? "STRING"),
      value: String(p.VALOR_TXT ?? ""),
      offer_date_id: null,
    });
  }
  const params = Array.from(paramsByCode.entries()).map(([offerCode, paramsMap]) => ({
    offerCode,
    paramValues: Array.from(paramsMap.values()),
  }));

  return { rules, params };
}

export async function restoreSnapshot(snapshotId, { createdBy, destino = "POC", rangoDestino, ofertaIdOverrides, pocFechaDesde } = {}) {
  const pool = await getSqlPool();
  const getReq = pool.request();
  getReq.input("snapshotId", sql.Int, snapshotId);
  const getResult = await getReq.query(`
    SELECT snapshot_id, snapshot_name, entorno_cd, rules_json, params_json, checksum
    FROM dbo.cfg_config_snapshot
    WHERE snapshot_id = @snapshotId
  `);

  const row = getResult.recordset?.[0];
  if (!row) {
    throw new AppError(`No existe snapshot_id ${snapshotId}.`, 404);
  }

  // OWASP-10: verify integrity BEFORE any transform/apply step, on the raw
  // persisted strings (before JSON.parse) — see design.md § "Momento de
  // verificación en restore".
  const verify = verifySnapshotChecksum({
    rulesJson: row.rules_json,
    paramsJson: row.params_json,
    storedChecksum: row.checksum,
    secret: env.snapshot.hmacSecret,
  });
  if (verify.status === "failed") {
    // Fix 4 (revision de codigo PR3, 2026-07-14): la manipulacion del contenido
    // no es la unica causa posible de un checksum que no coincide — rotar
    // JWT_SECRET sin definir un SNAPSHOT_HMAC_SECRET dedicado invalida en
    // silencio TODOS los checksums historicos (ver env.js § env.snapshot.hmacSecret
    // y design.md § Open Questions). El mensaje lo menciona como alternativa
    // honesta a la manipulacion, sin dejar de rechazar la restauracion.
    throw new AppError(
      "La integridad del snapshot no se pudo verificar: el contenido no coincide con su checksum. " +
        "Restauración cancelada. Esto puede deberse a manipulación del contenido o a una rotación " +
        "reciente de SNAPSHOT_HMAC_SECRET/JWT_SECRET sin migrar los checksums existentes.",
      409
    );
  }
  if (verify.status === "legacy") {
    console.warn(
      `Snapshot #${snapshotId} no tiene checksum (legado/no verificable) — restaurando sin verificacion de integridad.`
    );
  }
  // Fix 3 (revision de codigo PR3, 2026-07-14): checksumPresent es exactamente
  // "no es un snapshot legado" — derivarlo de verify.status evita una segunda
  // comprobacion independiente de row.checksum que podria divergir del status
  // ya calculado por verifySnapshotChecksum (misma fuente de verdad, sin
  // cambio de comportamiento: verifySnapshotChecksum ya devuelve "legacy"
  // exactamente cuando storedChecksum es null/"").
  const checksumPresent = verify.status !== "legacy";

  let rulesRaw;
  let paramsRaw;
  try {
    rulesRaw = JSON.parse(row.rules_json);
    paramsRaw = JSON.parse(row.params_json);
  } catch {
    throw new AppError("El snapshot contiene JSON invalido.", 500);
  }

  const isWfSnapshot = String(row.entorno_cd ?? "").toUpperCase() === "WF";

  // For WF snapshots, resolve POC offer codes via oferta_id FK before transforming.
  // WF uses HIPO_OFERTA.OFERTA_CD as text code; POC uses cfg_offer_ruleset.code — they may differ.
  let ofertaIdToPocCode = new Map();
  if (isWfSnapshot) {
    const wfData = rulesRaw && typeof rulesRaw === "object" && !Array.isArray(rulesRaw) ? rulesRaw : {};
    const allOfertaIds = [...new Set([
      ...(wfData.ofertas ?? []).map((o) => Number(o.OFERTA_ID)).filter(Boolean),
      ...(wfData.reglas ?? []).map((r) => Number(r.OFERTA_ID)).filter(Boolean),
      ...(wfData.params ?? []).map((p) => Number(p.OFERTA_ID)).filter(Boolean),
    ])];
    if (allOfertaIds.length > 0) {
      const mappingReq = pool.request();
      mappingReq.input("ids", sql.NVarChar(sql.MAX), allOfertaIds.join(","));
      const mappingResult = await mappingReq.query(`
        SELECT oferta_id, code FROM dbo.cfg_offer_ruleset
        WHERE oferta_id IN (SELECT TRY_CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))
      `);
      ofertaIdToPocCode = new Map(
        (mappingResult.recordset ?? []).map((r) => [Number(r.oferta_id), String(r.code)])
      );
    }
    // User-provided overrides reconcile id drift between WF and POC:
    // { pocCode: snapshotOfertaId } → force snapshotOfertaId to resolve to pocCode,
    // overriding the automatic cfg_offer_ruleset FK match above.
    if (ofertaIdOverrides && typeof ofertaIdOverrides === "object") {
      for (const [code, ofertaId] of Object.entries(ofertaIdOverrides)) {
        if (ofertaId != null) ofertaIdToPocCode.set(Number(ofertaId), String(code));
      }
    }
  }

  let { rules, params } = isWfSnapshot
    ? transformWfToPoc(rulesRaw, paramsRaw, ofertaIdToPocCode)
    : { rules: rulesRaw, params: paramsRaw };

  // Resolve target offer_date_id when restoring WF snapshot → POC
  if (isWfSnapshot && String(destino).toUpperCase() !== "WF") {
    if (!pocFechaDesde) {
      throw new AppError("pocFechaDesde es obligatorio para restaurar un snapshot WF en POC.", 400);
    }
    const fechaNorm = normalizeVigenciaToSecond(pocFechaDesde);
    const dateReq = pool.request();
    // ADR-003: exact valid_from = @fecha (second precision) — no CAST(... AS DATE).
    dateReq.input("fecha", sql.DateTime2(0), fechaNorm);
    const dateResult = await dateReq.query(`
      SELECT TOP 1 offer_date_id FROM dbo.cfg_offer_dates WHERE valid_from = @fecha
    `);
    let offerDateId = dateResult.recordset?.[0]?.offer_date_id ?? null;
    if (!offerDateId) {
      const hasRules = rules.length > 0;
      const hasParams = Array.isArray(params) && params.some((g) => (g.paramValues ?? []).length > 0);
      const tipoCd = hasRules && hasParams ? "AMBOS" : hasRules ? "REGLAS" : hasParams ? "PARAMS" : "AMBOS";

      // Close any earlier open period that would overlap — same logic as duplicateFecha.
      // ADR-003: close = exact @fecha (half-open [from, to)), no DATEADD(day,-1,...).
      // Periods starting BEFORE pocFechaDesde that still have valid_to=NULL would make the
      // SP return duplicate params for two simultaneously active periods.
      await pool.request()
        .input("fecha", sql.DateTime2(0), fechaNorm)
        .query(`
          UPDATE dbo.cfg_offer_dates
          SET valid_to = @fecha
          WHERE valid_to IS NULL AND valid_from < @fecha
        `);

      // Find the nearest period starting AFTER pocFechaDesde so we can cap the new period's
      // valid_to and avoid a forward overlap (e.g. existing period starting 2026-05-20 when
      // the new period is 2026-01-01).
      const nextReq = pool.request();
      nextReq.input("fecha", sql.DateTime2(0), fechaNorm);
      const nextResult = await nextReq.query(`
        SELECT TOP 1 valid_from FROM dbo.cfg_offer_dates
        WHERE valid_from > @fecha
        ORDER BY valid_from ASC
      `);
      const nextFrom = nextResult.recordset?.[0]?.valid_from ?? null;
      // ADR-003: newValidTo = nextFrom exactly — computeNewValidTo normalizes to Date|null.
      // No setUTCDate(-1), no day subtraction.
      const newValidTo = computeNewValidTo(nextFrom);

      const createReq = pool.request();
      createReq.input("validFrom", sql.DateTime2(0), fechaNorm);
      createReq.input("validTo", sql.DateTime2(0), newValidTo);
      createReq.input("tipoCd", sql.VarChar(10), tipoCd);
      createReq.input("descripcion", sql.NVarChar(200), `Restaurado de snapshot WF #${snapshotId}`);
      createReq.input("altaUsr", sql.NVarChar(100), createdBy ?? null);
      const createResult = await createReq.query(`
        INSERT INTO dbo.cfg_offer_dates (valid_from, valid_to, descripcion, tipo_cd, alta_usr)
        OUTPUT INSERTED.offer_date_id
        VALUES (@validFrom, @validTo, @descripcion, @tipoCd, @altaUsr)
      `);
      offerDateId = createResult.recordset?.[0]?.offer_date_id ?? null;
      if (!offerDateId) {
        throw new AppError("No se pudo crear el período de destino en cfg_offer_dates.", 500);
      }
    }
    rules = rules.map((r) => ({ ...r, offer_date_id: offerDateId }));
    params = params.map((g) => ({
      ...g,
      paramValues: (g.paramValues ?? []).map((p) => ({ ...p, offer_date_id: offerDateId })),
    }));
  }

  // Save current state as pre-restore backup
  const date = new Date().toISOString().replace("T", " ").substring(0, 16);
  const backupName = `Pre-restauracion ${date}`;
  const backupComment = `Auto: antes de restaurar snapshot #${snapshotId} ("${row.snapshot_name}")`;
  const preRestoreSnapshotId = await createSnapshot(backupName, backupComment, createdBy ?? null);

  const integrity = { status: verify.status, checksumPresent };

  if (String(destino).toUpperCase() === "WF") {
    if (!rangoDestino?.vigDesde) {
      throw new AppError("rangoDestino.vigDesde es obligatorio para destino WF.", 400);
    }
    const publishResult = await publishSnapshotToWorkflow(rules, params, rangoDestino, { ofertaIdOverrides });
    return { ...publishResult, preRestoreSnapshotId, integrity };
  }

  // Apply the restored config (POC) — scoped to offer_date_ids present in the payload.
  const applyResult = await applyConfig({ rules, params });
  return { ...applyResult, preRestoreSnapshotId, integrity };
}

export async function getSnapshotContent(snapshotId) {
  const pool = await getSqlPool();
  const req = pool.request();
  req.input("snapshotId", sql.Int, snapshotId);
  const result = await req.query(`
    SELECT snapshot_id, snapshot_name, entorno_cd, rules_json, params_json
    FROM dbo.cfg_config_snapshot
    WHERE snapshot_id = @snapshotId
  `);
  const row = result.recordset?.[0];
  if (!row) throw new AppError(`No existe snapshot_id ${snapshotId}.`, 404);

  let rules;
  let params;
  try {
    const rulesRaw = JSON.parse(row.rules_json);
    const paramsRaw = JSON.parse(row.params_json);
    const isWf = String(row.entorno_cd ?? "").toUpperCase() === "WF";
    if (isWf && rulesRaw && typeof rulesRaw === "object" && !Array.isArray(rulesRaw)) {
      rules = rulesRaw.reglas ?? rulesRaw;
      params = rulesRaw.params ?? paramsRaw;
    } else {
      rules = rulesRaw;
      params = paramsRaw;
    }
  } catch {
    rules = null;
    params = null;
  }

  return {
    snapshot_id: row.snapshot_id,
    snapshot_name: row.snapshot_name,
    entorno_cd: row.entorno_cd ?? "POC",
    rules,
    params,
  };
}

// ---------------------------------------------------------------------------
// Export / Apply (bulk config operations)
// ---------------------------------------------------------------------------

export async function exportConfig() {
  const [rulesResult, paramsResult] = await Promise.all([
    listRules({ page: 1, pageSize: 9999 }),
    listParams({}),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    rules: rulesResult.items,
    params: paramsResult.items,
  };
}

/**
 * Single source of truth for how a bulk-apply payload maps onto DB scope.
 * Both `applyConfig` (real DELETE/INSERT) and `computeApplyImpact` (read-only
 * SELECT COUNT preview) call this so their notion of "which offerCodes are
 * touched" and "which offer_date_id periods are in scope" can never drift
 * apart again (see design.md § "computeApplyImpact — read-only" for the two
 * bugs this fixed: a rules-only payload falsely showing param deletions in
 * the preview, and an offerCode present only in `payload.params` — no
 * corresponding `payload.rules` entries — being invisible to the preview).
 *
 * Pure/synchronous — no I/O. `options.deleteAllPeriods` mirrors the flag
 * `applyConfig`/`computeApplyImpact` already accept.
 *
 * @param {{rules: Array, params?: Array}} payload
 * @param {{deleteAllPeriods?: boolean}} [options]
 * @returns {{
 *   offerCodes: string[],
 *   paramOfferCodes: string[],
 *   hasParams: boolean,
 *   rulePeriodIdsCsv: string,
 *   paramPeriodIdsCsv: string,
 *   ruleScopeClause: string,
 *   directScopeClause: string,
 *   paramScopeClause: string,
 * }}
 */
export function deriveApplyScope(payload, options = {}) {
  const { deleteAllPeriods = false } = options;
  const hasParams = Array.isArray(payload.params);

  const offerCodes = [...new Set(payload.rules.map((r) => String(r.offerCode)))];
  const paramOfferCodes = hasParams
    ? [...new Set(payload.params.map((g) => String(g.offerCode)))]
    : [];

  // Collect offer_date_ids from payload to scope the DELETE when not doing a full replace.
  const rulePeriodIds = deleteAllPeriods
    ? null
    : [...new Set(payload.rules.map((r) => r.offer_date_id).filter((id) => id != null && Number(id) > 0))];
  const rulePeriodIdsCsv = rulePeriodIds !== null ? rulePeriodIds.join(",") : "";

  const paramPeriodIds = deleteAllPeriods || !hasParams
    ? null
    : [...new Set(
        payload.params.flatMap((g) =>
          (g.paramValues ?? []).map((p) => p.offer_date_id).filter((id) => id != null && Number(id) > 0)
        )
      )];
  const paramPeriodIdsCsv = paramPeriodIds !== null ? paramPeriodIds.join(",") : "";

  const ruleScopeClause = rulePeriodIdsCsv
    ? "AND r.offer_date_id IN (SELECT TRY_CAST(value AS INT) FROM STRING_SPLIT(@rulePeriodIdsCsv, ','))"
    : "";
  const directScopeClause = rulePeriodIdsCsv
    ? "AND offer_date_id IN (SELECT TRY_CAST(value AS INT) FROM STRING_SPLIT(@rulePeriodIdsCsv, ','))"
    : "";
  const paramScopeClause = paramPeriodIdsCsv
    ? "AND offer_date_id IN (SELECT TRY_CAST(value AS INT) FROM STRING_SPLIT(@paramPeriodIdsCsv, ','))"
    : "";

  return {
    offerCodes,
    paramOfferCodes,
    hasParams,
    rulePeriodIdsCsv,
    paramPeriodIdsCsv,
    ruleScopeClause,
    directScopeClause,
    paramScopeClause,
  };
}

export async function applyConfig(payload, options = {}) {
  // payload.rules : AdminRuleItem[] — rule_id ignored, new ones assigned
  // payload.params: AdminParamsItem[] | undefined — if absent, DB params untouched
  // options.deleteAllPeriods: when true, deletes rules/params across ALL periods for affected
  //   offer codes (used by "Grabar configuración" bulk replace). Default false — scopes the
  //   delete to only the offer_date_id values present in the payload, so other periods are
  //   not touched (correct for snapshot restore operations).
  const {
    offerCodes,
    paramOfferCodes,
    hasParams,
    rulePeriodIdsCsv,
    paramPeriodIdsCsv,
    ruleScopeClause,
    directScopeClause,
    paramScopeClause,
  } = deriveApplyScope(payload, options);

  const pool = await getSqlPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    // Cache ruleset IDs to avoid redundant round-trips
    const rulesetIdCache = new Map();
    for (const offerCode of offerCodes) {
      const rulesetId = await findRulesetIdByOfferCode(tx, offerCode);
      rulesetIdCache.set(offerCode, rulesetId);
    }

    // --- Delete existing rules (cascade) for affected offerCodes ---
    // Scoped to specific offer_date_ids unless deleteAllPeriods=true.
    for (const [, rulesetId] of rulesetIdCache) {
      const addInputs = (req) => {
        req.input("rulesetId", sql.Int, rulesetId);
        if (rulePeriodIdsCsv) req.input("rulePeriodIdsCsv", sql.NVarChar(sql.MAX), rulePeriodIdsCsv);
        return req;
      };

      await addInputs(tx.request()).query(`
        DELETE cv
        FROM dbo.cfg_offer_rule_condition_value cv
        INNER JOIN dbo.cfg_offer_rule_condition c ON c.cond_id = cv.cond_id
        INNER JOIN dbo.cfg_offer_rule r ON r.rule_id = c.rule_id
        WHERE r.ruleset_id = @rulesetId ${ruleScopeClause}
      `);

      await addInputs(tx.request()).query(`
        DELETE c
        FROM dbo.cfg_offer_rule_condition c
        INNER JOIN dbo.cfg_offer_rule r ON r.rule_id = c.rule_id
        WHERE r.ruleset_id = @rulesetId ${ruleScopeClause}
      `);

      await addInputs(tx.request()).query(`
        DELETE a
        FROM dbo.cfg_offer_rule_action a
        INNER JOIN dbo.cfg_offer_rule r ON r.rule_id = a.rule_id
        WHERE r.ruleset_id = @rulesetId ${ruleScopeClause}
      `);

      await addInputs(tx.request()).query(`
        DELETE FROM dbo.cfg_offer_rule WHERE ruleset_id = @rulesetId ${directScopeClause}
      `);
    }

    // --- Insert new rules ---
    let rulesApplied = 0;
    for (const rule of payload.rules) {
      const rulesetId = rulesetIdCache.get(String(rule.offerCode));
      const insertRuleReq = tx.request();
      insertRuleReq.input("rulesetId", sql.Int, rulesetId);
      insertRuleReq.input("name", sql.NVarChar(200), rule.rule_name);
      insertRuleReq.input("priority", sql.Int, Number(rule.priority) || 0);
      insertRuleReq.input("enabled", sql.Bit, rule.enabled ? 1 : 0);
      insertRuleReq.input("offerDateId", sql.Int, Number(rule.offer_date_id) || null);
      insertRuleReq.input("stopProcessing", sql.Bit, rule.stop_processing ? 1 : 0);

      const insertResult = await insertRuleReq.query(`
        INSERT INTO dbo.cfg_offer_rule (ruleset_id, name, priority, enabled, offer_date_id, stop_processing)
        OUTPUT INSERTED.rule_id
        VALUES (@rulesetId, @name, @priority, @enabled, @offerDateId, @stopProcessing)
      `);

      const newRuleId = insertResult.recordset?.[0]?.rule_id;
      if (!newRuleId) {
        throw new AppError(`No se pudo insertar la regla '${rule.rule_name}'.`, 500);
      }

      await insertRuleConditions(tx, newRuleId, rule.conditions ?? []);
      for (const action of (Array.isArray(rule.actions) ? rule.actions : [])) {
        await insertRuleAction(tx, newRuleId, action);
      }
      rulesApplied++;
    }

    // --- Handle params (only if provided in the payload) ---
    let paramsApplied = 0;
    if (hasParams) {
      for (const offerCode of paramOfferCodes) {
        const rulesetId = await resolveRulesetId(tx, offerCode);
        const disableReq = tx.request();
        disableReq.input("rulesetId", sql.Int, rulesetId);
        if (paramPeriodIdsCsv) disableReq.input("paramPeriodIdsCsv", sql.NVarChar(sql.MAX), paramPeriodIdsCsv);
        await disableReq.query(`
          UPDATE dbo.cfg_offer_param
          SET enabled = 0, updated_at = SYSDATETIME()
          WHERE ruleset_id = @rulesetId AND enabled = 1 ${paramScopeClause}
        `);
      }

      for (const group of payload.params) {
        const rulesetId = await resolveRulesetId(tx, group.offerCode);
        // Deduplicate params by key within each group — WF snapshots may include the same
        // param key from multiple vigencia periods, which would violate the unique index.
        const seenKeys = new Set();
        for (const param of (group.paramValues ?? [])) {
          const paramKey = String(param.key ?? "");
          if (seenKeys.has(paramKey)) continue;
          seenKeys.add(paramKey);
          const insertParamReq = tx.request();
          insertParamReq.input("rulesetId", sql.Int, rulesetId);
          insertParamReq.input("key", sql.NVarChar(100), paramKey);
          insertParamReq.input("valueType", sql.NVarChar(10), normalizeValueType(param.value_type));
          insertParamReq.input("value", sql.NVarChar(200), String(param.value));
          insertParamReq.input("offerDateId", sql.Int, Number(param.offer_date_id) || null);
          await insertParamReq.query(`
            INSERT INTO dbo.cfg_offer_param (ruleset_id, param_key, value_type, value, offer_date_id, enabled)
            VALUES (@rulesetId, @key, @valueType, @value, @offerDateId, 1)
          `);
          paramsApplied++;
        }
      }
    }

    await tx.commit();

    return { applied: { rules: rulesApplied, params: paramsApplied }, offerCodes };
  } catch (error) {
    await tx.rollback();
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("Error aplicando configuracion en SQL Server.", 500, { cause: error.message });
  }
}

// ---------------------------------------------------------------------------
// computeApplyImpact — read-only preview (OWASP-02)
// ---------------------------------------------------------------------------

/**
 * Read-only preview of what applyConfig(payload, options) would delete/insert.
 * Calls the SAME deriveApplyScope(payload, options) helper applyConfig calls,
 * so the two can never disagree on which offerCodes/periods are in scope —
 * then performs SELECT COUNT instead of DELETE/INSERT, and opens no
 * transaction — advisory only, never called by the real applyConfig
 * (see design.md § "computeApplyImpact — read-only").
 *
 * Bug fixes (code review, 2026-07-13):
 *  - A rules-only payload (no `params` key) used to always run the params
 *    COUNT query per offer, showing a false-positive paramsToDelete even
 *    though applyConfig's own params block is skipped entirely when
 *    `payload.params` is not an array. Now guarded by `hasParams`, mirroring
 *    applyConfig's `if (Array.isArray(payload.params))`.
 *  - An offerCode present only in `payload.params` (no corresponding
 *    `payload.rules` entries) used to be entirely invisible to this preview
 *    (the loop only iterated `offerCodes`, derived from `payload.rules`),
 *    even though applyConfig WOULD disable/insert its params. Now the loop
 *    iterates the union of `offerCodes` and `paramOfferCodes`; an offer with
 *    params-but-no-rules gets `rulesToDelete: 0, rulesToInsert: 0` (accurate —
 *    applyConfig's rule-delete loop never touches it) plus its real param
 *    counts.
 *
 * @param {{rules: Array, params?: Array}} payload
 * @param {{deleteAllPeriods?: boolean}} [options]
 * @returns {Promise<{
 *   offerCodes: string[],
 *   rulesToDelete: number, paramsToDelete: number,
 *   rulesToInsert: number, paramsToInsert: number,
 *   perOffer: Array<{offerCode: string, rulesToDelete: number, paramsToDelete: number, rulesToInsert: number, paramsToInsert: number}>
 * }>}
 */
export async function computeApplyImpact(payload, options = {}) {
  const {
    offerCodes,
    paramOfferCodes,
    hasParams,
    rulePeriodIdsCsv,
    paramPeriodIdsCsv,
    directScopeClause,
    paramScopeClause,
  } = deriveApplyScope(payload, options);

  const offerCodeSet = new Set(offerCodes);
  const paramOfferCodeSet = new Set(paramOfferCodes);
  // Union, preserving `offerCodes` order first (keeps existing callers/tests
  // that only have rules+params on the same offerCode unaffected).
  const allOfferCodes = [...offerCodes, ...paramOfferCodes.filter((code) => !offerCodeSet.has(code))];

  // rulesToInsert per offer — length of payload.rules grouped by offerCode.
  const rulesToInsertByOffer = new Map();
  for (const rule of payload.rules) {
    const code = String(rule.offerCode);
    rulesToInsertByOffer.set(code, (rulesToInsertByOffer.get(code) ?? 0) + 1);
  }

  // paramsToInsert per offer, deduplicated by key — mirrors applyConfig's seenKeys.
  const paramsToInsertByOffer = new Map();
  if (hasParams) {
    for (const group of payload.params) {
      const code = String(group.offerCode);
      const seenKeys = new Set();
      let count = 0;
      for (const param of (group.paramValues ?? [])) {
        const key = String(param.key ?? "");
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        count++;
      }
      paramsToInsertByOffer.set(code, (paramsToInsertByOffer.get(code) ?? 0) + count);
    }
  }

  const pool = await getSqlPool();
  const perOffer = [];
  let rulesToDelete = 0;
  let paramsToDelete = 0;

  for (const offerCode of allOfferCodes) {
    const rulesetId = await findRulesetIdByOfferCode(pool, offerCode);

    // Only offers that actually have rules in the payload get a rules-count
    // query — matches applyConfig, whose rule-delete loop is scoped to
    // `rulesetIdCache` (built from `offerCodes`, i.e. payload.rules only).
    let offerRulesToDelete = 0;
    if (offerCodeSet.has(offerCode)) {
      const rulesCountReq = pool.request();
      rulesCountReq.input("rulesetId", sql.Int, rulesetId);
      if (rulePeriodIdsCsv) rulesCountReq.input("rulePeriodIdsCsv", sql.NVarChar(sql.MAX), rulePeriodIdsCsv);
      const rulesCountResult = await rulesCountReq.query(`
        SELECT COUNT(*) AS cnt
        FROM dbo.cfg_offer_rule
        WHERE ruleset_id = @rulesetId ${directScopeClause}
      `);
      offerRulesToDelete = Number(rulesCountResult.recordset?.[0]?.cnt ?? 0);
    }

    // Bug A fix: only query params-count when the payload actually provides
    // `params` (mirrors applyConfig's `if (Array.isArray(payload.params))`).
    // Bug B fix: iterate `paramOfferCodeSet` (not just `offerCodeSet`) so an
    // offer with params-but-no-rules gets its own accurate count.
    let offerParamsToDelete = 0;
    if (hasParams && paramOfferCodeSet.has(offerCode)) {
      const paramsCountReq = pool.request();
      paramsCountReq.input("rulesetId", sql.Int, rulesetId);
      if (paramPeriodIdsCsv) paramsCountReq.input("paramPeriodIdsCsv", sql.NVarChar(sql.MAX), paramPeriodIdsCsv);
      const paramsCountResult = await paramsCountReq.query(`
        SELECT COUNT(*) AS cnt
        FROM dbo.cfg_offer_param
        WHERE ruleset_id = @rulesetId AND enabled = 1 ${paramScopeClause}
      `);
      offerParamsToDelete = Number(paramsCountResult.recordset?.[0]?.cnt ?? 0);
    }

    rulesToDelete += offerRulesToDelete;
    paramsToDelete += offerParamsToDelete;

    perOffer.push({
      offerCode,
      rulesToDelete: offerRulesToDelete,
      paramsToDelete: offerParamsToDelete,
      rulesToInsert: rulesToInsertByOffer.get(offerCode) ?? 0,
      paramsToInsert: paramsToInsertByOffer.get(offerCode) ?? 0,
    });
  }

  const rulesToInsert = payload.rules.length;
  const paramsToInsert = Array.from(paramsToInsertByOffer.values()).reduce((sum, n) => sum + n, 0);

  return { offerCodes: allOfferCodes, rulesToDelete, paramsToDelete, rulesToInsert, paramsToInsert, perOffer };
}

// ---------------------------------------------------------------------------
// Seed reset (D4-EXT — full-scope reset to the 6-offer seed configuration)
// ---------------------------------------------------------------------------

/**
 * Deletes every cfg_offer_ruleset row whose code is NOT one of the 6 seed
 * offers, cascading through condition_values -> conditions -> actions ->
 * rules -> params -> ruleset (mirrors applyConfig()'s own cascade DELETE,
 * scoped by ruleset_id instead of offerCode+period). Own transaction — runs
 * FIRST in resetToSeed() so non-seed data is gone before periods are touched.
 *
 * @returns {Promise<{ removedOfferCodes: string[] }>}
 */
export async function deleteNonSeedOffers() {
  const seedCodesCsv = SEED_OFFERS.map((offer) => offer.code).join(",");
  const pool = await getSqlPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    const findReq = tx.request();
    findReq.input("seedCodesCsv", sql.NVarChar(sql.MAX), seedCodesCsv);
    const findResult = await findReq.query(`
      SELECT ruleset_id, code
      FROM dbo.cfg_offer_ruleset
      WHERE code NOT IN (SELECT value FROM STRING_SPLIT(@seedCodesCsv, ','))
    `);
    const extraOffers = findResult.recordset ?? [];
    const removedOfferCodes = [];

    for (const { ruleset_id: rulesetId, code } of extraOffers) {
      const delCvReq = tx.request();
      delCvReq.input("rulesetId", sql.Int, rulesetId);
      await delCvReq.query(`
        DELETE cv
        FROM dbo.cfg_offer_rule_condition_value cv
        INNER JOIN dbo.cfg_offer_rule_condition c ON c.cond_id = cv.cond_id
        INNER JOIN dbo.cfg_offer_rule r ON r.rule_id = c.rule_id
        WHERE r.ruleset_id = @rulesetId
      `);

      const delCondReq = tx.request();
      delCondReq.input("rulesetId", sql.Int, rulesetId);
      await delCondReq.query(`
        DELETE c
        FROM dbo.cfg_offer_rule_condition c
        INNER JOIN dbo.cfg_offer_rule r ON r.rule_id = c.rule_id
        WHERE r.ruleset_id = @rulesetId
      `);

      const delActReq = tx.request();
      delActReq.input("rulesetId", sql.Int, rulesetId);
      await delActReq.query(`
        DELETE a
        FROM dbo.cfg_offer_rule_action a
        INNER JOIN dbo.cfg_offer_rule r ON r.rule_id = a.rule_id
        WHERE r.ruleset_id = @rulesetId
      `);

      const delRulesReq = tx.request();
      delRulesReq.input("rulesetId", sql.Int, rulesetId);
      await delRulesReq.query(`
        DELETE FROM dbo.cfg_offer_rule WHERE ruleset_id = @rulesetId
      `);

      // cfg_offer_param has a real enforced FK to cfg_offer_ruleset(ruleset_id)
      // (data_model.sql) — must be deleted before the ruleset row.
      const delParamsReq = tx.request();
      delParamsReq.input("rulesetId", sql.Int, rulesetId);
      await delParamsReq.query(`
        DELETE FROM dbo.cfg_offer_param WHERE ruleset_id = @rulesetId
      `);

      const delRulesetReq = tx.request();
      delRulesetReq.input("rulesetId", sql.Int, rulesetId);
      await delRulesetReq.query(`
        DELETE FROM dbo.cfg_offer_ruleset WHERE ruleset_id = @rulesetId
      `);

      removedOfferCodes.push(code);
    }

    await tx.commit();
    return { removedOfferCodes };
  } catch (error) {
    await tx.rollback();
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("Error eliminando ofertas no-semilla en SQL Server.", 500, { cause: error.message });
  }
}

/**
 * Finds or creates the cfg_offer_dates baseline period (valid_from =
 * SEED_BASELINE_VALID_FROM, tipo_cd = 'AMBOS') used to host the seed rules
 * and params. Not transactional — a lightweight find-or-create, same style
 * as the rest of the period helpers in admin_fechas_service.js.
 *
 * @returns {Promise<number>} offer_date_id
 */
export async function ensureBaselinePeriod() {
  const pool = await getSqlPool();
  const validFrom = normalizeVigenciaToSecond(SEED_BASELINE_VALID_FROM);

  const findReq = pool.request();
  findReq.input("validFrom", sql.DateTime2(0), validFrom);
  const findResult = await findReq.query(`
    SELECT TOP 1 offer_date_id FROM dbo.cfg_offer_dates
    WHERE valid_from = @validFrom AND valid_to IS NULL AND tipo_cd = 'AMBOS'
  `);
  const existingId = findResult.recordset?.[0]?.offer_date_id;
  if (existingId) {
    return existingId;
  }

  const createReq = pool.request();
  createReq.input("validFrom", sql.DateTime2(0), validFrom);
  createReq.input("descripcion", sql.NVarChar(200), "Período base Ofertas Hipotecarias (seed reset)");
  createReq.input("tipoCd", sql.VarChar(10), "AMBOS");
  const createResult = await createReq.query(`
    INSERT INTO dbo.cfg_offer_dates (valid_from, valid_to, descripcion, tipo_cd)
    OUTPUT INSERTED.offer_date_id
    VALUES (@validFrom, NULL, @descripcion, @tipoCd)
  `);
  const offerDateId = createResult.recordset?.[0]?.offer_date_id;
  if (!offerDateId) {
    throw new AppError("No se pudo crear el período base para el seed reset.", 500);
  }
  return offerDateId;
}

/**
 * Upserts the 6 SEED_OFFERS rows into cfg_offer_ruleset by code — inserts
 * missing ones, and for existing ones (even if disabled) re-enables and
 * restores the seed name/offer_rank/oferta_id without touching ruleset_id.
 */
export async function ensureSeedOffers() {
  const pool = await getSqlPool();

  for (const offer of SEED_OFFERS) {
    const findReq = pool.request();
    findReq.input("code", sql.NVarChar(50), offer.code);
    const findResult = await findReq.query(`
      SELECT ruleset_id FROM dbo.cfg_offer_ruleset WHERE code = @code
    `);
    const existing = findResult.recordset?.[0];

    if (existing) {
      const updateReq = pool.request();
      updateReq.input("rulesetId", sql.Int, existing.ruleset_id);
      updateReq.input("name", sql.NVarChar(200), offer.name);
      updateReq.input("offerRank", sql.Int, offer.offer_rank);
      updateReq.input("ofertaId", sql.Int, offer.oferta_id);
      await updateReq.query(`
        UPDATE dbo.cfg_offer_ruleset
        SET name = @name, offer_rank = @offerRank, oferta_id = @ofertaId, enabled = 1
        WHERE ruleset_id = @rulesetId
      `);
    } else {
      const insertReq = pool.request();
      insertReq.input("code", sql.NVarChar(50), offer.code);
      insertReq.input("name", sql.NVarChar(200), offer.name);
      insertReq.input("offerRank", sql.Int, offer.offer_rank);
      insertReq.input("ofertaId", sql.Int, offer.oferta_id);
      await insertReq.query(`
        INSERT INTO dbo.cfg_offer_ruleset (oferta_id, offer_rank, code, name, enabled, published_version)
        VALUES (@ofertaId, @offerRank, @code, @name, 1, 1)
      `);
    }
  }
}

/**
 * Deletes every cfg_offer_dates period except offerDateId. Safe to run last
 * in resetToSeed(): by that point non-seed offers' data is already gone
 * (deleteNonSeedOffers) and the 6 seed offers' rows already reference only
 * offerDateId (applyConfig with deleteAllPeriods:true), so no live rule/param
 * still points at the periods being removed here.
 *
 * @param {number} offerDateId
 * @returns {Promise<{ removedPeriodCount: number }>}
 */
export async function deleteExtraPeriods(offerDateId) {
  const pool = await getSqlPool();
  const request = pool.request();
  request.input("offerDateId", sql.Int, offerDateId);
  const result = await request.query(`
    DELETE FROM dbo.cfg_offer_dates WHERE offer_date_id <> @offerDateId
  `);
  return { removedPeriodCount: result.rowsAffected?.[0] ?? 0 };
}

/**
 * Full-scope reset to the 6-offer seed configuration (D4-EXT). Order matters:
 *   1. deleteNonSeedOffers()   — own tx, runs first
 *   2. ensureBaselinePeriod()  — find-or-create 2026-01-01 AMBOS period
 *   3. ensureSeedOffers()      — upsert the 6 seed offers, re-enable if needed
 *   4. applyConfig(...)        — replace seed offers' rules/params, stamped
 *                                 with offerDateId, across ALL their periods
 *   5. deleteExtraPeriods()    — own tx, runs last
 *
 * The pre-reset snapshot is the caller's responsibility (admin_reset_controller.js),
 * matching the existing pattern in postAdminApply.
 *
 * @param {{ createdBy?: string|null }} [options]
 */
export async function resetToSeed({ createdBy } = {}) {
  void createdBy; // reserved — snapshot (which records createdBy) is created by the controller.

  const { removedOfferCodes } = await deleteNonSeedOffers();
  const offerDateId = await ensureBaselinePeriod();
  await ensureSeedOffers();
  const applyResult = await applyConfig(buildSeedConfig(offerDateId), { deleteAllPeriods: true });
  const { removedPeriodCount } = await deleteExtraPeriods(offerDateId);

  return {
    applied: applyResult.applied,
    offerCodes: applyResult.offerCodes,
    offer_date_id: offerDateId,
    removedOfferCodes,
    removedPeriodCount,
  };
}
