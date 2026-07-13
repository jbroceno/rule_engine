import { ComponentFixture, TestBed } from "@angular/core/testing";
import { of, throwError } from "rxjs";

import { SnapshotsPageComponent } from "./snapshots-page.component";
import { AdminApiError, AdminApiService } from "../services/admin-api.service";
import { AdminSnapshotItem } from "../models/admin.models";

/**
 * snapshots-page.component.spec.ts — TDD tests for the OWASP-10 snapshot
 * integrity verdict surfaced in the frontend (WU-12).
 *
 * Spec ref: openspec/changes/rbac-and-config-safeguards/specs/snapshot-integrity/spec.md
 *   "Veredicto de integridad propagado al frontend"
 * Design ref: openspec/changes/rbac-and-config-safeguards/design.md
 *   § "Interfaces / Contracts" (RestoreIntegrity), § "Códigos y textos de error"
 */

function makeSnapshot(overrides: Partial<AdminSnapshotItem> = {}): AdminSnapshotItem {
  return {
    snapshot_id: 1,
    snapshot_name: "Test snapshot",
    comment: "Comentario",
    created_by: "tester",
    created_at: "2026-07-01T10:00:00.000Z",
    entorno_cd: "POC",
    ...overrides,
  };
}

function buildAdminApiMock(overrides: Partial<ReturnType<typeof baseMock>> = {}) {
  return { ...baseMock(), ...overrides };
}

function baseMock() {
  return {
    listSnapshots: () => of({ items: [makeSnapshot()], pagination: { total: 1, page: 1, pageSize: 20 } }),
    getOffers: () => of({ items: [] }),
    restoreSnapshot: (_id: number, _opts: unknown) =>
      of({ applied: { rules: 1, params: 0 }, offerCodes: ["OFERTA_A"], preRestoreSnapshotId: 2 }),
    deleteSnapshot: () => of({ deleted: true, snapshot_id: 1 }),
    getSnapshotContent: () => of({ snapshot_id: 1, snapshot_name: "x", entorno_cd: "POC", rules: [], params: [] }),
    createWorkflowSnapshot: () => of({ snapshot_id: 1, snapshot_name: "x" }),
  };
}

async function setupTestBed(adminApiMock: Record<string, unknown>) {
  await TestBed.configureTestingModule({
    imports: [SnapshotsPageComponent],
    providers: [{ provide: AdminApiService, useValue: adminApiMock }],
  }).compileComponents();
}

function createComponent(): ComponentFixture<SnapshotsPageComponent> {
  const fixture = TestBed.createComponent(SnapshotsPageComponent);
  fixture.detectChanges();
  return fixture;
}

describe("SnapshotsPageComponent — integrity verdict (WU-12)", () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it("restore success con integrity.status 'verified' muestra un veredicto de integridad verificada", async () => {
    const mock = buildAdminApiMock({
      restoreSnapshot: () =>
        of({
          applied: { rules: 1, params: 0 },
          offerCodes: ["OFERTA_A"],
          preRestoreSnapshotId: 2,
          integrity: { status: "verified", checksumPresent: true },
        }),
    });
    await setupTestBed(mock);
    const fixture = createComponent();
    const component = fixture.componentInstance;
    component["confirmRestore"](makeSnapshot());
    component["executeRestore"]();
    fixture.detectChanges();

    const msg = component["actionSuccess"]();
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/verificad/i);
  });

  it("restore success con integrity.status 'legacy' muestra un veredicto de legado / no verificable", async () => {
    const mock = buildAdminApiMock({
      restoreSnapshot: () =>
        of({
          applied: { rules: 1, params: 0 },
          offerCodes: ["OFERTA_A"],
          preRestoreSnapshotId: 2,
          integrity: { status: "legacy", checksumPresent: false },
        }),
    });
    await setupTestBed(mock);
    const fixture = createComponent();
    const component = fixture.componentInstance;
    component["confirmRestore"](makeSnapshot());
    component["executeRestore"]();
    fixture.detectChanges();

    const msg = component["actionSuccess"]();
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/legad|no verificable/i);
  });

  it("restore rechazado por integridad (409) muestra un mensaje distinto al de un error generico", async () => {
    const integrityMessage =
      "La integridad del snapshot no se pudo verificar: el contenido no coincide con su checksum. " +
      "Restauración cancelada. Esto puede deberse a manipulación del contenido o a una rotación " +
      "reciente de SNAPSHOT_HMAC_SECRET/JWT_SECRET sin migrar los checksums existentes.";
    const mock = buildAdminApiMock({
      restoreSnapshot: () => throwError(() => new AdminApiError(integrityMessage, 409)),
    });
    await setupTestBed(mock);
    const fixture = createComponent();
    const component = fixture.componentInstance;
    component["confirmRestore"](makeSnapshot());
    component["executeRestore"]();
    fixture.detectChanges();

    expect(component["actionError"]()).toContain("integridad");
    const errorEl = fixture.nativeElement.querySelector(".state.error") as HTMLElement | null;
    expect(errorEl).toBeTruthy();
    expect(errorEl!.classList.contains("integrity-error")).toBeTrue();
  });

  it("restore rechazado por un error generico (no integridad) NO marca el mensaje como error de integridad", async () => {
    const mock = buildAdminApiMock({
      restoreSnapshot: () => throwError(() => new AdminApiError("Error inesperado de red.", 500)),
    });
    await setupTestBed(mock);
    const fixture = createComponent();
    const component = fixture.componentInstance;
    component["confirmRestore"](makeSnapshot());
    component["executeRestore"]();
    fixture.detectChanges();

    expect(component["actionError"]()).toContain("red");
    const errorEl = fixture.nativeElement.querySelector(".state.error") as HTMLElement | null;
    expect(errorEl).toBeTruthy();
    expect(errorEl!.classList.contains("integrity-error")).toBeFalse();
  });

  it("restore rechazado con status 409 pero un mensaje COMPLETAMENTE DISTINTO al texto de integridad TAMBIEN marca error de integridad (deteccion basada en status, Fix 2)", async () => {
    const mock = buildAdminApiMock({
      restoreSnapshot: () => throwError(() => new AdminApiError("Un conflicto totalmente distinto, sin relacion con checksums.", 409)),
    });
    await setupTestBed(mock);
    const fixture = createComponent();
    const component = fixture.componentInstance;
    component["confirmRestore"](makeSnapshot());
    component["executeRestore"]();
    fixture.detectChanges();

    const errorEl = fixture.nativeElement.querySelector(".state.error") as HTMLElement | null;
    expect(errorEl).toBeTruthy();
    expect(errorEl!.classList.contains("integrity-error")).toBeTrue();
  });
});
