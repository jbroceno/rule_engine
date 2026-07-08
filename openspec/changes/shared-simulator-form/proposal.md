# Proposal: shared-simulator-form

## What

Extract the form section of the three simulator pages (`init-simulator-page`, `pre-simulator-page`, `final-simulator-page`) into a single shared standalone Angular component, `SimulatorFormComponent`, parameterised by an immutable `phase: 'INIT' | 'PRE' | 'FINAL'` input.

The shared component owns:
- A **single `FormGroup`** containing the superset of all simulator fields (Option A).
- The WF validation block (`validateWf`, `wfToken`, `wfTokenExpCd`, `comunidadAutonoma`, `numPersonaT1`, `numPersonaT2`) consumed via direct injection of `WfValidationService`.
- The `isTwoTitulares` computed signal driving T2 fieldset visibility.
- Validators and `disable()` calls applied on `ngOnInit` based on `phase`, so fields not used in the current phase are excluded from `getRawValue()`.
- A typed `@Output() formSubmit` emitting a discriminated union (see Approach below).

Each parent page keeps its own:
- Route, page shell, results section (cards, trace logs, `wfCompare`, winner blocks for FINAL).
- API call wiring (`ApiService` method per phase).
- Result signals and computed helpers (`limitFromOffer`, `minPlazo`, etc.).

## Why

**Usability**: Today, the same form lives in three places with subtle divergences (FINAL omits `[formGroup]` on the `<form>` tag and uses two internal groups; FINAL duplicates `numPersonaT1/T2` in the WF fieldset). Touching one form means touching all three — error-prone and inconsistent.

**DRY**: ~330 lines of nearly identical form HTML (plus three copies of the WF block and three copies of the `isTwoTitulares` wiring) collapse into a single component. New simulator fields, validator tweaks, or WF block changes happen once.

**Consistency**: The FINAL WF fieldset's duplicated `numPersona` inputs get reconciled — `numPersona` lives only inside the respective Titular fieldset, gated by `validateWf()`.

**Maintainability**: Adding a future phase (or simulator variant) becomes a matter of extending the `phase` union and adjusting validator/disable logic in one place.

## Scope

### In scope

- Create `SimulatorFormComponent` under `web/src/app/shared/simulator-form/`.
- Define `SimulatorFormSubmit` discriminated union and `InitFormValues`, `PreFormValues`, `FinalFormValues` types.
- Move the form template (titular T1 fieldset, titular T2 fieldset, operación fieldset, WF fieldset, submit button) into the shared component.
- Move the `isTwoTitulares` computed and `WfValidationService` consumption into the shared component.
- Refactor `init-simulator-page`, `pre-simulator-page`, `final-simulator-page` to render `<app-simulator-form [phase]="..." (formSubmit)="onSubmit($event)" />` and keep only the results section.
- Consolidate FINAL's duplicated `numPersona` inputs: keep them inside the T1/T2 fieldsets only, gated by `validateWf()`.
- Match existing template conventions (`*ngIf` / `*ngFor`, NOT `@if` / `@for`) to avoid mixed-syntax churn.

### Out of scope

- A unified simulator page that switches phase at runtime. **`phase` is immutable**, set once via `@Input()` when the page renders. No `ngOnChanges` handling for phase mutation.
- Merging the result templates (offer cards, winner block, `wfCompare` sections) — these stay per-page because INIT, PRE, and FINAL diverge meaningfully in what they display.
- Routing changes. The three routes (`/simulador-init`, `/simulador-pre`, `/simulador-final`) stay as-is.
- Migrating to Angular 20 control-flow syntax (`@if`/`@for`) — that's a separate cleanup.
- Changes to `WfValidationService` itself — the service is already a root-scoped singleton and is consumed unchanged.
- Backend / SQL / rule-engine changes.

## Approach

### 1. Single `FormGroup` with phase-conditional `disable()` (Option A)

One `FormGroup<SimulatorFormControls>` is constructed with **every** field across all three phases. On `ngOnInit`, based on the immutable `phase` input, fields not applicable to the current phase are `disable()`d. Because the group is `nonNullable` and disabled controls are excluded from `getRawValue()`, the emitted payload contains only the live fields for that phase.

Field matrix:

| Field group | INIT | PRE | FINAL |
|-------------|:----:|:---:|:-----:|
| `edadT1`, `antiguedadT1`, `domiciliaNominaT1`, `finalidad`, `primeraViviendaHabitual`, `tipoAlta`, `importeVivienda`, `importeVentaCA` | ✓ | ✓ | ✓ |
| `numTitulares`, `edadT2`, `antiguedadT2`, `domiciliaNominaT2`, `ingresosT1`, `pagasT1`, `ingresosT2`, `pagasT2`, `chained` | — | ✓ | ✓ |
| `importeHipoteca`, `plazo` | — | — | ✓ |

