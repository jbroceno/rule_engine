import { ComponentFixture, TestBed } from "@angular/core/testing";
import { throwError } from "rxjs";

import { InitSimulatorPageComponent } from "./init-simulator-page.component";
import { ApiError, ApiService } from "../services/api.service";
import { InitFormValues, SimulatorFormSubmit } from "../shared/simulator-form/simulator-form.component";

// ---------------------------------------------------------------------------
// Fix (code review follow-up, 2026-07-15 — closing WARNING from
// verify-report-final #66, item "Consider extracting the 401-vs-other-error
// distinction ... likely all 4 read-only pages share the same risk"): same
// stale-error-banner-vs-async-redirect race as config-page, but here the
// only HTTP call is the form submit handler (no separate page-load fetch on
// this simulator). Fix: skip setting the local error state for 401 (already
// handled by authInterceptor's logout+redirect); keep it for other errors.
// ---------------------------------------------------------------------------

function buildApiServiceMock(err: ApiError) {
  return {
    simulateInit: () => throwError(() => err),
  };
}

async function setupTestBed(err: ApiError) {
  await TestBed.configureTestingModule({
    imports: [InitSimulatorPageComponent],
    providers: [{ provide: ApiService, useValue: buildApiServiceMock(err) }],
  }).compileComponents();
}

function createComponent(): ComponentFixture<InitSimulatorPageComponent> {
  const fixture = TestBed.createComponent(InitSimulatorPageComponent);
  fixture.detectChanges();
  return fixture;
}

const initValues: InitFormValues = {
  edadT1: 35,
  antiguedadT1: 24,
  domiciliaNominaT1: false,
  finalidad: 1,
  primeraViviendaHabitual: true,
  tipoAlta: "COMPRA",
  importeVivienda: 200000,
  importeVentaCA: 0,
};

const submitEvent: SimulatorFormSubmit = { phase: "INIT", values: initValues };

describe("InitSimulatorPageComponent — 401 error-banner race fix", () => {
  it("does NOT set the local error message when simulateInit() fails with 401 (authInterceptor already handles logout+redirect)", async () => {
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
