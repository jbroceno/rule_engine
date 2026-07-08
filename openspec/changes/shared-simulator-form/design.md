# Design: shared-simulator-form

## Overview

Introduce a single standalone `SimulatorFormComponent` under `web/src/app/shared/simulator-form/` that owns the entire form section (Titulares + Solicitud + Vivienda + Préstamo + Opciones + Validación WF) for all three simulator phases. The component is parameterised by an immutable `@Input() phase` and emits a discriminated-union `formSubmit` event. Parent pages (`init-simulator-page`, `pre-simulator-page`, `final-simulator-page`) retain their results templates and result signals; they delegate the form to the shared component and react to a single `onFormSubmit(event)` callback.

Pattern: **container–presentational**. Parent pages are containers (own API call, result signals, results template). The shared component is a smart-presentational element (owns form state + WF state, emits typed events).

---

## 1. New file: `SimulatorFormComponent`

### File paths

- `web/src/app/shared/simulator-form/simulator-form.component.ts`
- `web/src/app/shared/simulator-form/simulator-form.component.html`
- `web/src/app/shared/simulator-form/simulator-form.component.css` (empty placeholder; styles inherited from page-level CSS)

Absolute root: `C:\\jesus\\cursos\\IA\\BigSchool-Master dev IA\\tfm\\rule_engine\\rule_set\web\src\app\shared\simulator-form\`

### `@Component` metadata

```ts
@Component({
  selector: "app-simulator-form",
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: "./simulator-form.component.html",
  styleUrl: "./simulator-form.component.css",
})
```

`SimulationTraceLogComponent` is NOT imported here — trace logs stay in parent templates.

### TypeScript public types

Defined at the top of `simulator-form.component.ts` (or co-located in `simulator-form.types.ts` if preferred):

```ts
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
  | { phase: "FINAL"; preValues: PreFormValues; finalValues: FinalFormValues };
