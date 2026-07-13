import { CommonModule } from "@angular/common";
import { Component, computed, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule } from "@angular/forms";

import { AdminOffer, AdminSnapshotContentResponse, AdminSnapshotItem, AdminSnapshotListQuery, RestoreIntegrity } from "../models/admin.models";
import { AdminApiError, AdminApiService } from "../services/admin-api.service";

@Component({
  selector: "app-snapshots-page",
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: "./snapshots-page.component.html",
  styleUrl: "./snapshots-page.component.css",
})
export class SnapshotsPageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly adminApiService = inject(AdminApiService);

  protected readonly filtersForm = this.fb.nonNullable.group({
    dateFrom: "",
    dateTo: "",
    q: "",
    entorno: "" as "" | "POC" | "WF",
  });

  protected readonly snapshots = signal<AdminSnapshotItem[]>([]);
  protected readonly total = signal(0);
  protected readonly currentPage = signal(1);
  protected readonly pageSize = 20;

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly actionSuccess = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  /** OWASP-10: distinguishes a snapshot-integrity (409) rejection from a generic server error,
   *  so the template can surface a visibly different message. */
  protected readonly actionErrorKind = signal<"generic" | "integrity">("generic");

  protected readonly restoring = signal(false);
  protected readonly restoreUser = signal("");
  protected readonly restoreDestino = signal<"POC" | "WF">("POC");
  protected readonly restoreVigDesde = signal("");
  protected readonly restoreVigHasta = signal("");
  protected readonly restorePocFechaDesde = signal("");
  protected readonly confirmDialog = signal<AdminSnapshotItem | null>(null);

  protected readonly deleteDialog = signal<AdminSnapshotItem | null>(null);
  protected readonly deleting = signal(false);

  protected readonly previewDialog = signal<AdminSnapshotContentResponse | null>(null);
  protected readonly loadingPreview = signal(false);

  protected readonly takingSnapshot = signal(false);
  protected readonly snapshotWfDialog = signal(false);
  protected readonly snapshotWfUser = signal("");
  protected readonly snapshotVigDesde = signal("");
  protected readonly snapshotVigHasta = signal("");


  // WF restore offer-ID mapping
  protected readonly wfOffers = signal<AdminOffer[]>([]);
  protected readonly restoreOfertaIdOverrides = signal<Record<string, number | null>>({});

  protected readonly restoreOverridesValid = computed(() =>
    Object.values(this.restoreOfertaIdOverrides()).every(
      (v) => v !== null && Number.isInteger(v) && v >= 1,
    ),
  );

  // The oferta_id mapping applies both when publishing to WF and when
  // restoring a WF-origin snapshot to POC (to reconcile id drift between envs).
  protected readonly showOfertaMapping = computed(() => {
    const destino = this.restoreDestino();
    const isWfSnap = this.confirmDialog()?.entorno_cd === "WF";
    return destino === "WF" || (destino === "POC" && isWfSnap);
  });

  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.pageSize))
  );

  protected readonly pageOptions = computed(() => {
    const total = this.totalPages();
    const current = this.currentPage();
    if (total <= 5) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
    const start = Math.max(1, current - 2);
    const end = Math.min(total, start + 4);
    const adjStart = Math.max(1, end - 4);
    return Array.from({ length: end - adjStart + 1 }, (_, i) => adjStart + i);
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
    this.applyFilters(false);
  }

  protected applyFilters(resetPage = true): void {
    if (resetPage) {
      this.currentPage.set(1);
    }
    const { dateFrom, dateTo, q, entorno } = this.filtersForm.getRawValue();
    this.loadSnapshots({
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      q: q.trim() || undefined,
      entorno: (entorno as "POC" | "WF") || undefined,
      page: this.currentPage(),
      pageSize: this.pageSize,
    });
  }

  protected resetFilters(): void {
    this.filtersForm.reset({ dateFrom: "", dateTo: "", q: "", entorno: "" });
    this.applyFilters();
  }

  protected goToPage(page: number): void {
    const safe = Math.min(Math.max(1, page), this.totalPages());
    this.currentPage.set(safe);
    this.applyFilters(false);
  }

  protected confirmRestore(snapshot: AdminSnapshotItem): void {
    this.actionError.set(null);
    this.actionErrorKind.set("generic");
    this.actionSuccess.set(null);
    this.restoreUser.set("");
    this.restoreDestino.set("POC");
    this.restoreVigDesde.set("");
    this.restoreVigHasta.set("");
    this.restorePocFechaDesde.set("");
    this.wfOffers.set([]);
    this.restoreOfertaIdOverrides.set({});
    this.confirmDialog.set(snapshot);
    // WF-origin snapshots default to POC restore, which also needs the
    // oferta_id mapping (id drift) → preload it.
    if (snapshot.entorno_cd === "WF") {
      this.loadOffersForWfMapping();
    }
  }

  protected onRestoreDestinoChange(destino: "POC" | "WF"): void {
    this.restoreDestino.set(destino);
    const isWfSnap = this.confirmDialog()?.entorno_cd === "WF";
    if (destino === "WF" || (destino === "POC" && isWfSnap)) {
      this.loadOffersForWfMapping();
    } else {
      this.wfOffers.set([]);
      this.restoreOfertaIdOverrides.set({});
    }
  }

  protected setRestoreOfertaId(offerCode: string, rawValue: string): void {
    const parsed = parseInt(rawValue, 10);
    const val = !rawValue.trim() || isNaN(parsed) ? null : parsed;
    this.restoreOfertaIdOverrides.update((prev) => ({ ...prev, [offerCode]: val }));
  }

  private loadOffersForWfMapping(): void {
    this.adminApiService.getOffers().subscribe({
      next: (resp) => {
        this.wfOffers.set(resp.items);
        this.restoreOfertaIdOverrides.set(
          resp.items.reduce<Record<string, number | null>>(
            (acc, o) => ({ ...acc, [o.offerCode]: o.oferta_id ?? null }),
            {},
          ),
        );
      },
      error: () => {
        this.wfOffers.set([]);
        this.restoreOfertaIdOverrides.set({});
      },
    });
  }

  protected closeConfirmDialog(): void {
    this.confirmDialog.set(null);
  }

  protected executeRestore(): void {
    const snapshot = this.confirmDialog();
    if (!snapshot) {
      return;
    }
    const destino = this.restoreDestino();
    const isWfSnap = snapshot.entorno_cd === "WF";
    const vigDesde = this.toVigenciaString(this.restoreVigDesde().trim());
    if (destino === "WF" && !vigDesde) {
      this.actionError.set("La fecha de inicio de destino es obligatoria para restaurar en Workflow.");
      return;
    }
    if (this.showOfertaMapping() && !this.restoreOverridesValid()) {
      this.actionError.set("Todos los oferta_id deben ser enteros positivos (≥ 1).");
      return;
    }
    const pocFechaDesde = this.toVigenciaString(this.restorePocFechaDesde().trim());
    if (destino === "POC" && isWfSnap && !pocFechaDesde) {
      this.actionError.set("La fecha de destino POC es obligatoria para restaurar un snapshot WF.");
      return;
    }
    const overridesRaw = this.restoreOfertaIdOverrides();
    const ofertaIdOverrides = this.showOfertaMapping()
      ? Object.fromEntries(Object.entries(overridesRaw).map(([k, v]) => [k, v as number]))
      : undefined;
    this.closeConfirmDialog();
    this.restoring.set(true);
    this.actionError.set(null);
    this.actionErrorKind.set("generic");
    this.actionSuccess.set(null);
    const vigHastaNorm = this.restoreVigHasta().trim();

    this.adminApiService
      .restoreSnapshot(snapshot.snapshot_id, {
        createdBy: this.restoreUser().trim() || undefined,
        destino,
        rangoDestino: destino === "WF" ? { vigDesde, vigHasta: vigHastaNorm ? this.toVigenciaString(vigHastaNorm) : null } : undefined,
        ofertaIdOverrides,
        pocFechaDesde: destino === "POC" && isWfSnap ? pocFechaDesde : undefined,
      })
      .subscribe({
        next: (result) => {
          this.restoring.set(false);
          const integritySuffix = this.formatIntegritySuffix(result.integrity);
          if (destino === "WF") {
            this.actionSuccess.set(
              `Snapshot #${snapshot.snapshot_id} publicado en Workflow: ${result.rules ?? 0} reglas, ${result.params ?? 0} parámetros. Snapshot de seguridad #${result.preRestoreSnapshotId} creado.${integritySuffix}`,
            );
          } else if (isWfSnap) {
            this.actionSuccess.set(
              `Snapshot WF #${snapshot.snapshot_id} desplegado en POC: ${result.applied?.rules ?? 0} reglas, ${result.applied?.params ?? 0} parámetros. Snapshot de seguridad #${result.preRestoreSnapshotId} creado.${integritySuffix}`,
            );
          } else {
            this.actionSuccess.set(
              `Snapshot #${snapshot.snapshot_id} restaurado: ${result.applied?.rules ?? 0} reglas, ${result.applied?.params ?? 0} parámetros. Snapshot de seguridad #${result.preRestoreSnapshotId} creado.${integritySuffix}`,
            );
          }
          this.applyFilters(false);
        },
        error: (err: AdminApiError) => {
          this.restoring.set(false);
          this.actionErrorKind.set(this.isIntegrityError(err) ? "integrity" : "generic");
          this.actionError.set(err.message);
        },
      });
  }

  /** OWASP-10: builds the " Integridad: ..." suffix appended to the restore success message. */
  private formatIntegritySuffix(integrity?: RestoreIntegrity): string {
    if (!integrity) return "";
    return integrity.status === "legacy"
      ? " Snapshot legado / no verificable (sin checksum de integridad)."
      : " Integridad verificada (checksum coincide).";
  }

  /**
   * OWASP-10 (Fix 2, code review PR3 2026-07-14): detects the snapshot-integrity
   * rejection primarily by the real HTTP status (409 — the only status
   * restoreSnapshot uses for this rejection, per admin_service.js), which
   * `AdminApiError` now propagates end-to-end instead of being discarded by
   * `handleError`. This makes detection independent of the exact Spanish
   * message text (previously duplicated here via regex from design.md, and
   * liable to drift if either side's wording changed). The message regex is
   * kept ONLY as a defensive fallback for the unlikely case the status is
   * missing (e.g. a client-side/network error with no HttpErrorResponse.status).
   */
  private isIntegrityError(err: AdminApiError): boolean {
    if (err.status === 409) return true;
    return /integridad del snapshot/i.test(err.message);
  }

  protected openSnapshotWfDialog(): void {
    this.snapshotWfUser.set("");
    this.snapshotVigDesde.set("");
    this.snapshotVigHasta.set("");
    this.snapshotWfDialog.set(true);
  }

  protected closeSnapshotWfDialog(): void {
    this.snapshotWfDialog.set(false);
  }

  protected executeSnapshotWf(): void {
    this.closeSnapshotWfDialog();
    this.takingSnapshot.set(true);
    this.actionError.set(null);
    this.actionErrorKind.set("generic");
    this.actionSuccess.set(null);
    const vigDesdeRaw = this.snapshotVigDesde().trim();
    const vigHastaRaw = this.snapshotVigHasta().trim();
    const vigDesde = vigDesdeRaw ? this.toVigenciaString(vigDesdeRaw) : null;
    const vigHasta = vigHastaRaw ? this.toVigenciaString(vigHastaRaw) : null;
    this.adminApiService
      .createWorkflowSnapshot({
        vigDesde,
        vigHasta,
        createdBy: this.snapshotWfUser().trim() || undefined,
      })
      .subscribe({
        next: (result) => {
          this.takingSnapshot.set(false);
          this.actionSuccess.set(`Snapshot WF generado: #${result.snapshot_id} "${result.snapshot_name}".`);
          this.applyFilters(false);
        },
        error: (err: Error) => {
          this.takingSnapshot.set(false);
          this.actionError.set(err.message);
        },
      });
  }

  protected trackSnapshot(_: number, snap: AdminSnapshotItem): number {
    return snap.snapshot_id;
  }

  protected trackPage(_: number, page: number): number {
    return page;
  }

  protected openPreview(snap: AdminSnapshotItem): void {
    this.previewDialog.set(null);
    this.loadingPreview.set(true);
    this.adminApiService.getSnapshotContent(snap.snapshot_id).subscribe({
      next: (data) => {
        this.loadingPreview.set(false);
        this.previewDialog.set(data);
      },
      error: (err: Error) => {
        this.loadingPreview.set(false);
        this.actionErrorKind.set("generic");
        this.actionError.set(err.message);
      },
    });
  }

  protected closePreview(): void {
    this.previewDialog.set(null);
  }

  protected previewJson(data: AdminSnapshotContentResponse): string {
    try {
      return JSON.stringify({ rules: data.rules, params: data.params }, null, 2);
    } catch {
      return "(error serializando JSON)";
    }
  }

  protected openDeleteDialog(snap: AdminSnapshotItem): void {
    this.deleteDialog.set(snap);
  }

  protected cancelDelete(): void {
    this.deleteDialog.set(null);
  }

  protected executeDelete(): void {
    const snap = this.deleteDialog();
    if (!snap) return;

    this.deleting.set(true);
    this.actionSuccess.set(null);
    this.actionError.set(null);
    this.actionErrorKind.set("generic");

    this.adminApiService.deleteSnapshot(snap.snapshot_id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.deleteDialog.set(null);
        this.actionSuccess.set(`Snapshot #${snap.snapshot_id} eliminado.`);
        setTimeout(() => this.actionSuccess.set(null), 4000);
        this.applyFilters(false);
      },
      error: (err: Error) => {
        this.deleting.set(false);
        this.actionError.set(err.message);
        this.deleteDialog.set(null);
      },
    });
  }

  private loadSnapshots(query: AdminSnapshotListQuery): void {
    this.loading.set(true);
    this.error.set(null);
    this.adminApiService.listSnapshots(query).subscribe({
      next: (response) => {
        this.snapshots.set(response.items);
        this.total.set(response.pagination.total);
        this.loading.set(false);
      },
      error: (err: Error) => {
        this.snapshots.set([]);
        this.total.set(0);
        this.error.set(err.message);
        this.loading.set(false);
      },
    });
  }
}
