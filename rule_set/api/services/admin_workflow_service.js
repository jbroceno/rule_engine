import { getSqlPool, getWfSqlPool, sql } from "../db/sql_client.js";
import { AppError } from "../utils/app_error.js";
import { normalizeVigenciaToSecond } from "../utils/vigencia.js";
import { computeSnapshotChecksum } from "../utils/snapshot_integrity.js";
import { env } from "../config/env.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeSnapshotAction(action) {
  const actionType = String(action?.action_type ?? "").toUpperCase();
  if (actionType === "SET_DICTAMEN") {
    return { actionType: "SET", field: "dictamen", value: String(action?.action_payload?.dictamen ?? ""), valueType: "STRING" };
  }
  const p = action?.action_payload ?? {};
  return {
    actionType: actionType || "SET",
    field: String(p.field ?? action.field ?? "").trim(),
    value: String(p.value ?? action.value ?? ""),
    valueType: String(p.value_type ?? action.value_type ?? "STRING").toUpperCase(),
  };
}

function normalizeSnapshotCondition(cond) {
  const op = String(cond.operator ?? "").toUpperCase();
  const isIn = op === "IN" || op === "NOT_IN";
  const isParamRef = isIn && typeof cond.right_operand === "string" && cond.right_operand.trim().startsWith("PARAM:");
  const inValues = isIn && !isParamRef && Array.isArray(cond.right_operand) ? cond.right_operand.map(String) : [];
  const value1 = isIn && !isParamRef ? null : String(cond.right_operand ?? "");
  return {
    groupId: Number(cond.group_id ?? 0),
    field: String(cond.left_operand ?? cond.field ?? ""),
    operator: op,
    valueType: String(cond.value_type ?? "STRING").toUpperCase(),
    value1: isParamRef ? String(cond.right_operand) : value1,
    value2: cond.value2 ?? null,
    inValues,
  };
}

// ---------------------------------------------------------------------------
// Pure helper: determine which MRO table groups to delete based on tipo.
// Extracted for unit-testing (no DB). Used by deletePeriodFromMRO.
// ---------------------------------------------------------------------------
export function getDeleteScope(tipo) {
  const t = String(tipo ?? "AMBOS").toUpperCase();
  const ALLOWED = new Set(["REGLAS", "PARAMS", "AMBOS"]);
  if (!ALLOWED.has(t)) throw new Error(`tipoDs inválido: ${tipo}`);
  return {
    deleteReglas: t === "REGLAS" || t === "AMBOS",
    deleteParams: t === "PARAMS" || t === "AMBOS",
  };
}

// ---------------------------------------------------------------------------
// deletePeriodFromMRO: delete MRO records scoped by MOTORFECHA_ID and tipo.
// Only fires on a reused MOTORFECHA_ID (exact-period match). Overlapping
// records for a different TIPO_DS on the same date range are NOT touched.
// ---------------------------------------------------------------------------
async function deletePeriodFromMRO(tx, motorFechaId, tipo) {
  const { deleteReglas, deleteParams } = getDeleteScope(tipo);

  const addId = (req) => {
    req.input("fid", sql.Int, motorFechaId);
    return req;
  };

  if (deleteReglas) {
    await addId(tx.request()).query(`
      DELETE cv
      FROM dbo.MRO_MOTORCONDICIONVALOR cv
      INNER JOIN dbo.MRO_MOTORCONDICION c ON c.MOTORCONDICION_ID = cv.MOTORCONDICION_ID
      INNER JOIN dbo.MRO_MOTORREGLA r ON r.MOTORREGLA_ID = c.MOTORREGLA_ID
      WHERE r.MOTORFECHA_ID = @fid
    `);

    await addId(tx.request()).query(`
      DELETE c
      FROM dbo.MRO_MOTORCONDICION c
      INNER JOIN dbo.MRO_MOTORREGLA r ON r.MOTORREGLA_ID = c.MOTORREGLA_ID
      WHERE r.MOTORFECHA_ID = @fid
    `);

    await addId(tx.request()).query(`
      DELETE a
      FROM dbo.MRO_MOTORACCION a
      INNER JOIN dbo.MRO_MOTORREGLA r ON r.MOTORREGLA_ID = a.MOTORREGLA_ID
      WHERE r.MOTORFECHA_ID = @fid
    `);

    await addId(tx.request()).query(`
      DELETE FROM dbo.MRO_MOTORREGLA WHERE MOTORFECHA_ID = @fid
    `);
  }

  if (deleteParams) {
    await addId(tx.request()).query(`
      DELETE FROM dbo.MRO_MOTORPARAM WHERE MOTORFECHA_ID = @fid
    `);
  }
}

