import { CommonModule } from "@angular/common";
import { Component, inject, signal } from "@angular/core";

import { InitEligibleOffer, InitSimulationInput, OfferEvaluationResult, WfCompareResult } from "../models/api.models";
import { SimulationTraceLogComponent } from "../shared/simulation-trace-log.component";
import { SimulatorFormComponent, SimulatorFormSubmit } from "../shared/simulator-form/simulator-form.component";
import { ApiError, ApiService } from "../services/api.service";
import { WfValidationService } from "../services/wf-validation.service";
import { environment } from "../../environments/environment";
import { DictamenEntry, extraDictamenEntries } from "../util/dictamen-extra";

@Component({
  selector: "app-init-simulator-page",
  standalone: true,
  imports: [CommonModule, SimulationTraceLogComponent, SimulatorFormComponent],
  templateUrl: "./init-simulator-page.component.html",
  styleUrl: "./init-simulator-page.component.css",
})
export class InitSimulatorPageComponent {
  private readonly apiService = inject(ApiService);
  private readonly wfValidation = inject(WfValidationService);

  protected readonly maxCols = environment.maxSimulatorColumns;

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly initElegibles = signal<InitEligibleOffer[]>([]);
  protected readonly initUiLimits = signal<Record<string, number | boolean | undefined>>({});
  protected readonly evaluations = signal<OfferEvaluationResult[]>([]);
  protected readonly wfCompare = signal<WfCompareResult | null>(null);

  protected extraDictamenEntries(offer: InitEligibleOffer): DictamenEntry[] {
    return extraDictamenEntries(offer.dictamen as Record<string, unknown> | undefined);
  }

  /** Lectura numérica segura de uiLimits: descarta valores boolean (p. ej. SOLICITAR_DATOS_INTERVINIENTES). */
  protected numUiLimit(key: string): number | undefined {
    const v = this.initUiLimits()[key];
    return typeof v === "number" ? v : undefined;
  }

  protected limitFromOffer(offer: InitEligibleOffer, key: string): number | null {
    const direct = (offer as unknown as Record<string, unknown>)[key];
    if (typeof direct === "number") {
      return direct;
    }
    const nested = offer.dictamen?.[key];
    return typeof nested === "number" ? nested : null;
  }

  protected onFormSubmit(event: SimulatorFormSubmit): void {
    if (event.phase !== "INIT") return;

    this.loading.set(true);
    this.error.set(null);
    this.initElegibles.set([]);
    this.initUiLimits.set({});
    this.evaluations.set([]);
    this.wfCompare.set(null);

    const v = event.values;
    const input: InitSimulationInput = {
      NUM_TITULARES_NM:             1,
      EDAD_T1_NM:                   v.edadT1,
      ANTIGUEDAD_T1_NM:             v.antiguedadT1,
      DOMICILIA_NOMINA_T1_FL:       v.domiciliaNominaT1,
      EDAD_T2_NM:                   0,
      ANTIGUEDAD_T2_NM:             0,
      DOMICILIA_NOMINA_T2_FL:       false,
      EDAD_MAX_NM:                  v.edadT1,
      FINALIDAD_CD:                 v.finalidad,
      PRIMERA_VIVIENDA_HABITUAL_FL: v.primeraViviendaHabitual,
      TIPO_ALTA_CD:                 v.tipoAlta,
      IMPORTE_VIVIENDA_NM:          v.importeVivienda,
      IMPORTE_VIVIENDA_CA_NM:       v.importeVentaCA,
    };

    const wfOptions = this.wfValidation.validateWf()
      ? {
          validateWf: true,
          wfToken: this.wfValidation.wfToken(),
          wfTokenExpCd: this.wfValidation.wfTokenExpCd(),
          wfComunidadAutonoma: this.wfValidation.comunidadAutonoma(),
          wfNumPersonaT1: this.wfValidation.numPersonaT1(),
        }
      : {};

    this.apiService.simulateInit({ input, ...wfOptions }).subscribe({
      next: (response) => {
        this.initElegibles.set(this.apiService.extractInitEligibleOffers(response));
        this.initUiLimits.set(response.uiLimits ?? {});
        this.evaluations.set(response.all ?? []);
        this.wfCompare.set(response.wfCompare ?? null);
        this.loading.set(false);
      },
      error: (error: ApiError) => {
        // Fix (code review follow-up, 2026-07-15): a 401 here is already
        // handled end-to-end by authInterceptor (logout + redirect to
        // /login) — setting the local error banner too would race the
        // async redirect and could flash a stale error message on screen.
        // Any other error status still surfaces normally.
        if (error.status !== 401) {
          this.error.set(error.message);
        }
        this.loading.set(false);
      },
    });
  }
}
