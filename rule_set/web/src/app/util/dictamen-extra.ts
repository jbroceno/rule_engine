/**
 * dictamen-extra.ts
 *
 * Shared utility for the generic per-offer property panel (RF-SDI-06).
 *
 * The three simulator pages (INIT, PRE, FINAL) use `extraDictamenEntries()` to
 * obtain the list of dictamen properties that are NOT part of the well-known
 * numeric-limits or eligibility-status set.  Any future `SET|NEW_FLAG|…` action
 * added to rules.json will surface automatically in the panel — no Angular code
 * change required (Escenario C, RF-SDI-06).
 */

/** Well-known dictamen keys that are already rendered as numeric limits or
 *  internal eligibility flags.  Any key NOT in this set is considered an
 *  "extra" property and shown in the generic panel. */
export const STANDARD_DICTAMEN_KEYS: ReadonlySet<string> = new Set([
  // Numeric limits (rendered by limitFromOffer / explicit template rows)
  "MIN_HIPOTECA",
  "MAX_HIPOTECA",
  "MIN_PLAZO",
  "MAX_PLAZO",
  "MIN_PLAZO_MESES",
  "MIN_LTV_EXCLUSIVE",
  "MIN_LTV_RATIO",
  "MAX_LTV",
  "MAX_LTV_RATIO",
  "EDAD_PLAZO",
  // Internal engine eligibility / rejection flags
  "initEligible",
  "preEligible",
  "eligible",
  "rejected",
  "initRejected",
  "preRejected",
  "selectedOffer",
  "offerCode",
]);

export interface DictamenEntry {
  key: string;
  value: unknown;
  formatted: string;
}

/**
 * Returns dictamen entries not in `STANDARD_DICTAMEN_KEYS`, sorted by key.
 * If the offer has no `dictamen` or all keys are standard, returns `[]`.
 */
export function extraDictamenEntries(
  dictamen: Record<string, unknown> | undefined
): DictamenEntry[] {
  if (!dictamen) return [];
  return Object.keys(dictamen)
    .filter((k) => !STANDARD_DICTAMEN_KEYS.has(k))
    .sort()
    .map((k) => ({ key: k, value: dictamen[k], formatted: formatDictamenValue(dictamen[k]) }));
}

/**
 * Formats a dictamen value for display.
 * - boolean  → "Sí" / "No"
 * - null/undefined → "-"
 * - object/array → compact JSON
 * - everything else → String()
 */
export function formatDictamenValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