async function getMaxIds(tx) {
  // MAX captured BEFORE any deletes — high-water mark, no id reuse.
  const result = await tx.request().query(`
    SELECT
      ISNULL((SELECT MAX(MOTOROFERTA_ID)         FROM dbo.MRO_MOTOROFERTA         WITH (UPDLOCK, ROWLOCK)), 0) AS maxOferta,
      ISNULL((SELECT MAX(MOTORFECHA_ID)           FROM dbo.MRO_MOTORFECHA          WITH (UPDLOCK, ROWLOCK)), 0) AS maxFecha,
      ISNULL((SELECT MAX(MOTORREGLA_ID)           FROM dbo.MRO_MOTORREGLA          WITH (UPDLOCK, ROWLOCK)), 0) AS maxRegla,
      ISNULL((SELECT MAX(MOTORCONDICION_ID)       FROM dbo.MRO_MOTORCONDICION      WITH (UPDLOCK, ROWLOCK)), 0) AS maxCond,
      ISNULL((SELECT MAX(MOTORCONDICIONVALOR_ID)  FROM dbo.MRO_MOTORCONDICIONVALOR WITH (UPDLOCK, ROWLOCK)), 0) AS maxCondVal,
      ISNULL((SELECT MAX(MOTORACCION_ID)          FROM dbo.MRO_MOTORACCION         WITH (UPDLOCK, ROWLOCK)), 0) AS maxAccion,
      ISNULL((SELECT MAX(MOTORPARAM_ID)           FROM dbo.MRO_MOTORPARAM          WITH (UPDLOCK, ROWLOCK)), 0) AS maxParam
  `);
  return result.recordset[0];
}

// ---------------------------------------------------------------------------
// upsertMotorFecha: upsert MRO_MOTORFECHA by (DESDE_DT, HASTA_DT, TIPO_DS).
// Exact key match → reuse existing MOTORFECHA_ID (caller will delete and
// reinsert dependents). No match → INSERT with ++maxIdRef.val.
// UPDLOCK on SELECT prevents concurrent inserts of the same key.
// Returns MOTORFECHA_ID (integer).
// Exported for integration testing (WF-01 / RF-VDT-02 exact second match).
// ---------------------------------------------------------------------------
export async function upsertMotorFecha(tx, desde, hasta, tipo, maxIdRef) {
  const tipoStr = String(tipo ?? "AMBOS").toUpperCase();
  // INV-VDT-01/02: normalize to second-truncated local wall-clock before binding.
  // sql.DateTime2(0) pairs with useUTC:false — exact second match against
  // WF-tool-written DESDE_DT (GETDATE() local). No CAST(... AS DATE) —
  // that would drop the time component and break non-midnight period matching.
  const desdeNorm = normalizeVigenciaToSecond(desde);
  const hastaNorm = normalizeVigenciaToSecond(hasta ?? null);

  const existsReq = tx.request();
  existsReq.input("desde", sql.DateTime2(0), desdeNorm);
  existsReq.input("hasta", sql.DateTime2(0), hastaNorm);
  existsReq.input("tipo", sql.VarChar(10), tipoStr);
  // UPDLOCK prevents a concurrent transaction from inserting the same key
  // between our SELECT and INSERT (high-concurrency safety).
  // WU-06.3: HASTA_DT IS NULL is already NULL-safe (no CAST needed, correct).
  // RF-VDT-01: exact DESDE_DT = @desde (second precision), NOT CAST AS DATE.
  const exists = await existsReq.query(`
    SELECT TOP 1 MOTORFECHA_ID FROM dbo.MRO_MOTORFECHA WITH (UPDLOCK, ROWLOCK)
    WHERE DESDE_DT = @desde
      AND ((@hasta IS NULL AND HASTA_DT IS NULL) OR HASTA_DT = @hasta)
      AND TIPO_DS = @tipo
  `);
  if (exists.recordset?.length) {
    return exists.recordset[0].MOTORFECHA_ID;
  }
  // New period: assign next id from the high-water mark.
  const newId = ++maxIdRef.val;
  const req = tx.request();
  req.input("id", sql.Int, newId);
  req.input("desde", sql.DateTime2(0), desdeNorm);
  req.input("hasta", sql.DateTime2(0), hastaNorm);
  req.input("tipo", sql.VarChar(10), tipoStr);
  await req.query(`
    INSERT INTO dbo.MRO_MOTORFECHA (MOTORFECHA_ID, DESDE_DT, HASTA_DT, TIPO_DS, ALTA_DT)
    VALUES (@id, @desde, @hasta, @tipo, GETDATE())
  `);
  return newId;
}

