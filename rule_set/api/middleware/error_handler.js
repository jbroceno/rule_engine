import { env } from "../config/env.js";
import { isAppError } from "../utils/app_error.js";

export function errorHandler(error, _req, res, _next) {
  const isKnown = isAppError(error);
  const statusCode = isKnown ? error.statusCode : 500;
  const isProd = env.nodeEnv === "production";

  const payload = {
    message: isKnown ? error.message : "Error interno inesperado.",
  };

  if (isKnown && error.details) {
    payload.details = error.details;
  }

  if (!isProd && !isKnown) {
    payload.details = {
      cause: error.message,
      stack: error.stack,
    };
  }

  res.status(statusCode).json(payload);
}
