import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { of, throwError } from "rxjs";

import { OfertasPageComponent } from "./ofertas-page.component";
import { AdminApiService } from "../services/admin-api.service";
import { AdminOffer } from "../models/admin.models";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOffer(code: string, enabled = true): AdminOffer {
  return {
    ruleset_id: 1,
    offerCode: code,
    name: `Oferta ${code}`,
    offer_rank: 100,
    enabled,
    oferta_id: 1,
  };
}

// ---------------------------------------------------------------------------
// Mock service
// ---------------------------------------------------------------------------

function buildAdminApiMock() {
  return {
    getOffers: () => of({ items: [makeOffer("OFERTA_A"), makeOffer("OFERTA_B")] }),
    createOffer: (_payload: unknown) => of({ ruleset_id: 1, offerCode: "NUEVA" }),
    updateOffer: (_code: string, _payload: unknown) => of({ offerCode: "OFERTA_A", updated: true }),
    deleteOffer: (_code: string) =>
      of({ deleted: true, offerCode: "OFERTA_A", snapshot_id: 42, deletedRules: 3, deletedParams: 1 }),
    setOfferEnabled: (_code: string, _enabled: boolean) => of({ enabled: true }),
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

async function setupTestBed(apiMock = buildAdminApiMock()) {
  await TestBed.configureTestingModule({
    imports: [OfertasPageComponent],
    providers: [
      provideRouter([]),
      { provide: AdminApiService, useValue: apiMock },
    ],
  }).compileComponents();
}

function createComponent(): ComponentFixture<OfertasPageComponent> {
  const fixture = TestBed.createComponent(OfertasPageComponent);
  fixture.detectChanges();
  return fixture;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("OfertasPageComponent", () => {
  // -------------------------------------------------------------------------
  // T1.1-A: Smoke
  // -------------------------------------------------------------------------

  describe("smoke", () => {
    beforeEach(async () => {
      await setupTestBed();
    });

    it("should create without errors (CA-001)", () => {
      const fixture = createComponent();
      expect(fixture.componentInstance).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // T1.1-B: FR-002 — Listado de ofertas
  // -------------------------------------------------------------------------

  describe("FR-002: offer list", () => {
    beforeEach(async () => {
      await setupTestBed();
    });

    it("renders offer rows for each item returned by the API (CA-003)", () => {
      const fixture = createComponent();
      fixture.detectChanges();
      const rows = fixture.nativeElement.querySelectorAll("table tbody tr") as NodeListOf<HTMLElement>;
      expect(rows.length).toBe(2);
    });

    it("shows 'No hay ofertas configuradas' when list is empty (CA-003 empty)", async () => {
      await setupTestBed({
        ...buildAdminApiMock(),
        getOffers: () => of({ items: [] }),
      });
      const fixture = createComponent();
      fixture.detectChanges();
      const emptyMsg = fixture.nativeElement.textContent as string;
      expect(emptyMsg).toContain("No hay ofertas");
    });
  });

  // -------------------------------------------------------------------------
  // T1.1-C: FR-003 — Crear oferta (inline form)
  // -------------------------------------------------------------------------

  describe("FR-003: create offer", () => {
    beforeEach(async () => {
      await setupTestBed();
    });

    it("opens inline create form on 'Crear' click", () => {
      const fixture = createComponent();
      fixture.detectChanges();
      const crearBtn = fixture.nativeElement.querySelector(".btn-create") as HTMLButtonElement;
      crearBtn.click();
      fixture.detectChanges();
      const form = fixture.nativeElement.querySelector(".crud-form");
      expect(form).toBeTruthy();
    });

    it("closes form on 'Cancelar' click (CA-009 analog)", () => {
      const fixture = createComponent();
      fixture.detectChanges();
      const crearBtn = fixture.nativeElement.querySelector(".btn-create") as HTMLButtonElement;
      crearBtn.click();
      fixture.detectChanges();
      const cancelBtn = fixture.nativeElement.querySelector(".crud-form .btn-ghost") as HTMLButtonElement;
      cancelBtn.click();
      fixture.detectChanges();
      const form = fixture.nativeElement.querySelector(".crud-form");
      expect(form).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // T1.1-D: FR-006 — Confirm dialog for delete (CA-008, CA-009, CA-010)
  // -------------------------------------------------------------------------

  describe("FR-006: delete cascade confirm dialog", () => {
    beforeEach(async () => {
      await setupTestBed();
    });

    it("opens confirm dialog with 'todos los períodos' text when delete is clicked (CA-010)", () => {
      const fixture = createComponent();
      fixture.detectChanges();
      // Click delete button on first row
      const deleteBtn = fixture.nativeElement.querySelector(
        "table tbody tr .action-danger"
      ) as HTMLButtonElement;
      expect(deleteBtn).toBeTruthy();
      deleteBtn.click();
      fixture.detectChanges();
      const modal = fixture.nativeElement.querySelector(".confirm-modal");
      expect(modal).toBeTruthy();
      expect((modal as HTMLElement).textContent).toContain("todos los períodos");
    });

    it("closes confirm dialog on 'Cancelar' without calling deleteOffer (CA-009)", () => {
      const fixture = createComponent();
      fixture.detectChanges();
      const deleteBtn = fixture.nativeElement.querySelector(
        "table tbody tr .action-danger"
      ) as HTMLButtonElement;
      deleteBtn.click();
      fixture.detectChanges();
      const cancelBtn = fixture.nativeElement.querySelector(
        ".confirm-modal .btn-ghost"
      ) as HTMLButtonElement;
      const adminApi = TestBed.inject(AdminApiService);
      const deleteSpy = spyOn(adminApi, "deleteOffer").and.callThrough();
      cancelBtn.click();
      fixture.detectChanges();
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(fixture.nativeElement.querySelector(".confirm-modal")).toBeNull();
    });

    it("calls deleteOffer and reloads after confirm (CA-008)", () => {
      const adminApi = TestBed.inject(AdminApiService);
      const deleteSpy = spyOn(adminApi, "deleteOffer").and.callThrough();
      const loadSpy = spyOn(adminApi, "getOffers").and.callThrough();

      const fixture = createComponent();
      fixture.detectChanges();
      const deleteBtn = fixture.nativeElement.querySelector(
        "table tbody tr .action-danger"
      ) as HTMLButtonElement;
      deleteBtn.click();
      fixture.detectChanges();
      const confirmBtn = fixture.nativeElement.querySelector(
        ".confirm-modal .btn-danger"
      ) as HTMLButtonElement;
      confirmBtn.click();
      fixture.detectChanges();
      expect(deleteSpy).toHaveBeenCalledWith("OFERTA_A");
      // getOffers called on init + after delete
      expect(loadSpy).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // T1.1-E: FR-005 — Toggle enabled/disabled (CA-007)
  // -------------------------------------------------------------------------

  describe("FR-005: toggle enabled/disabled (CA-007)", () => {
    beforeEach(async () => {
      await setupTestBed();
    });

    it("calls setOfferEnabled with toggled value when toggle button clicked (CA-007)", () => {
      const adminApi = TestBed.inject(AdminApiService);
      const toggleSpy = spyOn(adminApi, "setOfferEnabled").and.callThrough();

      const fixture = createComponent();
      fixture.detectChanges();
      // Toggle button is the second icon button in first row (edit=0, toggle=1, delete=2)
      const buttons = fixture.nativeElement.querySelectorAll(
        "table tbody tr .row-actions .btn-ghost:not(.action-danger)"
      ) as NodeListOf<HTMLButtonElement>;
      // Second btn is toggle (index 1)
      buttons[1].click();
      fixture.detectChanges();
      expect(toggleSpy).toHaveBeenCalledWith("OFERTA_A", false); // enabled=true → toggled to false
    });
  });

  // -------------------------------------------------------------------------
  // T1.1-F: FR-004 — Edit opens form prefilled (CA-006)
  // -------------------------------------------------------------------------

  describe("FR-004: edit offer", () => {
    beforeEach(async () => {
      await setupTestBed();
    });

    it("opens inline edit form with existing values when edit is clicked (CA-006)", () => {
      const fixture = createComponent();
      fixture.detectChanges();
      const editBtn = fixture.nativeElement.querySelector(
        "table tbody tr .row-actions .btn-ghost:not(.action-danger)"
      ) as HTMLButtonElement;
      editBtn.click(); // first btn = edit
      fixture.detectChanges();
      const form = fixture.nativeElement.querySelector(".crud-form");
      expect(form).toBeTruthy();
      const codeInput = fixture.nativeElement.querySelector(
        ".crud-form input[formcontrolname='code']"
      ) as HTMLInputElement;
      expect(codeInput).toBeTruthy();
      expect(codeInput.value).toBe("OFERTA_A");
    });
  });

  // -------------------------------------------------------------------------
  // T1.1-G: Error handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("shows error message when getOffers fails", async () => {
      await setupTestBed({
        ...buildAdminApiMock(),
        getOffers: () => throwError(() => new Error("Error de red")),
      });
      const fixture = createComponent();
      fixture.detectChanges();
      const errorMsg = fixture.nativeElement.querySelector(".state.error");
      expect(errorMsg).toBeTruthy();
      expect((errorMsg as HTMLElement).textContent).toContain("Error de red");
    });
  });
});
