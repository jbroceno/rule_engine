import { normalizeConfig, parseJsonMaybe } from "../../rule_engine.js";
import { getSqlPool, sql } from "../db/sql_client.js";
import { AppError } from "../utils/app_error.js";

function parseJsonValue(value, fallback) {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === "object") {
    return value;
  }
  if (typeof value !== "string") {
    return fallback;
  }

  const parsed = parseJsonMaybe(value, fallback);
  return parsed;
}

function normalizeParamsForUi(paramsRaw) {
  if (!Array.isArray(paramsRaw)) {
    return [];
  }

  return paramsRaw.map((row) => {
    const rawParamValues = row.paramValues ?? row.params ?? [];
    const parsedValues = parseJsonValue(rawParamValues, []);
    const paramValues = Array.isArray(parsedValues) ? parsedValues : [];

    return {
      offerCode: row.offerCode ?? row.offer_code,
      stage: String(row.stage ?? "ANY").toUpperCase(),
      paramValues: paramValues.map((param) => ({
        key: param.key ?? param.param_key,
        value_type: param.value_type ?? param.valueType,
        value: param.value,
      })),
    };
  });
}

function extractConfigPayload(result) {
  const row = result?.recordset?.[0] ?? null;
  if (!row) {
    throw new AppError(
      "El procedimiento dbo.cfg_get_offers_and_params_json_cached no devolvio filas. Verifica que exista configuracion activa en SQL Server.",
      500
    );
  }

  // WF SP (cfg_get_offers_and_params_json / _cached) returns uppercase column names
  if (row.OFERTAS_JSON !== undefined || row.PARAMETROS_JSON !== undefined) {
    return {
      offers: parseJsonValue(row.OFERTAS_JSON, []),
      params: parseJsonValue(row.PARAMETROS_JSON, []),
    };
  }

  if (row.offers_json !== undefined || row.params_json !== undefined) {
    return {
      offers: parseJsonValue(row.offers_json, []),
      params: parseJsonValue(row.params_json, []),
    };
  }

  if (row.rules_json !== undefined) {
    const payload = parseJsonValue(row.rules_json, {});
    return {
      offers: Array.isArray(payload.offers) ? payload.offers : [],
      params: Array.isArray(payload.params) ? payload.params : [],
    };
  }

  return {
    offers: parseJsonValue(row.offers, []),
    params: parseJsonValue(row.params, []),
  };
}

function parseAsOfDate(asOfDateRaw) {
  if (!asOfDateRaw) {
    return new Date();
  }
  const parsed = new Date(asOfDateRaw);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError("Fecha invalida. Usa formato ISO (YYYY-MM-DD).", 400);
  }
  return parsed;
}

export async function loadNormalizedConfig(options = {}) {
  const offerCodes = Array.isArray(options.offerCodes)
    ? options.offerCodes.filter((code) => typeof code === "string" && code.trim().length > 0)
    : [];
  const offerCodesCsv = offerCodes.length ? offerCodes.join(",") : null;

  const pool = await getSqlPool();
  let result = null;
  try {
    const request = pool.request();
    request.input("offer_codes", sql.NVarChar(sql.MAX), offerCodesCsv);
    request.input("DATE", sql.DateTime, parseAsOfDate(options.asOfDate));
    request.input("max_history_size", sql.Int, 50);
    result = await request.execute("dbo.cfg_get_offers_and_params_json_cached");
  } catch (error) {
    const isMissingPrimarySp = String(error?.message ?? "")
      .toLowerCase()
      .includes("could not find stored procedure 'dbo.cfg_get_offers_and_params_json_cached'");

    if (!isMissingPrimarySp) {
      throw new AppError(
        "Error ejecutando dbo.cfg_get_offers_and_params_json_cached. Verifica permisos y parametros de entrada.",
        500,
        { cause: error.message }
      );
    }

    try {
      const fallbackRequest = pool.request();
      fallbackRequest.input("offer_codes", sql.NVarChar(sql.MAX), offerCodesCsv);
      result = await fallbackRequest.execute("dbo.cfg_get_rules_json");
    } catch (fallbackError) {
      throw new AppError(
        "No se pudo cargar configuracion desde SQL Server. Verifica que exista dbo.cfg_get_offers_and_params_json o dbo.cfg_get_rules_json y permisos EXECUTE.",
        500,
        { cause: fallbackError.message }
      );
    }
  }

  const parsed = extractConfigPayload(result);

  let normalized;
  try {
    normalized = normalizeConfig(parsed, { strictValidation: true });
  } catch (error) {
    // Log the full validation detail server-side for diagnosis
    console.error("[config_service] normalizeConfig failed:\n", error.message);
    const lines = String(error.message ?? "").split("\n").filter(Boolean);
    const firstError = lines.find((l) => l.startsWith("-")) ?? lines[1] ?? "";
    const hint = firstError ? ` Primer error: ${firstError.replace(/^-\s*/, "")}.` : "";
    throw new AppError(
      `Configuracion invalida recibida desde SQL Server.${hint} Revisa reglas/parametros y su estructura JSON.`,
      500,
      { cause: error.message }
    );
  }

  return {
    offers: normalized.offers,
    paramsIndex: normalized.paramsIndex,
    uiConfig: {
      offers: normalized.offers,
      params: normalizeParamsForUi(parsed.params),
    },
  };
}
