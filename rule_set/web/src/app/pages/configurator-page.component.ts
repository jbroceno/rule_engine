import { CommonModule } from "@angular/common";
import { Component, computed, inject, OnInit, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";

import {
  AdminConfigApplyPayload,
  AdminFechaItem,
  AdminOffer,
  AdminOfferUpdatePayload,
  AdminParamsItem,
  AdminParamValue,
  AdminRuleAction,
  AdminRuleCondition,
  AdminRuleItem,
  AdminRulesQuery,
  AdminResetSeedPayload,
  RuleActionPayloadEntry,
  ValidationIssue,
  ValidatePayloadResponse,
} from "../models/admin.models";
import {
  ACTION_PAYLOAD_KEY_OPTIONS,
  ACTION_TYPE_OPTIONS,
  VALUE_TYPE_OPTIONS,
  normalizeActionType,
  normalizeValueType,
} from "../shared/rule-catalogs";
import { normalizeRuleOperator } from "../shared/rule-operators";
import { ActivePeriodService } from "../services/active-period.service";
import { AdminApiService } from "../services/admin-api.service";
import { environment } from "../../environments/environment";
import { RuleActionPayloadTableComponent } from "./configurator/rule-action-payload-table.component";
import { RuleConditionsTableComponent } from "./configurator/rule-conditions-table.component";

const DEFAULT_RULE_PAYLOAD = {
  offerCode: "OFERTA_RESTRICTIVA",
  stage: "PRE",
  rule_name: "PRE nueva regla",
  priority: 900,
  enabled: true,
  stop_processing: false,
  actions: [
    {
      action_type: "SET",
      action_payload: {
        field: "preRejected",
        value_type: normalizeValueType("BOOL"),
        value: "false",
      },
    },
  ],
  conditions: [
    {
      group_id: 0,
      left_operand: "stage",
      operator: "EQ",
      right_operand: "PRE",
      value_type: normalizeValueType("STRING"),
    },
  ],
};

const PARAMS_VIEW_STATE_KEY = "configurator.params.view-state";
const RULES_VIEW_STATE_KEY = "configurator.rules.view-state";

type RuleFormValue = {
  offerCode: string;
  stage: "INIT" | "PRE" | "FINAL";
  rule_name: string;
  priority: number;
  enabled: boolean;
  action_type: string;
  stop_processing: boolean;
  offer_date_id: number | null;
};

type RuleEditorMode = "closed" | "create" | "edit";
type ParamEditorMode = "closed" | "create" | "edit";

type ParamSortKey = "param_id" | "offerCode" | "key" | "value" | "value_type" | "execution";
type RuleSortKey = "rule_id" | "offerCode" | "stage" | "rule_name" | "priority" | "enabled" | "conditions" | "action_type" | "execution";

type FlatParamRow = {
  offerCode: string;
  param: AdminParamValue;
};

type OfferEditorMode = "closed" | "edit";

type ConfirmDialogState =
  | {
      type: "rule";
      title: string;
      message: string;
      rule: AdminRuleItem;
    }
  | {
      type: "param";
      title: string;
      message: string;
      paramId: number;
    }
  | {
      type: "apply-config";
      title: string;
      message: string;
    }
  | {
      type: "reset-seed";
      title: string;
      message: string;
    }
  | {
      type: "publicar-wf";
      title: string;
      message: string;
    }
  | {
      type: "offer-period";
      title: string;
      message: string;
      offerCode: string;
      offerDateId: number;
    };

@Component({
  selector: "app-configurator-page",
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, RuleConditionsTableComponent, RuleActionPayloadTableComponent],
  templateUrl: "./configurator-page.component.html",
  styleUrl: "./configurator-page.component.css",
})
export class ConfiguratorPageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly adminApiService = inject(AdminApiService);
  readonly activePeriodService = inject(ActivePeriodService);

  protected readonly filtersForm = this.fb.nonNullable.group({
    offerCode: "",
    stage: "" as "" | "INIT" | "PRE" | "FINAL",
    q: "",
    pageSize: 25,
  });

  protected readonly ruleForm = this.fb.group({
    offerCode: [""],
    stage: ["PRE" as "INIT" | "PRE" | "FINAL"],
    rule_name: [""],
    priority: [900],
    enabled: [true],
    action_type: ["SET"],
    stop_processing: [false],
    offer_date_id: [null as number | null],
  });

  protected readonly paramForm = this.fb.group({
    offerCode: [""],
    key: [""],
    value: [""],
    value_type: [normalizeValueType("STRING")],
    offer_date_id: [null as number | null],
  });

  protected readonly rules = signal<AdminRuleItem[]>([]);
  protected readonly rulesTotal = signal(0);
  protected readonly currentPage = signal(1);
  protected readonly rulesLoading = signal(false);
  protected readonly rulesError = signal<string | null>(null);
  protected readonly ruleSortKey = signal<RuleSortKey>("execution");
  protected readonly ruleSortDirection = signal<"asc" | "desc">("asc");

  protected readonly params = signal<AdminParamsItem[]>([]);
  protected readonly paramsLoading = signal(false);
  protected readonly paramsError = signal<string | null>(null);
  protected readonly paramSearchTerm = signal("");
  protected readonly paramSortKey = signal<ParamSortKey>("execution");
  protected readonly paramSortDirection = signal<"asc" | "desc">("asc");
  protected readonly paramCurrentPage = signal(1);

  protected readonly offers = signal<AdminOffer[]>([]);

  // Period-scoped offers panel (FR-101 to FR-104)
  protected readonly periodOffers = signal<AdminOffer[]>([]);
  protected readonly periodOffersLoading = signal(false);
  protected readonly periodOffersError = signal<string | null>(null);
  protected readonly offerEditorMode = signal<OfferEditorMode>("closed");
  protected readonly selectedOfferCode = signal<string | null>(null);
  protected readonly offerSaving = signal(false);
  protected readonly offerActionError = signal<string | null>(null);
  protected readonly offerActionSuccess = signal<string | null>(null);
  protected readonly pendingOfferCodes = signal<Set<string>>(new Set());

  protected readonly offerForm = this.fb.nonNullable.group({
    code: "",
    name: "",
    offer_rank: 0,
    enabled: true,
    oferta_id: 0,
  });

  protected readonly isOfferEditorOpen = computed(() => this.offerEditorMode() !== "closed");
  protected readonly offerEditorTitle = computed(() => "Editar oferta");

  protected readonly selectedRuleId = signal<number | null>(null);
  protected readonly ruleEditorMode = signal<RuleEditorMode>("closed");
  protected readonly ruleSaving = signal(false);
  protected readonly ruleActionError = signal<string | null>(null);
  protected readonly ruleActionSuccess = signal<string | null>(null);
  protected readonly rulePreviewLoading = signal(false);
  protected readonly rulePreviewError = signal<string | null>(null);
  protected readonly rulePreviewResult = signal<ValidatePayloadResponse | null>(null);
  protected readonly invalidConditionFields = signal<string[]>([]);
  protected readonly invalidActionPayloadFields = signal<string[]>([]);
  protected readonly draftConditions = signal<AdminRuleCondition[]>([...DEFAULT_RULE_PAYLOAD.conditions]);
  protected readonly draftActionPayloadEntries = signal<RuleActionPayloadEntry[]>(
    this.buildEntriesFromActions(DEFAULT_RULE_PAYLOAD.actions)
  );

  protected readonly selectedParamId = signal<number | null>(null);
  protected readonly paramEditorMode = signal<ParamEditorMode>("closed");
  protected readonly paramSaving = signal(false);
  protected readonly paramActionError = signal<string | null>(null);
  protected readonly paramActionSuccess = signal<string | null>(null);
  protected readonly pendingRuleIds = signal<Set<number>>(new Set());
  protected readonly pendingParamIds = signal<Set<number>>(new Set());

  protected readonly confirmDialog = signal<ConfirmDialogState | null>(null);

  // Import / Export / Apply config
  protected readonly importedConfig = signal<{ rules: AdminRuleItem[]; params: AdminParamsItem[] | null } | null>(null);
  protected readonly configOpLoading = signal(false);
  protected readonly configOpError = signal<string | null>(null);
  protected readonly configOpSuccess = signal<string | null>(null);
  protected readonly applyConfigComment = signal("");
  protected readonly applyConfigUser = signal("");
  protected readonly applyConfigCommentError = signal<string | null>(null);

  // Seed reset (feature-flagged)
  protected readonly enableSeedReset = environment.enableSeedReset;
  protected readonly resetSeedComment = signal("");
  protected readonly resetSeedUser = signal("");
  protected readonly resetSeedCommentError = signal<string | null>(null);

  // cfg_offer_dates
  protected readonly fechas = signal<AdminFechaItem[]>([]);
  protected readonly fechasLoading = signal(false);

  // Publicar en Workflow
  protected readonly publicarOfferDateId = signal<number | null>(null);
  protected readonly publicarVigDesde = signal("");
  protected readonly publicarVigHasta = signal("");
  protected readonly publicarUser = signal("");
  protected readonly publicarTipoDs = signal<"REGLAS" | "PARAMS" | "AMBOS">("AMBOS");
  protected readonly publicarError = signal<string | null>(null);
  protected readonly publicarLoading = signal(false);
  protected readonly publicarOfertaIdOverrides = signal<Record<string, number | null>>({});

  protected readonly publicarOverridesValid = computed(() =>
    Object.values(this.publicarOfertaIdOverrides()).every(
      (v) => v !== null && Number.isInteger(v) && v >= 1,
    ),
  );

  protected readonly pocSnapshotDialog = signal(false);
  protected readonly pocSnapshotComment = signal("");
  protected readonly pocSnapshotUser = signal("");
  protected readonly pocSnapshotLoading = signal(false);
  protected readonly pocSnapshotError = signal<string | null>(null);

  protected readonly offerCodes = computed(() => this.offers().map((o) => o.offerCode));

  protected readonly fechasForRules = computed(() =>
    this.fechas().filter((f) => f.tipo_cd === "REGLAS" || f.tipo_cd === "AMBOS"),
  );

  protected readonly fechasForParams = computed(() =>
    this.fechas().filter((f) => f.tipo_cd === "PARAMS" || f.tipo_cd === "AMBOS"),
  );

  // Active period guards
  protected readonly canCreateRule = computed(() => this.activePeriodService.activePeriodRules() != null);
  protected readonly canCreateParam = computed(() => this.activePeriodService.activePeriodParams() != null);

  // Read-only period label for display (create mode shows active period; edit mode uses formatPeriodById)
  protected readonly activeRulesPeriodLabel = computed(() =>
    this.formatPeriod(this.activePeriodService.activePeriodRules()),
  );
  protected readonly activeParamsPeriodLabel = computed(() =>
    this.formatPeriod(this.activePeriodService.activePeriodParams()),
  );

  protected readonly paramCount = computed(() =>
    this.params().reduce((total, row) => total + row.paramValues.length, 0)
  );

  protected readonly importedConfigSummary = computed(() => {
    const config = this.importedConfig();
    if (!config) {
      return null;
    }
    const offerCodes = [...new Set(config.rules.map((r) => r.offerCode))].join(", ");
    const paramsNote =
      config.params !== null
        ? `${config.params.reduce((sum, g) => sum + g.paramValues.length, 0)} parametros`
        : "parametros sin cambios";
    return `${config.rules.length} reglas (${offerCodes}), ${paramsNote}`;
  });

  protected readonly flatParams = computed(() =>
    this.params().flatMap((row) =>
      row.paramValues.map((param) => ({
        offerCode: row.offerCode,
        param,
      }))
    )
  );

  protected readonly totalPages = computed(() => {
    const pageSize = this.filtersForm.controls.pageSize.value;
    const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 25;
    return Math.max(1, Math.ceil(this.rulesTotal() / safePageSize));
  });

  protected readonly paramTotalPages = computed(() => {
    const pageSize = this.filtersForm.controls.pageSize.value;
    const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 25;
    return Math.max(1, Math.ceil(this.filteredSortedParams().length / safePageSize));
  });

  protected readonly safeParamCurrentPage = computed(() =>
    Math.min(Math.max(1, this.paramCurrentPage()), this.paramTotalPages())
  );

  protected readonly sortedRules = computed(() => {
    const sortKey = this.ruleSortKey();
    const sortDirection = this.ruleSortDirection();

    if (sortKey === "execution") {
      return [...this.rules()].sort((a, b) => this.compareRulesByDefault(a, b));
    }

    const factor = sortDirection === "asc" ? 1 : -1;
    return [...this.rules()].sort((left, right) => {
      const leftValue = this.readRuleSortValue(left, sortKey);
      const rightValue = this.readRuleSortValue(right, sortKey);
      if (leftValue === rightValue) {
        return this.compareRulesByDefault(left, right);
      }
      return leftValue > rightValue ? factor : -factor;
    });
  });

  protected readonly isRuleEditorOpen = computed(() => this.ruleEditorMode() !== "closed");
  protected readonly isRuleCreateMode = computed(() => this.ruleEditorMode() === "create");
  protected readonly ruleEditorTitle = computed(() =>
    this.isRuleCreateMode() ? "Crear regla" : "Editar regla"
  );
  protected readonly ruleSubmitLabel = computed(() => (this.isRuleCreateMode() ? "Crear" : "Guardar"));
  protected readonly isParamEditorOpen = computed(() => this.paramEditorMode() !== "closed");
  protected readonly isParamCreateMode = computed(() => this.paramEditorMode() === "create");
  protected readonly paramEditorTitle = computed(() =>
    this.isParamCreateMode() ? "Crear parametro" : "Editar parametro"
  );
  protected readonly paramSubmitLabel = computed(() =>
    this.isParamCreateMode() ? "Crear parametro" : "Guardar parametro"
  );
  protected readonly actionTypeOptions = ACTION_TYPE_OPTIONS;
  protected readonly valueTypeOptions = VALUE_TYPE_OPTIONS;
  protected readonly actionPayloadKeyOptions = ACTION_PAYLOAD_KEY_OPTIONS;

  protected readonly filteredSortedParams = computed(() => {
    const search = this.paramSearchTerm().trim().toLowerCase();
    const sortKey = this.paramSortKey();
    const sortDirection = this.paramSortDirection();

    const filtered = this.flatParams().filter((row) => {
      if (!search) {
        return true;
      }
      return [
        row.offerCode,
        row.param.key,
        row.param.value,
        row.param.value_type,
        String(row.param.param_id ?? ""),
      ]
        .join(" ")
        .toLowerCase()
        .includes(search);
    });

    if (sortKey === "execution") {
      return [...filtered].sort((a, b) => this.compareParamRowsByDefault(a, b));
    }

    const factor = sortDirection === "asc" ? 1 : -1;
    return [...filtered].sort((left, right) => {
      const leftValue = this.readParamSortValue(left, sortKey);
      const rightValue = this.readParamSortValue(right, sortKey);
      if (leftValue === rightValue) {
        return this.compareParamRowsByDefault(left, right);
      }
      return leftValue > rightValue ? factor : -factor;
    });
  });

  protected readonly pagedParams = computed(() => {
    const pageSize = this.filtersForm.controls.pageSize.value;
    const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 25;
    const start = (this.safeParamCurrentPage() - 1) * safePageSize;
    return this.filteredSortedParams().slice(start, start + safePageSize);
  });

  /**
   * Normalizes a datetime-local control value to YYYY-MM-DDTHH:mm:ss
   * (backend contract, local wall-clock). Browsers may omit :00 seconds —
   * this appends them. Never calls .toISOString() (ADR-005).
   */
  protected toVigenciaString(val: string): string {
    if (!val) return "";
    const normalized = val.replace(" ", "T");
    if (normalized.length >= 19) return normalized;
    if (normalized.length === 16) return normalized + ":00";
    return normalized;
  }

  constructor() {
    this.restoreRulesViewState();
    this.restoreParamsViewState();
  }

  ngOnInit(): void {
    this.loadOffers();
    this.loadPeriodOffers();
    this.loadFechas();
    this.applyFilters(false);
  }

  protected applyFilters(resetPage = true): void {
    if (resetPage) {
      this.currentPage.set(1);
      this.paramCurrentPage.set(1);
      this.persistRulesViewState();
    }

    const { offerCode, stage, q, pageSize } = this.filtersForm.getRawValue();
    const normalizedOfferCode = this.normalizeText(offerCode);
    const activeRulesId = this.activePeriodService.activePeriodRules()?.offer_date_id;
    const activeParamsId = this.activePeriodService.activePeriodParams()?.offer_date_id;

    const rulesQuery: AdminRulesQuery = {
      offerCode: normalizedOfferCode,
      stage: stage || undefined,
      q: this.normalizeText(q),
      offerDateId: activeRulesId,
      page: this.currentPage(),
      pageSize,
    };

    this.loadRules(rulesQuery);
    this.loadParams({ offerCode: normalizedOfferCode, offerDateId: activeParamsId });
  }

  protected resetFilters(): void {
    this.filtersForm.reset({
      offerCode: "",
      stage: "",
      q: "",
      pageSize: 25,
    });
    this.applyFilters();
  }

  protected refreshParams(): void {
    this.loadParams({
      offerCode: this.normalizeText(this.filtersForm.controls.offerCode.value),
      offerDateId: this.activePeriodService.activePeriodParams()?.offer_date_id,
    });
  }

  protected goToPage(page: number): void {
    const safePage = Math.min(Math.max(1, page), this.totalPages());
    this.currentPage.set(safePage);
    this.persistRulesViewState();
    this.applyFilters(false);
  }

  protected goToParamPage(page: number): void {
    const safePage = Math.min(Math.max(1, page), this.paramTotalPages());
    this.paramCurrentPage.set(safePage);
    this.persistParamsViewState();
  }

  protected pageOptions(): number[] {
    return this.buildPagerOptions(this.totalPages(), this.currentPage());
  }

  protected paramPageOptions(): number[] {
    return this.buildPagerOptions(this.paramTotalPages(), this.safeParamCurrentPage());
  }

  private buildPagerOptions(total: number, current: number): number[] {
    if (total <= 5) {
      return Array.from({ length: total }, (_, index) => index + 1);
    }

    const start = Math.max(1, current - 2);
    const end = Math.min(total, start + 4);
    const adjustedStart = Math.max(1, end - 4);
    return Array.from({ length: end - adjustedStart + 1 }, (_, index) => adjustedStart + index);
  }

  protected validateRuleDraft(): void {
    const parsedRule = this.buildRulePayloadFromForm();
    if (!parsedRule) {
      this.rulePreviewError.set(this.ruleActionError() || "Payload vacio o invalido.");
      this.rulePreviewResult.set(null);
      return;
    }

    this.rulePreviewLoading.set(true);
    this.rulePreviewError.set(null);
    this.rulePreviewResult.set(null);

    this.adminApiService.validateRulePayload({ entity: "rule", payload: parsedRule }).subscribe({
      next: (response) => {
        this.applyRuleValidationFeedback(response);
        this.rulePreviewResult.set(response);
        this.rulePreviewLoading.set(false);
      },
      error: (error: Error) => {
        this.rulePreviewError.set(error.message);
        this.rulePreviewLoading.set(false);
      },
    });
  }

  protected setParamSearchTerm(rawValue: string): void {
    this.paramSearchTerm.set(rawValue);
    this.paramCurrentPage.set(1);
    this.persistParamsViewState();
  }

  protected sortParamsBy(key: ParamSortKey): void {
    if (this.paramSortKey() === key) {
      this.paramSortDirection.update((current) => (current === "asc" ? "desc" : "asc"));
      this.paramCurrentPage.set(1);
      this.persistParamsViewState();
      return;
    }
    this.paramSortKey.set(key);
    this.paramSortDirection.set("asc");
    this.paramCurrentPage.set(1);
    this.persistParamsViewState();
  }

  protected resetParamsSort(): void {
    this.paramSortKey.set("execution");
    this.paramCurrentPage.set(1);
    this.persistParamsViewState();
  }

  protected sortRulesBy(key: RuleSortKey): void {
    if (this.ruleSortKey() === key) {
      this.ruleSortDirection.update((current) => (current === "asc" ? "desc" : "asc"));
      this.persistRulesViewState();
      return;
    }
    this.ruleSortKey.set(key);
    this.ruleSortDirection.set("asc");
    this.persistRulesViewState();
  }

  protected resetRulesSort(): void {
    this.ruleSortKey.set("execution");
    this.persistRulesViewState();
  }

  protected ruleSortIndicator(key: RuleSortKey): string {
    if (this.ruleSortKey() !== key) {
      return "↕";
    }
    return this.ruleSortDirection() === "asc" ? "↑" : "↓";
  }

  protected paramSortIndicator(key: ParamSortKey): string {
    if (this.paramSortKey() !== key) {
      return "↕";
    }
    return this.paramSortDirection() === "asc" ? "↑" : "↓";
  }

  protected saveRule(): void {
    this.ruleActionError.set(null);
    this.ruleActionSuccess.set(null);

    const parsedRule = this.buildRulePayloadFromForm();
    if (!parsedRule) {
      return;
    }

    this.ruleSaving.set(true);
    this.adminApiService.validateRulePayload({ entity: "rule", payload: parsedRule }).subscribe({
      next: (preview) => {
        this.applyRuleValidationFeedback(preview);
        if (!preview.valid) {
          this.ruleSaving.set(false);
          this.ruleActionError.set(`La regla no es valida: ${this.buildRuleValidationMessage(preview.errors)}`);
          return;
        }

        const selectedRuleId = this.selectedRuleId();
        if (selectedRuleId) {
          this.setRulePending(selectedRuleId, true);
        }
        const request$ = selectedRuleId
          ? this.adminApiService.updateRule(selectedRuleId, parsedRule)
          : this.adminApiService.createRule(parsedRule);

        request$.subscribe({
          next: () => {
            if (selectedRuleId) {
              this.setRulePending(selectedRuleId, false);
            }
            this.ruleSaving.set(false);
            if (selectedRuleId) {
              this.verifyUpdatedRule(selectedRuleId, parsedRule);
            } else {
              this.ruleActionSuccess.set("Regla creada.");
            }
            this.cancelRuleEdit();
            this.applyFilters(false);
          },
          error: (error: Error) => {
            if (selectedRuleId) {
              this.setRulePending(selectedRuleId, false);
            }
            this.ruleSaving.set(false);
            this.ruleActionError.set(error.message);
          },
        });
      },
      error: (error: Error) => {
        this.ruleSaving.set(false);
        this.ruleActionError.set(error.message);
      },
    });
  }

  protected openCreateRuleEditor(): void {
    this.selectedRuleId.set(null);
    this.ruleEditorMode.set("create");
    this.ruleActionError.set(null);
    this.ruleActionSuccess.set(null);
    this.rulePreviewError.set(null);
    this.rulePreviewResult.set(null);
    this.invalidConditionFields.set([]);
    this.invalidActionPayloadFields.set([]);
    this.ruleForm.reset({
      offerCode: this.normalizeText(this.filtersForm.controls.offerCode.value) ?? this.offerCodes()[0] ?? "",
      stage: (this.filtersForm.controls.stage.value || "PRE") as "INIT" | "PRE" | "FINAL",
      rule_name: "",
      priority: 900,
      enabled: true,
      action_type: normalizeActionType("SET"),
      stop_processing: false,
      offer_date_id: this.activePeriodService.activePeriodRules()?.offer_date_id ?? null,
    });
    this.draftConditions.set([...DEFAULT_RULE_PAYLOAD.conditions]);
    this.draftActionPayloadEntries.set(this.buildEntriesFromActions(DEFAULT_RULE_PAYLOAD.actions));
  }

  protected duplicateRule(rule: AdminRuleItem): void {
    this.selectedRuleId.set(null);
    this.ruleEditorMode.set("create");
    this.ruleActionError.set(null);
    this.ruleActionSuccess.set(null);
    this.rulePreviewError.set(null);
    this.rulePreviewResult.set(null);
    this.invalidConditionFields.set([]);
    this.invalidActionPayloadFields.set([]);

    this.ruleForm.setValue({
      offerCode: rule.offerCode,
      stage: rule.stage,
      rule_name: `Copia de ${rule.rule_name}`,
      priority: rule.priority,
      enabled: rule.enabled,
      action_type: normalizeActionType(rule.actions[0]?.action_type),
      stop_processing: rule.stop_processing,
      offer_date_id: this.activePeriodService.activePeriodRules()?.offer_date_id ?? null,
    });
    this.draftConditions.set(
      rule.conditions.map((condition) => ({
        ...condition,
        operator: normalizeRuleOperator(condition.operator),
      }))
    );
    this.draftActionPayloadEntries.set(this.buildEntriesFromActions(rule.actions ?? []));
  }

  protected editRule(rule: AdminRuleItem): void {
    if (this.isRulePending(rule.rule_id)) {
      return;
    }
    this.ruleEditorMode.set("edit");
    this.selectedRuleId.set(rule.rule_id);
    this.ruleActionError.set(null);
    this.ruleActionSuccess.set(null);
    this.rulePreviewError.set(null);
    this.rulePreviewResult.set(null);
    this.invalidConditionFields.set([]);
    this.invalidActionPayloadFields.set([]);

    this.ruleForm.setValue({
      offerCode: rule.offerCode,
      stage: rule.stage,
      rule_name: rule.rule_name,
      priority: rule.priority,
      enabled: rule.enabled,
      action_type: normalizeActionType(rule.actions[0]?.action_type),
      stop_processing: rule.stop_processing,
      offer_date_id: rule.offer_date_id ?? null,
    });
    this.draftConditions.set(
      rule.conditions.map((condition) => ({
        ...condition,
        operator: normalizeRuleOperator(condition.operator),
      }))
    );
    this.draftActionPayloadEntries.set(this.buildEntriesFromActions(rule.actions ?? []));
  }

  protected cancelRuleEdit(): void {
    this.ruleEditorMode.set("closed");
    this.selectedRuleId.set(null);
    this.rulePreviewLoading.set(false);
    this.rulePreviewError.set(null);
    this.rulePreviewResult.set(null);
    this.invalidConditionFields.set([]);
    this.invalidActionPayloadFields.set([]);
    this.ruleForm.reset({
      offerCode: this.normalizeText(this.filtersForm.controls.offerCode.value) ?? this.offerCodes()[0] ?? "",
      stage: (this.filtersForm.controls.stage.value || "PRE") as "INIT" | "PRE" | "FINAL",
      rule_name: "",
      priority: 900,
      enabled: true,
      action_type: normalizeActionType("SET"),
      stop_processing: false,
      offer_date_id: null,
    });
    this.draftConditions.set([...DEFAULT_RULE_PAYLOAD.conditions]);
    this.draftActionPayloadEntries.set(this.buildEntriesFromActions(DEFAULT_RULE_PAYLOAD.actions));
  }

  protected updateDraftConditions(conditions: AdminRuleCondition[]): void {
    this.draftConditions.set(conditions.map((condition) => ({ ...condition })));
    this.invalidConditionFields.set([]);
  }

  protected updateDraftActionPayloadEntries(entries: RuleActionPayloadEntry[]): void {
    this.draftActionPayloadEntries.set(entries.map((entry) => ({ ...entry })));
    this.invalidActionPayloadFields.set([]);
  }

  protected deleteRule(rule: AdminRuleItem): void {
    this.confirmDialog.set({
      type: "rule",
      title: "Eliminar regla",
      message: `Se eliminara la regla ${rule.rule_id} (${rule.rule_name}). Esta accion no se puede deshacer.`,
      rule,
    });
  }

  protected toggleRule(rule: AdminRuleItem): void {
    if (this.isRulePending(rule.rule_id)) {
      return;
    }
    this.ruleActionError.set(null);
    this.ruleActionSuccess.set(null);
    this.setRulePending(rule.rule_id, true);
    this.adminApiService.setRuleEnabled(rule.rule_id, !rule.enabled).subscribe({
      next: () => {
        this.setRulePending(rule.rule_id, false);
        this.ruleActionSuccess.set(`Regla ${rule.rule_id} ${rule.enabled ? "deshabilitada" : "habilitada"}.`);
        this.applyFilters(false);
      },
      error: (error: Error) => {
        this.setRulePending(rule.rule_id, false);
        this.ruleActionError.set(error.message);
      },
    });
  }

  protected moveRule(rule: AdminRuleItem, direction: -1 | 1): void {
    if (this.isRulePending(rule.rule_id)) {
      return;
    }
    const group = this.rules()
      .filter((item) => item.offerCode === rule.offerCode && item.stage === rule.stage)
      .sort((a, b) => b.priority - a.priority || a.rule_id - b.rule_id);

    const index = group.findIndex((item) => item.rule_id === rule.rule_id);
    const target = index >= 0 ? group[index + direction] : null;
    if (!target) {
      return;
    }
    if (this.isRulePending(target.rule_id)) {
      return;
    }

    this.ruleActionError.set(null);
    this.ruleActionSuccess.set(null);
    this.setRulePending(rule.rule_id, true);
    this.setRulePending(target.rule_id, true);
    this.adminApiService
      .reorderRules({
        offerCode: rule.offerCode,
        stage: rule.stage,
        items: [
          { rule_id: rule.rule_id, priority: target.priority },
          { rule_id: target.rule_id, priority: rule.priority },
        ],
      })
      .subscribe({
        next: () => {
          this.setRulePending(rule.rule_id, false);
          this.setRulePending(target.rule_id, false);
          this.ruleActionSuccess.set(`Prioridad actualizada para ${rule.rule_id} y ${target.rule_id}.`);
          this.applyFilters(false);
        },
        error: (error: Error) => {
          this.setRulePending(rule.rule_id, false);
          this.setRulePending(target.rule_id, false);
          this.ruleActionError.set(error.message);
        },
      });
  }

  protected saveParam(): void {
    this.paramActionError.set(null);
    this.paramActionSuccess.set(null);
    this.paramSaving.set(true);

    const raw = this.paramForm.getRawValue();
    // In create mode re-read the signal so a period change after opening the editor is captured.
    const resolvedParamDateId = this.isParamCreateMode()
      ? (this.activePeriodService.activePeriodParams()?.offer_date_id ?? null)
      : (raw.offer_date_id ? Number(raw.offer_date_id) : null);
    const payload = {
      offerCode: raw.offerCode ?? "",
      key: raw.key ?? "",
      value: raw.value ?? "",
      value_type: raw.value_type ?? normalizeValueType("STRING"),
      offer_date_id: resolvedParamDateId,
    };
    const selectedParamId = this.selectedParamId();
    if (selectedParamId) {
      this.setParamPending(selectedParamId, true);
    }
    const request$ = selectedParamId
      ? this.adminApiService.updateParam(selectedParamId, payload)
      : this.adminApiService.createParam(payload);

    request$.subscribe({
      next: () => {
        if (selectedParamId) {
          this.setParamPending(selectedParamId, false);
        }
        this.paramSaving.set(false);
        this.paramActionSuccess.set(selectedParamId ? "Parametro actualizado." : "Parametro creado.");
        this.cancelParamEdit();
        this.refreshParams();
      },
      error: (error: Error) => {
        if (selectedParamId) {
          this.setParamPending(selectedParamId, false);
        }
        this.paramSaving.set(false);
        this.paramActionError.set(error.message);
      },
    });
  }

  protected openCreateParamEditor(): void {
    this.paramEditorMode.set("create");
    this.selectedParamId.set(null);
    this.paramActionError.set(null);
    this.paramActionSuccess.set(null);
    this.paramForm.reset({
      offerCode: this.normalizeText(this.filtersForm.controls.offerCode.value) ?? this.offerCodes()[0] ?? "",
      key: "",
      value: "",
      value_type: normalizeValueType("STRING"),
      offer_date_id: this.activePeriodService.activePeriodParams()?.offer_date_id ?? null,
    });
  }

  protected editParam(row: FlatParamRow): void {
    if (this.isParamPending(row.param.param_id)) {
      return;
    }
    this.selectedParamId.set(row.param.param_id ?? null);
    this.paramEditorMode.set("edit");
    this.paramActionError.set(null);
    this.paramActionSuccess.set(null);
    this.paramForm.setValue({
      offerCode: row.offerCode,
      key: row.param.key,
      value: row.param.value,
      value_type: normalizeValueType(row.param.value_type),
      offer_date_id: row.param.offer_date_id ?? null,
    });
  }

  protected cancelParamEdit(): void {
    this.paramEditorMode.set("closed");
    this.selectedParamId.set(null);
    this.paramForm.reset({
      offerCode: this.normalizeText(this.filtersForm.controls.offerCode.value) ?? this.offerCodes()[0] ?? "",
      key: "",
      value: "",
      value_type: normalizeValueType("STRING"),
      offer_date_id: null,
    });
  }

  protected deleteParam(paramId?: number): void {
    if (!paramId) {
      return;
    }
    if (this.isParamPending(paramId)) {
      return;
    }

    this.confirmDialog.set({
      type: "param",
      title: "Eliminar parametro",
      message: `Se deshabilitara el parametro ${paramId}.`,
      paramId,
    });
  }

  protected closeConfirmDialog(): void {
    this.confirmDialog.set(null);
  }

  protected isRulePending(ruleId: number): boolean {
    return this.pendingRuleIds().has(ruleId);
  }

  protected isParamPending(paramId?: number): boolean {
    if (!paramId) {
      return false;
    }
    return this.pendingParamIds().has(paramId);
  }

  protected isConfirmActionPending(): boolean {
    const dialog = this.confirmDialog();
    if (!dialog) {
      return false;
    }
    if (dialog.type === "rule") {
      return this.isRulePending(dialog.rule.rule_id);
    }
    if (dialog.type === "param") {
      return this.isParamPending(dialog.paramId);
    }
    if (dialog.type === "offer-period") {
      return this.isOfferCodePending(dialog.offerCode);
    }
    return this.configOpLoading();
  }

  protected confirmDialogAction(): void {
    const dialog = this.confirmDialog();
    if (!dialog) {
      return;
    }

    if (dialog.type === "rule") {
      this.executeRuleDelete(dialog.rule);
    } else if (dialog.type === "param") {
      this.executeParamDelete(dialog.paramId);
    } else if (dialog.type === "apply-config") {
      this.executeApplyConfig();
    } else if (dialog.type === "reset-seed") {
      this.executeResetSeed();
    } else if (dialog.type === "publicar-wf") {
      this.executePublicarWf();
    } else if (dialog.type === "offer-period") {
      this.executeOfferPeriodDelete(dialog.offerCode, dialog.offerDateId);
    }
  }

  protected trackRule(_: number, rule: AdminRuleItem): number {
    return rule.rule_id;
  }

  protected trackParam(index: number, row: FlatParamRow): string {
    return `${row.param.param_id ?? "new"}-${row.offerCode}-${index}`;
  }

  protected trackPage(_: number, page: number): number {
    return page;
  }

  protected summarizeRuleConditions(rule: AdminRuleItem): string {
    const grouped = new Map<number, string[]>();

    for (const condition of rule.conditions) {
      const rightOperand = Array.isArray(condition.right_operand)
        ? condition.right_operand.join(",")
        : String(condition.right_operand ?? "");
      const expression = `${condition.left_operand} ${normalizeRuleOperator(condition.operator)} ${rightOperand}`.trim();
      const rows = grouped.get(condition.group_id) ?? [];
      rows.push(expression);
      grouped.set(condition.group_id, rows);
    }

    return Array.from(grouped.entries())
      .sort(([left], [right]) => left - right)
      .map(([, expressions]) => (expressions.length > 1 ? `(${expressions.join(" AND ")})` : expressions[0]))
      .join(" OR ");
  }

  // ---------------------------------------------------------------------------
  // Export / Import / Apply config
  // ---------------------------------------------------------------------------

  protected exportConfig(): void {
    this.configOpError.set(null);
    this.configOpSuccess.set(null);
    this.configOpLoading.set(true);

    this.adminApiService.exportConfig().subscribe({
      next: (data) => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        const date = new Date().toISOString().split("T")[0];
        anchor.href = url;
        anchor.download = `config_export_${date}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        this.configOpLoading.set(false);
        this.configOpSuccess.set("Configuracion exportada.");
      },
      error: (error: Error) => {
        this.configOpLoading.set(false);
        this.configOpError.set(error.message);
      },
    });
  }

  protected triggerImportFile(): void {
    this.configOpError.set(null);
    this.configOpSuccess.set(null);
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file) {
        this.readImportFile(file);
      }
    };
    input.click();
  }

  protected openApplyConfigDialog(): void {
    const config = this.importedConfig();
    if (!config) {
      return;
    }
    const offerCodes = [...new Set(config.rules.map((r) => r.offerCode))].join(", ");
    const paramsNote =
      config.params !== null
        ? `Se reemplazaran tambien los parametros de los offerCodes afectados.`
        : `Los parametros existentes en BD no se modificaran.`;
    this.applyConfigComment.set("");
    this.applyConfigUser.set("");
    this.applyConfigCommentError.set(null);
    this.confirmDialog.set({
      type: "apply-config",
      title: "Grabar configuracion en BD",
      message: `Se eliminaran TODAS las reglas actuales de [${offerCodes}] y se insertaran las ${config.rules.length} reglas importadas. ${paramsNote} Se recomienda exportar la configuracion actual como copia de seguridad antes de continuar. Esta operacion no se puede deshacer.`,
    });
  }

  protected openResetSeedDialog(): void {
    this.resetSeedComment.set("");
    this.resetSeedUser.set("");
    this.resetSeedCommentError.set(null);
    this.confirmDialog.set({
      type: "reset-seed",
      title: "Restaurar configuracion semilla",
      message:
        "Esto restaurara las reglas y parametros de las 6 ofertas semilla base a su estado inicial y garantizara que exista el periodo base (2026-01-01). ADEMAS, esto eliminara permanentemente cualquier oferta, regla, parametro o periodo de vigencia que no forme parte de la configuracion semilla inicial de 6 ofertas — el sistema quedara exactamente en su estado inicial. Se creara un snapshot de la configuracion actual antes de aplicar el cambio. Esta operacion no se puede deshacer.",
    });
  }

  protected clearImportedConfig(): void {
    this.importedConfig.set(null);
    this.configOpSuccess.set(null);
    this.configOpError.set(null);
    this.applyFilters(false);
    this.loadParams({});
  }

  private readImportFile(file: File): void {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const data = JSON.parse(text) as { rules?: unknown; params?: unknown };

        if (!Array.isArray(data?.rules)) {
          this.configOpError.set('El JSON debe contener un campo "rules" de tipo array.');
          return;
        }
        const rules = data.rules as AdminRuleItem[];
        for (let i = 0; i < rules.length; i++) {
          const rule = rules[i];
          if (!rule.offerCode || !rule.rule_name || !Array.isArray(rule.conditions) || !Array.isArray(rule.actions)) {
            this.configOpError.set(`La regla [${i}] tiene un formato incorrecto (falta offerCode, rule_name, conditions o actions).`);
            return;
          }
        }
        if (data.params !== undefined && !Array.isArray(data.params)) {
          this.configOpError.set('El campo "params" debe ser un array o estar ausente.');
          return;
        }

        const importedParams: AdminParamsItem[] | null = Array.isArray(data.params)
          ? (data.params as AdminParamsItem[])
          : null;

        this.importedConfig.set({ rules, params: importedParams });
        // Show the imported data in the tables for review
        this.rules.set(rules);
        this.rulesTotal.set(rules.length);
        this.currentPage.set(1);
        if (importedParams !== null) {
          this.params.set(importedParams);
        }
        const paramsMsg =
          importedParams !== null
            ? `, ${importedParams.reduce((sum, g) => sum + g.paramValues.length, 0)} parametros`
            : " (parametros sin cambios)";
        this.configOpSuccess.set(
          `Configuracion importada: ${rules.length} reglas${paramsMsg}. Revisa los datos y pulsa "Grabar" para guardar en BD.`
        );
      } catch {
        this.configOpError.set("Error al parsear el fichero JSON. Verifica que sea un JSON valido.");
      }
    };
    reader.readAsText(file);
  }

  private executeApplyConfig(): void {
    const config = this.importedConfig();
    if (!config) {
      return;
    }
    const comment = this.applyConfigComment().trim();
    if (!comment) {
      this.applyConfigCommentError.set("El motivo es requerido.");
      return;
    }
    this.applyConfigCommentError.set(null);
    this.closeConfirmDialog();
    this.configOpLoading.set(true);
    this.configOpError.set(null);
    this.configOpSuccess.set(null);

    const payload: AdminConfigApplyPayload = {
      rules: config.rules,
      ...(config.params !== null ? { params: config.params } : {}),
      comment,
      createdBy: this.applyConfigUser().trim() || undefined,
    };

    this.adminApiService.applyConfig(payload).subscribe({
      next: (result) => {
        this.configOpLoading.set(false);
        this.importedConfig.set(null);
        this.configOpSuccess.set(
          `Configuracion grabada: ${result.applied.rules} reglas, ${result.applied.params} parametros. Snapshot #${result.snapshot_id} creado.`
        );
        this.applyFilters(false);
      },
      error: (error: Error) => {
        this.configOpLoading.set(false);
        this.configOpError.set(error.message);
      },
    });
  }

  private executeResetSeed(): void {
    const comment = this.resetSeedComment().trim();
    if (!comment) {
      this.resetSeedCommentError.set("El motivo es requerido.");
      return;
    }
    this.resetSeedCommentError.set(null);
    this.closeConfirmDialog();
    this.configOpLoading.set(true);
    this.configOpError.set(null);
    this.configOpSuccess.set(null);

    const payload: AdminResetSeedPayload = {
      comment,
      createdBy: this.resetSeedUser().trim() || undefined,
    };

    this.adminApiService.resetSeed(payload).subscribe({
      next: (result) => {
        this.configOpLoading.set(false);
        this.configOpSuccess.set(
          `Configuracion semilla restaurada: ${result.applied.rules} reglas, ${result.applied.params} parametros. Snapshot #${result.snapshot_id} creado. ${result.removedOfferCodes.length} ofertas y ${result.removedPeriodCount} periodos extra eliminados.`
        );
        // Full-scope reset may have deleted the previously-selected period.
        this.activePeriodService.setRulesPeriod(null);
        this.activePeriodService.setParamsPeriod(null);
        this.loadOffers();
        this.applyFilters(false);
      },
      error: (error: Error) => {
        this.configOpLoading.set(false);
        this.configOpError.set(error.message);
      },
    });
  }

  private executeRuleDelete(rule: AdminRuleItem): void {
    this.closeConfirmDialog();
    this.ruleActionError.set(null);
    this.ruleActionSuccess.set(null);
    this.setRulePending(rule.rule_id, true);

    this.adminApiService.deleteRule(rule.rule_id).subscribe({
      next: () => {
        this.setRulePending(rule.rule_id, false);
        this.ruleActionSuccess.set(`Regla ${rule.rule_id} eliminada.`);
        this.applyFilters(false);
      },
      error: (error: Error) => {
        this.setRulePending(rule.rule_id, false);
        this.ruleActionError.set(error.message);
      },
    });
  }

  private executeParamDelete(paramId: number): void {
    this.closeConfirmDialog();
    this.paramActionError.set(null);
    this.paramActionSuccess.set(null);
    this.setParamPending(paramId, true);

    this.adminApiService.deleteParam(paramId).subscribe({
      next: () => {
        this.setParamPending(paramId, false);
        this.paramActionSuccess.set(`Parametro ${paramId} eliminado.`);
        this.refreshParams();
      },
      error: (error: Error) => {
        this.setParamPending(paramId, false);
        this.paramActionError.set(error.message);
      },
    });
  }

  private setRulePending(ruleId: number, pending: boolean): void {
    this.pendingRuleIds.update((current) => {
      const next = new Set(current);
      if (pending) {
        next.add(ruleId);
      } else {
        next.delete(ruleId);
      }
      return next;
    });
  }

  private setParamPending(paramId: number, pending: boolean): void {
    this.pendingParamIds.update((current) => {
      const next = new Set(current);
      if (pending) {
        next.add(paramId);
      } else {
        next.delete(paramId);
      }
      return next;
    });
  }

  protected editOffer(offer: AdminOffer): void {
    this.offerEditorMode.set("edit");
    this.selectedOfferCode.set(offer.offerCode);
    this.offerActionError.set(null);
    this.offerActionSuccess.set(null);
    this.offerForm.setValue({
      code: offer.offerCode,
      name: offer.name,
      offer_rank: offer.offer_rank,
      enabled: offer.enabled,
      oferta_id: offer.oferta_id ?? 0,
    });
  }

  protected cancelOfferEdit(): void {
    this.offerEditorMode.set("closed");
    this.selectedOfferCode.set(null);
    this.offerForm.reset({ code: "", name: "", offer_rank: 0, enabled: true, oferta_id: 0 });
  }

  protected saveOffer(): void {
    this.offerActionError.set(null);
    this.offerActionSuccess.set(null);

    const raw = this.offerForm.getRawValue();
    if (!raw.code.trim()) {
      this.offerActionError.set("El código es obligatorio.");
      return;
    }
    if (!raw.name.trim()) {
      this.offerActionError.set("El nombre es obligatorio.");
      return;
    }

    this.offerSaving.set(true);
    const selectedOfferCode = this.selectedOfferCode();
    if (!selectedOfferCode) {
      this.offerSaving.set(false);
      return;
    }

    const offerData: AdminOfferUpdatePayload = {
      code: raw.code.trim().toUpperCase(),
      name: raw.name.trim(),
      offer_rank: Number(raw.offer_rank),
      enabled: raw.enabled,
      oferta_id: Number(raw.oferta_id),
    };

    this.adminApiService.updateOffer(selectedOfferCode, offerData).subscribe({
      next: () => {
        this.offerSaving.set(false);
        this.offerActionSuccess.set("Oferta actualizada.");
        this.cancelOfferEdit();
        this.loadOffers();
        this.loadPeriodOffers();
      },
      error: (error: Error) => {
        this.offerSaving.set(false);
        this.offerActionError.set(error.message);
      },
    });
  }

  protected deleteOfferInPeriod(offer: AdminOffer): void {
    const activePeriod = this.activePeriodService.activePeriodRules();
    if (!activePeriod) {
      return;
    }
    this.confirmDialog.set({
      type: "offer-period",
      title: "Eliminar reglas y parámetros del período",
      message: `Se eliminarán las reglas y parámetros de la oferta "${offer.offerCode}" SOLO en el período activo (#${activePeriod.offer_date_id} — ${activePeriod.descripcion}). La entidad oferta y sus datos en otros períodos NO se verán afectados.`,
      offerCode: offer.offerCode,
      offerDateId: activePeriod.offer_date_id,
    });
  }

  private loadOffers(): void {
    this.adminApiService.getOffers().subscribe({
      next: (response) => {
        this.offers.set(response.items);
      },
      error: () => {
        this.offers.set([]);
      },
    });
  }

  protected loadPeriodOffers(): void {
    const activePeriod = this.activePeriodService.activePeriodRules();
    if (!activePeriod) {
      this.periodOffers.set([]);
      return;
    }
    this.periodOffersLoading.set(true);
    this.periodOffersError.set(null);
    this.adminApiService.getOffers(activePeriod.offer_date_id).subscribe({
      next: (response) => {
        this.periodOffers.set(response.items);
        this.periodOffersLoading.set(false);
      },
      error: (error: Error) => {
        this.periodOffers.set([]);
        this.periodOffersError.set(error.message);
        this.periodOffersLoading.set(false);
      },
    });
  }

  private executeOfferPeriodDelete(offerCode: string, offerDateId: number): void {
    this.closeConfirmDialog();
    this.offerActionError.set(null);
    this.offerActionSuccess.set(null);
    this.setPendingOfferCode(offerCode, true);

    this.adminApiService.deleteOfferRulesInPeriod(offerCode, offerDateId).subscribe({
      next: (result) => {
        this.setPendingOfferCode(offerCode, false);
        this.offerActionSuccess.set(
          `Oferta ${offerCode}: ${result.deletedRules} regla(s) y ${result.deletedParams} parámetro(s) eliminados del período #${offerDateId}. Snapshot de seguridad: #${result.snapshot_id}.`
        );
        this.loadPeriodOffers();
        this.applyFilters(false);
      },
      error: (error: Error) => {
        this.setPendingOfferCode(offerCode, false);
        this.offerActionError.set(error.message);
      },
    });
  }

  private setPendingOfferCode(offerCode: string, pending: boolean): void {
    this.pendingOfferCodes.update((current) => {
      const next = new Set(current);
      if (pending) {
        next.add(offerCode);
      } else {
        next.delete(offerCode);
      }
      return next;
    });
  }

  protected isOfferCodePending(offerCode: string): boolean {
    return this.pendingOfferCodes().has(offerCode);
  }

  private loadRules(query: AdminRulesQuery): void {
    this.rulesLoading.set(true);
    this.rulesError.set(null);

    this.adminApiService.getRules(query).subscribe({
      next: (response) => {
        this.rules.set(response.items);
        this.rulesTotal.set(response.pagination.total);
        const maxPage = Math.max(1, Math.ceil(response.pagination.total / (query.pageSize ?? 25)));
        if (this.currentPage() > maxPage) {
          this.currentPage.set(maxPage);
          this.persistRulesViewState();
        }
        this.rulesLoading.set(false);
      },
      error: (error: Error) => {
        this.rules.set([]);
        this.rulesTotal.set(0);
        this.rulesError.set(error.message);
        this.rulesLoading.set(false);
      },
    });
  }

  protected openPocSnapshotDialog(): void {
    this.pocSnapshotComment.set("");
    this.pocSnapshotUser.set("");
    this.pocSnapshotError.set(null);
    this.pocSnapshotDialog.set(true);
  }

  protected closePocSnapshotDialog(): void {
    this.pocSnapshotDialog.set(false);
  }

  protected executePocSnapshot(): void {
    const comment = this.pocSnapshotComment().trim();
    if (!comment) {
      this.pocSnapshotError.set("El motivo es requerido.");
      return;
    }
    this.closePocSnapshotDialog();
    this.pocSnapshotLoading.set(true);
    this.pocSnapshotError.set(null);
    this.adminApiService
      .createPocSnapshot({ comment, createdBy: this.pocSnapshotUser().trim() || undefined })
      .subscribe({
        next: (result) => {
          this.pocSnapshotLoading.set(false);
          this.configOpSuccess.set(`Snapshot POC guardado: #${result.snapshot_id} "${result.snapshot_name}".`);
        },
        error: (err: Error) => {
          this.pocSnapshotLoading.set(false);
          this.configOpError.set(err.message);
        },
      });
  }

  protected openPublicarDialog(): void {
    this.publicarOfferDateId.set(null);
    this.publicarVigDesde.set("");
    this.publicarVigHasta.set("");
    this.publicarUser.set("");
    this.publicarTipoDs.set("AMBOS");
    this.publicarError.set(null);
    this.publicarOfertaIdOverrides.set(
      this.offers().reduce<Record<string, number | null>>(
        (acc, o) => ({ ...acc, [o.offerCode]: o.oferta_id ?? null }),
        {},
      ),
    );
    this.confirmDialog.set({
      type: "publicar-wf",
      title: "Publicar en Workflow",
      message: "Selecciona el período de origen (cfg_offer_dates) y el rango de destino en Workflow.",
    });
  }

  private loadFechas(): void {
    this.fechasLoading.set(true);
    this.adminApiService.getFechas().subscribe({
      next: (resp) => {
        this.fechas.set(resp.items);
        this.fechasLoading.set(false);
      },
      error: () => {
        this.fechasLoading.set(false);
      },
    });
  }

  private executePublicarWf(): void {
    const offerDateId = this.publicarOfferDateId();
    const vigDesde = this.toVigenciaString(this.publicarVigDesde().trim());
    if (!offerDateId) {
      this.publicarError.set("Selecciona un período de origen.");
      return;
    }
    if (!vigDesde) {
      this.publicarError.set("La fecha de inicio de destino es obligatoria.");
      return;
    }
    if (!this.publicarOverridesValid()) {
      this.publicarError.set("Todos los oferta_id deben ser enteros positivos (≥ 1).");
      return;
    }
    const overridesRaw = this.publicarOfertaIdOverrides();
    const ofertaIdOverrides = Object.fromEntries(
      Object.entries(overridesRaw).map(([k, v]) => [k, v as number]),
    );
    this.publicarLoading.set(true);
    this.publicarError.set(null);
    const vigHastaNorm = this.publicarVigHasta().trim();
    this.adminApiService
      .publishToWorkflow({
        offerDateId,
        rangoDestino: { vigDesde, vigHasta: vigHastaNorm ? this.toVigenciaString(vigHastaNorm) : null },
        createdBy: this.publicarUser().trim() || undefined,
        ofertaIdOverrides,
        tipoDs: this.publicarTipoDs(),
      })
      .subscribe({
        next: (result) => {
          this.publicarLoading.set(false);
          this.closeConfirmDialog();
          this.configOpSuccess.set(
            `Publicado en Workflow (${this.publicarTipoDs()}): ${result.rules} reglas, ${result.params} parámetros.`,
          );
          setTimeout(() => this.configOpSuccess.set(null), 5000);
        },
        error: (err: Error) => {
          this.publicarLoading.set(false);
          this.publicarError.set(err.message);
        },
      });
  }

  protected setPublicarOfertaId(offerCode: string, rawValue: string): void {
    const parsed = parseInt(rawValue, 10);
    const val = !rawValue.trim() || isNaN(parsed) ? null : parsed;
    this.publicarOfertaIdOverrides.update((prev) => ({ ...prev, [offerCode]: val }));
  }

  private loadParams(query: { offerCode?: string; offerDateId?: number }): void {
    this.paramsLoading.set(true);
    this.paramsError.set(null);

    this.adminApiService.getParams(query).subscribe({
      next: (response) => {
        this.params.set(response.items);
        this.paramsLoading.set(false);
      },
      error: (error: Error) => {
        this.params.set([]);
        this.paramsError.set(error.message);
        this.paramsLoading.set(false);
      },
    });
  }

  private buildRulePayloadFromForm() {
    const raw = this.ruleForm.getRawValue() as RuleFormValue;
    const conditions = this.normalizeDraftConditions(this.draftConditions());
    if (conditions.length === 0) {
      this.ruleActionError.set("Debes definir al menos una condicion para la regla.");
      return null;
    }

    const actions = this.buildActionsFromEntries(this.draftActionPayloadEntries(), raw.action_type);
    if (!actions) {
      this.ruleActionError.set("Hay parametros de accion invalidos. Revisa tipo y valor.");
      return null;
    }

    // In create mode re-read the signal so a period change after opening the editor is captured.
    // In edit mode keep the original record's period (immutable, stored in form value).
    const resolvedDateId = this.isRuleCreateMode()
      ? (this.activePeriodService.activePeriodRules()?.offer_date_id ?? null)
      : (raw.offer_date_id ? Number(raw.offer_date_id) : null);

    return {
      offerCode: (raw.offerCode ?? "").trim(),
      stage: raw.stage,
      rule_name: (raw.rule_name ?? "").trim(),
      priority: Number(raw.priority),
      enabled: raw.enabled,
      stop_processing: raw.stop_processing,
      offer_date_id: resolvedDateId,
      actions,
      conditions,
    };
  }

  private normalizeDraftConditions(conditions: AdminRuleCondition[]): AdminRuleCondition[] {
    return conditions
      .map((condition) => ({
        ...condition,
        left_operand: (condition.left_operand ?? "").trim(),
        operator: normalizeRuleOperator(condition.operator),
      }))
      .filter((condition) => condition.left_operand && condition.operator);
  }

  private buildEntriesFromActions(actions: AdminRuleAction[]): RuleActionPayloadEntry[] {
    if (!actions || actions.length === 0) {
      return [{ key: "", value: "", value_type: normalizeValueType("STRING") }];
    }
    return actions.map((action) => {
      const payload = action.action_payload;
      // SET_DICTAMEN payload: { dictamen: "..." }
      if (payload["dictamen"] !== undefined && payload["field"] === undefined) {
        return { key: "dictamen", value: String(payload["dictamen"] ?? ""), value_type: normalizeValueType("STRING") };
      }
      // Standard payload: { field, value, value_type }
      return {
        key: String(payload["field"] ?? ""),
        value: String(payload["value"] ?? ""),
        value_type: normalizeValueType(payload["value_type"]),
      };
    });
  }

  private buildActionsFromEntries(entries: RuleActionPayloadEntry[], actionTypeRaw: string): AdminRuleAction[] | null {
    if (entries.length === 0) return null;
    const normalizedType = normalizeActionType(actionTypeRaw);
    const actions: AdminRuleAction[] = [];
    for (const entry of entries) {
      if (normalizedType === "SET_DICTAMEN") {
        actions.push({ action_type: normalizedType, action_payload: { dictamen: entry.value ?? "" } });
      } else {
        const key = entry.key.trim();
        if (!key) return null;
        actions.push({
          action_type: normalizedType,
          action_payload: { field: key, value: entry.value ?? "", value_type: entry.value_type ?? normalizeValueType("STRING") },
        });
      }
    }
    return actions;
  }

  private applyRuleValidationFeedback(preview: ValidatePayloadResponse): void {
    this.invalidConditionFields.set(this.extractInvalidConditionFields(preview.errors));
    this.invalidActionPayloadFields.set(this.extractInvalidActionPayloadFields(preview.errors));
    if (!preview.valid) {
      this.rulePreviewError.set(this.buildRuleValidationMessage(preview.errors));
      return;
    }
    this.rulePreviewError.set(null);
  }

  private extractInvalidConditionFields(issues: ValidationIssue[]): string[] {
    const fields = new Set<string>();
    for (const issue of issues) {
      const match = /^conditions\[(\d+)\]\.(left_operand|operator|right_operand|value_type|value2)$/.exec(issue.field);
      if (match) {
        fields.add(`conditions[${match[1]}].${match[2]}`);
      }
    }
    return Array.from(fields);
  }

  private extractInvalidActionPayloadFields(issues: ValidationIssue[]): string[] {
    const fields = new Set<string>();
    for (const issue of issues) {
      const match = /^actions\[\d+\]\.action_payload\.([^.]+)$/.exec(issue.field);
      if (match) {
        fields.add(match[1]);
      }
    }
    return Array.from(fields);
  }

  private buildRuleValidationMessage(issues: ValidationIssue[]): string {
    if (!issues || issues.length === 0) {
      return "Payload vacio o invalido.";
    }
    return issues
      .map((issue) => {
        const conditionMatch = /^conditions\[(\d+)\]\.(.+)$/.exec(issue.field);
        if (conditionMatch) {
          return `Condicion #${Number(conditionMatch[1]) + 1} (${conditionMatch[2]}): ${issue.message}`;
        }

        const actionMatch = /^actions\[(\d+)\]\.action_payload\.(.+)$/.exec(issue.field);
        if (actionMatch) {
          return `Accion #${Number(actionMatch[1]) + 1} (${actionMatch[2]}): ${issue.message}`;
        }

        return `${issue.field}: ${issue.message}`;
      })
      .join(" | ");
  }

  private stageOrder(stage: string): number {
    if (stage === "INIT") return 0;
    if (stage === "PRE") return 1;
    if (stage === "FINAL") return 2;
    return 3;
  }

  private readParamSortValue(row: FlatParamRow, key: ParamSortKey): number | string {
    if (key === "param_id") {
      return row.param.param_id ?? -1;
    }
    if (key === "offerCode") {
      return row.offerCode.toLowerCase();
    }
    if (key === "key") {
      return row.param.key.toLowerCase();
    }
    if (key === "value") {
      return row.param.value.toLowerCase();
    }
    return row.param.value_type.toLowerCase();
  }

  private readRuleSortValue(rule: AdminRuleItem, key: RuleSortKey): number | string {
    if (key === "rule_id") {
      return rule.rule_id;
    }
    if (key === "offerCode") {
      return rule.offerCode.toLowerCase();
    }
    if (key === "stage") {
      return this.stageOrder(rule.stage);
    }
    if (key === "rule_name") {
      return rule.rule_name.toLowerCase();
    }
    if (key === "priority") {
      return rule.priority;
    }
    if (key === "enabled") {
      return rule.enabled ? 1 : 0;
    }
    if (key === "conditions") {
      return rule.conditions.length;
    }
    return (rule.actions[0]?.action_type ?? "").toLowerCase();
  }

  private compareRulesByDefault(left: AdminRuleItem, right: AdminRuleItem): number {
    if (left.offerCode !== right.offerCode) {
      return left.offerCode.localeCompare(right.offerCode);
    }
    const stageDiff = this.stageOrder(left.stage) - this.stageOrder(right.stage);
    if (stageDiff !== 0) {
      return stageDiff;
    }
    if (left.priority !== right.priority) {
      return right.priority - left.priority;
    }
    return left.rule_id - right.rule_id;
  }

  private verifyUpdatedRule(ruleId: number, expectedPayload: ReturnType<ConfiguratorPageComponent["buildRulePayloadFromForm"]>): void {
    if (!expectedPayload) {
      this.ruleActionSuccess.set("Regla actualizada.");
      return;
    }

    this.adminApiService
      .getRules({
        offerCode: expectedPayload.offerCode,
        stage: expectedPayload.stage,
        q: expectedPayload.rule_name,
        page: 1,
        pageSize: 200,
      })
      .subscribe({
        next: (response) => {
          const updatedRule = response.items.find((item) => item.rule_id === ruleId);
          if (!updatedRule) {
            this.ruleActionSuccess.set("Regla actualizada. No se pudo verificar en la pagina actual.");
            return;
          }

          const expectedConditions = this.serializeConditions(expectedPayload.conditions);
          const actualConditions = this.serializeConditions(updatedRule.conditions);
          if (expectedConditions !== actualConditions) {
            this.ruleActionError.set("Regla actualizada, pero las condiciones no coinciden tras recarga. Revisa operadores y datos.");
            return;
          }

          this.ruleActionSuccess.set("Regla actualizada.");
        },
        error: () => {
          this.ruleActionSuccess.set("Regla actualizada. Verificacion diferida.");
        },
      });
  }

  private serializeConditions(conditions: AdminRuleCondition[]): string {
    return JSON.stringify(
      conditions
        .map((condition) => ({
          group_id: condition.group_id,
          left_operand: String(condition.left_operand ?? "").trim(),
          operator: normalizeRuleOperator(condition.operator),
          right_operand: condition.right_operand,
          value_type: String(condition.value_type ?? "").toUpperCase(),
          value2: condition.value2 ?? null,
        }))
        .sort((a, b) => a.group_id - b.group_id || a.left_operand.localeCompare(b.left_operand))
    );
  }

  private compareParamRowsByDefault(left: FlatParamRow, right: FlatParamRow): number {
    if (left.offerCode !== right.offerCode) {
      return left.offerCode.localeCompare(right.offerCode);
    }
    if (left.param.key !== right.param.key) {
      return left.param.key.localeCompare(right.param.key);
    }
    return (left.param.param_id ?? -1) - (right.param.param_id ?? -1);
  }

  private persistParamsViewState(): void {
    try {
      const payload = {
        search: this.paramSearchTerm(),
        sortKey: this.paramSortKey(),
        sortDirection: this.paramSortDirection(),
        page: this.paramCurrentPage(),
      };
      localStorage.setItem(PARAMS_VIEW_STATE_KEY, JSON.stringify(payload));
    } catch {
      // Best-effort persistence for UX only.
    }
  }

  private persistRulesViewState(): void {
    try {
      const payload = {
        sortKey: this.ruleSortKey(),
        sortDirection: this.ruleSortDirection(),
        page: this.currentPage(),
      };
      localStorage.setItem(RULES_VIEW_STATE_KEY, JSON.stringify(payload));
    } catch {
      // Best-effort persistence for UX only.
    }
  }

  private restoreParamsViewState(): void {
    try {
      const rawValue = localStorage.getItem(PARAMS_VIEW_STATE_KEY);
      if (!rawValue) {
        return;
      }
      const parsed = JSON.parse(rawValue) as {
        search?: unknown;
        sortKey?: unknown;
        sortDirection?: unknown;
        page?: unknown;
      };

      if (typeof parsed.search === "string") {
        this.paramSearchTerm.set(parsed.search);
      }

      const validSortKeys: ParamSortKey[] = ["param_id", "offerCode", "key", "value", "value_type", "execution"];
      if (typeof parsed.sortKey === "string" && validSortKeys.includes(parsed.sortKey as ParamSortKey)) {
        this.paramSortKey.set(parsed.sortKey as ParamSortKey);
      }

      if (parsed.sortDirection === "asc" || parsed.sortDirection === "desc") {
        this.paramSortDirection.set(parsed.sortDirection);
      }

      if (typeof parsed.page === "number" && Number.isFinite(parsed.page) && parsed.page > 0) {
        this.paramCurrentPage.set(Math.floor(parsed.page));
      }
    } catch {
      // Ignore corrupted persisted state.
    }
  }

  private restoreRulesViewState(): void {
    try {
      const rawValue = localStorage.getItem(RULES_VIEW_STATE_KEY);
      if (!rawValue) {
        return;
      }
      const parsed = JSON.parse(rawValue) as {
        sortKey?: unknown;
        sortDirection?: unknown;
        page?: unknown;
      };

      const validSortKeys: RuleSortKey[] = [
        "rule_id",
        "offerCode",
        "stage",
        "rule_name",
        "priority",
        "enabled",
        "conditions",
        "action_type",
        "execution",
      ];

      if (typeof parsed.sortKey === "string" && validSortKeys.includes(parsed.sortKey as RuleSortKey)) {
        this.ruleSortKey.set(parsed.sortKey as RuleSortKey);
      }

      if (parsed.sortDirection === "asc" || parsed.sortDirection === "desc") {
        this.ruleSortDirection.set(parsed.sortDirection);
      }

      if (typeof parsed.page === "number" && Number.isFinite(parsed.page) && parsed.page > 0) {
        this.currentPage.set(Math.floor(parsed.page));
      }
    } catch {
      // Ignore corrupted persisted state.
    }
  }

  private normalizeText(value: string): string | undefined {
    const normalized = value.trim();
    return normalized ? normalized : undefined;
  }

  // ---------------------------------------------------------------------------
  // Period helpers (WU-02)
  // ---------------------------------------------------------------------------

  private formatPeriod(p: AdminFechaItem | null): string {
    if (!p) return "";
    const from = this.formatDate(p.valid_from);
    const to = p.valid_to ? this.formatDate(p.valid_to) : "∞";
    return `#${p.offer_date_id} ${from} – ${to} · ${p.descripcion} (${p.tipo_cd})`;
  }

  protected formatPeriodById(id: number | null): string {
    if (id === null) return "—";
    const found = this.fechas().find((f) => f.offer_date_id === id) ?? null;
    return found ? this.formatPeriod(found) : `#${id}`;
  }

  private formatDate(d: string): string {
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
  }

}
