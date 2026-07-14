import { ComponentFixture, TestBed } from "@angular/core/testing";
import { throwError } from "rxjs";

import { PreSimulatorPageComponent } from "./pre-simulator-page.component";
import { ApiError, ApiService } from "../services/api.service";
import { PreFormValues, SimulatorFormSubmit } from "../shared/simulator-form/simulator-form.component";

// ---------------------------------------------------------------------------
// Fix (code review follow-up, 2026-07-15 — closing WARNING from
// verify-report-final #66): same stale-error-banner-vs-async-redirect race as
// config-page/init-simulator-page. Fix: skip setting the local error state
// for 401 (already handled by authInterceptor's logout+redirect); keep it
// for other errors.
// ---------------------------------------------------------------------------

function buildApiServiceMock(err: ApiError) {
  return {
    simulatePre: () => throwError(() => err),
  };
}

async function setupTestBed(err: ApiError) {
  await TestBed.configureTestingModule({
    imports: [PreSimulatorPageComponent],
    providers: [{ provide: ApiService, useValue: buildApiServiceMock(err) }],
  }).compileComponents();
}

function createComponent(): ComponentFixture<PreSimulatorPageComponent> {
  const fixture = TestBed.createComponent(PreSimulatorPageComponent);
  fixture.detectChanges();
  return fixture;
}

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

const submitEvent: SimulatorFormSubmit = { phase: "PRE", values: preValues };

describe("PreSimulatorPageComponent — 401 error-banner race fix", () => {
  it("does NOT set the local error message when simulatePre() fails with 401 (authInterceptor already handles logout+redirect)", async () => {
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
