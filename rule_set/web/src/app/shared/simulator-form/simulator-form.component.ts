import { CommonModule } from "@angular/common";
import { Component, computed, EventEmitter, inject, Input, OnInit, Output, signal } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { startWith } from "rxjs";
import { OfferConfig } from "../../models/api.models";
import { WfValidationService } from "../../services/wf-validation.service";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SimulatorPhase = "INIT" | "PRE" | "FINAL";

export interface InitFormValues {
  edadT1: number;
  antiguedadT1: number;
  domiciliaNominaT1: boolean;
  finalidad: number;
  primeraViviendaHabitual: boolean;
  tipoAlta: string;
  importeVivienda: number;
  importeVentaCA: number;
}

export interface PreFormValues {
  numTitulares: number;
  edadT1: number;
  antiguedadT1: number;
  domiciliaNominaT1: boolean;
  ingresosT1: number;
  pagasT1: number;
  edadT2: number;
  antiguedadT2: number;
  domiciliaNominaT2: boolean;
  ingresosT2: number;
  pagasT2: number;
  finalidad: number;
  primeraViviendaHabitual: boolean;
  tipoAlta: string;
  importeVivienda: number;
  importeVentaCA: number;
  chained: boolean;
}

export interface FinalFormValues {
  importeHipoteca: number;
  plazo: number;
}

export type SimulatorFormSubmit =
  | { phase: "INIT";  values: InitFormValues }
  | { phase: "PRE";   values: PreFormValues }
  | { phase: "FINAL"; preValues: PreFormValues; finalValues: FinalFormValues; offerCodes?: string[] };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