// Upsert MRO_MOTOROFERTA by OFERTA_ID. Returns MOTOROFERTA_ID.
async function upsertMotorOferta(tx, ofertaId, ofertaRank, publishedVersion, maxIdRef) {
  const existsReq = tx.request();
  existsReq.input("ofertaId", sql.Int, ofertaId);
  const exists = await existsReq.query(`
    SELECT TOP 1 MOTOROFERTA_ID FROM dbo.MRO_MOTOROFERTA WHERE OFERTA_ID = @ofertaId AND BORRADO_FL = 0
  `);
  if (exists.recordset?.length) {
    return exists.recordset[0].MOTOROFERTA_ID;
  }
  const newId = ++maxIdRef.val;
  const req = tx.request();
  req.input("id", sql.Int, newId);
  req.input("ofertaId", sql.Int, ofertaId);
  req.input("rank", sql.Int, ofertaRank ?? 0);
  req.input("version", sql.Int, publishedVersion ?? 1);
  await req.query(`
    INSERT INTO dbo.MRO_MOTOROFERTA (MOTOROFERTA_ID, OFERTA_ID, OFERTA_RANK_NM, VERSION_PUBLICADA_NM, BORRADO_FL, ALTA_DT)
    VALUES (@id, @ofertaId, @rank, @version, 0, GETDATE())
  `);
  return newId;
}

