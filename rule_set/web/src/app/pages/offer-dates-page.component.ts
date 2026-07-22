import { CommonModule } from "@angular/common";
import { Component, computed, inject, OnInit, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";

import { AdminFechaItem, AdminFechaPayload } from "../models/admin.models";
import { ActivePeriodService } from "../services/active-period.service";
import { AdminApiService } from "../services/admin-api.service";
import { PublicConfigApiService } from "../services/public-config-api.service";

type DialogMode = "create" | "edit";

@Component({
  selector: "app-offer-dates-page",
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: "./offer-dates-page.component.html",
  styleUrl: "./offer-dates-page.component.css",
})
export class OfferDatesPageComponent implements OnInit {
  private readonly adminApi = inject(AdminApiService);
  private readonly publicConfigApi = inject(PublicConfigApiService);
  private readonly fb = inject(FormBuilder);
  readonly activePeriodService = inject(ActivePeriodService);

  readonly activeRulesId = computed(() => this.activePeriodService.activePeriodRules()?.offer_date_id ?? null);
  readonly activeParamsId = computed(() => this.activePeriodService.activePeriodParams()?.offer_date_id ?? null);

  fechas = signal<AdminFechaItem[]>([]);
  loading = signal(false);
  errorMsg = signal<string | null>(null);
  successMsg = signal<string | null>(null);

  dialogMode = signal<DialogMode>("create");
  dialogOpen = signal(false);
  editingId = signal<number | null>(null);
  dialogError = signal<string | null>(null);
  dialogSaving = signal(false);

  deleteTarget = signal<AdminFechaItem | null>(null);
  deleteError = signal<string | null>(null);
  deleteInProgress = signal(false);

  duplicateSource = signal<AdminFechaItem | null>(null);
  duplicateDialogOpen = signal(false);
  duplicateNewFrom = signal("");
  duplicateError = signal<string | null>(null);
  duplicateSaving = signal(false);

  form = this.fb.nonNullable.group({
    valid_from: ["", Validators.required],
    valid_to: [""],
    descripcion: ["", Validators.required],
    tipo_cd: ["REGLAS" as "REGLAS" | "PARAMS" | "AMBOS", Validators.required],
  });

  sortedFechas = computed(() =>
    [...this.fechas()].sort((a, b) => b.valid_from.localeCompare(a.valid_from)),
  );

  ngOnInit(): void {
    this.loadFechas();
  }

  activarReglas(fecha: AdminFechaItem): void {
    this.activePeriodService.setRulesPeriod(
      this.activeRulesId() === fecha.offer_date_id ? null : fecha,
    );
  }

  activarParams(fecha: AdminFechaItem): void {
    this.activePeriodService.setParamsPeriod(
      this.activeParamsId() === fecha.offer_date_id ? null : fecha,
    );
  }

  canActivateReglas(fecha: AdminFechaItem): boolean {
    return fecha.tipo_cd === "REGLAS" || fecha.tipo_cd === "AMBOS";
  }

  canActivateParams(fecha: AdminFechaItem): boolean {
    return fecha.tipo_cd === "PARAMS" || fecha.tipo_cd === "AMBOS";
  }

  loadFechas(): void {
    this.loading.set(true);
    this.errorMsg.set(null);
    // permissive-config-readonly (ADR-CR5): reads go through the public
    // /api/config/* surface so anonymous/viewer sessions can load períodos
    // in AUTH_MODE=permissive. All writes below remain on AdminApiService.
    this.publicConfigApi.getFechas().subscribe({
      next: (resp) => {
        this.fechas.set(resp.items);
        this.loading.set(false);
      },
      error: (err: Error) => {
        this.errorMsg.set(err.message);
        this.loading.set(false);
      },
    });
  }

  openCreate(): void {
    this.form.reset({ valid_from: "", valid_to: "", descripcion: "", tipo_cd: "REGLAS" });
    this.dialogMode.set("create");
    this.editingId.set(null);
    this.dialogError.set(null);
    this.dialogOpen.set(true);
  }

  /**
   * Normalizes a datetime-local control value to the backend contract
   * YYYY-MM-DDTHH:mm:ss (local wall-clock). Browsers may omit the seconds
   * component when they are :00 — this helper re-appends :00 in that case.
   * Never calls .toISOString() to avoid UTC conversion (ADR-005).
   */
  toVigenciaString(val: string): string {
    if (!val) return "";
    // Normalize space separator from backend to T
    const normalized = val.replace(" ", "T");
    // If value already has seconds component (length >= 19), return as-is
    if (normalized.length >= 19) return normalized;
    // Value is YYYY-MM-DDTHH:mm (16 chars) — append :00
    if (normalized.length === 16) return normalized + ":00";
    return normalized;
  }

  openEdit(fecha: AdminFechaItem): void {
    // substring(0, 19) preserves YYYY-MM-DDTHH:mm:ss (RF-COD-03, CA-COD-006)
    // Replace space separator with T so datetime-local receives a valid value
    const toDatetimeLocal = (s: string) => this.toVigenciaString(s.substring(0, 19));
    this.form.setValue({
      valid_from: toDatetimeLocal(fecha.valid_from),
      valid_to: fecha.valid_to ? toDatetimeLocal(fecha.valid_to) : "",
      descripcion: fecha.descripcion,
      tipo_cd: fecha.tipo_cd,
    });
    this.dialogMode.set("edit");
    this.editingId.set(fecha.offer_date_id);
    this.dialogError.set(null);
    this.dialogOpen.set(true);
  }

  closeDialog(): void {
    this.dialogOpen.set(false);
  }

  saveDialog(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    const payload: AdminFechaPayload = {
      valid_from: this.toVigenciaString(raw.valid_from),
      valid_to: raw.valid_to?.trim() ? this.toVigenciaString(raw.valid_to.trim()) : null,
      descripcion: raw.descripcion,
      tipo_cd: raw.tipo_cd,
    };

    this.dialogSaving.set(true);
    this.dialogError.set(null);

    if (this.dialogMode() === "create") {
      this.adminApi.createFecha(payload).subscribe({
        next: () => {
          this.dialogSaving.set(false);
          this.dialogOpen.set(false);
          this.successMsg.set("Período creado correctamente.");
          this.loadFechas();
          setTimeout(() => this.successMsg.set(null), 4000);
        },
        error: (err: Error) => {
          this.dialogError.set(err.message);
          this.dialogSaving.set(false);
        },
      });
    } else {
      const id = this.editingId()!;
      this.adminApi.updateFecha(id, payload).subscribe({
        next: () => {
          this.dialogSaving.set(false);
          this.dialogOpen.set(false);
          this.successMsg.set("Período actualizado correctamente.");
          this.loadFechas();
          setTimeout(() => this.successMsg.set(null), 4000);
        },
        error: (err: Error) => {
          this.dialogError.set(err.message);
          this.dialogSaving.set(false);
        },
      });
    }
  }

  openDuplicate(fecha: AdminFechaItem): void {
    this.duplicateSource.set(fecha);
    this.duplicateNewFrom.set("");
    this.duplicateError.set(null);
    this.duplicateDialogOpen.set(true);
  }

  cancelDuplicate(): void {
    this.duplicateDialogOpen.set(false);
    this.duplicateSource.set(null);
  }

  confirmDuplicate(): void {
    const source = this.duplicateSource();
    const newFrom = this.duplicateNewFrom().trim();
    if (!source || !newFrom) {
      this.duplicateError.set("La fecha de inicio es obligatoria.");
      return;
    }

    this.duplicateSaving.set(true);
    this.duplicateError.set(null);

    this.adminApi.duplicateFecha(source.offer_date_id, this.toVigenciaString(newFrom)).subscribe({
      next: () => {
        this.duplicateSaving.set(false);
        this.duplicateDialogOpen.set(false);
        this.successMsg.set("Período duplicado correctamente.");
        this.loadFechas();
        setTimeout(() => this.successMsg.set(null), 4000);
      },
      error: (err: Error) => {
        this.duplicateError.set(err.message);
        this.duplicateSaving.set(false);
      },
    });
  }

  openDeleteConfirm(fecha: AdminFechaItem): void {
    this.deleteTarget.set(fecha);
    this.deleteError.set(null);
  }

  cancelDelete(): void {
    this.deleteTarget.set(null);
  }

  confirmDelete(): void {
    const fecha = this.deleteTarget();
    if (!fecha) return;
    this.deleteInProgress.set(true);
    this.deleteError.set(null);
    this.adminApi.deleteFecha(fecha.offer_date_id).subscribe({
      next: () => {
        this.deleteInProgress.set(false);
        this.deleteTarget.set(null);
        this.successMsg.set("Período eliminado.");
        this.loadFechas();
        setTimeout(() => this.successMsg.set(null), 4000);
      },
      error: (err: Error) => {
        this.deleteError.set(err.message);
        this.deleteInProgress.set(false);
      },
    });
  }
}
