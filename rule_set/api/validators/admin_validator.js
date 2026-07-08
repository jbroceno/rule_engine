import { AppError } from "../utils/app_error.js";
import { parseVigencia } from "../utils/vigencia.js";
import {
  ALLOWED_ACTION_TYPES,
  ALLOWED_OPERATORS,
  ALLOWED_STAGES,
  ALLOWED_VALUE_TYPES,
  normalizeActionType,
  normalizeOperator,
  normalizeStage,
  normalizeValueType,
} from "../utils/rule_catalogs.js";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pushError(errors, field, message) {
  errors.push({ field, message });
}

function ensureRequestBody(body) {
  if (!isObject(body)) {
    throw new AppError("El body debe ser un objeto JSON.", 400);
  }
}

function validateRulePayloadInternal(payload) {
  const errors = [];

  if (!isObject(payload)) {
    return [{ field: "payload", message: "Debe ser un objeto JSON." }];
  }

  if (typeof payload.offerCode !== "string" || !payload.offerCode.trim()) {
    pushError(errors, "offerCode", "offerCode es obligatorio.");
  }

  const stage = normalizeStage(payload.stage);
  if (!ALLOWED_STAGES.has(stage)) {
    pushError(errors, "stage", "stage debe ser INIT, PRE o FINAL.");
  }

  if (typeof payload.rule_name !== "string" || !payload.rule_name.trim()) {
    pushError(errors, "rule_name", "rule_name es obligatorio.");
  }

  if (!Number.isInteger(payload.priority)) {
    pushError(errors, "priority", "priority debe ser entero.");
  }

  if (typeof payload.enabled !== "boolean") {
    pushError(errors, "enabled", "enabled debe ser booleano.");
  }

  if (typeof payload.stop_processing !== "boolean") {
    pushError(errors, "stop_processing", "stop_processing debe ser booleano.");
  }

  if (!Number.isInteger(payload.offer_date_id) || payload.offer_date_id <= 0) {
    pushError(errors, "offer_date_id", "offer_date_id es obligatorio y debe ser entero positivo.");
  }

  if (!Array.isArray(payload.actions) || payload.actions.length === 0) {
    pushError(errors, "actions", "Debe contener al menos una accion.");
  } else {
    payload.actions.forEach((action, index) => {
      const actionPrefix = `actions[${index}]`;

      if (!isObject(action)) {
        pushError(errors, actionPrefix, "Cada accion debe ser objeto.");
        return;
      }

      const actionType = normalizeActionType(action.action_type);
      if (!ALLOWED_ACTION_TYPES.has(actionType)) {
        pushError(errors, `${actionPrefix}.action_type`, "action_type no soportado.");
      }

      const actionPayload = action.action_payload;
      if (!isObject(actionPayload)) {
        pushError(errors, `${actionPrefix}.action_payload`, "action_payload debe ser objeto.");
      } else if (actionType === "SET_DICTAMEN") {
        if (typeof actionPayload.dictamen !== "string" || !actionPayload.dictamen.trim()) {
          pushError(errors, `${actionPrefix}.action_payload.dictamen`, "dictamen es obligatorio para SET_DICTAMEN.");
        }
      } else {
        if (typeof actionPayload.field !== "string" || !actionPayload.field.trim()) {
          pushError(errors, `${actionPrefix}.action_payload.field`, "field es obligatorio en action_payload.");
        }
        if (!ALLOWED_VALUE_TYPES.has(normalizeValueType(actionPayload.value_type))) {
          pushError(errors, `${actionPrefix}.action_payload.value_type`, "value_type invalido en action_payload.");
        }
        if (actionPayload.value === undefined) {
          pushError(errors, `${actionPrefix}.action_payload.value`, "value es obligatorio en action_payload.");
        }
      }
    });
  }

  if (!Array.isArray(payload.conditions) || payload.conditions.length === 0) {
    pushError(errors, "conditions", "Debe contener al menos una condicion.");
  } else {
    let hasMatchingStageCondition = false;

    payload.conditions.forEach((condition, index) => {
      const prefix = `conditions[${index}]`;

      if (!isObject(condition)) {
        pushError(errors, prefix, "Cada condicion debe ser objeto.");
        return;
      }

      if (!Number.isInteger(condition.group_id) || condition.group_id < 0) {
        pushError(errors, `${prefix}.group_id`, "group_id debe ser entero mayor o igual que 0.");
      }

      if (typeof condition.left_operand !== "string" || !condition.left_operand.trim()) {
        pushError(errors, `${prefix}.left_operand`, "left_operand es obligatorio.");
      }

      const normalizedOperator = normalizeOperator(condition.operator);
      if (!ALLOWED_OPERATORS.has(normalizedOperator)) {
        pushError(errors, `${prefix}.operator`, "operator no soportado.");
      }

      const conditionValueType = normalizeValueType(condition.value_type);
      if (!ALLOWED_VALUE_TYPES.has(conditionValueType)) {
        pushError(errors, `${prefix}.value_type`, "value_type invalido.");
      }

      const isInOperator = normalizedOperator === "IN" || normalizedOperator === "NOT_IN";
      const isUnaryOperator = normalizedOperator === "IS_TRUE" || normalizedOperator === "IS_FALSE";
      if (isInOperator) {
        const isArrayOperand = Array.isArray(condition.right_operand);
        const isStringOperand = typeof condition.right_operand === "string" && condition.right_operand.trim().length > 0;
        if (!isArrayOperand && !isStringOperand) {
          pushError(errors, `${prefix}.right_operand`, "Para IN/NOT_IN usa array o string no vacio.");
        }
      } else if (!isUnaryOperator) {
        if (condition.right_operand === undefined || condition.right_operand === null || String(condition.right_operand).trim() === "") {
          pushError(errors, `${prefix}.right_operand`, "right_operand es obligatorio.");
        }
      }

      const isStageCondition = String(condition.left_operand ?? "").trim().toLowerCase() === "stage"
        && normalizeOperator(condition.operator) === "EQ"
        && String(condition.right_operand ?? "").trim().toUpperCase() === stage;
      if (isStageCondition) {
        hasMatchingStageCondition = true;
      }
    });

    if (!hasMatchingStageCondition && ALLOWED_STAGES.has(stage)) {
      pushError(
        errors,
        "conditions",
        "Debe existir una condicion stage EQ con el mismo valor que payload.stage."
      );
    }
  }

  return errors;
}