// Insert all MRO_ records inside an open transaction.
// VIGENCIA_DESDE_DT / VIGENCIA_HASTA_DT are NOT written — period ownership is
// encoded entirely via MOTORFECHA_ID FK.
// ruleEntries:  [{ motorOfertaId, name, priority, stopProcessing, conditions, actions }]
// paramEntries: [{ motorOfertaId, paramKey, valueType, value }]
// motorFechaId: the MOTORFECHA_ID resolved by upsertMotorFecha for this publish.
async function insertMRORecords(tx, { ruleEntries, paramEntries }, motorFechaId, maxIds) {
  let { maxRegla, maxCond, maxCondVal, maxAccion, maxParam } = maxIds;

  for (const rule of ruleEntries) {
    const motorReglaId = ++maxRegla;

    const rReq = tx.request();
    rReq.input("id", sql.Int, motorReglaId);
    rReq.input("ofertaId", sql.Int, rule.motorOfertaId);
    rReq.input("ds", sql.VarChar(100), String(rule.name ?? "").substring(0, 100));
    rReq.input("priority", sql.Int, Number(rule.priority) || 0);
    rReq.input("stopProcess", sql.Bit, rule.stopProcessing ? 1 : 0);
    rReq.input("motorFechaId", sql.Int, motorFechaId);
    await rReq.query(`
      INSERT INTO dbo.MRO_MOTORREGLA
        (MOTORREGLA_ID, MOTOROFERTA_ID, MOTORREGLA_DS, PRIORIDAD_NM, PARAR_PROCESO_FL, MOTORFECHA_ID, BORRADO_FL, ALTA_DT)
      VALUES (@id, @ofertaId, @ds, @priority, @stopProcess, @motorFechaId, 0, GETDATE())
    `);

    for (const cond of (rule.conditions ?? [])) {
      const motorCondId = ++maxCond;

      const cReq = tx.request();
      cReq.input("id", sql.Int, motorCondId);
      cReq.input("reglaId", sql.Int, motorReglaId);
      cReq.input("grupo", sql.VarChar(20), String(cond.groupId ?? cond.group_id ?? 0));
      cReq.input("campo", sql.VarChar(100), String(cond.field ?? ""));
      cReq.input("operador", sql.VarChar(20), String(cond.operator ?? ""));
      cReq.input("tipoValor", sql.VarChar(20), String(cond.valueType ?? cond.value_type ?? ""));
      cReq.input("valor1", sql.VarChar(100), cond.value1 ?? null);
      cReq.input("valor2", sql.VarChar(100), cond.value2 ?? null);
      await cReq.query(`
        INSERT INTO dbo.MRO_MOTORCONDICION
          (MOTORCONDICION_ID, MOTORREGLA_ID, GRUPO_CONDICION_CD, CAMPO_CD, OPERADOR_CD, TIPO_VALOR_CD, VALOR1_DS, VALOR2_DS, ALTA_DT)
        VALUES (@id, @reglaId, @grupo, @campo, @operador, @tipoValor, @valor1, @valor2, GETDATE())
      `);

      for (const val of (cond.inValues ?? [])) {
        const cvId = ++maxCondVal;
        const cvReq = tx.request();
        cvReq.input("id", sql.Int, cvId);
        cvReq.input("condId", sql.Int, motorCondId);
        cvReq.input("valor", sql.VarChar(100), String(val));
        await cvReq.query(`
          INSERT INTO dbo.MRO_MOTORCONDICIONVALOR (MOTORCONDICIONVALOR_ID, MOTORCONDICION_ID, VALOR_DS, ALTA_DT)
          VALUES (@id, @condId, @valor, GETDATE())
        `);
      }
    }

    for (const action of (rule.actions ?? [])) {
      const motorAccionId = ++maxAccion;
      const aReq = tx.request();
      aReq.input("id", sql.Int, motorAccionId);
      aReq.input("reglaId", sql.Int, motorReglaId);
      aReq.input("tipoAccion", sql.VarChar(20), String(action.actionType ?? action.action_type ?? ""));
      aReq.input("campo", sql.VarChar(100), String(action.field ?? ""));
      aReq.input("valor", sql.VarChar(400), String(action.value ?? ""));
      aReq.input("tipoValor", sql.VarChar(20), String(action.valueType ?? action.value_type ?? ""));
      await aReq.query(`
        INSERT INTO dbo.MRO_MOTORACCION
          (MOTORACCION_ID, MOTORREGLA_ID, TIPO_ACCION_CD, CAMPO_CD, VALOR_DS, TIPO_VALOR_CD, ALTA_DT)
        VALUES (@id, @reglaId, @tipoAccion, @campo, @valor, @tipoValor, GETDATE())
      `);
    }
  }

  for (const param of paramEntries) {
    const motorParamId = ++maxParam;
    const pReq = tx.request();
    pReq.input("id", sql.Int, motorParamId);
    pReq.input("ofertaId", sql.Int, param.motorOfertaId);
    pReq.input("paramKey", sql.VarChar(100), String(param.paramKey ?? ""));
    pReq.input("tipoValor", sql.VarChar(20), String(param.valueType ?? ""));
    pReq.input("valor", sql.VarChar(100), String(param.value ?? ""));
    pReq.input("motorFechaId", sql.Int, motorFechaId);
    await pReq.query(`
      INSERT INTO dbo.MRO_MOTORPARAM
        (MOTORPARAM_ID, MOTOROFERTA_ID, PARAM_KEY_CD, TIPO_VALOR_CD, VALOR_DS, MOTORFECHA_ID, BORRADO_FL, ALTA_DT)
      VALUES (@id, @ofertaId, @paramKey, @tipoValor, @valor, @motorFechaId, 0, GETDATE())
    `);
  }
}

// ---------------------------------------------------------------------------
// Public: publish from cfg_ tables (filtered by offer_date_id)
// ---------------------------------------------------------------------------