```

### Class shape

```ts
export class SimulatorFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly wfValidation = inject(WfValidationService);

  @Input({ required: true }) phase!: SimulatorPhase;
  @Output() readonly formSubmit = new EventEmitter<SimulatorFormSubmit>();

  // Single superset FormGroup — all fields from all phases.
  protected readonly form = this.fb.nonNullable.group({
    // Selector
    numTitulares:            [1,            [Validators.required, Validators.min(1), Validators.max(2)]],
    // Titular 1
    edadT1:                  [35,           [Validators.required, Validators.min(18), Validators.max(99)]],
    antiguedadT1:            [24,           [Validators.required, Validators.min(0)]],
    domiciliaNominaT1:       [false],
    ingresosT1:              [2500,         [Validators.required, Validators.min(0)]],
    pagasT1:                 [14,           [Validators.required, Validators.min(1), Validators.max(20)]],
    // Titular 2
    edadT2:                  [0,            [Validators.min(0), Validators.max(99)]],
    antiguedadT2:            [0,            [Validators.min(0)]],
    domiciliaNominaT2:       [false],
    ingresosT2:              [0,            [Validators.min(0)]],
    pagasT2:                 [14,           [Validators.min(1), Validators.max(20)]],
    // Solicitud
    finalidad:               [1,            [Validators.required]],
    primeraViviendaHabitual: [true],
    tipoAlta:                ["NOVACION",   [Validators.required]],
    importeVivienda:         [200000,       [Validators.required, Validators.min(1)]],
    importeVentaCA:          [150000,       [Validators.required, Validators.min(0)]],
    // Opciones
    chained:                 [true],
    // Préstamo (FINAL)
    importeHipoteca:         [160000,       [Validators.required, Validators.min(1)]],
    plazo:                   [30,           [Validators.required, Validators.min(1), Validators.max(50)]],
  });

  // WF signals aliased from the service so the template can read them directly.
  protected readonly validateWf       = this.wfValidation.validateWf;
  protected readonly wfToken          = this.wfValidation.wfToken;
  protected readonly wfTokenExpCd     = this.wfValidation.wfTokenExpCd;
  protected readonly comunidadAutonoma = this.wfValidation.comunidadAutonoma;
  protected readonly numPersonaT1     = this.wfValidation.numPersonaT1;
  protected readonly numPersonaT2     = this.wfValidation.numPersonaT2;

  // Two-titular toggle driven by numTitulares.valueChanges (same pattern as today).
  private readonly numTitularesValue = toSignal(
    this.form.controls.numTitulares.valueChanges.pipe(startWith(this.form.controls.numTitulares.value)),
  );
  protected readonly isTwoTitulares = computed(() => Number(this.numTitularesValue()) === 2);

  ngOnInit(): void { /* see §1.1 */ }
  protected submit(): void { /* see §1.2 */ }
}
```

Defaults and validators are copied verbatim from existing pages — `pre-simulator-page.component.ts` is the source of truth for the union; INIT-only and FINAL-only defaults come from their respective pages.

### 1.1 `ngOnInit` — phase-conditional disable

Drives the field matrix from the proposal. Disabled controls are excluded from `getRawValue()` automatically.

```ts
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
      // No controls to disable.
      break;
  }
}
```

### 1.2 `submit()` — validate, slice, emit

```ts
protected submit(): void {
  if (this.form.invalid) {
    this.form.markAllAsTouched();
    return;
  }

  const raw = this.form.getRawValue();

  switch (this.phase) {
    case "INIT": {
      const values: InitFormValues = {
        edadT1: raw.edadT1,
        antiguedadT1: raw.antiguedadT1,
        domiciliaNominaT1: raw.domiciliaNominaT1,
        finalidad: raw.finalidad,
        primeraViviendaHabitual: raw.primeraViviendaHabitual,
        tipoAlta: raw.tipoAlta,
        importeVivienda: raw.importeVivienda,
        importeVentaCA: raw.importeVentaCA,
      };
      this.formSubmit.emit({ phase: "INIT", values });
      return;
    }
    case "PRE": {
      const values = this.toPreValues(raw);
      this.formSubmit.emit({ phase: "PRE", values });
      return;
    }
    case "FINAL": {
      const preValues = this.toPreValues(raw);
      const finalValues: FinalFormValues = {
        importeHipoteca: raw.importeHipoteca,
        plazo: raw.plazo,
      };
      this.formSubmit.emit({ phase: "FINAL", preValues, finalValues });
      return;
    }
  }
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
```

Key decisions:
- `getRawValue()` is used so the slicing helper does not need to consult `disabled` state — but only fields relevant to the phase are forwarded into the typed `XxxFormValues`. Disabled fields are not leaked.
- `WfValidationService` signals are NOT included in the emit payload. The service is a singleton; parents already inject it, so they read WF signals on their own when building the API request.
- No transformations in the shared component (`ingresos × pagas / 14`, `EDAD_MAX_NM`, `INGRESO_TOTAL_NM`). Those stay in parent submit handlers — domain mappings to API shape, not form concerns.

---

## 2. HTML template design

File: `simulator-form.component.html`. Single `<form>` element bound to the single `FormGroup`.

```html
<form [formGroup]="form" (ngSubmit)="submit()" novalidate>

  <!-- Num. titulares selector — PRE & FINAL only -->
  <fieldset *ngIf="phase !== 'INIT'">
    <legend>Titulares</legend>
    <div class="grid">
      <label>
        Num. titulares
        <select formControlName="numTitulares">
          <option [value]="1">1 titular</option>
          <option [value]="2">2 titulares</option>
        </select>
      </label>
    </div>
  </fieldset>

  <!-- Titular 1 — always shown; ingresos/pagas only for PRE & FINAL -->
  <fieldset>
    <legend>Titular 1</legend>
    <div class="grid grid-sm">
      <label *ngIf="validateWf()">
        Num. persona
        <input type="text" [value]="numPersonaT1()" (input)="numPersonaT1.set($any($event.target).value)"
               maxlength="10" placeholder="NUM_PERSONA" />
      </label>
      <label>
        Edad T1 (años)
        <input type="number" formControlName="edadT1" min="18" max="99" />
      </label>
      <label>
        Antiguedad T1 (meses)
        <input type="number" formControlName="antiguedadT1" min="0" />
      </label>
      <label *ngIf="phase !== 'INIT'">
        Ingresos T1 (€/mes)
        <input type="number" formControlName="ingresosT1" min="0" />
      </label>
      <label *ngIf="phase !== 'INIT'">
        Num. pagas T1
        <input type="number" formControlName="pagasT1" min="1" max="20" />
        <small>× pagas / 14 al enviar</small>
      </label>
      <label class="check">
        <input type="checkbox" formControlName="domiciliaNominaT1" />
        Domicilia nomina T1
      </label>
    </div>
  </fieldset>

  <!-- Titular 2 — only PRE/FINAL with isTwoTitulares -->
  <fieldset *ngIf="phase !== 'INIT' && isTwoTitulares()">
    <legend>Titular 2</legend>
    <div class="grid grid-sm">
      <label *ngIf="validateWf()">
        Num. persona
        <input type="text" [value]="numPersonaT2()" (input)="numPersonaT2.set($any($event.target).value)"
               maxlength="10" placeholder="NUM_PERSONA" />
      </label>
      <label>Edad T2 (años)<input type="number" formControlName="edadT2" min="0" max="99" /></label>
      <label>Antiguedad T2 (meses)<input type="number" formControlName="antiguedadT2" min="0" /></label>
      <label>Ingresos T2 (€/mes)<input type="number" formControlName="ingresosT2" min="0" /></label>
      <label>Num. pagas T2<input type="number" formControlName="pagasT2" min="1" max="20" /></label>
      <label class="check">
        <input type="checkbox" formControlName="domiciliaNominaT2" />
        Domicilia nomina T2
      </label>
    </div>
  </fieldset>

  <!-- Solicitud — always shown -->
  <fieldset>
    <legend>Solicitud</legend>
    <div class="grid">
      <label>Finalidad (01 = Vivienda habitual)<input type="number" formControlName="finalidad" /></label>
      <label>
        Tipo de alta
        <select formControlName="tipoAlta">
          <option value="CAPTACION">CAPTACION</option>
          <option value="NOVACION">NOVACION</option>
        </select>
      </label>
      <label class="check">
        <input type="checkbox" formControlName="primeraViviendaHabitual" />
        Primera vivienda habitual
      </label>
    </div>
  </fieldset>

  <!-- Vivienda — always shown -->
  <fieldset>
    <legend>Vivienda</legend>
    <div class="grid">
      <label>Importe vivienda (€)<input type="number" formControlName="importeVivienda" min="1" /></label>
      <label>
        Importe venta CCAA (€)
        <input type="number" formControlName="importeVentaCA" min="0" />
        <small>Valor del lookup de precio minimo de compraventa por CCAA</small>
      </label>
    </div>
  </fieldset>

  <!-- Préstamo — FINAL only -->
  <fieldset *ngIf="phase === 'FINAL'">
    <legend>Prestamo</legend>
    <div class="grid">
      <label>Importe hipoteca (€)<input type="number" formControlName="importeHipoteca" min="1" /></label>
      <label>
        Plazo (años)
        <input type="number" formControlName="plazo" min="1" max="50" />
        <small>LTV y edadMasPlazo los calcula el servidor</small>
      </label>
    </div>
  </fieldset>

  <!-- Opciones — PRE & FINAL -->
  <fieldset *ngIf="phase !== 'INIT'">
    <legend>Opciones de evaluacion</legend>
    <div class="grid">
      <label class="check">
        <input type="checkbox" formControlName="chained" />
        Ejecución encadenada
      </label>
    </div>
    <small>Propaga fallos de fases anteriores por oferta.</small>
  </fieldset>

  <!-- Validación WF — always shown; numPersona lives in Titular fieldsets only -->
  <fieldset>
    <legend>Validacion WF</legend>
    <div class="grid">
      <label class="check">
        <input type="checkbox" [checked]="validateWf()" (change)="validateWf.set(!validateWf())" />
        Validar contra motor WF
      </label>
    </div>
    <div class="grid" *ngIf="validateWf()">
      <label>Token<input type="text" [value]="wfToken()" (input)="wfToken.set($any($event.target).value)" placeholder="Token de seguridad WF" /></label>
      <label>Token expediente<input type="text" [value]="wfTokenExpCd()" (input)="wfTokenExpCd.set($any($event.target).value)" placeholder="UUID del expediente" /></label>
      <label>Comunidad autónoma<input type="text" [value]="comunidadAutonoma()" (input)="comunidadAutonoma.set($any($event.target).value)" placeholder="Cód. CCAA para WF" /></label>
    </div>
  </fieldset>

  <button class="btn" type="submit">
    <ng-container [ngSwitch]="phase">
      <span *ngSwitchCase="'INIT'">Ejecutar INIT</span>
      <span *ngSwitchCase="'PRE'">Ejecutar PRE</span>
      <span *ngSwitchCase="'FINAL'">Ejecutar FINAL</span>
    </ng-container>
  </button>
</form>
```

Notes:
- WF fieldset shows ONLY token/tokenExp/CCAA. `numPersonaT1`/`numPersonaT2` live inside Titular fieldsets gated by `validateWf()`.
- `loading` state lives in the parent; submit button is not loading-aware (ADR-6).
- `*ngIf` / `*ngSwitch` only. No `@if` / `@for`.

---

## 3. Changes to each parent page

### 3.1 `init-simulator-page.component.ts`

**Remove**: `FormBuilder`, all WF signal aliases, the entire `form` group definition, the `if (this.form.invalid)` block, `const raw = this.form.getRawValue()`.

**Keep**: `apiService`, `wfValidation` (still reads WF signals when building request), all result signals (`loading`, `error`, `initElegibles`, `initUiLimits`, `evaluations`, `wfCompare`), `maxCols`, `limitFromOffer`.

**Add**:
```ts
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
    ? { validateWf: true, wfToken: this.wfValidation.wfToken(), wfTokenExpCd: this.wfValidation.wfTokenExpCd(),
        wfComunidadAutonoma: this.wfValidation.comunidadAutonoma(), wfNumPersonaT1: this.wfValidation.numPersonaT1() }
    : {};

  this.apiService.simulateInit({ input, ...wfOptions }).subscribe({ ... });
}
```

**Template**: replace entire `<form>` block with `<app-simulator-form phase="INIT" (formSubmit)="onFormSubmit($event)" />`.

### 3.2 `pre-simulator-page.component.ts`

**Remove**: `FormBuilder`, WF aliases, `form` group, `numTitularesValue`, `isTwoTitulares`, `submit()` form validation block.

**Keep**: `apiService`, `wfValidation`, all result signals/computed, all `limitFromOffer` / min/max helpers, `maxCols`.

**Add**: `onFormSubmit(event: SimulatorFormSubmit)` — reads `event.values`, builds `PreSimulationInput` (with `ingresos × pagas / 14`, `EDAD_MAX_NM`, `INGRESO_TOTAL_NM` calculations), reads WF options from `this.wfValidation`, calls `apiService.simulatePre(...)`.

**Template**: replace entire `<form>` block with `<app-simulator-form phase="PRE" (formSubmit)="onFormSubmit($event)" />`.

### 3.3 `final-simulator-page.component.ts`

**Remove**: `FormBuilder`, WF aliases, `preForm`, `finalForm`, `numTitularesValue`, `isTwoTitulares`, existing `onFormSubmit(event: Event)`.

**Keep**: `apiService`, `wfValidation`, all result signals/computed, `limitFromOffer`, `winnerDescription`, `maxCols`.

**Add**: `onFormSubmit(event: SimulatorFormSubmit)` — reads `event.preValues` and `event.finalValues`, builds `PreSimulationInput` + `FinalSimulationInput`, reads WF options from `this.wfValidation`, calls `apiService.simulateFinal(...)`.

**Template**: replace entire `<form>` block with `<app-simulator-form phase="FINAL" (formSubmit)="onFormSubmit($event)" />`.

---

## 4. ADR-style decisions

### ADR-1: Single FormGroup
**Decision**: Single superset `FormGroup`, fields disabled per phase via `ngOnInit`.
**Rationale**: One validity check, one `getRawValue()` call, one `markAllAsTouched()`. FINAL's two-group pattern disappears.

### ADR-2: WF state stays in `WfValidationService`
**Decision**: Shared component injects the service; parents also keep the injection to read WF signals when building API requests. WF signals are NOT in the emit payload.
**Rationale**: The service already round-trips to localStorage. Passing WF signals through the payload would duplicate state. Parents need the service anyway.

### ADR-3: No transformations in shared component
**Decision**: `ingresos × pagas / 14`, `EDAD_MAX_NM`, `INGRESO_TOTAL_NM` stay in parent submit handlers.
**Rationale**: These are API-shape mappings, not form concerns.

### ADR-4: Discriminated union output
**Decision**: Single `formSubmit: EventEmitter<SimulatorFormSubmit>`.
**Rationale**: TypeScript narrowing on `event.phase` gives compile-time guarantees about which fields exist.

### ADR-5: `*ngIf` style preserved
**Decision**: Use `*ngIf` / `*ngFor` / `*ngSwitch` only. No `@if`/`@for` migration.

### ADR-6: Submit button not loading-aware
**Decision**: Button always enabled. Parents render their own status block.
**Tradeoff**: Users can click submit during loading. Acceptable for internal simulator.

---

## 5. Component contract summary

```
Inputs:
  phase: 'INIT' | 'PRE' | 'FINAL'   required, immutable

