import { loadNormalizedConfig } from "../services/config_service.js";

function splitCsv(value) {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function getConfig(req, res, next) {
  try {
    const offerCodes = splitCsv(req.query.offerCodes);
    const asOfDate = req.query.date;

    const config = await loadNormalizedConfig({ offerCodes, asOfDate });
    res.status(200).json(config.uiConfig);
  } catch (error) {
    next(error);
  }
}