export async function publishCfgToWorkflow(offerDateId, rangoDestino, options = {}) {
  const { ofertaIdOverrides, tipoDs: tipoOption } = options;
  const tipoDs = String(tipoOption ?? "AMBOS").toUpperCase();
  if (!new Set(["REGLAS", "PARAMS", "AMBOS"]).has(tipoDs)) {
    throw new AppError(`tipoDs debe ser REGLAS, PARAMS o AMBOS. Recibido: ${tipoOption}`, 400);
  }

  const pool = await getSqlPool();

  // Verify source period exists
  const mfReq = pool.request();
  mfReq.input("offerDateId", sql.Int, offerDateId);
  const mfResult = await mfReq.query(`
    SELECT offer_date_id FROM dbo.cfg_offer_dates WHERE offer_date_id = @offerDateId
  `);
  if (!mfResult.recordset?.length) {
    throw new AppError(`No existe offer_date_id ${offerDateId}.`, 404);
  }

  // Read offers (include `code` for override lookup)
  const offersResult = await pool.request().query(`
    SELECT ruleset_id, code, oferta_id, offer_rank, published_version
    FROM dbo.cfg_offer_ruleset WHERE enabled = 1
  `);
  const offers = offersResult.recordset ?? [];

  // Read rules for this period
  const rulesReq = pool.request();
  rulesReq.input("offerDateId", sql.Int, offerDateId);
  const rulesResult = await rulesReq.query(`
    SELECT rule_id, ruleset_id, name, priority, stop_processing
    FROM dbo.cfg_offer_rule
    WHERE offer_date_id = @offerDateId AND enabled = 1
  `);
  const rules = rulesResult.recordset ?? [];

  if (rules.length === 0) {
    throw new AppError("No hay reglas activas para el período de origen.", 400);
  }

  const ruleIdsCsv = rules.map((r) => r.rule_id).join(",");

  const condsResult = await pool.request().query(`
    SELECT cond_id, rule_id, group_id, field, operator, value_type, value1, value2
    FROM dbo.cfg_offer_rule_condition
    WHERE rule_id IN (SELECT TRY_CAST(value AS INT) FROM STRING_SPLIT('${ruleIdsCsv}', ','))
  `);
  const conditionsByRule = new Map();
  for (const c of (condsResult.recordset ?? [])) {
    if (!conditionsByRule.has(c.rule_id)) conditionsByRule.set(c.rule_id, []);
    conditionsByRule.get(c.rule_id).push({ ...c, inValues: [] });
  }

  const condIdsCsv = (condsResult.recordset ?? []).map((c) => c.cond_id).join(",");
  if (condIdsCsv) {
    const cvResult = await pool.request().query(`
      SELECT cond_id, value
      FROM dbo.cfg_offer_rule_condition_value
      WHERE cond_id IN (SELECT TRY_CAST(value AS INT) FROM STRING_SPLIT('${condIdsCsv}', ','))
    `);
    for (const cv of (cvResult.recordset ?? [])) {
      const conds = conditionsByRule.values();
      for (const condList of conds) {
        const cond = condList.find((c) => c.cond_id === cv.cond_id);
        if (cond) { cond.inValues.push(cv.value); break; }
      }
    }
  }

  const actionsResult = await pool.request().query(`
    SELECT rule_id, action_type, field, value, value_type
    FROM dbo.cfg_offer_rule_action
    WHERE rule_id IN (SELECT TRY_CAST(value AS INT) FROM STRING_SPLIT('${ruleIdsCsv}', ','))
  `);
  const actionsByRule = new Map();
  for (const a of (actionsResult.recordset ?? [])) {
    if (!actionsByRule.has(a.rule_id)) actionsByRule.set(a.rule_id, []);
    actionsByRule.get(a.rule_id).push({ actionType: a.action_type, field: a.field, value: a.value, valueType: a.value_type });
  }

  const paramsReq = pool.request();
  paramsReq.input("offerDateId", sql.Int, offerDateId);
  const paramsResult = await paramsReq.query(`
    SELECT ruleset_id, param_key, value_type, value
    FROM (
      SELECT ruleset_id, param_key, value_type, value,
             ROW_NUMBER() OVER (
               PARTITION BY ruleset_id, param_key
               ORDER BY CASE WHEN offer_date_id = @offerDateId THEN 0 ELSE 1 END
             ) AS rn
      FROM dbo.cfg_offer_param
      WHERE (offer_date_id = @offerDateId OR offer_date_id IS NULL) AND enabled = 1
    ) t WHERE t.rn = 1
  `);

  const vigDesde = rangoDestino.vigDesde;
  const vigHasta = rangoDestino.vigHasta || null;

  const wfPool = await getWfSqlPool();
  const tx = new sql.Transaction(wfPool);
  await tx.begin();
  try {
    // MAX captured BEFORE deletes — high-water mark (no id reuse).
    const maxIds = await getMaxIds(tx);

    // Upsert MOTORFECHA for this period+tipo. Exact match reuses existing id
    // (dependents will be deleted and reinserted below).
    const motorFechaIdRef = { val: maxIds.maxFecha };
    const motorFechaId = await upsertMotorFecha(tx, vigDesde, vigHasta, tipoDs, motorFechaIdRef);

    // Delete existing MRO records for this period (only fires if period already existed).
    await deletePeriodFromMRO(tx, motorFechaId, tipoDs);

    const motorOfertaIdRef = { val: maxIds.maxOferta };
    const ofertaIdByRuleset = new Map();

    for (const offer of offers) {
      const effectiveOfertaId = ofertaIdOverrides?.[offer.code] ?? offer.oferta_id;
      const moid = await upsertMotorOferta(tx, effectiveOfertaId, offer.offer_rank, offer.published_version, motorOfertaIdRef);
      ofertaIdByRuleset.set(offer.ruleset_id, moid);
    }

    const ruleEntries = rules.map((r) => ({
      motorOfertaId: ofertaIdByRuleset.get(r.ruleset_id),
      name: r.name,
      priority: r.priority,
      stopProcessing: r.stop_processing,
      conditions: conditionsByRule.get(r.rule_id) ?? [],
      actions: actionsByRule.get(r.rule_id) ?? [],
    })).filter((r) => r.motorOfertaId);

    const paramEntries = (paramsResult.recordset ?? []).map((p) => ({
      motorOfertaId: ofertaIdByRuleset.get(p.ruleset_id),
      paramKey: p.param_key,
      valueType: p.value_type,
      value: p.value,
    })).filter((p) => p.motorOfertaId);

    await insertMRORecords(tx, { ruleEntries, paramEntries }, motorFechaId, {
      maxRegla: maxIds.maxRegla,
      maxCond: maxIds.maxCond,
      maxCondVal: maxIds.maxCondVal,
      maxAccion: maxIds.maxAccion,
      maxParam: maxIds.maxParam,
    });

    await tx.commit();
    return { published: true, rules: ruleEntries.length, params: paramEntries.length, motorFechaId };
  } catch (error) {
    await tx.rollback();
    throw error instanceof AppError ? error : new AppError("Error publicando en Workflow.", 500, { cause: error.message });
  }
}

