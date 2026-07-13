export type AdminStage = "INIT" | "PRE" | "FINAL";

export interface AdminOffer {
  ruleset_id: number;
  offerCode: string;
  name: string;
  offer_rank: number;
  enabled: boolean;
  oferta_id?: number;
}

export interface AdminOfferPayload {
  code: string;
  name: string;
  offer_rank: number;
  enabled: boolean;
  oferta_id?: number;
}

export interface AdminOfferUpdatePayload {
  code?: string;
  name?: string;
  offer_rank?: number;
  enabled?: boolean;
  oferta_id?: number;
}

export interface AdminOffersResponse {
  items: AdminOffer[];
}

export interface AdminOfferCreateResponse {
  ruleset_id: number;
  offerCode: string;
}

export interface AdminOfferUpdateResponse {
  offerCode: string;
  updated: boolean;
}

export interface AdminOfferDeleteResponse {
  offerCode: string;
  deleted: boolean;
  snapshot_id: number;
  deletedRules: number;
  deletedParams: number;
}

/** Response from DELETE /admin/offers/:offerCode/rules?offerDateId=N */
export interface AdminOfferRulesDeleteResponse {
  offerCode: string;
  offerDateId: number;
  deleted: boolean;
  snapshot_id: number;
  deletedRules: number;
  deletedParams: number;
}

export interface AdminOfferEnabledResponse {
  offerCode: string;
  enabled: boolean;
}

export interface AdminRuleCondition {
  cond_id?: number;
  group_id: number;
  left_operand: string;
  operator: string;
  right_operand: unknown;
  value2?: unknown;
  value_type: "NUMBER" | "BOOL" | "STRING" | "JSON" | string;
}

export interface AdminRuleAction {
  action_type: string;
  action_payload: Record<string, unknown>;
}

export interface RuleActionPayloadEntry {
  key: string;
  value: string;
  value_type: "NUMBER" | "BOOL" | "STRING" | "JSON";
}

export interface AdminRulePayload {
  offerCode: string;
  stage: AdminStage;
  rule_name: string;
  priority: number;
  enabled: boolean;
  stop_processing: boolean;
  offer_date_id?: number | null;
  actions: AdminRuleAction[];
  conditions: AdminRuleCondition[];
}

export interface AdminRuleIdResponse {
  rule_id: number;
}

export interface AdminRuleUpdateResponse {
  rule_id: number;
  updated: boolean;
}

export interface AdminRuleEnabledResponse {
  rule_id: number;
  enabled: boolean;
}

export interface AdminRuleDeleteResponse {
  rule_id: number;
  deleted: boolean;
}

export interface AdminRuleReorderItem {
  rule_id: number;
  priority: number;
}

export interface AdminRuleReorderPayload {
  offerCode: string;
  stage: AdminStage;
  items: AdminRuleReorderItem[];
}

export interface AdminRuleReorderResponse {
  updated: number;
}

export interface AdminRuleItem {
  rule_id: number;
  offerCode: string;
  stage: AdminStage;
  rule_name: string;
  priority: number;
  enabled: boolean;
  stop_processing: boolean;
  offer_date_id?: number | null;
  actions: AdminRuleAction[];
  conditions: AdminRuleCondition[];
}

export interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
}

export interface AdminRulesResponse {
  items: AdminRuleItem[];
  pagination: PaginationInfo;
}

export interface AdminRulesQuery {
  offerCode?: string;
  stage?: AdminStage;
  q?: string;
  offerDateId?: number;
  page?: number;
  pageSize?: number;
}

export interface AdminParamValue {
  param_id?: number;
  key: string;
  value: string;
  value_type: "NUMBER" | "BOOL" | "STRING" | "JSON" | string;
  offer_date_id?: number | null;
}

export interface AdminParamPayload {
  offerCode: string;
  key: string;
  value: string;
  value_type: "NUMBER" | "BOOL" | "STRING" | "JSON";
  offer_date_id?: number | null;
}

export interface AdminParamUpdatePayload {
  offerCode?: string;
  key?: string;
  value?: string;
  value_type?: "NUMBER" | "BOOL" | "STRING" | "JSON";
}

export interface AdminParamIdResponse {
  param_id: number;
}

export interface AdminParamUpdateResponse {
  param_id: number;
  updated: boolean;
}

export interface AdminParamDeleteResponse {
  param_id: number;
  deleted: boolean;
}

export interface AdminParamsItem {
  offerCode: string;
  paramValues: AdminParamValue[];
}

export interface AdminParamsResponse {
  items: AdminParamsItem[];
}

export interface AdminParamsQuery {
  offerCode?: string;
  offerDateId?: number;
}

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidatePayloadRequest {
  entity: "rule";
  payload: Record<string, unknown>;
}