function validateParamPayloadInternal(payload, allowPartial = false) {
  const errors = [];

  if (!isObject(payload)) {
    return [{ field: "payload", message: "Debe ser un objeto JSON." }];
  }

  if (!allowPartial || payload.offerCode !== undefined) {
    if (typeof payload.offerCode !== "string" || !payload.offerCode.trim()) {
      pushError(errors, "offerCode", "offerCode es obligatorio.");
    }
  }

  if (!allowPartial || payload.key !== undefined) {
    if (typeof payload.key !== "string" || !payload.key.trim()) {
      pushError(errors, "key", "key es obligatorio.");
    }
  }

  if (!allowPartial || payload.value_type !== undefined) {
      const valueType = normalizeValueType(payload.value_type);
    if (!ALLOWED_VALUE_TYPES.has(valueType)) {
      pushError(errors, "value_type", "value_type invalido.");
    }
  }

  if (!allowPartial || payload.value !== undefined) {
    if (payload.value === undefined || payload.value === null || String(payload.value).trim() === "") {
      pushError(errors, "value", "value es obligatorio.");
    }
  }

  if (!allowPartial) {
    if (!Number.isInteger(payload.offer_date_id) || payload.offer_date_id <= 0) {
      pushError(errors, "offer_date_id", "offer_date_id es obligatorio y debe ser entero positivo.");
    }
  }

  return errors;
}

