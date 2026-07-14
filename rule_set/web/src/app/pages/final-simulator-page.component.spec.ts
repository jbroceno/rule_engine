import { ComponentFixture, TestBed } from "@angular/core/testing";
import { of, throwError } from "rxjs";

import { FinalSimulatorPageComponent } from "./final-simulator-page.component";
import { ApiError, ApiService } from "../services/api.service";
import { FinalFormValues, PreFormValues, SimulatorFormSubmit } from "../shared/simulator-form/simulator-form.component";

// ---------------------------------------------------------------------------
// Fix (code review follow-up, 2026-07-15 — closing WARNING from
// verify-report-final #66): same stale-error-banner-vs-async-redirect race as
// the other 3 read-only pages. This component has TWO HTTP error handlers
// that could race the redirect: the constructor's getConfig() (loads the
// offers list on page mount) and onFormSubmit()'s simulateFinal() call. Fix:
// skip setting the local error state for 401 in BOTH handlers (already
// handled by authInterceptor's logout+redirect); keep it for other errors.
// ---------------------------------------------------------------------------

const preValues: PreFormValues = {
  numTitulares: 1,
  edadT1: 35,
  antiguedadT1: 24,
  domiciliaNominaT1: false,
  ingresosT1: 2500,
  pagasT1: 14,
  edadT2: 0,
  antiguedadT2: 0,
  domiciliaNominaT2: false,
  ingresosT2: 0,
  pagasT2: 14,
  finalidad: 1,
  primeraViviendaHabitual: true,
  tipoAlta: "COMPRA",
  importeVivienda: 200000,
  importeVentaCA: 0,
  chained: false,
};

const finalValues: FinalFormValues = { importeHipoteca: 150000, plazo: 240 };

const submitEvent: SimulatorFormSubmit = { phase: "FINAL", preValues, finalValues };

function createComponent(): ComponentFixture<FinalSimulatorPageComponent> {
  const fixture = TestBed.createComponent(FinalSimulatorPageComponent);
  fixture.detectChanges();
  return fixture;
}

describe("FinalSimulatorPageComponent — 401 error-banner race fix", () => {
  describe("constructor's getConfig() (offers list load on mount)", () => {
    async function setupTestBed(err: ApiError) {
      await TestBed.configureTestingModule({
        imports: [FinalSimulatorPageComponent],
        providers: [
          {
            provide: ApiService,
            useValue: { getConfig: () => throwError(() => err), simulateFinal: () => of() },
          },
        ],
      }).compileComponents();
    }

    it("does NOT set the local error message when getConfig() fails with 401 on mount", async () => {
      await setupTestBed(new ApiError("No autorizado.", 401));
      const fixture = createComponent();
      const component = fixture.componentInstance as unknown as { error: () => string | null };
      expect(component.error()).toBeNull();
    });

    it("STILL sets the local error message for a non-401 error on mount (e.g. 500)", async () => {
      await setupTestBed(new ApiError("Error interno del servidor.", 500));
      const fixture = createComponent();
      const component = fixture.componentInstance as unknown as { error: () => string | null };
      expect(component.error()).toContain("Error interno del servidor.");
    });
  });

  describe("onFormSubmit()'s simulateFinal()", () => {
    async function setupTestBed(err: ApiError) {
      await TestBed.configureTestingModule({
        imports: [FinalSimulatorPageComponent],
        providers: [
          {
            provide: ApiService,
            useValue: { getConfig: () => of({ offers: [] }), simulateFinal: () => throwError(() => err) },
          },
        ],
      }).compileComponents();
    }

    it("does NOT set the local error message when simulateFinal() fails with 401", async () => {
      await setupTestBed(new ApiError("No autorizado.", 401));
      const fixture = createComponent();
      const component = fixture.componentInstance as unknown as {
        error: () => string | null;
        onFormSubmit: (event: SimulatorFormSubmit) => void;
      };

      component.onFormSubmit(submitEvent);

      expect(component.error()).toBeNull();
    });

    it("STILL sets the local error message for a non-401 error (e.g. 500)", async () => {
      await setupTestBed(new ApiError("Error interno del servidor.", 500));
      const fixture = createComponent();
      const component = fixture.componentInstance as unknown as {
        error: () => string | null;
        onFormSubmit: (event: SimulatorFormSubmit) => void;
      };

      component.onFormSubmit(submitEvent);

      expect(component.error()).toBe("Error interno del servidor.");
    });
  });
});
