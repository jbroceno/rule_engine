# SimulatorFormComponent Specification

## Purpose

Shared Angular 20 component that consolidates the form sections from the INIT, PRE, and FINAL simulator pages into a single reusable component. Each page passes its phase to the component, which renders and validates accordingly, then emits typed results to the parent page for API dispatch.

---

## Requirements

### Requirement: Phase Input

The component MUST accept a required `phase` input of type `'INIT' | 'PRE' | 'FINAL'`.
The `phase` value MUST be treated as immutable after `ngOnInit` — the component SHALL NOT respond to runtime changes to this input.

#### Scenario: Valid phase binding

- GIVEN a parent page renders `<app-simulator-form [phase]="'INIT'" />`
- WHEN the component initializes
- THEN the component configures its internal state for INIT and does not respond to any subsequent phase changes

#### Scenario: Missing phase binding (compile-time guard)

- GIVEN `phase` is declared as `@Input({ required: true })`
- WHEN a parent template omits the binding
- THEN the Angular compiler reports a template error and the build fails

---

### Requirement: Unified FormGroup with Phase-Based Field Activation

The component MUST contain a single `FormGroup` that declares ALL fields across all phases.
On `ngOnInit`, fields that are NOT applicable to the current phase MUST be disabled via `disable()`.

Field applicability per phase:

| Field | INIT | PRE | FINAL |
|-------|------|-----|-------|
| edadT1, antiguedadT1, domiciliaNominaT1, finalidad, primeraViviendaHabitual, tipoAlta, importeVivienda, importeVentaCA | enabled | enabled | enabled |
| numTitulares, edadT2, antiguedadT2, domiciliaNominaT2, ingresosT1, pagasT1, ingresosT2, pagasT2, chained | disabled | enabled | enabled |
| importeHipoteca, plazo | disabled | disabled | enabled |

#### Scenario: INIT phase disables PRE/FINAL-only fields

- GIVEN phase is `'INIT'`
- WHEN the component initializes
- THEN `numTitulares`, `edadT2`, `antiguedadT2`, `domiciliaNominaT2`, `ingresosT1`, `pagasT1`, `ingresosT2`, `pagasT2`, `chained`, `importeHipoteca`, and `plazo` are disabled

#### Scenario: PRE phase enables PRE fields, disables FINAL-only fields

- GIVEN phase is `'PRE'`
- WHEN the component initializes
- THEN `importeHipoteca` and `plazo` are disabled
- AND all other fields are enabled

#### Scenario: FINAL phase enables all fields

- GIVEN phase is `'FINAL'`
- WHEN the component initializes
- THEN all fields in the FormGroup are enabled

---

### Requirement: Validators on Enabled Fields Only

Validators for fields that are disabled on `ngOnInit` MUST NOT cause form-level invalidity. Because `disable()` removes a control from validation automatically, validators MAY be declared on every control — phase-gating is achieved exclusively via `disable()`, not by conditionally attaching validators.

#### Scenario: Disabled field with validator does not block submit

- GIVEN phase is `'INIT'` and `importeHipoteca` has a `Validators.required` declaration
- WHEN the user submits without providing `importeHipoteca`
- THEN the form is still considered valid (assuming enabled fields pass validation)

---

### Requirement: WF Block Internal Consumption

The component MUST inject `WfValidationService` internally and consume these signals: `validateWf`, `wfToken`, `wfTokenExpCd`, `comunidadAutonoma`, `numPersonaT1`, `numPersonaT2`.
Parent pages MUST NOT inject `WfValidationService` for purposes that the shared component now handles.
WF values MUST be bundled into the `formSubmit` emit payload rather than emitted separately.

#### Scenario: WF signals bundled in output

- GIVEN phase is `'PRE'` and `validateWf` signal is true
- WHEN the user submits a valid form
- THEN the emitted payload contains the current `wfToken`, `wfTokenExpCd`, `comunidadAutonoma`, `numPersonaT1`, and `numPersonaT2` values alongside the form values

---

### Requirement: Discriminated-Union Output

The component MUST declare an `@Output() formSubmit` that emits one of the following union members based on `phase`:

```ts
| { phase: 'INIT'; values: InitFormValues }
| { phase: 'PRE';  values: PreFormValues }
| { phase: 'FINAL'; preValues: PreFormValues; finalValues: FinalFormValues }
```

The FINAL payload MUST split `getRawValue()` into `preValues` (PRE-applicable fields) and `finalValues` (FINAL-only fields: `importeHipoteca`, `plazo`).

#### Scenario: INIT emit shape

- GIVEN phase is `'INIT'` and the form is valid
- WHEN the user submits
- THEN `formSubmit` emits `{ phase: 'INIT', values: InitFormValues }` with WF values included

#### Scenario: FINAL emit shape

- GIVEN phase is `'FINAL'` and the form is valid
- WHEN the user submits
- THEN `formSubmit` emits `{ phase: 'FINAL', preValues: PreFormValues, finalValues: FinalFormValues }`
- AND `finalValues` contains `importeHipoteca` and `plazo`
- AND `preValues` contains the shared PRE/FINAL fields

---

### Requirement: Submit Validation Gate

The component MUST validate the form before emitting. If the FormGroup is invalid, the component MUST NOT emit `formSubmit` and MUST mark all controls as touched to surface validation errors.

#### Scenario: Invalid form does not emit

- GIVEN a required enabled field is empty
- WHEN the user triggers submit
- THEN `formSubmit` does NOT emit
- AND all controls are marked as touched

#### Scenario: Valid form emits once

- GIVEN all enabled required fields are filled and valid
- WHEN the user triggers submit
- THEN `formSubmit` emits exactly once with the typed payload

---

### Requirement: getRawValue() for Value Extraction

The component MUST use `FormGroup.getRawValue()` (not `.value`) when building the emit payload. This ensures disabled fields retain their default values in the FINAL payload slicing, even though they are not user-editable.

#### Scenario: Disabled field value present in raw value

- GIVEN phase is `'FINAL'` and a PRE field is disabled
- WHEN submit is triggered
- THEN `getRawValue()` includes the disabled field's current value in the payload

---

### Requirement: FINAL Page Duplicate Field Removal

The FINAL simulator page MUST NOT contain the duplicate `numPersonaT1` / `numPersonaT2` inputs that previously existed in the WF fieldset. These values are now read exclusively via `WfValidationService` signals inside the shared component.

#### Scenario: No duplicate WF persona inputs in FINAL template

- GIVEN the FINAL page template after extraction
- WHEN the template is inspected
- THEN no `numPersonaT1` or `numPersonaT2` form inputs exist outside `SimulatorFormComponent`

---

### Requirement: Parent Page Responsibilities After Extraction

Each parent page (INIT, PRE, FINAL) MUST:
1. Replace its inline form section with `<app-simulator-form [phase]="'...'" (formSubmit)="onFormSubmit($event)" />`.
2. Implement `onFormSubmit(event)` to dispatch the API call using the typed payload.
3. Retain all result signals and result template markup — untouched.

#### Scenario: Parent page handles typed submit event

- GIVEN the INIT page has `onFormSubmit(event: { phase: 'INIT'; values: InitFormValues })`
- WHEN `formSubmit` emits
- THEN the page calls the simulation API with `event.values` and stores the result in its own signal

---

### Requirement: Template Syntax Preservation

The component MUST retain `*ngIf` / `*ngFor` structural directive syntax. Migration to `@if` / `@for` control flow blocks is out of scope for this change.

#### Scenario: No @if or @for in the new component template

- GIVEN the shared component template
- WHEN the template is reviewed
- THEN only `*ngIf` and `*ngFor` directives appear — no `@if` or `@for` blocks

---

## Out-of-Scope Constraints

The following MUST NOT be implemented as part of this change:

- REQ-OOS-01: Runtime phase-switching within a single page instance is out of scope.
- REQ-OOS-02: Merging result templates across pages is out of scope.
- REQ-OOS-03: Routing changes are out of scope.
- REQ-OOS-04: `WfValidationService` contract or implementation changes are out of scope.
- REQ-OOS-05: Backend or API changes are out of scope.
- REQ-OOS-06: Migration from `*ngIf`/`*ngFor` to `@if`/`@for` is out of scope.