function throwIfErrors(errors) {
  if (errors.length > 0) {
    throw new AppError("Payload invalido.", 400, { errors });
  }
}

export function validateRulesQuery(query) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const pageSize = query.pageSize === undefined ? 50 : Number(query.pageSize);

  if (!Number.isInteger(page) || page <= 0) {
    throw new AppError("page debe ser entero positivo.", 400);
  }

  if (!Number.isInteger(pageSize) || pageSize <= 0 || pageSize > 200) {
    throw new AppError("pageSize debe ser entero entre 1 y 200.", 400);
  }

  if (query.stage !== undefined && !ALLOWED_STAGES.has(normalizeStage(query.stage))) {
    throw new AppError("stage debe ser PRE o FINAL.", 400);
  }

  if (query.enabled !== undefined && !["true", "false", "1", "0"].includes(String(query.enabled).toLowerCase())) {
    throw new AppError("enabled debe ser true/false.", 400);
  }

  const offerDateId = query.offerDateId === undefined ? undefined : Number(query.offerDateId);

  return {
    offerCode: typeof query.offerCode === "string" ? query.offerCode.trim() : undefined,
    stage: query.stage === undefined ? undefined : normalizeStage(query.stage),
    enabled: query.enabled === undefined
      ? undefined
      : ["true", "1"].includes(String(query.enabled).toLowerCase()),
    q: typeof query.q === "string" ? query.q.trim() : undefined,
    offerDateId: Number.isInteger(offerDateId) && offerDateId > 0 ? offerDateId : undefined,
    page,
    pageSize,
  };
}

export function validateRuleCreatePayload(body) {
  ensureRequestBody(body);
  const errors = validateRulePayloadInternal(body);
  throwIfErrors(errors);
}

export function validateRuleUpdatePayload(body) {
  ensureRequestBody(body);
  const errors = validateRulePayloadInternal(body);
  throwIfErrors(errors);
}

export function validateRuleEnabledPayload(body) {
  ensureRequestBody(body);
  if (typeof body.enabled !== "boolean") {
    throw new AppError("enabled debe ser booleano.", 400);
  }
}

export function validateRuleReorderPayload(body) {
  ensureRequestBody(body);

  const errors = [];
  if (typeof body.offerCode !== "string" || !body.offerCode.trim()) {
    pushError(errors, "offerCode", "offerCode es obligatorio.");
  }

  if (!ALLOWED_STAGES.has(normalizeStage(body.stage))) {
    pushError(errors, "stage", "stage debe ser INIT, PRE o FINAL.");
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    pushError(errors, "items", "items debe contener al menos un elemento.");
  } else {
    body.items.forEach((item, index) => {
      const prefix = `items[${index}]`;
      if (!isObject(item)) {
        pushError(errors, prefix, "Cada item debe ser objeto.");
        return;
      }
      if (!Number.isInteger(item.rule_id)) {
        pushError(errors, `${prefix}.rule_id`, "rule_id debe ser entero.");
      }
      if (!Number.isInteger(item.priority)) {
        pushError(errors, `${prefix}.priority`, "priority debe ser entero.");
      }
    });
  }

  throwIfErrors(errors);
}

export function validateParamsQuery(query) {
  const offerDateId = query.offerDateId === undefined ? undefined : Number(query.offerDateId);
  return {
    offerCode: typeof query.offerCode === "string" ? query.offerCode.trim() : undefined,
    offerDateId: Number.isInteger(offerDateId) && offerDateId > 0 ? offerDateId : undefined,
  };
}

export function validateParamCreatePayload(body) {
  ensureRequestBody(body);
  throwIfErrors(validateParamPayloadInternal(body, false));
}

export function validateParamUpdatePayload(body) {
  ensureRequestBody(body);
  throwIfErrors(validateParamPayloadInternal(body, true));
}