// ---------------------------------------------------------------------------
// Public: publish from snapshot data (rules/params already loaded in memory)
// ---------------------------------------------------------------------------

export async function publishSnapshotToWorkflow(snapshotRules, snapshotParams, rangoDestino, options = {}) {
  const { ofertaIdOverrides, tipoDs: tipoOption } = options;
  // Snapshot-to-WF always uses AMBOS — per design Q3 (cap-3 hardcodes AMBOS).
  const tipoDs = String(tipoOption ?? "AMBOS").toUpperCase();
  if (!new Set(["REGLAS", "PARAMS", "AMBOS"]).has(tipoDs)) {
    throw new AppError(`tipoDs debe ser REGLAS, PARAMS o AMBOS. Recibido: ${tipoOption}`, 400);
  }

  const pool = await getSqlPool();

  // Get OFERTA_ID for each offerCode from current DB
  const offersResult = await pool.request().query(`
    SELECT ruleset_id, code, oferta_id, offer_rank, published_version
    FROM dbo.cfg_offer_ruleset WHERE enabled = 1
  `);
  const offerMap = new Map(); // code → { rulesetId, ofertaId, offerRank, publishedVersion }
  for (const o of (offersResult.recordset ?? [])) {
    offerMap.set(String(o.code).toUpperCase(), { rulesetId: o.ruleset_id, ofertaId: o.oferta_id, offerRank: o.offer_rank, publishedVersion: o.published_version });
  }

  const vigDesde = rangoDestino.vigDesde;
  const vigHasta = rangoDestino.vigHasta || null;

  // Resolve motorOfertaId for each offer code before opening the WF transaction
  const allCodes = new Set([
    ...(Array.isArray(snapshotRules) ? snapshotRules.map((r) => String(r.offerCode ?? "").toUpperCase()) : []),
    ...(Array.isArray(snapshotParams) ? snapshotParams.map((p) => String(p.offerCode ?? "").toUpperCase()) : []),
  ]);

  const ofertaIdByCode = new Map(); // code → effective ofertaId
  for (const code of allCodes) {
    const offer = offerMap.get(code);
    if (!offer) continue;
    const effectiveOfertaId = ofertaIdOverrides?.[code] ?? offer.ofertaId;
    ofertaIdByCode.set(code, { effectiveOfertaId, offerRank: offer.offerRank, publishedVersion: offer.publishedVersion });
  }

  if (ofertaIdByCode.size === 0) {
    throw new AppError("Ningún offerCode del snapshot coincide con las ofertas activas en POC. Verificá los códigos de oferta.", 400);
  }

  const wfPool = await getWfSqlPool();
  const tx = new sql.Transaction(wfPool);
  await tx.begin();
  try {
    // MAX captured BEFORE deletes — high-water mark (no id reuse).
    const maxIds = await getMaxIds(tx);

    // Upsert MOTORFECHA for this period+tipo.
    const motorFechaIdRef = { val: maxIds.maxFecha };
    const motorFechaId = await upsertMotorFecha(tx, vigDesde, vigHasta, tipoDs, motorFechaIdRef);

    // Delete existing MRO records for this period (only if period already existed).
    await deletePeriodFromMRO(tx, motorFechaId, tipoDs);

    const motorOfertaIdRef = { val: maxIds.maxOferta };
    const motorOfertaByCode = new Map(); // offerCode → motorOfertaId
    for (const [code, info] of ofertaIdByCode) {
      const moid = await upsertMotorOferta(tx, info.effectiveOfertaId, info.offerRank, info.publishedVersion, motorOfertaIdRef);
      motorOfertaByCode.set(code, moid);
    }

    const ruleEntries = (Array.isArray(snapshotRules) ? snapshotRules : []).map((rule) => {
      const code = String(rule.offerCode ?? "").toUpperCase();
      const motorOfertaId = motorOfertaByCode.get(code);
      if (!motorOfertaId) return null;
      return {
        motorOfertaId,
        name: rule.rule_name,
        priority: rule.priority,
        stopProcessing: rule.stop_processing,
        conditions: (rule.conditions ?? []).map(normalizeSnapshotCondition),
        actions: (rule.actions ?? []).map(normalizeSnapshotAction),
      };
    }).filter(Boolean);

    const paramEntries = (Array.isArray(snapshotParams) ? snapshotParams : []).flatMap((group) => {
      const code = String(group.offerCode ?? "").toUpperCase();
      const motorOfertaId = motorOfertaByCode.get(code);
      if (!motorOfertaId) return [];
      return (group.paramValues ?? []).map((p) => ({
        motorOfertaId,
        paramKey: p.key ?? p.param_key,
        valueType: p.value_type,
        value: p.value,
      }));
    });

    if (ruleEntries.length === 0) {
      throw new AppError("El snapshot no contiene reglas para publicar en Workflow. Generá un nuevo snapshot WF antes de restaurar.", 400);
    }

    await insertMRORecords(tx, { ruleEntries, paramEntries }, motorFechaId, {
      maxRegla: maxIds.maxRegla,
      maxCond: maxIds.maxCond,
      maxCondVal: maxIds.maxCondVal,
      maxAccion: maxIds.maxAccion,
      maxParam: maxIds.maxParam,
    });

    await tx.commit();
    return { published: true, rules: ruleEntries.length, params: paramEntries.length, motorFechaId };
  } catch (error) {
    await tx.rollback();
    throw error instanceof AppError ? error : new AppError("Error publicando snapshot en Workflow.", 500, { cause: error.message });
  }
}

