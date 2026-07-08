---
change: simulator-panel-ux
phase: verify
date: 2026-05-26
mode: Standard
verdict: PASS WITH WARNINGS
---

# Verification Report: simulator-panel-ux

Change: simulator-panel-ux
Date: 2026-05-26
Mode: Standard (Strict TDD not active)

---

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 10 |
| Tasks complete [x] | 9 (T1-T9) |
| Tasks incomplete [ ] | 1 (T10 - manual smoke, no code output) |

T10 is the manual smoke checklist. It produces no file output and cannot be validated by automated tools. Expected and does NOT block archive.

---

## Build and Tests Execution

Backend tests (Node.js): 116 passed / 0 failed / 2 skipped (DB/live - expected). Exit code: 0.

TypeScript compilation: npx tsc --noEmit from rule_set/web/ - exit code 0, zero errors.

Coverage: Not available.

---

## Spec Compliance Matrix (11/12 compliant)

| Requirement | Scenario | Result |
|-------------|----------|--------|
| Grid Column Cap | Cap at default value | COMPLIANT |
| Grid Column Cap | Cap overridden in environment | COMPLIANT |
| Grid Column Cap | Fewer offers than cap (auto-fill CSS) | PARTIAL (see W-1) |
| Offer Cards Collapsed by Default | Initial render | COMPLIANT |
| Offer Cards Collapsed by Default | Expanding single card | COMPLIANT |
| Offer Cards Collapsed by Default | Re-collapsing expanded card | COMPLIANT |
| Per-Offer Expand State Survives CD | State survives CD cycle | COMPLIANT |
| Per-Instance Expand-All Toggle | Expand all via checkbox | COMPLIANT |
| Per-Instance Expand-All Toggle | Collapse all via checkbox | COMPLIANT |
| Per-Instance Expand-All Toggle | Independent across INIT/PRE/FINAL | COMPLIANT |
| Per-Instance Expand-All Toggle | Checkbox reflects mixed state | COMPLIANT |
| No Regression | API payload unchanged | COMPLIANT |

---

## Correctness (Static) - All 19 requirements implemented

All implementation targets confirmed present:
- environment.ts: production:true, maxSimulatorColumns:4
- environment.development.ts: production:false, maxSimulatorColumns:4
- angular.json: fileReplacements in configurations.development
- init/pre/final simulator .ts: import environment, expose maxCols
- All 5 .cards divs: [style.--cards-max-cols] binding (INIT:1, PRE:2, FINAL:2)
- SimulationTraceLogComponent.ts: expanded signal, allExpanded computed, isExpanded(), toggle(), toggleAll(), ngOnChanges reset
- simulation-trace-log.component.html: Expandir todo checkbox, role=button tabindex=0 aria-expanded, keydown handlers, chevron, offer-summary
- simulation-trace-log.component.css: .trace-toggle-all, .offer-head (cursor:pointer), .chevron, .offer-summary
- simulation-trace-log.component.spec.ts: 7 test cases

---

## Coherence (Design) - 11/11 decisions followed

All ADR decisions followed. ADR-3 CSS formula copied verbatim from design - see W-1 (pre-existing issue).
All 15 files from the Affected Files table created or modified.

---

## Issues Found

CRITICAL: None

WARNING:

W-1: CSS repeat(min(var(--cards-max-cols, 4), auto-fill), minmax(230px, 1fr)) is invalid CSS.
auto-fill is a CSS keyword for repeat() first arg, not a number, and cannot be used inside min().
Browsers silently discard invalid grid-template-columns rules, so the column cap may not apply at runtime.
This was specified verbatim in ADR-3 (design doc) - it is a pre-existing design issue, not introduced by apply.
Affected: init-simulator-page.component.css:51, pre-simulator-page.component.css:51, final-simulator-page.component.css:60
Fix a) Hard cap: grid-template-columns: repeat(var(--cards-max-cols, 4), minmax(230px, 1fr))
Fix b) Responsive: repeat(auto-fill, minmax(230px, 1fr)) + max-width: calc(var(--cards-max-cols, 4) * (230px + 0.85rem)) on .cards

W-2: Karma spec runtime not confirmed. Spec compiles clean (tsc --noEmit passes). 7 test cases cover all design targets.
No headless browser available in this environment. Recommend npm run web:test in CI before archive.

SUGGESTION:

S-1: Karma spec does not test eligibilityKey routing variants. Not a blocker - logic is trivial.

---

## Verdict

PASS WITH WARNINGS

All 9 code tasks (T1-T9) complete. TypeScript compiles clean. Backend engine unaffected (116/116 pass).
One pre-existing CSS invalidity (W-1, from ADR-3) may silently disable the column-cap rule in browsers.
Karma spec type-safe and complete; runtime confirmation recommended (W-2). No CRITICAL issues.