export function validateAdminValidatePayload(body) {
  ensureRequestBody(body);

  if (typeof body.entity !== "string" || !body.entity.trim()) {
    throw new AppError("entity es obligatorio.", 400);
  }

  const normalizedEntity = body.entity.trim().toLowerCase();
  if (normalizedEntity !== "rule" && normalizedEntity !== "param") {
    throw new AppError("entity debe ser 'rule' o 'param'.", 400);
  }

  if (!isObject(body.payload)) {
    throw new AppError("payload debe ser objeto.", 400);
  }

  return {
    entity: normalizedEntity,
    payload: body.payload,
  };
}

export function runValidationPreview(entity, payload) {
  if (entity === "rule") {
    return validateRulePayloadInternal(payload);
  }
  return validateParamPayloadInternal(payload, false);
}

const ALLOWED_TIPO_CD = new Set(["REGLAS", "PARAMS", "AMBOS"]);

function validateFechaPayloadInternal(payload) {
  const errors = [];

  if (!isObject(payload)) {
    return [{ field: "payload", message: "Debe ser un objeto JSON." }];
  }

  // ADR-004: accept YYYY-MM-DDTHH:mm:ss, YYYY-MM-DDTHH:mm, YYYY-MM-DD.
  // Reject malformed strings explicitly — parseVigencia returns null for invalid input.
  if (typeof payload.valid_from !== "string" || !payload.valid_from.trim()) {
    pushError(errors, "valid_from", "valid_from es obligatorio (formato YYYY-MM-DDTHH:mm:ss o YYYY-MM-DD).");
  } else if (parseVigencia(payload.valid_from) === null) {
    pushError(errors, "valid_from", "valid_from tiene formato inválido. Use YYYY-MM-DDTHH:mm:ss o YYYY-MM-DD.");
  }

  if (payload.valid_to !== undefined && payload.valid_to !== null) {
    if (typeof payload.valid_to !== "string" || !payload.valid_to.trim()) {
      pushError(errors, "valid_to", "valid_to debe ser string YYYY-MM-DDTHH:mm:ss, YYYY-MM-DD, o null.");
    } else if (parseVigencia(payload.valid_to) === null) {
      pushError(errors, "valid_to", "valid_to tiene formato inválido. Use YYYY-MM-DDTHH:mm:ss o YYYY-MM-DD.");
    } else if (payload.valid_from) {
      // ADR-004: temporal comparison — epoch millis, not lexical string compare.
      const fromEpoch = parseVigencia(payload.valid_from);
      const toEpoch   = parseVigencia(payload.valid_to);
      if (fromEpoch !== null && toEpoch !== null && toEpoch <= fromEpoch) {
        pushError(errors, "valid_to", "valid_to debe ser posterior a valid_from.");
      }
    }
  }

  if (typeof payload.descripcion !== "string" || !payload.descripcion.trim()) {
    pushError(errors, "descripcion", "descripcion es obligatoria.");
  }

  if (!ALLOWED_TIPO_CD.has(String(payload.tipo_cd ?? "").toUpperCase())) {
    pushError(errors, "tipo_cd", "tipo_cd debe ser REGLAS, PARAMS o AMBOS.");
  }

  return errors;
}

export function validateFechaCreatePayload(body) {
  ensureRequestBody(body);
  throwIfErrors(validateFechaPayloadInternal(body));
}

export function validateFechaUpdatePayload(body) {
  ensureRequestBody(body);
  throwIfErrors(validateFechaPayloadInternal(body));
}

const ALLOWED_ENTORNO_CD = new Set(["POC", "WF"]);

// Validates that the given value is a recognized entorno code (POC or WF).
// Returns the normalized uppercase value on success; throws AppError 400 otherwise.
export function validateEntornoCd(value) {
  const upper = typeof value === "string" ? value.toUpperCase() : undefined;
  if (!upper || !ALLOWED_ENTORNO_CD.has(upper)) {
    throw new AppError("entorno_cd debe ser POC o WF.", 400);
  }
  return upper;
}
