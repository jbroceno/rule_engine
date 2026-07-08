import {
  createRule,
  deleteRule,
  listRules,
  reorderRules,
  setRuleEnabled,
  updateRule,
  validateRuleParamReferences,
} from "../services/admin_service.js";
import {
  validateRuleCreatePayload,
  validateRuleEnabledPayload,
  validateRuleReorderPayload,
  validateRulesQuery,
  validateRuleUpdatePayload,
} from "../validators/admin_validator.js";
import { AppError } from "../utils/app_error.js";

function throwIfReferenceErrors(errors) {
  if (errors.length > 0) {
    throw new AppError("Payload invalido.", 400, { errors });
  }
}

function parseRuleId(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError("ruleId debe ser entero positivo.", 400);
  }
  return parsed;
}

export async function getRules(req, res, next) {
  try {
    const filters = validateRulesQuery(req.query);
    const payload = await listRules(filters);
    res.status(200).json(payload);
  } catch (error) {
    next(error);
  }
}

export async function postRule(req, res, next) {
  try {
    validateRuleCreatePayload(req.body);
    throwIfReferenceErrors(await validateRuleParamReferences(req.body));
    const created = await createRule(req.body);
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
}

export async function putRule(req, res, next) {
  try {
    const ruleId = parseRuleId(req.params.ruleId);
    validateRuleUpdatePayload(req.body);
    throwIfReferenceErrors(await validateRuleParamReferences(req.body));
    const updated = await updateRule(ruleId, req.body);
    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
}

export async function removeRule(req, res, next) {
  try {
    const ruleId = parseRuleId(req.params.ruleId);
    const deleted = await deleteRule(ruleId);
    res.status(200).json(deleted);
  } catch (error) {
    next(error);
  }
}

export async function patchRuleEnabled(req, res, next) {
  try {
    const ruleId = parseRuleId(req.params.ruleId);
    validateRuleEnabledPayload(req.body);
    const result = await setRuleEnabled(ruleId, req.body.enabled);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function patchRuleReorder(req, res, next) {
  try {
    validateRuleReorderPayload(req.body);
    const result = await reorderRules(req.body);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
