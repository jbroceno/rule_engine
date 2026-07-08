# Tasks: shared-simulator-form

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1 400–1 600 (9 files: 3 new, 6 heavily refactored) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 — new shared component (3 files) → PR 2 — refactor 3 pages (6 files) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Create `SimulatorFormComponent` (types + FormGroup + template + empty CSS) | PR 1 | Base = main; new files only, no pages touched; repo stays green |
| 2 | Refactor INIT, PRE, FINAL pages to delegate to shared component | PR 2 | Base = PR 1 branch (stacked); depends on Unit 1 |

---

## Phase 1: Foundation — Types and shared component skeleton

- [ ] 1.1 Create `web/src/app/shared/simulator-form/simulator-form.component.css` — empty placeholder file (REQ-001 file structure)
- [ ] 1.2 Create `web/src/app/shared/simulator-form/simulator-form.component.ts` — declare `SimulatorFormSubmit` discriminated-union type and class stub with `@Input({ required: true }) phase`, `@Output() formSubmit`, `FormBuilder` injection, and full superset `FormGroup` definition (REQ-001, REQ-002, REQ-003)
- [ ] 1.3 Implement `ngOnInit` — disable INIT-irrelevant controls (T2 + income fields, importeHipoteca, plazo); computed `isTwoTitulares` from `numTitulares` valueChanges (REQ-002)
- [ ] 1.4 Implement `submit()` — `markAllAsTouched` guard, `wfValidation.validateWf()` call, build typed `SimulatorFormSubmit` using `getRawValue()` + `toPreValues(raw)` helper, emit (REQ-003, REQ-004, REQ-008)
- [ ] 1.5 Add WF signal aliases — `validateWf`, `wfToken`, `wfTokenExpCd`, `comunidadAutonoma`, `numPersonaT1`, `numPersonaT2` aliased from `WfValidationService`; NOT included in emit payload (REQ-004)

## Phase 2: Shared component template

- [ ] 2.1 Create `web/src/app/shared/simulator-form/simulator-form.component.html` — Titulares fieldset (`*ngIf="phase !== 'INIT'"`) (REQ-007)
- [ ] 2.2 Add Titular 1 fieldset — includes `*ngIf="validateWf()"` numPersona input; ingresos+pagas conditional on `phase !== 'INIT'` (REQ-002, REQ-007)
- [ ] 2.3 Add Titular 2 fieldset — `*ngIf="isTwoTitulares()"` outer guard; T2 fields disabled in ngOnInit for INIT phase (REQ-002, REQ-006)
- [ ] 2.4 Add Solicitud, Vivienda, Préstamo fieldsets — Préstamo wrapped in `*ngIf="phase === 'FINAL'"` (REQ-002, REQ-007)
- [ ] 2.5 Add Opciones de evaluación fieldset — `chained` checkbox visible only when `phase !== 'INIT'` (REQ-002)
- [ ] 2.6 Add Validación WF fieldset and submit button — WF fieldset uses `*ngIf="validateWf()"`; button label via `*ngSwitchCase` per phase (REQ-003, REQ-007)
- [ ] 2.7 Confirm no duplicate `numPersona` inputs in WF fieldset — numPersona belongs only in Titular fieldsets (REQ-006)

## Phase 3: Refactor INIT page

- [ ] 3.1 Update `web/src/app/pages/init-simulator-page.component.ts` — remove FormBuilder/form/submit/WF aliases; import `SimulatorFormComponent`; add `onFormSubmit(payload: SimulatorFormSubmit)` that maps payload to API call (REQ-005)
- [ ] 3.2 Update `web/src/app/pages/init-simulator-page.component.html` — replace `<form>` block with `<app-simulator-form phase="INIT" (formSubmit)="onFormSubmit($event)">`; keep result cards and trace-log (REQ-005)

## Phase 4: Refactor PRE page

- [ ] 4.1 Update `web/src/app/pages/pre-simulator-page.component.ts` — remove FormBuilder/form/isTwoTitulares/submit/WF aliases; import `SimulatorFormComponent`; add `onFormSubmit` (REQ-005)
- [ ] 4.2 Update `web/src/app/pages/pre-simulator-page.component.html` — replace `<form>` with `<app-simulator-form phase="PRE" ...>`; keep result blocks and trace-logs (REQ-005)

## Phase 5: Refactor FINAL page

- [ ] 5.1 Update `web/src/app/pages/final-simulator-page.component.ts` — remove preForm/finalForm/isTwoTitulares/submit/WF aliases; import `SimulatorFormComponent`; add typed `onFormSubmit(payload: SimulatorFormSubmit & { phase: 'FINAL' })` using `toPreValues()` to split into preInput+finalInput for API call (REQ-005, REQ-008)
- [ ] 5.2 Update `web/src/app/pages/final-simulator-page.component.html` — replace entire `<form>` block (~175 lines, dual formGroup) with `<app-simulator-form phase="FINAL" ...>`; keep winner-card, result cards, wfCompare, trace-logs (REQ-005, REQ-006)