// ---------------------------------------------------------------------------
// Pure helper: build the auto-comment for the safety snapshot taken before
// a cap-2 publish overwrites WF state.
// Exported for unit testing (no DB, no I/O).
// ---------------------------------------------------------------------------
export function buildWfSafetySnapshotComment(rangoDestino) {
  const desde = rangoDestino?.vigDesde ?? "?";
  const hasta = rangoDestino?.vigHasta ?? "abierto";
  return `Auto: antes de publicar en WF período ${desde} - ${hasta}`;
}

// ---------------------------------------------------------------------------
// Pure helper: assemble the INSERT payload from raw SP JSON output.
// Exported for unit testing (no DB, no I/O).
//
// rawSpJson   — snapshot_json string returned by cfg_get_workflow_snapshot_json.
//               Expected shape: { ofertas, reglas, params } where reglas and
//               params carry VIGENCIA_DESDE_DT / VIGENCIA_HASTA_DT aliased from
//               MRO_MOTORFECHA.DESDE_DT / HASTA_DT (post-2.6 SP migration).
// vigDesde    — date string used for the snapshot comment (nullable).
// createdBy   — optional user identifier string.
// secret      — HMAC secret for the OWASP-10 checksum (env.snapshot.hmacSecret
//               in production; defaults to "" so pre-existing 3-arg callers —
//               this file's own unit tests — keep working unchanged).
//
// OWASP-10 (fix, code review 2026-07-14): WF-origin snapshots used to be
// inserted by createWorkflowSnapshot's own raw INSERT with no checksum at
// all, so every WF snapshot's checksum stayed NULL forever and restoreSnapshot
// always classified it "legacy" (a warning, never a 409 rejection) — the
// tamper-detection this whole PR exists to add never covered this entire
// snapshot class. Fix: compute the checksum HERE, as part of assembling the
// payload, reusing the SAME computeSnapshotChecksum single source of
// canonicalization createSnapshot already uses (api/utils/snapshot_integrity.js).
// Critical invariant preserved: the checksum is computed from the EXACT
// rulesJson/paramsJson strings returned below — the same strings
// createWorkflowSnapshot passes to the INSERT — never a re-stringify.
//
// Returns: { name, comment, createdBy, entornoCd, rulesJson, paramsJson, checksum }
// ---------------------------------------------------------------------------

