export const VALUE_TYPE_OPTIONS = [
  { value: "STRING", label: "STRING" },
  { value: "NUMBER", label: "NUMBER" },
  { value: "BOOL", label: "BOOL" },
  { value: "JSON", label: "JSON" },
] as const;

export const ACTION_TYPE_OPTIONS = [
  { value: "SET", label: "SET" },
  { value: "ADD", label: "ADD" },
  { value: "APPEND", label: "APPEND" },
  { value: "SET_DICTAMEN", label: "SET_DICTAMEN" },
] as const;

export const ACTION_PAYLOAD_KEY_OPTIONS = [
  "initRejected", "initEligible",
  "preRejected", "preEligible",
  "rejected", "eligible", "selectedOffer",
  "motivos", "offerCode",
  "MIN_HIPOTECA", "MAX_HIPOTECA",
  "MIN_PLAZO", "MAX_PLAZO",
  "MIN_PLAZO_MESES", "MAX_PLAZO_MESES",
  "MIN_LTV_EXCLUSIVE", "MIN_LTV_RATIO",
  "MAX_LTV", "MAX_LTV_RATIO",
  "EDAD_PLAZO", "requierePrimeraVivienda",
  "dictamen",
] as const;

export function normalizeValueType(valueType: unknown): "STRING" | "NUMBER" | "BOOL" | "JSON" {
  const normalized = String(valueType ?? "").trim().toUpperCase();
  if (normalized === "NUMBER" || normalized === "BOOL" || normalized === "JSON") {
    return normalized;
  }
  return "STRING";
}

export function normalizeActionType(actionType: unknown): string {
  const normalized = String(actionType ?? "").trim().toUpperCase();
  const match = ACTION_TYPE_OPTIONS.find((option) => option.value === normalized);
  return match?.value ?? "SET";
}
