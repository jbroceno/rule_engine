import { CommonModule } from "@angular/common";
import { Component, computed, inject, signal } from "@angular/core";

import { PreEligibleOffer, PreSimulationEnvelope, PreSimulationInput, WfCompareResult } from "../models/api.models";
import { SimulationTraceLogComponent } from "../shared/simulation-trace-log.component";
import { SimulatorFormComponent, SimulatorFormSubmit } from "../shared/simulator-form/simulator-form.component";
import { ApiService } from "../services/api.service";
import { WfValidationService } from "../services/wf-validation.service";
import { environment } from "../../environments/environment";
import { DictamenEntry, extraDictamenEntries } from "../util/dictamen-extra";

@Component({
  selector: "app-pre-simulator-page",
  standalone: true,
  imports: [CommonModule, SimulationTraceLogComponent, SimulatorFormComponent],
  templateUrl: "./pre-simulator-page.component.html",
  styleUrl: "./pre-simulator-page.component.css",
})
export class PreSimulatorPageComponent {
  private readonly apiService = inject(ApiService);
  private readonly wfValidation = inject(WfValidationService);

  protected readonly maxCols = environment.maxSimulatorColumns;

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly envelope = signal<PreSimulationEnvelope | null>(null);
  protected readonly wfCompare = signal<WfCompareResult | null>(null);

  protected readonly initEvaluations = computed(() => this.envelope()?.init?.all ?? []);
  protected readonly initBlocked = computed(() => this.envelope() !== null && this.envelope()!.pre === null);
  protected readonly preElegibles = computed(() => {
    const pre = this.envelope()?.pre;
    return pre?.preElegibles ?? pre?.eligibleOffers ?? [];
  });
  protected readonly preEvaluations = computed(() => this.envelope()?.pre?.all ?? []);
  protected readonly preEligibleDetails = computed(() => this.preEvaluations().filter((offer) => offer.dictamen?.["preEligible"] === true));
  protected readonly preUiLimits = computed((): Record<string, number | boolean | undefined> => this.envelope()?.pre?.uiLimits ?? {});

  protected extraDictamenEntries(offer: PreEligibleOffer): DictamenEntry[] {
    return extraDictamenEntries(offer.dictamen);
  }

  /** Lectura numérica segura de uiLimits: descarta valores boolean (p. ej. SOLICITAR_DATOS_INTERVINIENTES). */
  protected numUiLimit(key: string): number | undefined {
    const v = this.preUiLimits()[key];
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

  protected minHipoteca(offer: PreEligibleOffer): number | null {
    return this.limitFromOffer(offer, "MIN_HIPOTECA");
  }

  protected maxHipoteca(offer: PreEligibleOffer): number | null {
    return this.limitFromOffer(offer, "MAX_HIPOTECA");
  }

  protected minPlazo(offer: PreEligibleOffer): number | null {
    return this.limitFromOffer(offer, "MIN_PLAZO", "MIN_PLAZO_MESES");
  }

  protected maxPlazo(offer: PreEligibleOffer): number | null {
    return this.limitFromOffer(offer, "MAX_PLAZO", "MAX_PLAZO_MESES");
  }

  protected minLtv(offer: PreEligibleOffer): number | null {
    return this.limitFromOffer(offer, "MIN_LTV_EXCLUSIVE", "MIN_LTV_RATIO");
  }

  protected maxLtv(offer: PreEligibleOffer): number | null {
    return this.limitFromOffer(offer, "MAX_LTV", "MAX_LTV_RATIO");
  }

  protected edadPlazo(offer: PreEligibleOffer): number | null {
    return this.limitFromOffer(offer, "EDAD_PLAZO");
  }

  protected onFormSubmit(event: SimulatorFormSubmit): void {
    if (event.phase !== "PRE") return;

    this.loading.set(true);
    this.error.set(null);
    this.envelope.set(null);
    this.wfCompare.set(null);

    const v = event.values;
    const dos = v.numTitulares === 2;
    const ingresosT1Norm = v.ingresosT1 * v.pagasT1 / 14;
    const ingresosT2Norm = dos ? v.ingresosT2 * v.pagasT2 / 14 : 0;

    const input: PreSimulationInput = {
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

    this.apiService.simulatePre({ input, chained: v.chained, ...wfOptions }).subscribe({
      next: (response) => {
        this.envelope.set(response);
        this.wfCompare.set(response.wfCompare ?? null);
        this.loading.set(false);
      },
      error: (error: Error) => {
        this.error.set(error.message);
        this.loading.set(false);
      },
    });
  }
}