export function assembleWfSnapshotPayload(rawSpJson, vigDesde, createdBy, secret = "") {
  let snapshotData;
  try {
    snapshotData = typeof rawSpJson === "string" ? JSON.parse(rawSpJson) : rawSpJson;
  } catch {
    snapshotData = {};
  }

  const date = new Date().toISOString().replace("T", " ").substring(0, 16);
  const name = `WF Snapshot ${date}`;

  const rulesJson = JSON.stringify(snapshotData);
  const paramsJson = "[]";
  const checksum = computeSnapshotChecksum(rulesJson, paramsJson, secret);

  return {
    name,
    comment: `Snapshot WF período ${vigDesde ?? "completo"}`,
    createdBy: createdBy ?? null,
    entornoCd: "WF",
    rulesJson,
    paramsJson,
    checksum,
  };
}

// ---------------------------------------------------------------------------
// Public: create a WF snapshot (reads MRO_ state via SP)
// ---------------------------------------------------------------------------

export async function createWorkflowSnapshot(vigDesde, vigHasta, createdBy) {
  const wfPool = await getWfSqlPool();
  const pool = await getSqlPool();

  const spReq = wfPool.request();
  // RF-VDT-04: SP params updated to DATETIME2(0) (WU-02) — bind with DateTime2(0).
  // normalizeVigenciaToSecond handles null/empty → null (open-ended hasta).
  spReq.input("VIGENCIA_DESDE", sql.DateTime2(0), normalizeVigenciaToSecond(vigDesde ?? null));
  spReq.input("VIGENCIA_HASTA", sql.DateTime2(0), normalizeVigenciaToSecond(vigHasta ?? null));
  const spResult = await spReq.execute("dbo.cfg_get_workflow_snapshot_json");

  const row = spResult.recordset?.[0];
  const rawJson = row?.snapshot_json ?? "{}";
  const payload = assembleWfSnapshotPayload(rawJson, vigDesde, createdBy, env.snapshot.hmacSecret);

  const insertReq = pool.request();
  insertReq.input("name", sql.NVarChar(200), payload.name);
  insertReq.input("comment", sql.NVarChar(1000), payload.comment);
  insertReq.input("createdBy", sql.NVarChar(100), payload.createdBy);
  insertReq.input("entornoCd", sql.VarChar(5), payload.entornoCd);
  insertReq.input("rulesJson", sql.NVarChar(sql.MAX), payload.rulesJson);
  insertReq.input("paramsJson", sql.NVarChar(sql.MAX), payload.paramsJson);
  // OWASP-10: same checksum column/invariant as createSnapshot — computed
  // above from these exact rulesJson/paramsJson strings, never re-stringified.
  insertReq.input("checksum", sql.NVarChar(64), payload.checksum);

  const result = await insertReq.query(`
    INSERT INTO dbo.cfg_config_snapshot (snapshot_name, comment, created_by, entorno_cd, rules_json, params_json, checksum)
    OUTPUT INSERTED.snapshot_id
    VALUES (@name, @comment, @createdBy, @entornoCd, @rulesJson, @paramsJson, @checksum)
  `);

  const snapshotId = result.recordset?.[0]?.snapshot_id;
  if (!snapshotId) {
    throw new AppError("No se pudo crear el snapshot de Workflow.", 500);
  }
  return { snapshot_id: snapshotId, snapshot_name: payload.name };
}
