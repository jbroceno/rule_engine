import { AppError } from "../utils/app_error.js";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ensureObject(value, fieldName) {
  if (!isObject(value)) {
    throw new AppError(`El campo '${fieldName}' es obligatorio y debe ser un objeto JSON.`, 400);
  }
}

export function validateInitSimulationPayload(body) {
  ensureObject(body, "body");
  ensureObject(body.input, "input");

  if (body.offerCodes !== undefined && !Array.isArray(body.offerCodes)) {
    throw new AppError("El campo 'offerCodes' debe ser un array de strings.", 400);
  }
}

export function validatePreSimulationPayload(body) {
  ensureObject(body, "body");
  ensureObject(body.input, "input");

  if (body.offerCodes !== undefined && !Array.isArray(body.offerCodes)) {
    throw new AppError("El campo 'offerCodes' debe ser un array de strings.", 400);
  }
}

export function validateFinalSimulationPayload(body) {
  ensureObject(body, "body");
  ensureObject(body.preInput, "preInput");
  ensureObject(body.finalInput, "finalInput");

  if (body.offerCodes !== undefined && !Array.isArray(body.offerCodes)) {
    throw new AppError("El campo 'offerCodes' debe ser un array de strings.", 400);
  }
}
