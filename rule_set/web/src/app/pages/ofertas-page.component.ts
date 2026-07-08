import { CommonModule } from "@angular/common";
import { Component, computed, inject, OnInit, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule } from "@angular/forms";

import { AdminOffer } from "../models/admin.models";
import { AdminApiService } from "../services/admin-api.service";

type OfferEditorMode = "closed" | "create" | "edit";

type ConfirmDialogState = {
  type: "offer";
  title: string;
  message: string;
  offerCode: string;
};

@Component({
  selector: "app-ofertas-page",
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: "./ofertas-page.component.html",
  styleUrl: "./ofertas-page.component.css",
})
export class OfertasPageComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly adminApiService = inject(AdminApiService);

  protected readonly offerForm = this.fb.nonNullable.group({
    code: "",
    name: "",
    offer_rank: 0,
    enabled: true,
    oferta_id: 0,
  });

  protected readonly offers = signal<AdminOffer[]>([]);
  protected readonly offersLoading = signal(false);
  protected readonly offersError = signal<string | null>(null);
  protected readonly offerEditorMode = signal<OfferEditorMode>("closed");
  protected readonly selectedOfferCode = signal<string | null>(null);
  protected readonly offerSaving = signal(false);
  protected readonly offerActionError = signal<string | null>(null);
  protected readonly offerActionSuccess = signal<string | null>(null);
  protected readonly pendingOfferCodes = signal<Set<string>>(new Set());
  protected readonly confirmDialog = signal<ConfirmDialogState | null>(null);

  protected readonly isOfferEditorOpen = computed(() => this.offerEditorMode() !== "closed");
  protected readonly isOfferCreateMode = computed(() => this.offerEditorMode() === "create");
  protected readonly offerEditorTitle = computed(() =>
    this.isOfferCreateMode() ? "Crear oferta" : "Editar oferta"
  );
  protected readonly offerSubmitLabel = computed(() =>
    this.isOfferCreateMode() ? "Crear oferta" : "Guardar oferta"
  );

  ngOnInit(): void {
    this.loadOffers();
  }

  protected openCreateOfferEditor(): void {
    this.offerEditorMode.set("create");
    this.selectedOfferCode.set(null);
    this.offerActionError.set(null);
    this.offerActionSuccess.set(null);
    this.offerForm.reset({ code: "", name: "", offer_rank: 0, enabled: true, oferta_id: 0 });
  }

  protected editOffer(offer: AdminOffer): void {
    this.offerEditorMode.set("edit");
    this.selectedOfferCode.set(offer.offerCode);
    this.offerActionError.set(null);
    this.offerActionSuccess.set(null);
    this.offerForm.setValue({
      code: offer.offerCode,
      name: offer.name,
      offer_rank: offer.offer_rank,
      enabled: offer.enabled,
      oferta_id: offer.oferta_id ?? 0,
    });
  }

  protected cancelOfferEdit(): void {
    this.offerEditorMode.set("closed");
    this.selectedOfferCode.set(null);
    this.offerForm.reset({ code: "", name: "", offer_rank: 0, enabled: true, oferta_id: 0 });
  }

  protected saveOffer(): void {
    this.offerActionError.set(null);
    this.offerActionSuccess.set(null);

    const raw = this.offerForm.getRawValue();
    if (!raw.code.trim()) {
      this.offerActionError.set("El código es obligatorio.");
      return;
    }
    if (!raw.name.trim()) {
      this.offerActionError.set("El nombre es obligatorio.");
      return;
    }

    this.offerSaving.set(true);
    const selectedOfferCode = this.selectedOfferCode();
    const offerData = {
      code: raw.code.trim().toUpperCase(),
      name: raw.name.trim(),
      offer_rank: Number(raw.offer_rank),
      enabled: raw.enabled,
      oferta_id: Number(raw.oferta_id),
    };
    const request$ = selectedOfferCode
      ? (this.adminApiService.updateOffer(selectedOfferCode, offerData) as import("rxjs").Observable<unknown>)
      : (this.adminApiService.createOffer(offerData) as import("rxjs").Observable<unknown>);

    request$.subscribe({
      next: () => {
        this.offerSaving.set(false);
        this.offerActionSuccess.set(selectedOfferCode ? "Oferta actualizada." : "Oferta creada.");
        this.cancelOfferEdit();
        this.loadOffers();
      },
      error: (error: Error) => {
        this.offerSaving.set(false);
        this.offerActionError.set(error.message);
      },
    });
  }

  protected deleteOffer(offer: AdminOffer): void {
    this.confirmDialog.set({
      type: "offer",
      title: "Eliminar oferta",
      message: `Se eliminará la oferta "${offer.offerCode}" y TODAS sus reglas y parámetros de todos los períodos. Esta operación no se puede deshacer.`,
      offerCode: offer.offerCode,
    });
  }

  protected toggleOffer(offer: AdminOffer): void {
    this.offerActionError.set(null);
    this.offerActionSuccess.set(null);
    this.setPendingOffer(offer.offerCode, true);

    this.adminApiService.setOfferEnabled(offer.offerCode, !offer.enabled).subscribe({
      next: () => {
        this.setPendingOffer(offer.offerCode, false);
        this.offerActionSuccess.set(
          `Oferta ${offer.offerCode} ${offer.enabled ? "deshabilitada" : "habilitada"}.`
        );
        this.loadOffers();
      },
      error: (error: Error) => {
        this.setPendingOffer(offer.offerCode, false);
        this.offerActionError.set(error.message);
      },
    });
  }

  protected isOfferPending(offerCode: string): boolean {
    return this.pendingOfferCodes().has(offerCode);
  }

  protected isConfirmActionPending(): boolean {
    const dialog = this.confirmDialog();
    if (!dialog) return false;
    return this.isOfferPending(dialog.offerCode);
  }

  protected closeConfirmDialog(): void {
    this.confirmDialog.set(null);
  }

  protected confirmDialogAction(): void {
    const dialog = this.confirmDialog();
    if (!dialog) return;
    this.executeOfferDelete(dialog.offerCode);
  }

  private loadOffers(): void {
    this.offersLoading.set(true);
    this.offersError.set(null);

    this.adminApiService.getOffers().subscribe({
      next: (response) => {
        this.offers.set(response.items);
        this.offersLoading.set(false);
      },
      error: (error: Error) => {
        this.offers.set([]);
        this.offersError.set(error.message);
        this.offersLoading.set(false);
      },
    });
  }

  private executeOfferDelete(offerCode: string): void {
    this.closeConfirmDialog();
    this.offerActionError.set(null);
    this.offerActionSuccess.set(null);
    this.setPendingOffer(offerCode, true);

    this.adminApiService.deleteOffer(offerCode).subscribe({
      next: (result) => {
        this.setPendingOffer(offerCode, false);
        this.offerActionSuccess.set(
          `Oferta ${offerCode} eliminada. Se han borrado ${result.deletedRules} regla(s) y ${result.deletedParams} parámetro(s). Snapshot de seguridad: #${result.snapshot_id}.`
        );
        this.loadOffers();
      },
      error: (error: Error) => {
        this.setPendingOffer(offerCode, false);
        this.offerActionError.set(error.message);
      },
    });
  }

  private setPendingOffer(offerCode: string, pending: boolean): void {
    this.pendingOfferCodes.update((current) => {
      const next = new Set(current);
      if (pending) {
        next.add(offerCode);
      } else {
        next.delete(offerCode);
      }
      return next;
    });
  }
}
