export interface RuleCondition {
  cond_id?: number;
  group_id?: number;
  field: string;
  operator: string;
  value_type?: string;
  value1?: unknown;
  value2?: unknown;
}

export interface RuleAction {
  action_id?: number;
  action_type: string;
  field: string;
  value?: unknown;
  value_type?: string;
}

export interface RuleConfig {
  rule_id?: number;
  name?: string;
  priority?: number;
  stop_processing?: boolean;
  conditions?: RuleCondition[];
  actions?: RuleAction[];
}

export interface OfferConfig {
  offerCode: string;
  offer_rank?: number;
  oferta_id?: number;
  name?: string;
  rules?: RuleConfig[];
}

export interface ParamValue {
  key: string;
  value_type?: string;
  value?: unknown;
}

export interface ParamConfig {
  offerCode: string;
  stage: "PRE" | "FINAL" | "ANY" | string;
  paramValues: ParamValue[];
}

export interface ConfigResponse {
  offers: OfferConfig[];
  params: ParamConfig[];
}

/** Campos de entrada para la fase INIT (nomenclatura WF).
 *  El componente calcula EDAD_MAX_NM = max(edadT1, edadT2) antes de enviar.
 *  T2 toma valor 0/false cuando NUM_TITULARES_NM = 1.
 */
export interface InitSimulationInput {
  NUM_TITULARES_NM: number;
  // Titular 1
  EDAD_T1_NM: number;
  ANTIGUEDAD_T1_NM: number;          // meses como cliente
  DOMICILIA_NOMINA_T1_FL: boolean;
  // Titular 2 (0 / false cuando NUM_TITULARES_NM = 1)
  EDAD_T2_NM: number;
  ANTIGUEDAD_T2_NM: number;
  DOMICILIA_NOMINA_T2_FL: boolean;
  // Calculado por el componente: max(edadT1, edadT2)
  EDAD_MAX_NM: number;
  // Solicitud
  FINALIDAD_CD: number;
  PRIMERA_VIVIENDA_HABITUAL_FL: boolean;
  TIPO_ALTA_CD: string;
  IMPORTE_VIVIENDA_NM: number;
  IMPORTE_VIVIENDA_CA_NM: number;    // lookup real por CCAA; entrada directa en el simulador
}

/** Fase PRE: extiende INIT añadiendo los ingresos normalizados (nomenclatura WF).
 *  INGRESO_TOTAL_NM lo calcula el componente (INGRESO_T1_NM + INGRESO_T2_NM).
 */
export interface PreSimulationInput extends InitSimulationInput {
  INGRESO_T1_NM: number;             // T1.Ingresos * T1.NumPagas / 14
  INGRESO_T2_NM: number;             // 0 cuando NUM_TITULARES_NM = 1
  INGRESO_TOTAL_NM: number;          // calculado: INGRESO_T1_NM + INGRESO_T2_NM
}

/** Fase FINAL: solo los campos de préstamo (nomenclatura WF).
 *  LTV_NM y EDAD_MAS_PLAZO_NM los calcula el servidor en computeDerived
 *  a partir del preInput (IMPORTE_VIVIENDA_NM, EDAD_MAX_NM) y PLAZO_NM.
 */
export interface FinalSimulationInput {
  IMPORTE_HIPOTECA_NM: number;
  PLAZO_NM: number;                  // en años
}

export interface InitEligibleOffer {
  offerCode: string;
  offer_rank?: number;
  oferta_id?: number;
  dictamen?: Record<string, unknown>;
  motivos?: Array<Record<string, unknown>>;
}

export interface WfCompareOfertasElegibles {
  poc: string[];
  wf: string[];
  soloEnPoc: string[];
  soloEnWf: string[];
  match: boolean;
}

export interface WfCompareLimiteDif {
  campo: string;
  poc: unknown;
  wf: unknown;
}

export interface WfCompareLimites {
  match: boolean;
  diferencias: WfCompareLimiteDif[];
}

export interface WfCompareGanadora {
  poc: string | null;
  wf: string | null;
  match: boolean;
}

export interface WfCompareResult {
  match?: boolean;
  wf?: unknown;
  ofertasElegibles?: WfCompareOfertasElegibles;
  limites?: WfCompareLimites;
  ofertaGanadora?: WfCompareGanadora | null;
  error?: string;
}

