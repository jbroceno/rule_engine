# Verify Report: shared-simulator-form

**Date**: 2026-05-28
**Verifier**: sdd-verify (Claude Sonnet 4.6)
**Overall Status**: PASS
**Findings**: 0 CRITICAL · 1 WARNING · 2 SUGGESTION

---

## Test Run

| Suite | Tests | Pass | Fail |
|-------|-------|------|------|
| SimulatorFormComponent | 19 | 19 | 0 |
| SimulationTraceLogComponent | 8 | 8 | 0 |
| AppComponent (pre-existing failure) | 2 | 1 | 1* |
| **Total** | **29** | **28** | **1*** |

*Pre-existing failure: `app.spec.ts:23` — title mismatch `'MVP Simulador de Ofertas'` vs `'Simulador de Ofertas'`. Not caused by this change; documented in apply-progress.

---

## REQ Compliance Matrix

| Requirement | Status |
|-------------|--------|
| Phase Input — `@Input({ required: true }) phase!: SimulatorPhase` | PASS |
| Unified FormGroup, all fields declared | PASS |
| INIT disables 11 fields (numTitulares, T2 group, ingresos/pagas, chained, importeHipoteca, plazo) | PASS |
| PRE disables exactly 2 fields (importeHipoteca, plazo) | PASS |
| FINAL disables 0 fields | PASS |
| Validators on enabled fields only — disabled fields don't block form validity | PASS |
| WfValidationService injected internally, all 6 signals aliased | PASS |
| Discriminated-union `SimulatorFormSubmit` output declared | PASS |
| INIT emit shape: `{ phase: 'INIT', values: InitFormValues }` | PASS |
| PRE emit shape: `{ phase: 'PRE', values: PreFormValues }` | PASS |
| FINAL emit shape: `{ phase: 'FINAL', preValues: PreFormValues, finalValues: FinalFormValues }` | PASS |
| Submit guard: markAllAsTouched + no emit on invalid | PASS |
| `getRawValue()` used (not `.value`) | PASS |
| `toPreValues()` picks exactly 17 PreFormValues fields — no FINAL-only leakage | PASS |
| No duplicate numPersona inputs in WF fieldset | PASS |
| INIT page: form replaced with `<app-simulator-form phase="INIT">` | PASS |
| PRE page: form replaced with `<app-simulator-form phase="PRE">` | PASS |
| FINAL page: form replaced with `<app-simulator-form phase="FINAL">` | PASS |
| All parent pages retain result signals and wfValidation injection | PASS |
| Template syntax: `*ngIf`/`*ngFor`/`*ngSwitch` only — no `@if`/`@for` | PASS |

---

## Design ADR Compliance

| ADR | Decision | Status |
|-----|----------|--------|
| ADR-1 | Single superset FormGroup with phase-disabled fields | PASS |
| ADR-2 | WF NOT in emit payload; parents read from service | PASS |
| ADR-3 | No data transforms in shared component (`ingresos × pagas / 14` stays in pages) | PASS |
| ADR-4 | Discriminated union `SimulatorFormSubmit` — single `@Output` | PASS |
| ADR-5 | `*ngIf`/`*ngFor`/`*ngSwitch` only | PASS |
| ADR-6 | Submit button always enabled | PASS |
| ADR-7 | Result templates remain per-page | PASS |

---

## Field Matrix Verification

### INIT disabled controls (ngOnInit case 'INIT')

| Control | Disabled? |
|---------|-----------|
| numTitulares | YES |
| ingresosT1 | YES |
| pagasT1 | YES |
| edadT2 | YES |
| antiguedadT2 | YES |
| domiciliaNominaT2 | YES |
| ingresosT2 | YES |
| pagasT2 | YES |
| chained | YES |
| importeHipoteca | YES |
| plazo | YES |

All 11 INIT-irrelevant fields disabled. 8 INIT fields remain enabled. PASS.

### PRE disabled controls (ngOnInit case 'PRE')

| Control | Disabled? |
|---------|-----------|
| importeHipoteca | YES |
| plazo | YES |

Exactly 2 fields disabled. PASS.

### FINAL disabled controls (ngOnInit case 'FINAL')

Empty switch case — zero fields disabled. PASS.

---

## toPreValues() Field Audit

17 fields picked explicitly: `numTitulares`, `edadT1`, `antiguedadT1`, `domiciliaNominaT1`, `ingresosT1`, `pagasT1`, `edadT2`, `antiguedadT2`, `domiciliaNominaT2`, `ingresosT2`, `pagasT2`, `finalidad`, `primeraViviendaHabitual`, `tipoAlta`, `importeVivienda`, `importeVentaCA`, `chained`.

`importeHipoteca` and `plazo` are NOT included — correctly excluded from preValues. PASS.

---

## Findings

### WARNING

**W-01 — Spec/Design conflict on WF payload bundling (documentation only)**

- **Location**: Spec requirement "WF Block Internal Consumption" says *"WF values MUST be bundled into the `formSubmit` emit payload."* Design ADR-2 overrides this: *"WF NOT in emit payload. Parents read them from service."*
- **Implementation**: Follows ADR-2 correctly. No runtime defect.
- **Impact**: The spec text is misleading for future readers. It should be updated to match the design decision before archiving.
- **Action**: Update spec artifact to remove the contradictory bundling statement and align with ADR-2.

---

### SUGGESTION

**S-01 — Missing invalid-form test for PRE and FINAL phases**

The spec scenario "Invalid form does not emit" is tested only for INIT phase (`spec.ts:140`). PRE and FINAL have no equivalent test. The guard logic is phase-agnostic, so risk is low, but coverage is uneven. Consider adding the symmetric test for at least one other phase.

**S-02 — Tasks artifact tasks 3.x–5.x remain unchecked**

The tasks artifact shows tasks 3.1–5.2 as `[ ]` (unchecked). The apply-progress artifact correctly marks them as `[x]`. The code confirms they are fully implemented. The tasks artifact was not updated in the final apply batch. No runtime impact, but the artifacts are inconsistent. Update tasks artifact before archive or note in archive-report.

---

## Task Completion vs Code State

| Task Range | Tasks Artifact | Apply Progress | Code State |
|------------|----------------|----------------|------------|
| 1.1–1.5 (shared .ts) | [x] | [x] | Implemented |
| 2.1–2.7 (shared .html) | [x] | [x] | Implemented |
| 3.1–3.2 (INIT page) | [ ] | [x] | Implemented |
| 4.1–4.2 (PRE page) | [ ] | [x] | Implemented |
| 5.1–5.2 (FINAL page) | [ ] | [x] | Implemented |

---

## Files Verified

| File | Verdict |
|------|---------|
| `web/src/app/shared/simulator-form/simulator-form.component.ts` | PASS |
| `web/src/app/shared/simulator-form/simulator-form.component.html` | PASS |
| `web/src/app/shared/simulator-form/simulator-form.component.spec.ts` | PASS |
| `web/src/app/pages/init-simulator-page.component.ts` | PASS |
| `web/src/app/pages/init-simulator-page.component.html` | PASS |
| `web/src/app/pages/pre-simulator-page.component.ts` | PASS |
| `web/src/app/pages/pre-simulator-page.component.html` | PASS |
| `web/src/app/pages/final-simulator-page.component.ts` | PASS |
| `web/src/app/pages/final-simulator-page.component.html` | PASS |

---

## Next Recommended Action

`sdd-archive` — no CRITICAL issues. Address W-01 (spec text correction) and S-02 (tasks artifact sync) as part of the archive step or as a note in the archive-report.
