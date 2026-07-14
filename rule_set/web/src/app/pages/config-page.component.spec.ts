import { ComponentFixture, TestBed } from "@angular/core/testing";
import { throwError } from "rxjs";

import { ConfigPageComponent } from "./config-page.component";
import { ApiError, ApiService } from "../services/api.service";

// ---------------------------------------------------------------------------
// Fix (code review follow-up, 2026-07-15 — closing WARNING from
// verify-report-final #66): in secure mode, an anonymous user landing on a
// read-only route (e.g. /configuracion) gets a 401 from the backend.
// `authInterceptor` already logs out + redirects to /login for that case.
// The component's OWN error handler used to set a local error message on
// ANY HTTP error including 401, racing the async redirect and potentially
// flashing a stale error banner. Fix: skip setting the local error state
// specifically for 401 (already handled elsewhere); keep it for any other
// error status.
// ---------------------------------------------------------------------------

function buildApiServiceMock(err: ApiError) {
  return {
    getConfig: () => throwError(() => err),
  };
}

async function setupTestBed(err: ApiError) {
  await TestBed.configureTestingModule({
    imports: [ConfigPageComponent],
    providers: [{ provide: ApiService, useValue: buildApiServiceMock(err) }],
  }).compileComponents();
}

function createComponent(): ComponentFixture<ConfigPageComponent> {
  const fixture = TestBed.createComponent(ConfigPageComponent);
  fixture.detectChanges(); // triggers ngOnInit() -> loadConfig()
  return fixture;
}

describe("ConfigPageComponent — 401 error-banner race fix", () => {
  it("does NOT set the local error message when getConfig() fails with 401 (authInterceptor already handles logout+redirect)", async () => {
    await setupTestBed(new ApiError("No autorizado.", 401));
    const fixture = createComponent();
    const component = fixture.componentInstance as unknown as { error: () => string | null };
    expect(component.error()).toBeNull();
  });

  it("STILL sets the local error message for a non-401 error (e.g. 500)", async () => {
    await setupTestBed(new ApiError("Error interno del servidor.", 500));
    const fixture = createComponent();
    const component = fixture.componentInstance as unknown as { error: () => string | null };
    expect(component.error()).toBe("Error interno del servidor.");
  });
});
