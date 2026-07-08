const SUPPORTED_OPERATORS = new Set([
  "EQ",
  "NE",
  "LT",
  "LE",
  "GT",
  "GE",
  "BETWEEN",
  "IN",
  "NOT_IN",
  "IS_TRUE",
  "IS_FALSE",
]);

const SUPPORTED_ACTIONS = new Set(["SET", "ADD", "APPEND"]);

const SUPPORTED_VALUE_TYPES = new Set(["NUMBER", "BOOL", "STRING", "JSON", "DATE"]);

const FINAL_ONLY_ACTION_FIELDS = new Set(["eligible", "rejected", "selectedOffer"]);

function isNil(value) {
  return value === null || value === undefined;
}

export function parseJsonMaybe(value, fallback) {
  if (isNil(value)) {
    return fallback;
  }
  if (typeof value === "object") {
    return value;
  }
  const raw = String(value).trim();
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function coerce(value, valueType) {
  if (valueType === "NUMBER") {
    if (isNil(value)) {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (valueType === "BOOL") {
    if (isNil(value)) {
      return null;
    }
    if (typeof value === "boolean") {
      return value;
    }
    const normalized = String(value).trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "n"].includes(normalized)) {
      return false;
    }
    return null;
  }

  if (valueType === "JSON") {
    return parseJsonMaybe(value, value);
  }

  return isNil(value) ? null : String(value);
}

function buildValidationError(path, message) {
  return `${path}: ${message}`;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

const VALID_STAGES = new Set(["INIT", "PRE", "FINAL"]);

function hasStageCondition(conditions) {
  return conditions.some((cond) => {
    if (!cond || typeof cond !== "object") {
      return false;
    }
    if (cond.field !== "stage" || cond.operator !== "EQ") {
      return false;
    }
    const stageValue = typeof cond.value1 === "string" ? cond.value1.toUpperCase() : "";
    return VALID_STAGES.has(stageValue);
  });
}

function getRuleStages(conditions) {
  const stages = new Set();
  for (const cond of conditions) {
    if (!cond || typeof cond !== "object") {
      continue;
    }
    if (cond.field !== "stage" || cond.operator !== "EQ") {
      continue;
    }
    const stageValue = typeof cond.value1 === "string" ? cond.value1.toUpperCase() : "";
    if (VALID_STAGES.has(stageValue)) {
      stages.add(stageValue);
    }
  }
  return stages;
}

export function validateConfigShape(config, options = {}) {
  const strictValidation = options.strictValidation === true;
  const errors = [];

  if (!config || typeof config !== "object") {
    return [buildValidationError("$", "rules.json must be an object")];
  }

  if (!Array.isArray(config.offers)) {
    errors.push(buildValidationError("$.offers", "must be an array"));
  }

  if (!Array.isArray(config.params)) {
    errors.push(buildValidationError("$.params", "must be an array"));
  }

  const offers = Array.isArray(config.offers) ? config.offers : [];
  for (let offerIndex = 0; offerIndex < offers.length; offerIndex++) {
    const offer = offers[offerIndex];
    const offerPath = `$.offers[${offerIndex}]`;

    if (!offer || typeof offer !== "object") {
      errors.push(buildValidationError(offerPath, "must be an object"));
      continue;
    }
    if (!offer.offerCode) {
      errors.push(buildValidationError(`${offerPath}.offerCode`, "is required"));
    }
    if (strictValidation && !isFiniteNumber(Number(offer.offer_rank ?? 0))) {
      errors.push(buildValidationError(`${offerPath}.offer_rank`, "must be a finite number"));
    }

    const rules = parseJsonMaybe(offer.rules, []);
    if (!Array.isArray(rules)) {
      errors.push(buildValidationError(`${offerPath}.rules`, "must be an array"));
      continue;
    }

    for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex++) {
      const rule = rules[ruleIndex];
      const rulePath = `${offerPath}.rules[${ruleIndex}]`;
      const conditions = parseJsonMaybe(rule?.conditions, []);
      const actions = parseJsonMaybe(rule?.actions, []);

      if (strictValidation) {
        if (!isFiniteNumber(Number(rule?.rule_id))) {
          errors.push(buildValidationError(`${rulePath}.rule_id`, "must be a finite number"));
        }
        if (!isFiniteNumber(Number(rule?.priority))) {
          errors.push(buildValidationError(`${rulePath}.priority`, "must be a finite number"));
        }
        if (typeof rule?.stop_processing !== "boolean") {
          errors.push(buildValidationError(`${rulePath}.stop_processing`, "must be a boolean"));
        }
      }

      if (!Array.isArray(conditions)) {
        errors.push(buildValidationError(`${rulePath}.conditions`, "must be an array"));
      }
      if (!Array.isArray(actions)) {
        errors.push(buildValidationError(`${rulePath}.actions`, "must be an array"));
      }
      if (strictValidation && Array.isArray(conditions) && conditions.length === 0) {
        errors.push(buildValidationError(`${rulePath}.conditions`, "must not be empty in strict mode"));
      }
      if (Array.isArray(conditions) && !hasStageCondition(conditions)) {
        errors.push(
          buildValidationError(
            `${rulePath}.conditions`,
            "must include at least one stage guard (field='stage', operator='EQ', value1='INIT'|'PRE'|'FINAL')"
          )
        );
      }

      const ruleStages = Array.isArray(conditions) ? getRuleStages(conditions) : new Set();
      if (ruleStages.size > 1) {
        errors.push(buildValidationError(`${rulePath}.conditions`, "must target a single stage (INIT, PRE or FINAL), not multiple"));
      }

      for (let condIndex = 0; condIndex < conditions.length; condIndex++) {
        const cond = conditions[condIndex];
        const condPath = `${rulePath}.conditions[${condIndex}]`;

        if (strictValidation) {
          if (!isNonEmptyString(cond?.field)) {
            errors.push(buildValidationError(`${condPath}.field`, "is required and must be a non-empty string"));
          }
          if (!isNonEmptyString(cond?.operator)) {
            errors.push(buildValidationError(`${condPath}.operator`, "is required and must be a non-empty string"));
          }
          if (!isNonEmptyString(cond?.value_type)) {
            errors.push(buildValidationError(`${condPath}.value_type`, "is required and must be a non-empty string"));
          }
          if (!isFiniteNumber(Number(cond?.group_id ?? 0))) {
            errors.push(buildValidationError(`${condPath}.group_id`, "must be a finite number"));
          }
          if (cond?.operator === "BETWEEN" && (isNil(cond?.value1) || isNil(cond?.value2))) {
            errors.push(buildValidationError(condPath, "BETWEEN requires value1 and value2"));
          }
          if (["IN", "NOT_IN"].includes(cond?.operator)) {
            const hasInlineValues = Array.isArray(cond?.in_values) && cond.in_values.length > 0;
            const hasParamReference = typeof cond?.value1 === "string" && cond.value1.startsWith("PARAM:");
            if (!hasInlineValues && !hasParamReference) {
              errors.push(buildValidationError(condPath, `${cond.operator} requires in_values or value1=PARAM:<KEY>`));
            }
          }
        }

        if (!SUPPORTED_OPERATORS.has(cond?.operator)) {
          errors.push(buildValidationError(`${condPath}.operator`, `unsupported operator '${cond?.operator}'`));
        }
        if (cond?.value_type && !SUPPORTED_VALUE_TYPES.has(cond.value_type)) {
          errors.push(buildValidationError(`${condPath}.value_type`, `unsupported value_type '${cond.value_type}'`));
        }
      }

      for (let actionIndex = 0; actionIndex < actions.length; actionIndex++) {
        const action = actions[actionIndex];
        const actionPath = `${rulePath}.actions[${actionIndex}]`;

        if (strictValidation) {
          if (!isNonEmptyString(action?.action_type)) {
            errors.push(buildValidationError(`${actionPath}.action_type`, "is required and must be a non-empty string"));
          }
          if (!isNonEmptyString(action?.field)) {
            errors.push(buildValidationError(`${actionPath}.field`, "is required and must be a non-empty string"));
          }
          if (!isNonEmptyString(action?.value_type)) {
            errors.push(buildValidationError(`${actionPath}.value_type`, "is required and must be a non-empty string"));
          }
          if (action?.action_type === "ADD" && action?.value_type !== "NUMBER") {
            errors.push(buildValidationError(actionPath, "ADD action requires value_type='NUMBER'"));
          }
        }

        if (!SUPPORTED_ACTIONS.has(action?.action_type)) {
          errors.push(buildValidationError(`${actionPath}.action_type`, `unsupported action_type '${action?.action_type}'`));
        }
        if (action?.value_type && !SUPPORTED_VALUE_TYPES.has(action.value_type)) {
          errors.push(buildValidationError(`${actionPath}.value_type`, `unsupported value_type '${action.value_type}'`));
        }
        if ((ruleStages.has("PRE") || ruleStages.has("INIT")) && FINAL_ONLY_ACTION_FIELDS.has(action?.field)) {
          errors.push(
            buildValidationError(
              `${actionPath}.field`,
              `field '${action.field}' is FINAL-only and cannot be set by an INIT or PRE rule`
            )
          );
        }
      }
    }
  }

  if (strictValidation) {
    const params = Array.isArray(config.params) ? config.params : [];
    const paramScopeIndex = new Set();

    for (let paramIndex = 0; paramIndex < params.length; paramIndex++) {
      const row = params[paramIndex];
      const rowPath = `$.params[${paramIndex}]`;
      const offerCode = row?.offerCode ?? row?.offer_code;
      if (!isNonEmptyString(offerCode)) {
        errors.push(buildValidationError(`${rowPath}.offerCode`, "is required (offerCode or offer_code)"));
      }

      const rawValues = row?.paramValues ?? row?.params ?? [];
      const values = parseJsonMaybe(rawValues, []);
      if (!Array.isArray(values)) {
        errors.push(buildValidationError(`${rowPath}.paramValues`, "must be an array (or params array)"));
        continue;
      }

      for (let valueIndex = 0; valueIndex < values.length; valueIndex++) {
        const param = values[valueIndex];
        const valuePath = `${rowPath}.paramValues[${valueIndex}]`;
        const key = param?.key ?? param?.param_key;
        const valueType = param?.value_type ?? param?.valueType;

        if (!isNonEmptyString(key)) {
          errors.push(buildValidationError(`${valuePath}.key`, "is required (key or param_key)"));
          continue;
        }
        if (!SUPPORTED_VALUE_TYPES.has(valueType)) {
          errors.push(buildValidationError(`${valuePath}.value_type`, `unsupported value_type '${valueType}'`));
        }

        const scopeKey = `${offerCode}|${key}`;
        if (paramScopeIndex.has(scopeKey)) {
          errors.push(buildValidationError(valuePath, `duplicate param key '${key}' in scope ${offerCode}`));
        }
        paramScopeIndex.add(scopeKey);
      }
    }
  }

  return errors;
}

function normalizeRules(rulesRaw) {
  const rules = parseJsonMaybe(rulesRaw, []);
  if (!Array.isArray(rules)) {
    throw new Error("rules must be array");
  }

  return rules.map((rule) => {
    const conditions = parseJsonMaybe(rule.conditions, []);
    const actions = parseJsonMaybe(rule.actions, []);
    return {
      ...rule,
      conditions: Array.isArray(conditions) ? conditions : [],
      actions: Array.isArray(actions) ? actions : [],
    };
  });
}

function buildParamsIndex(paramsArr) {
  const index = {};

  for (const row of paramsArr) {
    const offerCode = row.offerCode ?? row.offer_code;
    const rawValues = row.paramValues ?? row.params ?? [];
    const paramValues = parseJsonMaybe(rawValues, []);

    if (!offerCode || !Array.isArray(paramValues)) {
      continue;
    }

    if (!index[offerCode]) {
      index[offerCode] = {};
    }

    for (const param of paramValues) {
      const key = param.key ?? param.param_key;
      const valueType = param.value_type ?? param.valueType;
      if (!key) {
        continue;
      }
      index[offerCode][key] = coerce(param.value, valueType);
    }
  }

  return index;
}

export function normalizeConfig(config, options = {}) {
  const errors = validateConfigShape(config, options);
  if (errors.length) {
    throw new Error(`Invalid rules config:\n- ${errors.join("\n- ")}`);
  }

  const offersRaw = Array.isArray(config.offers) ? config.offers : [];
  const paramsRaw = Array.isArray(config.params) ? config.params : [];

  const offers = offersRaw.map((offer) => ({
    offerCode: offer.offerCode,
    offer_rank: Number(offer.offer_rank ?? 0),
    oferta_id: offer.oferta_id,
    rules: normalizeRules(offer.rules ?? []),
  }));

  const paramsIndex = buildParamsIndex(paramsRaw);
  return { offers, paramsIndex };
}

function resolveParamRef(rawValue) {
  if (typeof rawValue !== "string") {
    return null;
  }
  const normalized = rawValue.trim();
  return normalized.startsWith("PARAM:") ? normalized.slice("PARAM:".length) : null;
}

function getParam(paramsIndex, offerCode, key) {
  return paramsIndex?.[offerCode]?.[key];
}

function readLeft(context, field, valueType, offerCode, paramsIndex) {
  if (typeof field === "string" && field.startsWith("PARAM:")) {
    const key = field.slice("PARAM:".length);
    return coerce(getParam(paramsIndex, offerCode, key), valueType);
  }
  return coerce(context[field], valueType);
}

function resolveOperand(raw, valueType, offerCode, paramsIndex, context) {
  if (typeof raw === "string" && raw.startsWith("FIELD:")) {
    const fieldName = raw.slice("FIELD:".length);
    return coerce(context?.[fieldName], valueType);
  }
  const key = resolveParamRef(raw);
  if (!key) {
    return coerce(raw, valueType);
  }
  const value = getParam(paramsIndex, offerCode, key);
  return coerce(value, valueType);
}

function getInList(cond, offerCode, paramsIndex) {
  if (Array.isArray(cond.in_values) && cond.in_values.length) {
    return cond.in_values;
  }

  const key = resolveParamRef(cond.value1);
  if (!key) {
    return null;
  }

  const rawList = getParam(paramsIndex, offerCode, key);
  if (Array.isArray(rawList)) {
    return rawList;
  }
  const parsed = parseJsonMaybe(rawList, null);
  return Array.isArray(parsed) ? parsed : null;
}

function evalCondition(context, cond, offerCode, paramsIndex) {
  const left = readLeft(context, cond.field, cond.value_type, offerCode, paramsIndex);
  const v1 = resolveOperand(cond.value1, cond.value_type, offerCode, paramsIndex, context);
  const v2 = resolveOperand(cond.value2, cond.value_type, offerCode, paramsIndex, context);
  const expectedSource = cond.operator === "BETWEEN"
    ? [cond.value1 ?? null, cond.value2 ?? null]
    : (cond.operator === "IN" || cond.operator === "NOT_IN" ? (cond.value1 ?? cond.in_values ?? null) : (cond.value1 ?? null));
  let list = null;
  let passed = false;

  switch (cond.operator) {
    case "EQ":
      passed = left === v1;
      break;
    case "NE":
      passed = left !== v1;
      break;
    case "LT":
      passed = left !== null && v1 !== null && left < v1;
      break;
    case "LE":
      passed = left !== null && v1 !== null && left <= v1;
      break;
    case "GT":
      passed = left !== null && v1 !== null && left > v1;
      break;
    case "GE":
      passed = left !== null && v1 !== null && left >= v1;
      break;
    case "BETWEEN":
      passed = left !== null && v1 !== null && v2 !== null && left >= v1 && left <= v2;
      break;
    case "IS_TRUE":
      passed = left === true;
      break;
    case "IS_FALSE":
      passed = left === false || left === null;
      break;
    case "IN":
    case "NOT_IN": {
      if (left === null) {
        passed = false;
        break;
      }
      list = getInList(cond, offerCode, paramsIndex);
      if (!Array.isArray(list) || !list.length) {
        passed = false;
        break;
      }
      const typedList = list.map((item) => coerce(item, cond.value_type));
      const isInList = typedList.includes(left);
      list = typedList;
      passed = cond.operator === "NOT_IN" ? !isInList : isInList;
      break;
    }
    default:
      throw new Error(`Unsupported operator: ${cond.operator}`);
  }

  return {
    passed,
    left,
    expected: cond.operator === "BETWEEN"
      ? [v1, v2]
      : (cond.operator === "IN" || cond.operator === "NOT_IN" ? list : v1),
    expectedSource,
  };
}

function ruleMatches(context, rule, offerCode, paramsIndex) {
  const conds = rule.conditions ?? [];
  if (!conds.length) {
    return { matched: true, condResults: [] };
  }

  const groups = new Map();
  for (const cond of conds) {
    const groupId = cond.group_id ?? 0;
    if (!groups.has(groupId)) {
      groups.set(groupId, []);
    }
    groups.get(groupId).push(cond);
  }

  const condResults = [];
  for (const [groupId, groupConds] of groups.entries()) {
    let allTrue = true;
    const groupResults = [];
    for (const cond of groupConds) {
      const evaluation = evalCondition(context, cond, offerCode, paramsIndex);
      const result = {
        rule_id: rule.rule_id,
        cond_id: cond.cond_id,
        group_id: groupId,
        field: cond.field,
        op: cond.operator,
        passed: evaluation.passed,
        actual: evaluation.left,
        expected: evaluation.expected,
        expectedSource: evaluation.expectedSource,
      };
      condResults.push(result);
      groupResults.push(result);
      if (!evaluation.passed) {
        allTrue = false;
      }
    }
    if (allTrue) {
      return { matched: true, condResults, matchedConds: groupResults };
    }
  }

  return { matched: false, condResults, matchedConds: [] };
}

function applyActions(dictamen, rule, offerCode, paramsIndex, applied, trace, matchedConds = []) {
  for (const action of rule.actions ?? []) {
    let value;
    const paramKey = resolveParamRef(action.value);

    if (paramKey) {
      const paramValue = getParam(paramsIndex, offerCode, paramKey);
      if (paramValue === undefined) {
        trace.missingParams.push({
          offerCode,
          key: paramKey,
          rule_id: rule.rule_id,
          action_id: action.action_id,
        });
      }
      value = coerce(paramValue, action.value_type);
    } else {
      value = coerce(action.value, action.value_type);
    }

    if (action.action_type === "SET") {
      dictamen[action.field] = value;
    } else if (action.action_type === "APPEND") {
      if (!Array.isArray(dictamen[action.field])) {
        dictamen[action.field] = [];
      }
      let item = value;
      if (action.field === "motivos" && matchedConds.length) {
        const diagConds = matchedConds
          .filter((c) => c.field !== "stage")
          .map((c) => ({ field: c.field, op: c.op, actual: c.actual, expected: c.expected }));
        if (diagConds.length) {
          item = { ...value, rule_id: rule.rule_id, rule: rule.name, conditions: diagConds };
        }
      }
      dictamen[action.field].push(item);
    } else if (action.action_type === "ADD") {
      dictamen[action.field] = Number(dictamen[action.field] ?? 0) + Number(value ?? 0);
    } else {
      throw new Error(`Unsupported action_type: ${action.action_type}`);
    }
  }

  applied.push({ rule_id: rule.rule_id, name: rule.name, priority: rule.priority });
  trace.appliedRules.push(`${rule.priority}:${rule.name}`);
  return dictamen;
}

export function evaluateRuleset(input, offer, paramsIndex, options = {}) {
  const stage = input.stage;
  const debug = options.debug === true;

  const rules = offer.rules
    .slice()
    .sort((a, b) => (b.priority - a.priority) || ((a.rule_id ?? 0) - (b.rule_id ?? 0)));

  let dictamen = { motivos: [] };
  const applied = [];
  const trace = {
    rulesEvaluated: 0,
    rulesMatched: 0,
    rulesApplied: 0,
    conditionsEvaluated: 0,
    failedConditions: [],
    appliedRules: [],
    missingParams: [],
  };

  if (debug) {
    trace.ruleTrace = [];
    trace.condTrace = [];
  }

  for (const rule of rules) {
    trace.rulesEvaluated += 1;
    const context = { ...input, ...dictamen };
    const { matched, condResults, matchedConds } = ruleMatches(context, rule, offer.offerCode, paramsIndex);

    trace.conditionsEvaluated += condResults.length;
    trace.failedConditions.push(...condResults.filter((result) => !result.passed));

    if (debug) {
      trace.ruleTrace.push({
        rule_id: rule.rule_id,
        name: rule.name,
        priority: rule.priority,
        matched,
      });
      trace.condTrace.push(...condResults);
    }

    if (!matched) {
      continue;
    }

    trace.rulesMatched += 1;
    dictamen = applyActions(dictamen, rule, offer.offerCode, paramsIndex, applied, trace, matchedConds);
    trace.rulesApplied += 1;

    if (rule.stop_processing) {
      break;
    }
  }

  return { dictamen, applied, trace };
}

const UI_LIMITS_MIN = ["MIN_HIPOTECA", "MIN_PLAZO", "MIN_PLAZO_MESES", "MIN_LTV_EXCLUSIVE", "MIN_LTV_RATIO"];
const UI_LIMITS_MAX = ["MAX_HIPOTECA", "MAX_PLAZO", "MAX_PLAZO_MESES", "MAX_LTV", "MAX_LTV_RATIO", "EDAD_PLAZO"];
const UI_LIMITS_BOOL = ["SOLICITAR_DATOS_INTERVINIENTES"];

function aggregateUiLimits(offersWithDictamen) {
  const ui = {};

  for (const field of UI_LIMITS_MIN) {
    const values = offersWithDictamen.map((offer) => offer.dictamen?.[field]).filter((v) => typeof v === "number");
    if (values.length) {
      ui[field] = Math.min(...values);
    }
  }

  for (const field of UI_LIMITS_MAX) {
    const values = offersWithDictamen.map((offer) => offer.dictamen?.[field]).filter((v) => typeof v === "number");
    if (values.length) {
      ui[field] = Math.max(...values);
    }
  }

  for (const field of UI_LIMITS_BOOL) {
    const values = offersWithDictamen.map((offer) => offer.dictamen?.[field]).filter((v) => typeof v === "boolean");
    if (values.length) {
      ui[field] = values.some(Boolean);
    }
  }

  return ui;
}

export function initcheck(inputBase, offers, paramsIndex, options = {}) {
  const input = { ...inputBase, stage: "INIT" };

  const all = offers.map((offer) => {
    const result = evaluateRuleset(input, offer, paramsIndex, options);
    return {
      offerCode: offer.offerCode,
      offer_rank: offer.offer_rank,
      oferta_id: offer.oferta_id,
      dictamen: result.dictamen,
      applied: result.applied,
      trace: result.trace,
    };
  });

  const eligibleFull = all
    .filter((offer) => offer.dictamen?.initEligible === true)
    .sort((a, b) => (b.offer_rank ?? 0) - (a.offer_rank ?? 0));

  return {
    eligibleOffers: eligibleFull,
    uiLimits: aggregateUiLimits(eligibleFull),
    all,
  };
}

const EMPTY_TRACE = Object.freeze({
  rulesEvaluated: 0, rulesMatched: 0, rulesApplied: 0,
  conditionsEvaluated: 0, failedConditions: [], appliedRules: [], missingParams: [],
});

export function precheck(inputBase, offers, paramsIndex, options = {}) {
  const { chained = false, ...evalOptions } = options;

  // Chained mode: run INIT first and record which offers failed.
  const initFailedCodes = new Set();
  let initEligibleFull = [];
  if (chained) {
    const initRes = initcheck(inputBase, offers, paramsIndex, evalOptions);
    for (const o of initRes.all) {
      if (o.dictamen?.initEligible !== true) {
        initFailedCodes.add(o.offerCode);
      } else {
        initEligibleFull.push(o);
      }
    }
  }

  const input = { ...inputBase, stage: "PRE" };

  const all = offers.map((offer) => {
    if (chained && initFailedCodes.has(offer.offerCode)) {
      // Inject a synthetic rejection without evaluating PRE rules.
      return {
        offerCode: offer.offerCode,
        offer_rank: offer.offer_rank,
        oferta_id: offer.oferta_id,
        dictamen: { motivos: [] },
        applied: [{ rule_id: 0, name: "PRE Rechazo: INIT no superado (encadenado)", priority: Infinity }],
        trace: { ...EMPTY_TRACE, failedConditions: [], appliedRules: [], missingParams: [] },
      };
    }
    const result = evaluateRuleset(input, offer, paramsIndex, evalOptions);
    return {
      offerCode: offer.offerCode,
      offer_rank: offer.offer_rank,
      oferta_id: offer.oferta_id,
      dictamen: result.dictamen,
      applied: result.applied,
      trace: result.trace,
    };
  });

  const preEligibleFull = all
    .filter((offer) => offer.dictamen?.preEligible === true)
    .sort((a, b) => (b.offer_rank ?? 0) - (a.offer_rank ?? 0));

  return {
    eligibleOffers: preEligibleFull,
    uiLimits: aggregateUiLimits([...initEligibleFull, ...preEligibleFull]),
    all,
  };
}

export function finalize(inputFull, offers, paramsIndex, preResult, options = {}) {
  const { chained = false, ...evalOptions } = options;

  // Chained mode: recompute preResult with full INIT+PRE validation.
  const effectivePreResult = chained
    ? precheck(inputFull, offers, paramsIndex, { chained: true, ...evalOptions })
    : preResult;

  const input = { ...inputFull, stage: "FINAL" };
  const hasPreResult = Array.isArray(effectivePreResult?.eligibleOffers);

  let offersToEval = offers;
  if (hasPreResult) {
    const eligibleCodes = new Set(effectivePreResult.eligibleOffers.map((offer) => offer.offerCode));
    if (!eligibleCodes.size) {
      return { winner: null, eligibleOffers: [], uiLimits: effectivePreResult?.uiLimits ?? {}, all: [] };
    }
    offersToEval = offers.filter((offer) => eligibleCodes.has(offer.offerCode));
  }

  const all = offersToEval.map((offer) => {
    const result = evaluateRuleset(input, offer, paramsIndex, evalOptions);
    return {
      offerCode: offer.offerCode,
      offer_rank: offer.offer_rank,
      oferta_id: offer.oferta_id,
      dictamen: result.dictamen,
      applied: result.applied,
      trace: result.trace,
    };
  });

  const eligibleFull = all.filter((item) => item.dictamen?.eligible === true);
  eligibleFull.sort((a, b) => (b.offer_rank ?? 0) - (a.offer_rank ?? 0));

  const preEligibleMap = new Map((effectivePreResult?.eligibleOffers ?? []).map((offer) => [offer.offerCode, offer]));

  const eligibleOffers = eligibleFull.map((offer) => {
    const pre = preEligibleMap.get(offer.offerCode);
    if (!pre) {
      return offer;
    }
    return {
      ...pre,
      ...offer,
      dictamen: {
        ...(pre.dictamen ?? {}),
        ...(offer.dictamen ?? {}),
      },
    };
  });

  const uiLimits = aggregateUiLimits(eligibleOffers);

  return { winner: eligibleFull[0] ?? null, eligibleOffers, uiLimits, all };
}

export function computeDerived(input) {
  const importeHipoteca = Number(input.IMPORTE_HIPOTECA_NM ?? 0);

  // LTV: usa IMPORTE_VIVIENDA_NM si está presente; si no, min(compraventa, tasacion) como fallback
  let LTV_NM = null;
  const importeVivienda = Number(input.IMPORTE_VIVIENDA_NM ?? 0);
  if (importeVivienda > 0) {
    LTV_NM = importeHipoteca / importeVivienda;
  } else {
    const baseGarantia = Math.min(Number(input.importeCompraventa ?? 0), Number(input.importeTasacion ?? 0));
    if (baseGarantia > 0) {
      LTV_NM = importeHipoteca / baseGarantia;
    }
  }

  // EDAD_MAS_PLAZO_NM = max(edadT1, edadT2) + plazo en años (ambos pre-calculados en el input)
  const edadMax = Number(input.EDAD_MAX_NM ?? 0);
  const plazo = Number(input.PLAZO_NM ?? 0);
  const EDAD_MAS_PLAZO_NM = edadMax > 0 && plazo > 0 ? edadMax + plazo : null;

  return {
    ...input,
    LTV_NM,
    EDAD_MAS_PLAZO_NM,
  };
}