@Component({
  selector: "app-simulator-form",
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: "./simulator-form.component.html",
  styleUrl: "./simulator-form.component.css",
})
export class SimulatorFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly wfValidation = inject(WfValidationService);

  @Input({ required: true }) phase!: SimulatorPhase;

  /** Ofertas disponibles (solo FINAL). La página contenedora las carga y las pasa aquí. */
  @Input() set offers(value: OfferConfig[] | null) {
    const list = value ?? [];
    this.offersList.set(list);
    this.selectedOffers.set(new Set(list.map((offer) => offer.offerCode)));
  }

  @Output() readonly formSubmit = new EventEmitter<SimulatorFormSubmit>();

  protected readonly offersList = signal<OfferConfig[]>([]);
  protected readonly selectedOffers = signal<ReadonlySet<string>>(new Set());
  protected readonly offerSelectionEmpty = computed(
    () => this.offersList().length > 0 && this.selectedOffers().size === 0,
  );

  protected readonly form = this.fb.nonNullable.group({
    numTitulares:            [1,            [Validators.required, Validators.min(1), Validators.max(2)]],
    edadT1:                  [35,           [Validators.required, Validators.min(18), Validators.max(99)]],
    antiguedadT1:            [24,           [Validators.required, Validators.min(0)]],
    domiciliaNominaT1:       [false],
    ingresosT1:              [2500,         [Validators.required, Validators.min(0)]],
    pagasT1:                 [14,           [Validators.required, Validators.min(1), Validators.max(20)]],
    edadT2:                  [0,            [Validators.min(0), Validators.max(99)]],
    antiguedadT2:            [0,            [Validators.min(0)]],
    domiciliaNominaT2:       [false],
    ingresosT2:              [0,            [Validators.min(0)]],
    pagasT2:                 [14,           [Validators.min(1), Validators.max(20)]],
    finalidad:               [1,            [Validators.required]],
    primeraViviendaHabitual: [true],
    tipoAlta:                ["NOVACION",   [Validators.required]],
    importeVivienda:         [200000,       [Validators.required, Validators.min(1)]],
    importeVentaCA:          [150000,       [Validators.required, Validators.min(0)]],
    chained:                 [true],
    importeHipoteca:         [160000,       [Validators.required, Validators.min(1)]],
    plazo:                   [30,           [Validators.required, Validators.min(1), Validators.max(50)]],
  });

  protected readonly validateWf        = this.wfValidation.validateWf;
  protected readonly wfToken           = this.wfValidation.wfToken;
  protected readonly wfTokenExpCd      = this.wfValidation.wfTokenExpCd;
  protected readonly comunidadAutonoma = this.wfValidation.comunidadAutonoma;
  protected readonly numPersonaT1      = this.wfValidation.numPersonaT1;
  protected readonly numPersonaT2      = this.wfValidation.numPersonaT2;

  private readonly numTitularesValue = toSignal(
    this.form.controls.numTitulares.valueChanges.pipe(
      startWith(this.form.controls.numTitulares.value),
    ),
  );
  protected readonly isTwoTitulares = computed(() => Number(this.numTitularesValue()) === 2);

  ngOnInit(): void {
    const c = this.form.controls;
    switch (this.phase) {
      case "INIT":
        c.numTitulares.disable();
        c.edadT2.disable();
        c.antiguedadT2.disable();
        c.domiciliaNominaT2.disable();
        c.ingresosT1.disable();
        c.pagasT1.disable();
        c.ingresosT2.disable();
        c.pagasT2.disable();
        c.chained.disable();
        c.importeHipoteca.disable();
        c.plazo.disable();
        break;
      case "PRE":
        c.importeHipoteca.disable();
        c.plazo.disable();
        break;
      case "FINAL":
        break;
    }
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    switch (this.phase) {
      case "INIT": {
        this.formSubmit.emit({
          phase: "INIT",
          values: {
            edadT1: raw.edadT1,
            antiguedadT1: raw.antiguedadT1,
            domiciliaNominaT1: raw.domiciliaNominaT1,
            finalidad: raw.finalidad,
            primeraViviendaHabitual: raw.primeraViviendaHabitual,
            tipoAlta: raw.tipoAlta,
            importeVivienda: raw.importeVivienda,
            importeVentaCA: raw.importeVentaCA,
          },
        });
        return;
      }
      case "PRE":
        this.formSubmit.emit({ phase: "PRE", values: this.toPreValues(raw) });
        return;
      case "FINAL": {
        if (this.offerSelectionEmpty()) {
          return;
        }
        this.formSubmit.emit({
          phase: "FINAL",
          preValues: this.toPreValues(raw),
          finalValues: { importeHipoteca: raw.importeHipoteca, plazo: raw.plazo },
          offerCodes: this.selectedOfferCodes(),
        });
        return;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Selección de ofertas (FINAL)
  // ---------------------------------------------------------------------------

  protected isOfferSelected(offerCode: string): boolean {
    return this.selectedOffers().has(offerCode);
  }

  protected toggleOffer(offerCode: string): void {
    const next = new Set(this.selectedOffers());
    if (next.has(offerCode)) {
      next.delete(offerCode);
    } else {
      next.add(offerCode);
    }
    this.selectedOffers.set(next);
  }

  protected selectAllOffers(): void {
    this.selectedOffers.set(new Set(this.offersList().map((offer) => offer.offerCode)));
  }

  protected selectNoOffers(): void {
    this.selectedOffers.set(new Set());
  }

  protected invertOfferSelection(): void {
    const current = this.selectedOffers();
    const next = new Set(
      this.offersList()
        .map((offer) => offer.offerCode)
        .filter((code) => !current.has(code)),
    );
    this.selectedOffers.set(next);
  }

  /** Subconjunto seleccionado, o undefined si están todas (= comportamiento por defecto). */
  private selectedOfferCodes(): string[] | undefined {
    const list = this.offersList();
    const selected = this.selectedOffers();
    if (!list.length || selected.size === list.length) {
      return undefined;
    }
    return list.map((offer) => offer.offerCode).filter((code) => selected.has(code));
  }

  private toPreValues(raw: ReturnType<typeof this.form.getRawValue>): PreFormValues {
    return {
      numTitulares: raw.numTitulares,
      edadT1: raw.edadT1,
      antiguedadT1: raw.antiguedadT1,
      domiciliaNominaT1: raw.domiciliaNominaT1,
      ingresosT1: raw.ingresosT1,
      pagasT1: raw.pagasT1,
      edadT2: raw.edadT2,
      antiguedadT2: raw.antiguedadT2,
      domiciliaNominaT2: raw.domiciliaNominaT2,
      ingresosT2: raw.ingresosT2,
      pagasT2: raw.pagasT2,
      finalidad: raw.finalidad,
      primeraViviendaHabitual: raw.primeraViviendaHabitual,
      tipoAlta: raw.tipoAlta,
      importeVivienda: raw.importeVivienda,
      importeVentaCA: raw.importeVentaCA,
      chained: raw.chained,
    };
  }
}
