# Exploration: shared-simulator-form

## Summary

Three standalone Angular 20 simulator pages (INIT, PRE, FINAL) share ~80% of their form template. Extracting a shared `SimulatorFormComponent` is feasible at medium effort. Results sections are genuinely divergent and should stay in each page.

## Field Matrix

| Field | INIT | PRE | FINAL |
|-------|------|-----|-------|
| edadT1, antiguedadT1, domiciliaNominaT1 | ✓ | ✓ | ✓ |
| finalidad, primeraViviendaHabitual, tipoAlta, importeVivienda, importeVentaCA | ✓ | ✓ | ✓ |
| numTitulares | ✗ | ✓ | ✓ |
| edadT2, antiguedadT2, domiciliaNominaT2, ingresosT2, pagasT2 | ✗ | ✓ | ✓ |
| ingresosT1, pagasT1 | ✗ | ✓ | ✓ |
| chained | ✗ | ✓ | ✓ |
| importeHipoteca, plazo | ✗ | ✗ | ✓ |

## Key Findings

### Form structure
- INIT and PRE: single `[formGroup]` on `<form>` tag
- FINAL: two separate groups (`preForm` + `finalForm`) applied per-fieldset with no `[formGroup]` on `<form>`
- Shared component must manage both groups internally; `submit()` must call `markAllAsTouched()` on both

### WF block
- Identical across INIT and PRE
- FINAL duplicates the `numPersonaT1`/`numPersonaT2` inputs inside the WF fieldset — consolidation needed

### isTwoTitulares logic
- Derived from `numTitulares.valueChanges` — belongs inside the shared component

### Results sections
- Genuinely divergent (INIT: eligible offers + uiLimits; PRE: preEligibleDetails + preUiLimits; FINAL: winner card + merged dictamen)
- Do NOT unify — would increase complexity with no net gain

## Recommended Approach

Single `SimulatorFormComponent` with `phase: 'INIT' | 'PRE' | 'FINAL'` input.

**Validator strategy**: Fields inapplicable to the current phase are `disable()`d on `ngOnInit`. Angular excludes disabled controls from `getRawValue()` — no conditional validator management needed.

**Emit interface** (discriminated union):
```ts
export type SimulatorFormSubmit =
  | { phase: 'INIT'; values: InitFormValues }
  | { phase: 'PRE';  values: PreFormValues }
  | { phase: 'FINAL'; preValues: PreFormValues; finalValues: FinalFormValues };
```

**WF signals**: consumed internally via `inject(WfValidationService)`. WF options bundled into emit payload — parent doesn't need to touch the service.

**`phase` input**: immutable after `ngOnInit` (no `ngOnChanges` needed).

## Risks

1. FINAL's two-group pattern: shared component must validate both `mainGroup` and `finalGroup` on submit
2. FINAL WF fieldset duplicates `numPersona` inputs — consolidation decision needed before implementation
3. `phase` must be set before first render; runtime phase switching is not supported by this design

## Alternatives Considered

| Approach | Verdict |
|----------|---------|
| Shared `WfBlockComponent` only | Too narrow — removes ~20 lines/page, main duplication stays |
| Component inheritance | Angular discourages; no HTML template reuse |
| Unified page (form + results) | Results too divergent; over-engineering for internal tool |

## Status

Ready for proposal phase.
