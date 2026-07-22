import { ComponentFixture, TestBed } from "@angular/core/testing";
import { signal } from "@angular/core";
import { provideRouter } from "@angular/router";
import { of, Subject } from "rxjs";

import { ConfiguratorPageComponent } from "./configurator-page.component";
import { AdminApiService } from "../services/admin-api.service";
import { PublicConfigApiService } from "../services/public-config-api.service";
import { ActivePeriodService } from "../services/active-period.service";
import { AdminFechaItem, AdminRuleItem, ApplyImpact } from "../models/admin.models";
import { environment } from "../../environments/environment";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePeriod(id: number, tipo_cd: "REGLAS" | "PARAMS" | "AMBOS" = "REGLAS"): AdminFechaItem {
  return {
    offer_date_id: id,
    valid_from: "2026-01-01",
    valid_to: null,
    descripcion: `Período ${id}`,
    tipo_cd,
    alta_usr: null,
    alta_dt: "2026-01-01T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Mock services
// ---------------------------------------------------------------------------

function makeOffer(code: string): { ruleset_id: number; offerCode: string; name: string; offer_rank: number; enabled: boolean; oferta_id: number } {
  return { ruleset_id: 1, offerCode: code, name: `Oferta ${code}`, offer_rank: 100, enabled: true, oferta_id: 1 };
}

function buildAdminApiMock() {
  return {
    getOffers: (_offerDateId?: number) => of({ items: [makeOffer("OFERTA_A"), makeOffer("OFERTA_B")] }),
    getRules: () => of({ items: [], pagination: { total: 0, page: 1, pageSize: 25 } }),
    getParams: () => of({ items: [] }),
    createRule: () => of({ rule_id: 1 }),
    updateRule: () => of({ updated: true }),
    createParam: () => of({ param_id: 1 }),
    updateParam: () => of({ updated: true }),
    getFechas: () => of({ items: [] }),
    deleteRule: () => of({ deleted: true }),
    deleteParam: () => of({ deleted: true }),
    setRuleEnabled: () => of({ enabled: true }),
    reorderRules: () => of({ reordered: true }),
    validateRulePayload: () => of({ valid: true, errors: [] }),
    setOfferEnabled: () => of({ enabled: true }),
    deleteOffer: () => of({ deleted: true, offerCode: "TEST", snapshot_id: 1, deletedRules: 0, deletedParams: 0 }),
    createOffer: () => of({ ruleset_id: 1, offerCode: "TEST" }),
    updateOffer: () => of({ offerCode: "TEST", updated: true }),
    exportConfig: () => of({ rules: [], params: [] }),
    applyConfig: () => of({ snapshot_id: 1, applied: { rules: 1, params: 0 }, offerCodes: ["OFERTA_A"] }),
    previewApply: () =>
      of({
        offerCodes: ["OFERTA_A"],
        rulesToDelete: 2,
        paramsToDelete: 1,
        rulesToInsert: 1,
        paramsToInsert: 0,
        perOffer: [
          { offerCode: "OFERTA_A", rulesToDelete: 2, paramsToDelete: 1, rulesToInsert: 1, paramsToInsert: 0 },
        ],
      }),
    resetSeed: () =>
      of({
        applied: { rules: 85, params: 67 },
        offerCodes: ["FIDELIZACION"],
        snapshot_id: 21,
        offer_date_id: 4,
        removedOfferCodes: ["OFERTA_TEST"],
        removedPeriodCount: 1,
      }),
    getSnapshots: () => of({ items: [], total: 0 }),
    restoreSnapshot: () => of({ preRestoreSnapshotId: 1, published: true, rules: 0, params: 0 }),
    createPocSnapshot: () => of({ snapshot_id: 1 }),
    createWorkflowSnapshot: () => of({ snapshot_id: 1, snapshot_name: "test" }),
    publishToWorkflow: () => of({ published: true, rules: 0, params: 0 }),
    deleteSnapshot: () => of({ deleted: true }),
    getSnapshotContent: () => of({ rules: [], params: [] }),
    deleteOfferRulesInPeriod: (_offerCode: string, _offerDateId: number, _createdBy?: string) =>
      of({ offerCode: _offerCode, offerDateId: _offerDateId, deleted: true, snapshot_id: 9, deletedRules: 3, deletedParams: 1 }),
  };
}

// ---------------------------------------------------------------------------
// permissive-config-readonly (PR 2, frontend infra) — ADR-CR5: read call
// sites (loadOffers/loadPeriodOffers/loadRules/loadParams/loadFechas) must go
// through the new public-adjacent PublicConfigApiService, not AdminApiService.
// AdminApiService.getRules() is still used internally by verifyUpdatedRule()
// (post-save verification, only reachable from the admin-gated saveRule()
// flow) — that one call site intentionally stays on AdminApiService per the
// design's explicit repoint list, which does not include it.
// ---------------------------------------------------------------------------
function buildPublicConfigApiMock() {
  return {
    getOffers: (_offerDateId?: number) => of({ items: [makeOffer("OFERTA_A"), makeOffer("OFERTA_B")] }),
    getRules: () => of({ items: [], pagination: { total: 0, page: 1, pageSize: 25 } }),
    getParams: () => of({ items: [] }),
    getFechas: () => of({ items: [] }),
  };
}

// Writable signals for ActivePeriodService mock
let mockActivePeriodRules = signal<AdminFechaItem | null>(null);
let mockActivePeriodParams = signal<AdminFechaItem | null>(null);

function buildActivePeriodMock() {
  return {
    activePeriodRules: mockActivePeriodRules,
    activePeriodParams: mockActivePeriodParams,
    setRulesPeriod: (p: AdminFechaItem | null) => mockActivePeriodRules.set(p),
    setParamsPeriod: (p: AdminFechaItem | null) => mockActivePeriodParams.set(p),
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

async function setupTestBed() {
  mockActivePeriodRules = signal<AdminFechaItem | null>(null);
  mockActivePeriodParams = signal<AdminFechaItem | null>(null);

  await TestBed.configureTestingModule({
    imports: [ConfiguratorPageComponent],
    providers: [
      provideRouter([]),
      { provide: AdminApiService, useValue: buildAdminApiMock() },
      { provide: PublicConfigApiService, useValue: buildPublicConfigApiMock() },
      { provide: ActivePeriodService, useValue: buildActivePeriodMock() },
    ],
  }).compileComponents();
}

function createComponent(): ComponentFixture<ConfiguratorPageComponent> {
  const fixture = TestBed.createComponent(ConfiguratorPageComponent);
  fixture.detectChanges();
  return fixture;
}

// ---------------------------------------------------------------------------
// WU-01: Smoke test
// ---------------------------------------------------------------------------

describe("ConfiguratorPageComponent", () => {
  beforeEach(async () => {
    await setupTestBed();
  });

  it("WU-01 smoke: should create component without errors", () => {
    const fixture = createComponent();
    expect(fixture.componentInstance).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // permissive-config-readonly (PR 2, frontend infra) — ADR-CR5
  // ---------------------------------------------------------------------------
  describe("permissive-config-readonly: reads go through PublicConfigApiService", () => {
    it("ngOnInit's loadOffers/loadPeriodOffers/loadFechas/loadRules/loadParams call PublicConfigApiService, not AdminApiService", () => {
      const publicConfigApi = TestBed.inject(PublicConfigApiService);
      const adminApi = TestBed.inject(AdminApiService);
      const getOffersSpy = spyOn(publicConfigApi, "getOffers").and.callThrough();
      const getRulesSpy = spyOn(publicConfigApi, "getRules").and.callThrough();
      const getParamsSpy = spyOn(publicConfigApi, "getParams").and.callThrough();
      const getFechasSpy = spyOn(publicConfigApi, "getFechas").and.callThrough();
      const adminGetOffersSpy = spyOn(adminApi, "getOffers").and.callThrough();
      const adminGetParamsSpy = spyOn(adminApi, "getParams").and.callThrough();
      const adminGetFechasSpy = spyOn(adminApi, "getFechas").and.callThrough();

      mockActivePeriodRules.set(makePeriod(3));
      createComponent();

      expect(getOffersSpy).toHaveBeenCalled();
      expect(getRulesSpy).toHaveBeenCalled();
      expect(getParamsSpy).toHaveBeenCalled();
      expect(getFechasSpy).toHaveBeenCalled();
      expect(adminGetOffersSpy).not.toHaveBeenCalled();
      expect(adminGetParamsSpy).not.toHaveBeenCalled();
      expect(adminGetFechasSpy).not.toHaveBeenCalled();
    });

    it("refreshParams() reads via PublicConfigApiService.getParams, not AdminApiService.getParams", () => {
      const publicConfigApi = TestBed.inject(PublicConfigApiService);
      const adminApi = TestBed.inject(AdminApiService);
      const getParamsSpy = spyOn(publicConfigApi, "getParams").and.callThrough();
      const adminGetParamsSpy = spyOn(adminApi, "getParams").and.callThrough();

      const fixture = createComponent();
      const component = fixture.componentInstance;
      getParamsSpy.calls.reset();
      component["refreshParams"]();

      expect(getParamsSpy).toHaveBeenCalled();
      expect(adminGetParamsSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // WU-02: canCreateRule / canCreateParam / formatPeriodById
  // -------------------------------------------------------------------------

  describe("WU-02: computed signals canCreateRule / canCreateParam", () => {
    it("T1: canCreateRule is false when activePeriodRules is null", () => {
      mockActivePeriodRules.set(null);
      const fixture = createComponent();
      const component = fixture.componentInstance;
      expect(component["canCreateRule"]()).toBeFalse();
    });

    it("T2: canCreateRule is true when activePeriodRules has a value", () => {
      mockActivePeriodRules.set(makePeriod(3));
      const fixture = createComponent();
      const component = fixture.componentInstance;
      expect(component["canCreateRule"]()).toBeTrue();
    });

    it("T3a: canCreateParam is false when activePeriodParams is null", () => {
      mockActivePeriodParams.set(null);
      const fixture = createComponent();
      const component = fixture.componentInstance;
      expect(component["canCreateParam"]()).toBeFalse();
    });

    it("T3b: canCreateParam is true when activePeriodParams has a value", () => {
      mockActivePeriodParams.set(makePeriod(5, "PARAMS"));
      const fixture = createComponent();
      const component = fixture.componentInstance;
      expect(component["canCreateParam"]()).toBeTrue();
    });

    it("T13a: formatPeriodById returns — when id is null", () => {
      const fixture = createComponent();
      const component = fixture.componentInstance;
      expect(component["formatPeriodById"](null)).toBe("—");
    });

    it("T13b: formatPeriodById returns #id fallback when fecha not in fechas()", () => {
      const fixture = createComponent();
      const component = fixture.componentInstance;
      // fechas() is empty (mock returns [])
      expect(component["formatPeriodById"](99)).toBe("#99");
    });

    it("T13c: formatPeriodById resolves from fechas() when period is present", () => {
      const fixture = createComponent();
      const component = fixture.componentInstance;
      // Inject a fecha into the component signal directly
      component["fechas"].set([makePeriod(7)]);
      fixture.detectChanges();
      const result = component["formatPeriodById"](7);
      expect(result).toContain("#7");
      expect(result).toContain("01/01/2026");
    });
  });

  // -------------------------------------------------------------------------
  // WU-03: Disable create-rule button and show banner (rules panel)
  // -------------------------------------------------------------------------

  describe("WU-03: rules panel — disabled button and banner", () => {
    it("T4: create-rule button is disabled when activePeriodRules is null", () => {
      mockActivePeriodRules.set(null);
      const fixture = createComponent();
      fixture.detectChanges();
      const button = fixture.nativeElement.querySelector(".panel-rules .btn-create") as HTMLButtonElement | null;
      expect(button).toBeTruthy();
      expect(button!.disabled).toBeTrue();
    });

    it("T5a: .period-banner is visible with link to /offer-dates when no rules period", () => {
      mockActivePeriodRules.set(null);
      const fixture = createComponent();
      fixture.detectChanges();
      const banner = fixture.nativeElement.querySelector(".panel-rules .period-banner") as HTMLElement | null;
      expect(banner).toBeTruthy();
      const link = banner!.querySelector("a") as HTMLAnchorElement | null;
      expect(link).toBeTruthy();
    });

    it("T5b: .period-banner is NOT visible when activePeriodRules is not null", () => {
      mockActivePeriodRules.set(makePeriod(3));
      const fixture = createComponent();
      fixture.detectChanges();
      const banner = fixture.nativeElement.querySelector(".panel-rules .period-banner");
      expect(banner).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // WU-04: Disable create-param button and show banner (params panel)
  // -------------------------------------------------------------------------

  describe("WU-04: params panel — disabled button and banner", () => {
    it("T6a: create-param button is disabled when activePeriodParams is null", () => {
      mockActivePeriodParams.set(null);
      const fixture = createComponent();
      fixture.detectChanges();
      const button = fixture.nativeElement.querySelector(".panel-params .btn-create") as HTMLButtonElement | null;
      expect(button).toBeTruthy();
      expect(button!.disabled).toBeTrue();
    });

    it("T6b: create-param button is enabled when activePeriodParams is not null", () => {
      mockActivePeriodParams.set(makePeriod(5, "PARAMS"));
      const fixture = createComponent();
      fixture.detectChanges();
      const button = fixture.nativeElement.querySelector(".panel-params .btn-create") as HTMLButtonElement | null;
      expect(button).toBeTruthy();
      expect(button!.disabled).toBeFalse();
    });

    it("T6c: params banner visible with link when no params period", () => {
      mockActivePeriodParams.set(null);
      const fixture = createComponent();
      fixture.detectChanges();
      const banner = fixture.nativeElement.querySelector(".panel-params .period-banner") as HTMLElement | null;
      expect(banner).toBeTruthy();
      const link = banner!.querySelector("a");
      expect(link).toBeTruthy();
    });

    it("CA-007: canCreateRule and canCreateParam are independent", () => {
      mockActivePeriodRules.set(null);
      mockActivePeriodParams.set(makePeriod(5, "PARAMS"));
      const fixture = createComponent();
      const component = fixture.componentInstance;
      expect(component["canCreateRule"]()).toBeFalse();
      expect(component["canCreateParam"]()).toBeTrue();
    });
  });

  // -------------------------------------------------------------------------
  // WU-05: Auto-inject active rules period at open-time and submit-time
  // -------------------------------------------------------------------------

  describe("WU-05: rules period injection at open-time", () => {
    it("T7: openCreateRuleEditor injects activePeriodRules offer_date_id into ruleForm", () => {
      mockActivePeriodRules.set(makePeriod(3));
      const fixture = createComponent();
      const component = fixture.componentInstance;
      component["openCreateRuleEditor"]();
      expect(component["ruleForm"].value["offer_date_id"]).toBe(3);
    });

    it("T9: buildRulePayloadFromForm in create mode re-reads signal (stale protection)", () => {
      mockActivePeriodRules.set(makePeriod(3));
      const fixture = createComponent();
      const component = fixture.componentInstance;
      component["openCreateRuleEditor"]();
      // Simulate signal changed after editor opened
      mockActivePeriodRules.set(makePeriod(99));
      // Need at least one condition for payload to build
      component["draftConditions"].set([
        { group_id: 0, left_operand: "stage", operator: "EQ", right_operand: "PRE", value_type: "STRING" },
      ]);
      const payload = component["buildRulePayloadFromForm"]();
      expect(payload).not.toBeNull();
      expect(payload!["offer_date_id"]).toBe(99);
    });

    it("T10: buildRulePayloadFromForm in EDIT mode uses form value (not signal)", () => {
      mockActivePeriodRules.set(makePeriod(9));
      const fixture = createComponent();
      const component = fixture.componentInstance;
      // Simulate editing a rule with offer_date_id=5
      const fakeRule = {
        rule_id: 1,
        offerCode: "OFERTA_RESTRICTIVA",
        stage: "PRE" as const,
        rule_name: "Test",
        priority: 900,
        enabled: true,
        stop_processing: false,
        offer_date_id: 5,
        actions: [{ action_type: "SET", action_payload: { field: "preRejected", value_type: "BOOL", value: "false" } }],
        conditions: [{ group_id: 0, left_operand: "stage", operator: "EQ", right_operand: "PRE", value_type: "STRING" }],
      };
      component["editRule"](fakeRule);
      fixture.detectChanges();
      const payload = component["buildRulePayloadFromForm"]();
      expect(payload).not.toBeNull();
      expect(payload!["offer_date_id"]).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  // WU-06: Auto-inject active params period at open-time
  // -------------------------------------------------------------------------

  describe("WU-06: params period injection at open-time", () => {
    it("T8a: openCreateParamEditor injects activePeriodParams offer_date_id into paramForm", () => {
      mockActivePeriodParams.set(makePeriod(5, "PARAMS"));
      const fixture = createComponent();
      const component = fixture.componentInstance;
      component["openCreateParamEditor"]();
      expect(component["paramForm"].value["offer_date_id"]).toBe(5);
    });

    it("T8b: saveParam in create mode uses updated signal (stale protection)", () => {
      mockActivePeriodParams.set(makePeriod(5, "PARAMS"));
      const fixture = createComponent();
      const component = fixture.componentInstance;
      component["openCreateParamEditor"]();
      // Change signal after open
      mockActivePeriodParams.set(makePeriod(77, "PARAMS"));

      // Spy on createParam to capture the payload
      const adminApi = TestBed.inject(AdminApiService);
      const createSpy = spyOn(adminApi, "createParam").and.callThrough();

      component["saveParam"]();

      expect(createSpy).toHaveBeenCalledOnceWith(jasmine.objectContaining({ offer_date_id: 77 }));
    });
  });

  // -------------------------------------------------------------------------
  // WU-07: duplicateRule re-injects active period (not source rule period)
  // -------------------------------------------------------------------------

  describe("WU-07: duplicateRule uses active period, not source rule period", () => {
    it("duplicateRule with activePeriodRules=7 and source rule period=2 -> form has 7", () => {
      mockActivePeriodRules.set(makePeriod(7));
      const fixture = createComponent();
      const component = fixture.componentInstance;
      const sourceRule = {
        rule_id: 1,
        offerCode: "OFERTA_RESTRICTIVA",
        stage: "PRE" as const,
        rule_name: "Regla origen",
        priority: 900,
        enabled: true,
        stop_processing: false,
        offer_date_id: 2,
        actions: [{ action_type: "SET", action_payload: { field: "preRejected", value_type: "BOOL", value: "false" } }],
        conditions: [],
      };
      component["duplicateRule"](sourceRule);
      expect(component["ruleForm"].value["offer_date_id"]).toBe(7);
    });
  });

  // -------------------------------------------------------------------------
  // WU-08: Edit mode — rule period immutable
  // -------------------------------------------------------------------------

  describe("WU-08: edit rule — period is immutable (form keeps original)", () => {
    it("T10: editRule with offer_date_id=5 and active signal=2 keeps form value=5", () => {
      mockActivePeriodRules.set(makePeriod(2));
      const fixture = createComponent();
      const component = fixture.componentInstance;
      const rule = {
        rule_id: 42,
        offerCode: "OFERTA_RESTRICTIVA",
        stage: "PRE" as const,
        rule_name: "Regla existente",
        priority: 500,
        enabled: true,
        stop_processing: false,
        offer_date_id: 5,
        actions: [{ action_type: "SET", action_payload: { field: "preRejected", value_type: "BOOL", value: "false" } }],
        conditions: [],
      };
      component["editRule"](rule);
      fixture.detectChanges();
      expect(component["ruleForm"].value["offer_date_id"]).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  // WU-09: Edit mode — param period immutable
  // -------------------------------------------------------------------------

  describe("WU-09: edit param — period is immutable (form keeps original)", () => {
    it("editParam with offer_date_id=5 and active signal=9 keeps form value=5", () => {
      mockActivePeriodParams.set(makePeriod(9, "PARAMS"));
      const fixture = createComponent();
      const component = fixture.componentInstance;
      const row = {
        offerCode: "OFERTA_RESTRICTIVA",
        param: {
          param_id: 10,
          key: "TEST_KEY",
          value: "test_val",
          value_type: "STRING",
          offer_date_id: 5,
          enabled: true,
        },
      };
      component["editParam"](row);
      fixture.detectChanges();
      expect(component["paramForm"].value["offer_date_id"]).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  // WU-10: Rules list visible with editor open
  // -------------------------------------------------------------------------

  describe("WU-10: rules list stays visible when editor is open", () => {
    it("T11: table.rules-table is in DOM when ruleEditorMode is create", () => {
      mockActivePeriodRules.set(makePeriod(3));
      const fixture = createComponent();
      const component = fixture.componentInstance;
      // Load some rules
      component["rules"].set([
        {
          rule_id: 1,
          offerCode: "OFERTA_RESTRICTIVA",
          stage: "PRE",
          rule_name: "Regla test",
          priority: 900,
          enabled: true,
          stop_processing: false,
          offer_date_id: 3,
          actions: [],
          conditions: [],
        },
      ]);
      component["rulesTotal"].set(1);
      component["openCreateRuleEditor"]();
      fixture.detectChanges();
      const table = fixture.nativeElement.querySelector("table.rules-table");
      expect(table).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // WU-11: Params list visible with editor open
  // -------------------------------------------------------------------------

  describe("WU-11: params list stays visible when editor is open", () => {
    it("T12: params table is in DOM when paramEditorMode is create", () => {
      mockActivePeriodParams.set(makePeriod(5, "PARAMS"));
      const fixture = createComponent();
      const component = fixture.componentInstance;
      // Load some params
      component["params"].set([
        {
          offerCode: "OFERTA_RESTRICTIVA",
          paramValues: [
            { param_id: 1, key: "KEY1", value: "val1", value_type: "STRING", offer_date_id: 5 },
          ],
        },
      ]);
      component["openCreateParamEditor"]();
      fixture.detectChanges();
      const table = fixture.nativeElement.querySelector("table.params-table");
      expect(table).toBeTruthy();
    });

    it("T12b: search field is visible when param editor is open", () => {
      mockActivePeriodParams.set(makePeriod(5, "PARAMS"));
      const fixture = createComponent();
      const component = fixture.componentInstance;
      component["openCreateParamEditor"]();
      fixture.detectChanges();
      const search = fixture.nativeElement.querySelector(".panel-search");
      expect(search).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // WU-12: No <select formControlName="offer_date_id"> in create forms
  // -------------------------------------------------------------------------

  describe("WU-12: no period <select> in create forms", () => {
    it("T14a: no select[formControlName=offer_date_id] in rules form when in create mode", () => {
      mockActivePeriodRules.set(makePeriod(3));
      const fixture = createComponent();
      const component = fixture.componentInstance;
      component["openCreateRuleEditor"]();
      fixture.detectChanges();
      const sel = fixture.nativeElement.querySelector(
        "form[formgroup] select[formcontrolname='offer_date_id'], .crud-form select[formcontrolname='offer_date_id']"
      );
      // Verify by inspecting the ruleForm section
      const ruleForm = fixture.nativeElement.querySelector(".panel-rules .crud-form");
      const periodSelect = ruleForm ? ruleForm.querySelector("select[formcontrolname='offer_date_id']") : null;
      expect(periodSelect).toBeNull();
    });

    it("T14b: no select[formControlName=offer_date_id] in params form when in create mode", () => {
      mockActivePeriodParams.set(makePeriod(5, "PARAMS"));
      const fixture = createComponent();
      const component = fixture.componentInstance;
      component["openCreateParamEditor"]();
      fixture.detectChanges();
      const paramForm = fixture.nativeElement.querySelector(".panel-params .crud-form");
      const periodSelect = paramForm ? paramForm.querySelector("select[formcontrolname='offer_date_id']") : null;
      expect(periodSelect).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // CA-008 (W-01): Reverse signal independence
  // activePeriodParams null, activePeriodRules has a period
  // -------------------------------------------------------------------------

  describe("CA-008: reverse signal independence (params null, rules active)", () => {
    it("params Crear button is disabled and params banner is visible when activePeriodParams is null", () => {
      mockActivePeriodParams.set(null);
      mockActivePeriodRules.set(makePeriod(3));
      const fixture = createComponent();
      fixture.detectChanges();

      const paramsButton = fixture.nativeElement.querySelector(".panel-params .btn-create") as HTMLButtonElement | null;
      expect(paramsButton).toBeTruthy();
      expect(paramsButton!.disabled).toBeTrue();

      const paramsBanner = fixture.nativeElement.querySelector(".panel-params .period-banner");
      expect(paramsBanner).toBeTruthy();
    });

    it("rules Crear button is enabled and no rules banner when activePeriodRules is not null (reverse case)", () => {
      mockActivePeriodParams.set(null);
      mockActivePeriodRules.set(makePeriod(3));
      const fixture = createComponent();
      fixture.detectChanges();

      const rulesButton = fixture.nativeElement.querySelector(".panel-rules .btn-create") as HTMLButtonElement | null;
      expect(rulesButton).toBeTruthy();
      expect(rulesButton!.disabled).toBeFalse();

      const rulesBanner = fixture.nativeElement.querySelector(".panel-rules .period-banner");
      expect(rulesBanner).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // CA-019 / CA-020 (W-02): Reactive DOM re-enablement after signal change
  // -------------------------------------------------------------------------

  describe("CA-019/CA-020: reactive re-enablement when signal changes from null to valid period", () => {
    it("CA-019: rules Crear button becomes enabled and banner disappears after activePeriodRules is set", () => {
      // Start with null — button disabled, banner present
      mockActivePeriodRules.set(null);
      const fixture = createComponent();
      fixture.detectChanges();

      const buttonBefore = fixture.nativeElement.querySelector(".panel-rules .btn-create") as HTMLButtonElement;
      expect(buttonBefore.disabled).toBeTrue();
      expect(fixture.nativeElement.querySelector(".panel-rules .period-banner")).toBeTruthy();

      // Mutate signal — Angular must react
      mockActivePeriodRules.set(makePeriod(3));
      fixture.detectChanges();

      const buttonAfter = fixture.nativeElement.querySelector(".panel-rules .btn-create") as HTMLButtonElement;
      expect(buttonAfter.disabled).toBeFalse();
      expect(fixture.nativeElement.querySelector(".panel-rules .period-banner")).toBeNull();
    });

    it("CA-020: params Crear button becomes enabled and banner disappears after activePeriodParams is set", () => {
      // Start with null — button disabled, banner present
      mockActivePeriodParams.set(null);
      const fixture = createComponent();
      fixture.detectChanges();

      const buttonBefore = fixture.nativeElement.querySelector(".panel-params .btn-create") as HTMLButtonElement;
      expect(buttonBefore.disabled).toBeTrue();
      expect(fixture.nativeElement.querySelector(".panel-params .period-banner")).toBeTruthy();

      // Mutate signal — Angular must react
      mockActivePeriodParams.set(makePeriod(5, "PARAMS"));
      fixture.detectChanges();

      const buttonAfter = fixture.nativeElement.querySelector(".panel-params .btn-create") as HTMLButtonElement;
      expect(buttonAfter.disabled).toBeFalse();
      expect(fixture.nativeElement.querySelector(".panel-params .period-banner")).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // FR-014 (W-04): Param edit payload immutability — spy on updateParam
  // -------------------------------------------------------------------------

  describe("FR-014: saveParam in edit mode sends original offer_date_id to updateParam", () => {
    it("updateParam payload carries original offer_date_id (not the active signal value)", () => {
      // Active signal = 9, but the param being edited has offer_date_id = 5
      mockActivePeriodParams.set(makePeriod(9, "PARAMS"));
      const fixture = createComponent();
      const component = fixture.componentInstance;

      const adminApi = TestBed.inject(AdminApiService);
      const updateSpy = spyOn(adminApi, "updateParam").and.callThrough();

      const row = {
        offerCode: "OFERTA_RESTRICTIVA",
        param: {
          param_id: 10,
          key: "EDIT_KEY",
          value: "edit_val",
          value_type: "STRING",
          offer_date_id: 5,
          enabled: true,
        },
      };
      component["editParam"](row);
      fixture.detectChanges();

      component["saveParam"]();

      expect(updateSpy).toHaveBeenCalledOnceWith(10, jasmine.objectContaining({ offer_date_id: 5 }));
    });
  });

  // -------------------------------------------------------------------------
  // T1.5: panel-offers removed — offerCode selects still populated (FR-102)
  // -------------------------------------------------------------------------

  describe("T1.5: panel-offers removed — offerCode selects in rule and param forms still populated", () => {
    it("no .panel-offers element exists in the configurator (panel removed)", () => {
      const fixture = createComponent();
      fixture.detectChanges();
      const panel = fixture.nativeElement.querySelector(".panel-offers");
      expect(panel).toBeNull();
    });

    it("rule form offerCode <select> lists offers from getOffers() signal (FR-102)", () => {
      mockActivePeriodRules.set(makePeriod(3));
      const fixture = createComponent();
      const component = fixture.componentInstance;
      // Verify offers signal is populated
      expect(component["offers"]().length).toBe(2);
      expect(component["offers"]()[0].offerCode).toBe("OFERTA_A");
    });

    it("param form offerCode <select> lists offers from getOffers() signal (FR-102)", () => {
      mockActivePeriodParams.set(makePeriod(5, "PARAMS"));
      const fixture = createComponent();
      const component = fixture.componentInstance;
      component["openCreateParamEditor"]();
      fixture.detectChanges();
      const selects = fixture.nativeElement.querySelectorAll(".panel-params .crud-form select") as NodeListOf<HTMLSelectElement>;
      // First select is offerCode
      const offerCodeSelect = Array.from(selects).find((s) => s.getAttribute("formcontrolname") === "offerCode");
      expect(offerCodeSelect).toBeTruthy();
      const options = offerCodeSelect!.querySelectorAll("option");
      // 2 offers loaded by mock
      expect(options.length).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // S-02: T13c extended — formatPeriodById open-ended and closed period display
  // -------------------------------------------------------------------------

  describe("S-02: formatPeriodById period display format", () => {
    it("T13c-ext: open-ended period (valid_to null) shows infinity symbol ∞", () => {
      const fixture = createComponent();
      const component = fixture.componentInstance;
      component["fechas"].set([makePeriod(7)]); // makePeriod uses valid_to: null
      fixture.detectChanges();
      const result = component["formatPeriodById"](7);
      expect(result).toContain("∞");
    });

    it("T13c-closed: closed period (valid_to not null) shows end date instead of ∞", () => {
      const fixture = createComponent();
      const component = fixture.componentInstance;
      const closedPeriod = { ...makePeriod(8), valid_to: "2026-06-30" };
      component["fechas"].set([closedPeriod]);
      fixture.detectChanges();
      const result = component["formatPeriodById"](8);
      expect(result).toContain("30/06/2026");
      expect(result).not.toContain("∞");
    });
  });

  // -------------------------------------------------------------------------
  // T2b.4 — Period-scoped offers panel (FR-101, FR-102, FR-103, FR-104)
  // -------------------------------------------------------------------------

  describe("T2b.4: period-scoped offers panel (FR-101 to FR-104)", () => {
    // CA-102: no active period → notice shown, no .panel-period-offers-table rendered
    it("CA-102: no activePeriodRules → notice 'Seleccioná un período activo' shown, table absent", () => {
      mockActivePeriodRules.set(null);
      const fixture = createComponent();
      fixture.detectChanges();
      const panel = fixture.nativeElement.querySelector(".panel-period-offers");
      // Panel exists in DOM (always rendered)
      expect(panel).toBeTruthy();
      // Notice element visible
      const notice = panel!.querySelector(".period-offers-notice");
      expect(notice).toBeTruthy();
      // Table NOT rendered when no active period
      const table = panel!.querySelector("table.period-offers-table");
      expect(table).toBeNull();
    });

    // CA-101: active period → table rendered, no notice
    it("CA-101: activePeriodRules set → table rendered, notice absent", () => {
      mockActivePeriodRules.set(makePeriod(3));
      const fixture = createComponent();
      fixture.detectChanges();
      const panel = fixture.nativeElement.querySelector(".panel-period-offers");
      expect(panel).toBeTruthy();
      const notice = panel!.querySelector(".period-offers-notice");
      expect(notice).toBeNull();
      const table = panel!.querySelector("table.period-offers-table");
      expect(table).toBeTruthy();
    });

    // FR-102: offerCode selects in rule/param forms use all offers (unfiltered)
    it("FR-102: offers() signal is populated for offerCode selects regardless of active period", () => {
      mockActivePeriodRules.set(makePeriod(3));
      const fixture = createComponent();
      const component = fixture.componentInstance;
      fixture.detectChanges();
      // offers signal must be populated (from unfiltered getOffers()) for <select> dropdowns
      expect(component["offers"]().length).toBe(2);
      expect(component["offerCodes"]()).toContain("OFERTA_A");
      expect(component["offerCodes"]()).toContain("OFERTA_B");
    });

    // Editar button opens edit form with offer data (FR-103)
    it("FR-103: Editar button opens editOffer flow for the offer", () => {
      mockActivePeriodRules.set(makePeriod(3));
      const fixture = createComponent();
      const component = fixture.componentInstance;
      // Manually populate periodOffers
      component["periodOffers"].set([makeOffer("OFERTA_A")]);
      fixture.detectChanges();
      const editBtn = fixture.nativeElement.querySelector(".panel-period-offers .btn-edit-offer");
      expect(editBtn).toBeTruthy();
      editBtn!.click();
      fixture.detectChanges();
      // offerForm should be populated with the offer's data
      expect(component["offerEditorMode"]()).toBe("edit");
    });

    // Borrar button opens confirm dialog with 'offer-period' variant (FR-104)
    it("FR-104: Borrar button opens confirmDialog with type offer-period", () => {
      mockActivePeriodRules.set(makePeriod(3));
      const fixture = createComponent();
      const component = fixture.componentInstance;
      component["periodOffers"].set([makeOffer("OFERTA_A")]);
      fixture.detectChanges();
      const deleteBtn = fixture.nativeElement.querySelector(".panel-period-offers .btn-delete-offer-period");
      expect(deleteBtn).toBeTruthy();
      deleteBtn!.click();
      fixture.detectChanges();
      const dialog = component["confirmDialog"]();
      expect(dialog).not.toBeNull();
      expect(dialog!.type).toBe("offer-period");
    });

    // CA-109: confirm dialog text explicitly mentions 'período activo'
    it("CA-109: confirm dialog message for offer-period contains 'período activo'", () => {
      mockActivePeriodRules.set(makePeriod(3));
      const fixture = createComponent();
      const component = fixture.componentInstance;
      component["periodOffers"].set([makeOffer("OFERTA_A")]);
      fixture.detectChanges();
      const deleteBtn = fixture.nativeElement.querySelector(".panel-period-offers .btn-delete-offer-period");
      deleteBtn!.click();
      fixture.detectChanges();
      const dialog = component["confirmDialog"]();
      expect(dialog!.message.toLowerCase()).toContain("período activo");
    });

    // CA-106: executeOfferPeriodDelete calls deleteOfferRulesInPeriod with correct args
    it("CA-106: executeOfferPeriodDelete calls deleteOfferRulesInPeriod(offerCode, offerDateId)", () => {
      mockActivePeriodRules.set(makePeriod(5));
      const fixture = createComponent();
      const component = fixture.componentInstance;
      const adminApi = TestBed.inject(AdminApiService);
      const deleteSpy = spyOn(adminApi, "deleteOfferRulesInPeriod").and.callThrough();
      component["periodOffers"].set([makeOffer("OFERTA_A")]);
      fixture.detectChanges();

      const deleteBtn = fixture.nativeElement.querySelector(".panel-period-offers .btn-delete-offer-period");
      deleteBtn!.click();
      fixture.detectChanges();
      component["confirmDialogAction"]();
      fixture.detectChanges();

      expect(deleteSpy).toHaveBeenCalledOnceWith("OFERTA_A", 5);
    });

    // After successful delete → periodOffers refreshed via loadPeriodOffers
    it("after executeOfferPeriodDelete success → loadPeriodOffers() is called", () => {
      mockActivePeriodRules.set(makePeriod(5));
      const fixture = createComponent();
      const component = fixture.componentInstance;
      const adminApi = TestBed.inject(AdminApiService);
      spyOn(adminApi, "deleteOfferRulesInPeriod").and.callThrough();
      const loadPeriodOffersSpy = spyOn(component as unknown as { loadPeriodOffers(): void }, "loadPeriodOffers").and.callThrough();
      component["periodOffers"].set([makeOffer("OFERTA_A")]);
      fixture.detectChanges();

      const deleteBtn = fixture.nativeElement.querySelector(".panel-period-offers .btn-delete-offer-period");
      deleteBtn!.click();
      fixture.detectChanges();
      component["confirmDialogAction"]();
      fixture.detectChanges();

      // After successful delete, loadPeriodOffers() is called to refresh the panel
      expect(loadPeriodOffersSpy).toHaveBeenCalled();
    });
  });

  describe("T4.7: seed-reset button + dialog (env-flag gated)", () => {
    let originalEnableSeedReset: boolean;

    beforeEach(() => {
      originalEnableSeedReset = environment.enableSeedReset;
    });

    afterEach(() => {
      environment.enableSeedReset = originalEnableSeedReset;
    });

    it("T4.7a: button is NOT rendered when environment.enableSeedReset is false", () => {
      environment.enableSeedReset = false;
      const fixture = createComponent();
      fixture.detectChanges();
      const button = fixture.nativeElement.querySelector(".btn-reset-seed");
      expect(button).toBeNull();
    });

    it("T4.7b: button IS rendered when environment.enableSeedReset is true", () => {
      environment.enableSeedReset = true;
      const fixture = createComponent();
      fixture.detectChanges();
      const button = fixture.nativeElement.querySelector(".btn-reset-seed");
      expect(button).toBeTruthy();
    });

    it("T4.7c: clicking the button opens confirmDialog with type reset-seed", () => {
      environment.enableSeedReset = true;
      const fixture = createComponent();
      const component = fixture.componentInstance;
      fixture.detectChanges();
      const button = fixture.nativeElement.querySelector(".btn-reset-seed") as HTMLButtonElement;
      button.click();
      fixture.detectChanges();
      const dialog = component["confirmDialog"]();
      expect(dialog).not.toBeNull();
      expect(dialog!.type).toBe("reset-seed");
    });

    it("T4.7d: dialog copy accurately warns of full-scope deletion", () => {
      environment.enableSeedReset = true;
      const fixture = createComponent();
      const component = fixture.componentInstance;
      fixture.detectChanges();
      component["openResetSeedDialog"]();
      fixture.detectChanges();
      const dialog = component["confirmDialog"]();
      const message = dialog!.message.toLowerCase();
      expect(message).toContain("eliminara permanentemente");
      expect(message).toContain("periodo de vigencia");
    });

    it("T4.7e: confirming without a comment blocks the request and shows an error", () => {
      environment.enableSeedReset = true;
      const fixture = createComponent();
      const component = fixture.componentInstance;
      const adminApi = TestBed.inject(AdminApiService);
      const resetSpy = spyOn(adminApi, "resetSeed").and.callThrough();
      fixture.detectChanges();
      component["openResetSeedDialog"]();
      fixture.detectChanges();
      component["confirmDialogAction"]();
      fixture.detectChanges();
      expect(resetSpy).not.toHaveBeenCalled();
      expect(component["resetSeedCommentError"]()).toBeTruthy();
      expect(component["confirmDialog"]()).not.toBeNull();
    });

    it("T4.7f: confirming with a comment calls resetSeed() and refreshes data", () => {
      environment.enableSeedReset = true;
      const fixture = createComponent();
      const component = fixture.componentInstance;
      const adminApi = TestBed.inject(AdminApiService);
      const resetSpy = spyOn(adminApi, "resetSeed").and.callThrough();
      // permissive-config-readonly: applyFilters()'s loadRules() now reads via
      // PublicConfigApiService, not AdminApiService — spy on the new service.
      const publicConfigApi = TestBed.inject(PublicConfigApiService);
      const getRulesSpy = spyOn(publicConfigApi, "getRules").and.callThrough();
      fixture.detectChanges();
      const rulesCallsBefore = getRulesSpy.calls.count();
      component["openResetSeedDialog"]();
      component["resetSeedComment"].set("Restaurar antes de pruebas");
      fixture.detectChanges();
      component["confirmDialogAction"]();
      fixture.detectChanges();
      expect(resetSpy).toHaveBeenCalledTimes(1);
      expect(resetSpy.calls.mostRecent().args[0]).toEqual(
        jasmine.objectContaining({ comment: "Restaurar antes de pruebas" }),
      );
      expect(component["confirmDialog"]()).toBeNull();
      expect(getRulesSpy.calls.count()).toBeGreaterThan(rulesCallsBefore);
    });

    it("T4.7g: cancelling the dialog sends no request", () => {
      environment.enableSeedReset = true;
      const fixture = createComponent();
      const component = fixture.componentInstance;
      const adminApi = TestBed.inject(AdminApiService);
      const resetSpy = spyOn(adminApi, "resetSeed").and.callThrough();
      fixture.detectChanges();
      component["openResetSeedDialog"]();
      fixture.detectChanges();
      component["closeConfirmDialog"]();
      fixture.detectChanges();
      expect(resetSpy).not.toHaveBeenCalled();
      expect(component["confirmDialog"]()).toBeNull();
    });

    it("T4.7h: a successful reset clears both active-period selections (rules + params)", () => {
      environment.enableSeedReset = true;
      mockActivePeriodRules.set(makePeriod(3, "REGLAS"));
      mockActivePeriodParams.set(makePeriod(4, "PARAMS"));
      const fixture = createComponent();
      const component = fixture.componentInstance;
      fixture.detectChanges();
      component["openResetSeedDialog"]();
      component["resetSeedComment"].set("Restaurar antes de pruebas");
      fixture.detectChanges();
      component["confirmDialogAction"]();
      fixture.detectChanges();
      expect(mockActivePeriodRules()).toBeNull();
      expect(mockActivePeriodParams()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // WU-08 (PR2, config-apply-safeguard): "Grabar configuracion" dialog exige
  // previsualizacion de impacto antes de habilitar la confirmacion.
  // -------------------------------------------------------------------------

  describe("WU-08 (PR2): previsualizacion de impacto en el dialogo de Grabar configuracion", () => {
    function fakeRule(offerCode = "OFERTA_A"): AdminRuleItem {
      return {
        rule_id: 1,
        offerCode,
        stage: "PRE",
        rule_name: "Regla importada",
        priority: 900,
        enabled: true,
        stop_processing: false,
        offer_date_id: null,
        actions: [],
        conditions: [],
      };
    }

    function fakeImpact(): ApplyImpact {
      return {
        offerCodes: ["OFERTA_A"],
        rulesToDelete: 2,
        paramsToDelete: 1,
        rulesToInsert: 1,
        paramsToInsert: 0,
        perOffer: [
          { offerCode: "OFERTA_A", rulesToDelete: 2, paramsToDelete: 1, rulesToInsert: 1, paramsToInsert: 0 },
        ],
      };
    }

    it("openApplyConfigDialog calls previewApply with the imported rules/params", () => {
      const fixture = createComponent();
      const component = fixture.componentInstance;
      const adminApi = TestBed.inject(AdminApiService);
      const previewSpy = spyOn(adminApi, "previewApply").and.callThrough();

      component["importedConfig"].set({ rules: [fakeRule()], params: null });
      component["openApplyConfigDialog"]();
      fixture.detectChanges();

      expect(previewSpy).toHaveBeenCalledOnceWith(
        jasmine.objectContaining({ rules: [fakeRule()] }),
      );
    });

    it("confirm button stays disabled while the preview has not resolved yet", () => {
      const fixture = createComponent();
      const component = fixture.componentInstance;
      const adminApi = TestBed.inject(AdminApiService);
      const pending$ = new Subject<ApplyImpact>();
      spyOn(adminApi, "previewApply").and.returnValue(pending$.asObservable());

      component["importedConfig"].set({ rules: [fakeRule()], params: null });
      component["openApplyConfigDialog"]();
      fixture.detectChanges();

      expect(component["isConfirmActionPending"]()).toBeTrue();

      pending$.next(fakeImpact());
      pending$.complete();
      fixture.detectChanges();

      expect(component["isConfirmActionPending"]()).toBeFalse();
    });

    it("renders the impact summary (offerCodes + counts) once the preview resolves", () => {
      const fixture = createComponent();
      const component = fixture.componentInstance;

      component["importedConfig"].set({ rules: [fakeRule()], params: null });
      component["openApplyConfigDialog"]();
      fixture.detectChanges();

      const impact = component["applyImpactPreview"]();
      expect(impact).not.toBeNull();
      expect(impact!.offerCodes).toEqual(["OFERTA_A"]);
      expect(impact!.rulesToDelete).toBe(2);

      const modal = fixture.nativeElement.querySelector(".confirm-modal");
      expect(modal.textContent).toContain("OFERTA_A");
    });

    it("confirming sends confirmReplaceAll:true to applyConfig, alongside comment", () => {
      const fixture = createComponent();
      const component = fixture.componentInstance;
      const adminApi = TestBed.inject(AdminApiService);
      const applySpy = spyOn(adminApi, "applyConfig").and.callThrough();

      component["importedConfig"].set({ rules: [fakeRule()], params: null });
      component["openApplyConfigDialog"]();
      fixture.detectChanges();

      component["applyConfigComment"].set("Motivo de prueba PR2");
      component["confirmDialogAction"]();
      fixture.detectChanges();

      expect(applySpy).toHaveBeenCalledOnceWith(
        jasmine.objectContaining({ confirmReplaceAll: true, comment: "Motivo de prueba PR2" }),
      );
    });

    it("Fix 3: a stale preview from a closed-then-reopened dialog does not overwrite a newer preview (out-of-order responses)", () => {
      const fixture = createComponent();
      const component = fixture.componentInstance;
      const adminApi = TestBed.inject(AdminApiService);

      const previewA$ = new Subject<ApplyImpact>();
      const previewB$ = new Subject<ApplyImpact>();
      const previewSpy = spyOn(adminApi, "previewApply");
      previewSpy.and.returnValue(previewA$.asObservable());

      // Open dialog #1 — fires preview A, does not resolve yet.
      component["importedConfig"].set({ rules: [fakeRule("OFERTA_A")], params: null });
      component["openApplyConfigDialog"]();
      fixture.detectChanges();

      // Close before A resolves.
      component["closeConfirmDialog"]();
      fixture.detectChanges();

      // Reopen with different imported data — fires preview B.
      previewSpy.and.returnValue(previewB$.asObservable());
      component["importedConfig"].set({ rules: [fakeRule("OFERTA_B")], params: null });
      component["openApplyConfigDialog"]();
      fixture.detectChanges();

      const impactB: ApplyImpact = {
        offerCodes: ["OFERTA_B"],
        rulesToDelete: 5,
        paramsToDelete: 3,
        rulesToInsert: 1,
        paramsToInsert: 0,
        perOffer: [
          { offerCode: "OFERTA_B", rulesToDelete: 5, paramsToDelete: 3, rulesToInsert: 1, paramsToInsert: 0 },
        ],
      };
      previewB$.next(impactB);
      fixture.detectChanges();

      // A resolves late, out of order, AFTER B already landed — must be ignored.
      previewA$.next({
        offerCodes: ["OFERTA_A"],
        rulesToDelete: 99,
        paramsToDelete: 99,
        rulesToInsert: 99,
        paramsToInsert: 99,
        perOffer: [],
      });
      fixture.detectChanges();

      expect(component["applyImpactPreview"]()).toEqual(impactB);
    });
  });
});
