export const ALLOWED_STAGES = new Set(["INIT", "PRE", "FINAL"]);
export const ALLOWED_VALUE_TYPES = new Set(["NUMBER", "BOOL", "STRING", "JSON", "DATE"]);
export const ALLOWED_OPERATORS = new Set([
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
export const ALLOWED_ACTION_TYPES = new Set(["SET", "ADD", "APPEND", "SET_DICTAMEN"]);

export function normalizeStage(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function normalizeOperator(value) {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (raw === "LTE") {
    return "LE";
  }
  if (raw === "GTE") {
    return "GE";
  }
  if (raw === "NEQ") {
    return "NE";
  }
  return raw;
}

export function normalizeValueType(valueType) {
  return String(valueType ?? "").trim().toUpperCase();
}

export function normalizeActionType(actionType) {
  return String(actionType ?? "").trim().toUpperCase();
}