export interface ValidatePayloadResponse {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface AdminConfigExport {
  exportedAt: string;
  rules: AdminRuleItem[];
  params: AdminParamsItem[];
}

export interface AdminConfigApplyPayload {
  rules: AdminRuleItem[];
  params?: AdminParamsItem[];
  comment: string;
  createdBy?: string;
  confirmReplaceAll: boolean;
}

export interface AdminConfigApplyResponse {
  applied: { rules: number; params: number };
  offerCodes: string[];
  snapshot_id: number;
}

/** Payload accepted by the read-only preview endpoint — no comment/confirmReplaceAll required. */
export interface AdminConfigApplyPreviewPayload {
  rules: AdminRuleItem[];
  params?: AdminParamsItem[];
}

/** Response from POST /admin/config/apply/preview (OWASP-02). */
export interface ApplyImpactPerOffer {
  offerCode: string;
  rulesToDelete: number;
  paramsToDelete: number;
  rulesToInsert: number;
  paramsToInsert: number;
}

export interface ApplyImpact {
  offerCodes: string[];
  rulesToDelete: number;
  paramsToDelete: number;
  rulesToInsert: number;
  paramsToInsert: number;
  perOffer: ApplyImpactPerOffer[];
}

export interface AdminResetSeedPayload {
  comment: string;
  createdBy?: string;
}

export interface AdminResetSeedResponse {
  applied: { rules: number; params: number };
  offerCodes: string[];
  snapshot_id: number;
  offer_date_id: number;
  removedOfferCodes: string[];
  removedPeriodCount: number;
}

export interface AdminSnapshotItem {
  snapshot_id: number;
  snapshot_name: string;
  comment: string | null;
  created_by: string | null;
  created_at: string;
  entorno_cd: "POC" | "WF";
}

export interface AdminSnapshotContentResponse {
  snapshot_id: number;
  snapshot_name: string;
  entorno_cd: "POC" | "WF";
  rules: unknown;
  params: unknown;
}

export interface AdminSnapshotListResponse {
  items: AdminSnapshotItem[];
  pagination: PaginationInfo;
}

export interface AdminSnapshotListQuery {
  dateFrom?: string;
  dateTo?: string;
  q?: string;
  entorno?: "POC" | "WF";
  page?: number;
  pageSize?: number;
}

/** Integrity verdict for a restored snapshot (OWASP-10). "failed" never reaches
 *  the frontend as a success payload — it is rejected as an HTTP 409 instead. */
export interface RestoreIntegrity {
  status: "verified" | "legacy";
  checksumPresent: boolean;
}

export interface AdminSnapshotRestoreResponse {
  applied?: { rules: number; params: number };
  offerCodes?: string[];
  preRestoreSnapshotId: number;
  published?: boolean;
  rules?: number;
  params?: number;
  integrity?: RestoreIntegrity;
}

export interface AdminSnapshotDeleteResponse {
  snapshot_id: number;
  deleted: boolean;
}

// cfg_offer_dates

export interface AdminFechaItem {
  offer_date_id: number;
  /** YYYY-MM-DDTHH:mm:ss local wall-clock (ADR-005) */
  valid_from: string;
  /** YYYY-MM-DDTHH:mm:ss local wall-clock, null = open-ended (ADR-005) */
  valid_to: string | null;
  descripcion: string;
  tipo_cd: "REGLAS" | "PARAMS" | "AMBOS";
  alta_usr: string | null;
  alta_dt: string;
}

export interface AdminFechaPayload {
  /** YYYY-MM-DDTHH:mm:ss local wall-clock (ADR-005) */
  valid_from: string;
  /** YYYY-MM-DDTHH:mm:ss local wall-clock, null = open-ended (ADR-005) */
  valid_to: string | null;
  descripcion: string;
  tipo_cd: "REGLAS" | "PARAMS" | "AMBOS";
}

export interface AdminFechasResponse {
  items: AdminFechaItem[];
}

export interface AdminFechaCreateResponse {
  offer_date_id: number;
}

export interface AdminFechaUpdateResponse {
  offer_date_id: number;
  updated: boolean;
}

export interface AdminFechaDeleteResponse {
  offer_date_id: number;
  deleted: boolean;
}

// POC snapshot

export interface AdminPocSnapshotPayload {
  comment: string;
  createdBy?: string;
}

export interface AdminPocSnapshotResponse {
  snapshot_id: number;
  snapshot_name: string;
}

// Workflow publish

export interface AdminWorkflowSnapshotPayload {
  /** YYYY-MM-DDTHH:mm:ss local wall-clock, null = all periods (ADR-005) */
  vigDesde?: string | null;
  /** YYYY-MM-DDTHH:mm:ss local wall-clock, null = open-ended (ADR-005) */
  vigHasta?: string | null;
  createdBy?: string;
}

export interface AdminWorkflowSnapshotResponse {
  snapshot_id: number;
  snapshot_name: string;
}

export interface AdminWorkflowPublicarPayload {
  offerDateId: number;
  /** vigDesde/vigHasta: YYYY-MM-DDTHH:mm:ss local wall-clock (ADR-005) */
  rangoDestino: { vigDesde: string; vigHasta: string | null };
  createdBy?: string;
  ofertaIdOverrides?: Record<string, number>;
  tipoDs?: "REGLAS" | "PARAMS" | "AMBOS";
}

export interface AdminWorkflowPublicarResponse {
  published: boolean;
  rules: number;
  params: number;
}

export interface AdminSnapshotRestoreWfOptions {
  createdBy?: string;
  destino: "WF";
  rangoDestino: { vigDesde: string; vigHasta: string | null };
  ofertaIdOverrides?: Record<string, number>;
}
