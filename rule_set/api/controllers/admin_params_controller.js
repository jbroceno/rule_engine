import { createParam, deleteParam, listParams, updateParam } from "../services/admin_service.js";
import { validateParamCreatePayload, validateParamsQuery, validateParamUpdatePayload } from "../validators/admin_validator.js";
import { AppError } from "../utils/app_error.js";

function parseParamId(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError("paramId debe ser entero positivo.", 400);
  }
  return parsed;
}

export async function getParams(req, res, next) {
  try {
    const filters = validateParamsQuery(req.query);
    const payload = await listParams(filters);
    res.status(200).json(payload);
  } catch (error) {
    next(error);
  }
}

export async function postParam(req, res, next) {
  try {
    validateParamCreatePayload(req.body);
    const created = await createParam(req.body);
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
}

export async function putParam(req, res, next) {
  try {
    const paramId = parseParamId(req.params.paramId);
    validateParamUpdatePayload(req.body);
    const updated = await updateParam(paramId, req.body);
    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
}

export async function removeParam(req, res, next) {
  try {
    const paramId = parseParamId(req.params.paramId);
    const deleted = await deleteParam(paramId);
    res.status(200).json(deleted);
  } catch (error) {
    next(error);
  }
}
