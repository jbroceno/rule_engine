/**
 * WU-09 specs — RED-first (Karma/Jasmine)
 *
 * Covers:
 *  - 9.1  toVigenciaString helper: appends :00 when seconds absent, preserves
 *         when present, never calls .toISOString()
 *  - 9.2  openEdit: no longer truncates at 10 chars (time is preserved)
 *  - 9.3  HTML inputs render as datetime-local with step="1"
 *  - ADR-005, RF-COD-03/05, CA-COD-006/007
 */

import { ComponentFixture, TestBed } from "@angular/core/testing";
import { signal } from "@angular/core";
import { of } from "rxjs";

import { OfferDatesPageComponent } from "./offer-dates-page.component";
import { AdminApiService } from "../services/admin-api.service";
import { PublicConfigApiService } from "../services/public-config-api.service";
import { ActivePeriodService } from "../services/active-period.service";
import { AdminFechaItem } from "../models/admin.models";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFecha(overrides: Partial<AdminFechaItem> = {}): AdminFechaItem {
  return {
    offer_date_id: 1,
    valid_from: "2026-03-15T14:32:07",
    valid_to: "2026-06-30T23:59:59",
    descripcion: "Test period",
    tipo_cd: "REGLAS",
    alta_usr: "test_user",
    alta_dt: "2026-01-01T10:00:00",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock services
// ---------------------------------------------------------------------------

function buildAdminApiMock() {
  return {
    getFechas: jasmine.createSpy("adminApi.getFechas").and.returnValue(of({ items: [] })),
    createFecha: () => of({ offer_date_id: 1 }),
    updateFecha: () => of({ offer_date_id: 1, updated: true }),
    deleteFecha: () => of({ offer_date_id: 1, deleted: true }),
    duplicateFecha: () => of({ offer_date_id: 2 }),
  };
}

// ---------------------------------------------------------------------------
// permissive-config-readonly (PR 2, frontend infra) — ADR-CR5: the READ call
// (loadFechas) must go through the new public-adjacent PublicConfigApiService,
// not AdminApiService. AdminApiService is retained for every WRITE method
// above (createFecha/updateFecha/deleteFecha/duplicateFecha).
// ---------------------------------------------------------------------------
function buildPublicConfigApiMock() {
  return {
    getFechas: jasmine.createSpy("publicConfigApi.getFechas").and.returnValue(of({ items: [] })),
  };
}

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

let mockAdminApi: ReturnType<typeof buildAdminApiMock>;
let mockPublicConfigApi: ReturnType<typeof buildPublicConfigApiMock>;

async function setupTestBed() {
  mockActivePeriodRules = signal<AdminFechaItem | null>(null);
  mockActivePeriodParams = signal<AdminFechaItem | null>(null);
  mockAdminApi = buildAdminApiMock();
  mockPublicConfigApi = buildPublicConfigApiMock();

  await TestBed.configureTestingModule({
    imports: [OfferDatesPageComponent],
    providers: [
      { provide: AdminApiService, useValue: mockAdminApi },
      { provide: PublicConfigApiService, useValue: mockPublicConfigApi },
      { provide: ActivePeriodService, useValue: buildActivePeriodMock() },
    ],
  }).compileComponents();
}

function createComponent(): ComponentFixture<OfferDatesPageComponent> {
  const fixture = TestBed.createComponent(OfferDatesPageComponent);
  fixture.detectChanges();
  return fixture;
}

// ---------------------------------------------------------------------------
// WU-09.1 — toVigenciaString helper
// ---------------------------------------------------------------------------

describe("OfferDatesPageComponent", () => {
  beforeEach(async () => {
    await setupTestBed();
  });

  it("WU-09 smoke: should create component without errors", () => {
    const fixture = createComponent();
    expect(fixture.componentInstance).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // permissive-config-readonly (PR 2, frontend infra) — ADR-CR5
  // ---------------------------------------------------------------------------
  describe("permissive-config-readonly: loadFechas reads via PublicConfigApiService", () => {
    it("ngOnInit's loadFechas calls PublicConfigApiService.getFechas, not AdminApiService.getFechas", () => {
      createComponent();
      expect(mockPublicConfigApi.getFechas).toHaveBeenCalled();
      expect(mockAdminApi.getFechas).not.toHaveBeenCalled();
    });
  });

  describe("WU-09.1: toVigenciaString", () => {
    it("T1: appends :00 when seconds are absent (YYYY-MM-DDTHH:mm format)", () => {
      const fixture = createComponent();
      const component = fixture.componentInstance;
      const result = (component as unknown as Record<string, (v: string) => string>)["toVigenciaString"]("2026-03-15T14:32");
      expect(result).toBe("2026-03-15T14:32:00");
    });

    it("T2: preserves seconds when already present (YYYY-MM-DDTHH:mm:ss format)", () => {
      const fixture = createComponent();
      const component = fixture.componentInstance;
      const result = (component as unknown as Record<string, (v: string) => string>)["toVigenciaString"]("2026-03-15T14:32:07");
      expect(result).toBe("2026-03-15T14:32:07");
    });

    it("T3: never calls .toISOString() — result has no Z suffix", () => {
      const fixture = createComponent();
      const component = fixture.componentInstance;
      const result = (component as unknown as Record<string, (v: string) => string>)["toVigenciaString"]("2026-03-15T14:32");
      expect(result.endsWith("Z")).toBeFalse();
      expect(result).not.toContain("Z");
    });

    it("T4: returns empty string when input is empty", () => {
      const fixture = createComponent();
      const component = fixture.componentInstance;
      const result = (component as unknown as Record<string, (v: string) => string>)["toVigenciaString"]("");
      expect(result).toBe("");
    });

    it("T5: handles value with non-zero seconds — must not add extra :00", () => {
      const fixture = createComponent();
      const component = fixture.componentInstance;
      const result = (component as unknown as Record<string, (v: string) => string>)["toVigenciaString"]("2026-01-01T00:00:59");
      expect(result).toBe("2026-01-01T00:00:59");
    });
  });

  // ---------------------------------------------------------------------------
  // WU-09.2 — openEdit preserves time component (no substring(0, 10) truncation)
  // ---------------------------------------------------------------------------

  describe("WU-09.2: openEdit does NOT truncate time", () => {
    it("T6: openEdit with valid_from YYYY-MM-DDTHH:mm:ss keeps time in form value", () => {
      const fixture = createComponent();
      const component = fixture.componentInstance;
      const fecha = makeFecha({ valid_from: "2026-03-15T14:32:07", valid_to: null });
      component["openEdit"](fecha);
      const formVal = component["form"].value["valid_from"];
      expect(formVal).toContain("14:32:07");
      expect(formVal).not.toBe("2026-03-15");
    });

    it("T7: openEdit with valid_to preserves the time component", () => {
      const fixture = createComponent();
      const component = fixture.componentInstance;
      const fecha = makeFecha({ valid_from: "2026-03-15T14:32:07", valid_to: "2026-06-30T23:59:59" });
      component["openEdit"](fecha);
      const formVal = component["form"].value["valid_to"];
      expect(formVal).toContain("23:59:59");
      expect(formVal).not.toBe("2026-06-30");
    });

    it("T8: openEdit with null valid_to sets empty string in form", () => {
      const fixture = createComponent();
      const component = fixture.componentInstance;
      const fecha = makeFecha({ valid_from: "2026-03-15T14:32:07", valid_to: null });
      component["openEdit"](fecha);
      const formVal = component["form"].value["valid_to"];
      expect(formVal).toBe("");
    });

    it("T9: openEdit handles space-separated datetime (YYYY-MM-DD HH:mm:ss) by replacing space with T", () => {
      const fixture = createComponent();
      const component = fixture.componentInstance;
      const fecha = makeFecha({ valid_from: "2026-03-15 14:32:07", valid_to: null });
      component["openEdit"](fecha);
      const formVal = component["form"].value["valid_from"];
      expect(formVal).toContain("T");
      expect(formVal).toContain("14:32:07");
    });
  });

  // ---------------------------------------------------------------------------
  // WU-09.3 — HTML inputs render as datetime-local with step="1"
  // ---------------------------------------------------------------------------

  describe("WU-09.3: create/edit dialog inputs are datetime-local with step=1", () => {
    it("T10: valid_from input in create/edit dialog is type=datetime-local", () => {
      const fixture = createComponent();
      const component = fixture.componentInstance;
      component["openCreate"]();
      fixture.detectChanges();
      const input: HTMLInputElement | null = fixture.nativeElement.querySelector(
        ".confirm-modal input[formcontrolname='valid_from']"
      );
      expect(input).toBeTruthy();
      expect(input!.type).toBe("datetime-local");
    });

    it("T11: valid_from input has step attribute set to 1", () => {
      const fixture = createComponent();
      const component = fixture.componentInstance;
      component["openCreate"]();
      fixture.detectChanges();
      const input: HTMLInputElement | null = fixture.nativeElement.querySelector(
        ".confirm-modal input[formcontrolname='valid_from']"
      );
      expect(input).toBeTruthy();
      expect(input!.step).toBe("1");
    });

    it("T12: valid_to input in create/edit dialog is type=datetime-local", () => {
      const fixture = createComponent();
      const component = fixture.componentInstance;
      component["openCreate"]();
      fixture.detectChanges();
      const input: HTMLInputElement | null = fixture.nativeElement.querySelector(
        ".confirm-modal input[formcontrolname='valid_to']"
      );
      expect(input).toBeTruthy();
      expect(input!.type).toBe("datetime-local");
    });

    it("T13: duplicate-dialog input is type=datetime-local", () => {
      const fixture = createComponent();
      const component = fixture.componentInstance;
      const fecha = makeFecha();
      component["openDuplicate"](fecha);
      fixture.detectChanges();
      const input: HTMLInputElement | null = fixture.nativeElement.querySelector(
        ".confirm-modal input[type='datetime-local']"
      );
      expect(input).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // WU-09.3 — Display pipes show HH:mm:ss in table
  // (checked via component signal binding, not live pipe output)
  // ---------------------------------------------------------------------------

  describe("WU-09.3: display pipe format — valid_from/valid_to table cells show time", () => {
    it("T14: date pipe format includes HH:mm:ss — template uses dd/MM/yyyy HH:mm:ss for valid_from", () => {
      // We verify the template text by rendering a row and checking the cell contains time
      const fixture = createComponent();
      const component = fixture.componentInstance;
      component["fechas"].set([makeFecha({ valid_from: "2026-03-15T14:32:07", valid_to: null })]);
      fixture.detectChanges();

      const rows = fixture.nativeElement.querySelectorAll("tbody tr");
      expect(rows.length).toBeGreaterThan(0);
      const firstRow: HTMLElement = rows[0];
      // The second <td> is "Desde" — should contain time
      const cells = firstRow.querySelectorAll("td");
      const desdeTd: HTMLElement = cells[1];
      // Angular date pipe with 'dd/MM/yyyy HH:mm:ss' and input "2026-03-15T14:32:07"
      // should produce "15/03/2026 14:32:07"
      expect(desdeTd.textContent).toContain("14:32:07");
    });
  });
});
