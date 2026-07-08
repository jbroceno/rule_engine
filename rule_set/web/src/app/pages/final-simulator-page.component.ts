import { CommonModule } from "@angular/common";
import { Component, computed, inject, signal } from "@angular/core";

import { FinalSimulationEnvelope, FinalSimulationInput, OfferConfig, PreEligibleOffer, PreSimulationInput, WfCompareResult } from "../models/api.models";
import { SimulationTraceLogComponent } from "../shared/simulation-trace-log.component";
import { SimulatorFormComponent, SimulatorFormSubmit } from "../shared/simulator-form/simulator-form.component";
import { ApiService } from "../services/api.service";
import { WfValidationService } from "../services/wf-validation.service";
import { environment } from "../../environments/environment";
import { DictamenEntry, extraDictamenEntries } from "../util/dictamen-extra";

@Component({
  selector: "app-final-simulator-page",
  standalone: true,
  imports: [CommonModule, SimulationTraceLogComponent, SimulatorFormComponent],
  templateUrl: "./final-simulator-page.component.html",
  styleUrl: "./final-simulator-page.component.css",
})
export class FinalSimulatorPageComponent {
  private readonly apiService = inject(ApiService);
  private readonly wfValidation = inject(WfValidationService);

  protected readonly maxCols = environment.maxSimulatorColumns;

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<FinalSimulationEnvelope | null>(null);
  protected readonly wfCompare = signal<WfCompareResult | null>(null);
  protected readonly offers = signal<OfferConfig[]>([]);

  constructor() {
    this.apiService.getConfig().subscribe({
      next: (config) => this.offers.set(config.offers ?? []),
      error: (error: Error) => this.error.set(`No se pudieron cargar las ofertas: ${error.message}`),
    });
  }

  protected readonly hasWinner = computed(() => Boolean(this.result()?.final?.winner));
  protected readonly initBlocked = computed(() => this.result() !== null && this.result()!.pre === null);
  protected readonly preBlocked = computed(() => this.result() !== null && this.result()!.pre !== null && this.result()!.final === null);
  protected readonly initEvaluations = computed(() => this.result()?.init?.all ?? []);
  protected readonly finalElegibles = computed(() => this.result()?.final?.eligibleOffers ?? []);
  protected readonly finalEligibleDetails = computed(() => {
    const response = this.result();
    const finalEligible = response?.final?.eligibleOffers ?? [];
    const preEligible = response?.pre?.eligibleOffers ?? response?.pre?.preElegibles ?? [];
    const preByCode = new Map(preEligible.map((offer) => [offer.offerCode, offer]));

    return finalEligible.map((offer) => {
      const pre = preByCode.get(offer.offerCode);
      if (!pre) {
        return offer;
      }
      return {
        ...pre,
        ...offer,
        dictamen: {
          ...(pre.dictamen ?? {}),
          ...(offer.dictamen ?? {}),
        },
      };
    });
  });
  protected readonly finalUiLimits = computed((): Record<string, number | boolean | undefined> => this.result()?.final?.uiLimits ?? {});

  protected extraDictamenEntries(offer: PreEligibleOffer): DictamenEntry[] {
    return extraDictamenEntries(offer.dictamen);
  }

  /** Lectura numérica segura de uiLimits: descarta valores boolean (p. ej. SOLICITAR_DATOS_INTERVINIENTES). */
  protected numUiLimit(key: string): number | undefined {
    const v = this.finalUiLimits()[key];
    return typeof v === "number" ? v : undefined;
  }

  protected limitFromOffer(offer: PreEligibleOffer, directKey: string, dictamenKey?: string): number | null {
    const direct = (offer as unknown as Record<string, unknown>)[directKey];
    if (typeof direct === "number") {
      return direct;
    }
    const dictamen = offer["dictamen"] as Record<string, unknown> | undefined;
    const nestedDirect = dictamen?.[directKey];
    if (typeof nestedDirect === "number") {
      return nestedDirect;
    }
    const nestedLegacy = dictamenKey ? dictamen?.[dictamenKey] : undefined;
    const nested = nestedLegacy;
    return typeof nested === "number" ? nested : null;
  }

  protected onFormSubmit(event: SimulatorFormSubmit): void {
    if (event.phase !== "FINAL") return;

    this.loading.set(true);
    this.error.set(null);
    this.result.set(null);
    this.wfCompare.set(null);

    const v = event.preValues;
    const dos = v.numTitulares === 2;
    const ingresosT1Norm = v.ingresosT1 * v.pagasT1 / 14;
    const ingresosT2Norm = dos ? v.ingresosT2 * v.pagasT2 / 14 : 0;

    const preInput: PreSimulationInput = {
      NUM_TITULARES_NM:             v.numTitulares,
      EDAD_T1_NM:                   v.edadT1,
      ANTIGUEDAD_T1_NM:             v.antiguedadT1,
      DOMICILIA_NOMINA_T1_FL:       v.domiciliaNominaT1,
      EDAD_T2_NM:                   dos ? v.edadT2 : 0,
      ANTIGUEDAD_T2_NM:             dos ? v.antiguedadT2 : 0,
      DOMICILIA_NOMINA_T2_FL:       dos ? v.domiciliaNominaT2 : false,
      EDAD_MAX_NM:                  dos ? Math.max(v.edadT1, v.edadT2) : v.edadT1,
      FINALIDAD_CD:                 v.finalidad,
      PRIMERA_VIVIENDA_HABITUAL_FL: v.primeraViviendaHabitual,
      TIPO_ALTA_CD:                 v.tipoAlta,
      IMPORTE_VIVIENDA_NM:          v.importeVivienda,
      IMPORTE_VIVIENDA_CA_NM:       v.importeVentaCA,
      INGRESO_T1_NM:                ingresosT1Norm,
      INGRESO_T2_NM:                ingresosT2Norm,
      INGRESO_TOTAL_NM:             ingresosT1Norm + ingresosT2Norm,
    };

    const finalInput: FinalSimulationInput = {
      IMPORTE_HIPOTECA_NM: event.finalValues.importeHipoteca,
      PLAZO_NM:            event.finalValues.plazo,
    };

    const wfOptions = this.wfValidation.validateWf()
      ? {
          validateWf: true,
          wfToken: this.wfValidation.wfToken(),
          wfTokenExpCd: this.wfValidation.wfTokenExpCd(),
          wfComunidadAutonoma: this.wfValidation.comunidadAutonoma(),
          wfNumPersonaT1: this.wfValidation.numPersonaT1(),
          wfNumPersonaT2: this.wfValidation.numPersonaT2(),
        }
      : {};

    this.apiService.simulateFinal({ preInput, finalInput, chained: v.chained, offerCodes: event.offerCodes, ...wfOptions }).subscribe({
      next: (response) => {
        this.result.set(response);
        this.wfCompare.set(response.wfCompare ?? null);
        this.loading.set(false);
      },
      error: (error: Error) => {
        this.error.set(error.message);
        this.loading.set(false);
      },
    });
  }

  protected winnerDescription(): string {
    const winner = this.result()?.final?.winner;
    if (!winner) return "-";
    const desc = winner.dictamen?.["descripcion"];
    return typeof desc === "string" && desc.trim() ? desc : "-";
  }
}