export interface InitSimulationRequest {
  input: InitSimulationInput;
  offerCodes?: string[];
  debug?: boolean;
  validateWf?: boolean;
  wfToken?: string;
  wfTokenExpCd?: string;
  wfComunidadAutonoma?: string;
  wfNumPersonaT1?: string;
  wfNumPersonaT2?: string;
}

export interface InitSimulationResponse {
  eligibleOffers?: InitEligibleOffer[];
  uiLimits?: Record<string, number | boolean | undefined>;
  all?: OfferEvaluationResult[];
  wfCompare?: WfCompareResult;
}

export interface PreSimulationRequest {
  input: PreSimulationInput;
  offerCodes?: string[];
  debug?: boolean;
  chained?: boolean;
  validateWf?: boolean;
  wfToken?: string;
  wfTokenExpCd?: string;
  wfComunidadAutonoma?: string;
  wfNumPersonaT1?: string;
  wfNumPersonaT2?: string;
}

export interface FinalSimulationRequest {
  preInput: PreSimulationInput;
  finalInput: FinalSimulationInput;
  offerCodes?: string[];
  debug?: boolean;
  chained?: boolean;
  validateWf?: boolean;
  wfToken?: string;
  wfTokenExpCd?: string;
  wfComunidadAutonoma?: string;
  wfNumPersonaT1?: string;
  wfNumPersonaT2?: string;
}

export interface RuleTraceItem {
  rule_id?: number;
  name?: string;
  priority?: number;
  matched: boolean;
}

export interface ConditionTraceItem {
  rule_id?: number;
  cond_id?: number;
  group_id?: number;
  field?: string;
  op?: string;
  passed: boolean;
  actual?: unknown;
  expected?: unknown;
  expectedSource?: unknown;
}

export interface EvaluationTrace {
  rulesEvaluated?: number;
  rulesMatched?: number;
  rulesApplied?: number;
  conditionsEvaluated?: number;
  ruleTrace?: RuleTraceItem[];
  condTrace?: ConditionTraceItem[];
}

export interface OfferEvaluationResult {
  offerCode: string;
  offer_rank?: number;
  oferta_id?: number;
  dictamen?: Record<string, unknown>;
  applied?: string[];
  trace?: EvaluationTrace;
}

export interface PreEligibleOffer {
  offerCode: string;
  offer_rank?: number;
  oferta_id?: number;
  dictamen?: Record<string, unknown>;
  // Límites devueltos por la regla PRE Decisión (nuevas reglas)
  MIN_HIPOTECA?: number;
  MAX_HIPOTECA?: number;
  MIN_PLAZO?: number;           // años
  MAX_PLAZO?: number;           // años
  MIN_LTV_EXCLUSIVE?: number;    // ratio (exclusivo)
  MAX_LTV?: number;             // ratio
  EDAD_PLAZO?: number;          // edad máx + plazo máximo
  // Legacy (reglas anteriores)
  MIN_PLAZO_MESES?: number;
  MAX_PLAZO_MESES?: number;
  MIN_LTV_RATIO?: number;
  MAX_LTV_RATIO?: number;
  requierePrimeraVivienda?: boolean;
  motivos?: Array<Record<string, unknown>>;
}

export interface PreSimulationResponse {
  preElegibles?: PreEligibleOffer[];
  eligibleOffers?: PreEligibleOffer[];
  uiLimits?: Record<string, number | boolean | undefined>;
  all?: OfferEvaluationResult[];
}

export interface FinalSimulationResponse {
  winner: OfferEvaluationResult | null;
  eligibleOffers?: PreEligibleOffer[];
  uiLimits?: Record<string, number | boolean | undefined>;
  all?: OfferEvaluationResult[];
}

export interface PreSimulationEnvelope {
  init: InitSimulationResponse;
  pre: PreSimulationResponse | null;
  wfCompare?: WfCompareResult;
}

export interface FinalSimulationEnvelope {
  init: InitSimulationResponse;
  pre: PreSimulationResponse | null;
  final: FinalSimulationResponse | null;
  wfCompare?: WfCompareResult;
}