Outputs:
  formSubmit: SimulatorFormSubmit   fired on successful validation

Side effects:
  - Reads/writes WF signals via WfValidationService

Internal state:
  - Single FormGroup with phase-conditional disabled fields
  - isTwoTitulares computed signal

Does NOT:
  - Show loading or error indicators
  - Make HTTP calls
  - Transform form values into API shapes
```

---

## 6. File list

### Created (3)
| Path | Purpose |
|------|---------|
| `web/src/app/shared/simulator-form/simulator-form.component.ts` | Class + types + form definition + submit logic |
| `web/src/app/shared/simulator-form/simulator-form.component.html` | Form template with phase-conditional fieldsets |
| `web/src/app/shared/simulator-form/simulator-form.component.css` | Empty placeholder |

### Modified (6)
| Path | Change |
|------|--------|
| `web/src/app/pages/init-simulator-page.component.ts` | Remove form/WF aliases; add `onFormSubmit` |
| `web/src/app/pages/init-simulator-page.component.html` | Replace `<form>` with `<app-simulator-form phase="INIT" .../>` |
| `web/src/app/pages/pre-simulator-page.component.ts` | Remove form/WF aliases/`isTwoTitulares`; add `onFormSubmit` |
| `web/src/app/pages/pre-simulator-page.component.html` | Replace `<form>` with `<app-simulator-form phase="PRE" .../>` |
| `web/src/app/pages/final-simulator-page.component.ts` | Remove `preForm`/`finalForm`/WF aliases; replace `onFormSubmit(Event)` with typed version |
| `web/src/app/pages/final-simulator-page.component.html` | Replace `<form>` with `<app-simulator-form phase="FINAL" .../>` |

### Not touched
- `services/wf-validation.service.ts`, `services/api.service.ts`, `models/api.models.ts`
- `shared/simulation-trace-log.component.*`
- Routes, page-level CSS, backend, SQL