T2 fields (`edadT2`, `antiguedadT2`, etc.) are additionally toggled by `isTwoTitulares()` within PRE/FINAL — this is an *internal* visibility/validator concern, not a phase concern.

### 2. Immutable `phase` input

```ts
@Input({ required: true }) phase!: 'INIT' | 'PRE' | 'FINAL';
```

Set once when the parent page renders. No runtime switching, no `ngOnChanges`. Parent pages are statically bound to one phase by their route.

### 3. WF block consumed internally

The shared component injects `WfValidationService` directly. The WF signals (`validateWf`, `wfToken`, `wfTokenExpCd`, `comunidadAutonoma`, `numPersonaT1`, `numPersonaT2`) are read internally to drive the WF fieldset template and the conditional `numPersona` inputs inside the Titular fieldsets. On submit, the current WF values are bundled into the emit payload so the parent does not need to wire the service itself.

### 4. Discriminated-union output

```ts
export type SimulatorFormSubmit =
  | { phase: 'INIT';  values: InitFormValues }
  | { phase: 'PRE';   values: PreFormValues }
  | { phase: 'FINAL'; preValues: PreFormValues; finalValues: FinalFormValues };

@Output() formSubmit = new EventEmitter<SimulatorFormSubmit>();
```

For `FINAL`, the shared component slices the single `getRawValue()` into `preValues` and `finalValues` shapes before emitting, so the parent page can pass each chunk to the right API argument without inspecting field names. The narrow `phase` tag lets each parent `switch` (or simply destructure for the one phase it cares about) with no casting.

### 5. Submit semantics

- INIT/PRE use `(ngSubmit)` on the inner `<form>`. FINAL's current `(submit)="onFormSubmit($event)"` pattern is absorbed — the shared component picks a single convention (`ngSubmit`) internally.
- Before emitting, the component calls `markAllAsTouched()` on the group. If the group is invalid, no emit happens.
- For FINAL, the same single-group validation covers both pre and final fields (no separate `markAllAsTouched` for two groups, because there's only one group).

### 6. Parent pages become thin

```html
<!-- e.g. final-simulator-page.component.html -->
<app-simulator-form phase="FINAL" (formSubmit)="onSubmit($event)" />

<!-- results section unchanged: winner card, finalEligibleDetails, finalUiLimits, wfCompare with ofertaGanadora -->
```

```ts
onSubmit(event: SimulatorFormSubmit) {
  if (event.phase !== 'FINAL') return; // type narrowing
  this.api.simulateFinal(event.preValues, event.finalValues).subscribe(...);
}
```

## Key risks

Inherited from exploration, now scoped against the confirmed decisions:

1. **FINAL submit validation**: with the single-FormGroup decision, FINAL must validate the *entire* group (PRE-shared fields + FINAL-only fields). One `markAllAsTouched()` + one `invalid` check covers it — simpler than the original two-group risk.
2. **FINAL WF fieldset duplicate `numPersona` inputs**: the legacy template has `numPersonaT1/T2` both inside the Titular fieldsets AND duplicated inside the WF fieldset. The shared component resolves this by keeping `numPersona` inputs only inside the Titular fieldsets, gated by `validateWf()`. This is a deliberate behavioral cleanup, not a bug-for-bug port.
3. **`phase` must be set before first render**: because `phase` is `required: true` and immutable, parent templates must bind it as a static string (`phase="INIT"`), not via a signal that could be empty on first render. Spec must call this out.
4. **Slicing `getRawValue()` into `preValues` / `finalValues` for FINAL**: the shared component must declare which field names belong to which slice. A small helper (`splitFinalValues(raw)`) keeps this explicit and testable.
5. **Disabled-field defaults**: when a phase doesn't use a field, that field is still in the group but `disable()`d. Default values for disabled fields are irrelevant to `getRawValue()` but matter if the group is ever inspected via `.value` directly — the spec should require `getRawValue()` for the slicing helper.
6. **Template directive convention**: shared component uses `*ngIf`/`*ngFor` to match the existing codebase. Not a technical risk, but a style consistency note.

## Out of scope (explicit recap)

- A unified simulator page that picks `phase` dynamically.
- Merging result templates across INIT/PRE/FINAL.
- Routing changes.
- Migrating to Angular 20 `@if`/`@for` control flow.
- Changes to `WfValidationService` or any backend/SQL artifact.
