export const RULE_OPERATOR_OPTIONS = [
  { value: "EQ", label: "EQ" },
  { value: "NE", label: "NE" },
  { value: "GT", label: "GT" },
  { value: "GE", label: "GE" },
  { value: "LT", label: "LT" },
  { value: "LE", label: "LE" },
  { value: "IN", label: "IN" },
  { value: "NOT_IN", label: "NOT_IN" },
  { value: "BETWEEN", label: "BETWEEN" },
  { value: "IS_TRUE", label: "IS_TRUE" },
  { value: "IS_FALSE", label: "IS_FALSE" },
] as const;

const RULE_OPERATOR_ALIASES: Record<string, string> = {
  EQ: "EQ",
  NE: "NE",
  NEQ: "NE",
  GT: "GT",
  GE: "GE",
  GTE: "GE",
  LT: "LT",
  LE: "LE",
  LTE: "LE",
  IN: "IN",
  NOT_IN: "NOT_IN",
  BETWEEN: "BETWEEN",
  IS_TRUE: "IS_TRUE",
  IS_FALSE: "IS_FALSE",
};

export function normalizeRuleOperator(operator: unknown): string {
  const normalized = String(operator ?? "").trim().toUpperCase();
  return RULE_OPERATOR_ALIASES[normalized] ?? normalized;
}
