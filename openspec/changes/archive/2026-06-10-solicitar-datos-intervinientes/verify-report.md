## Verification Report — Full Change

**Change**: solicitar-datos-intervinientes
**Scope**: PR-1 + PR-2 + PR-3 (complete change — supersedes PR-1-only report)
**Version**: spec #147 (2026-06-10)
**Date**: 2026-06-10

---

### Completeness

| Metric | Value |
|--------|-------|
| Total tasks | 16 (1.1–1.8, 2.1–2.6, 3.1–3.5) |
| Tasks complete | 16 |
| Tasks incomplete | 0 |

All 16 tasks marked [x] in apply-progress.

---

### Build and Tests

**Targeted suite** (rule_engine.test.js + offer_scenarios.test.js): 87 PASS / 0 FAIL / 0 SKIP

**Full suite** (node --test): 212 tests / 210 PASS / 0 FAIL / 2 SKIP
- 2 SKIP = CA-013 live WF tests (require real WF credentials — expected)
- apply-progress PR-3 checkpoint saw 205/5/2 due to transient live-DB failures
  (CA-005, CA-COD-001, CA-VDT-004, CA-VDT-004b, WF-01). Current run confirms environmental.

**Angular Karma**: not run (headless env constraint). TS correctness verified by structural analysis.

**freeze_scenarios.mjs**: exited 0. 49 scenarios frozen, all winners match.

---

### Spec Compliance Matrix

| RF | Requirement | Acceptance Criteria | Result |
|----|-------------|---------------------|--------|
| RF-SDI-01 | OR boolean aggregation in uiLimits | CA-SDI-01..03 | SATISFIED |
| RF-SDI-02 | 18 SET actions in rules.json | CA-SDI-04..05 | SATISFIED |
| RF-SDI-03 | Unit tests + boundary scenarios + golden | CA-SDI-06..07, CA-SDI-17 | SATISFIED |
| RF-SDI-04 | uiLimits widened to number/boolean/undefined in 3 interfaces | CA-SDI-08 | SATISFIED |
| RF-SDI-05 | Flag row in uiLimits summary card (3 simulators) | CA-SDI-09..11 | SATISFIED |
| RF-SDI-06 | Generic per-offer details panel + dictamen-extra.ts | CA-SDI-12..13 | SATISFIED |
| RF-SDI-07 | WF compare: absence = false semantics | CA-SDI-14..16 | SATISFIED |

All 7 requirements satisfied. 0 deferred.

---

### Correctness — PR-2

**RF-SDI-04**: uiLimits widened in InitSimulationResponse (L151), PreSimulationResponse (L245),
FinalSimulationResponse (L252) in api.models.ts. All 3 component signals widened.
limitFromOffer() typeof===number guard intact. No arithmetic regression.

**RF-SDI-05**: All 3 simulator templates have the flag row with != null guard (absent -> no row).
true -> Si, false -> No. Consistent across all 3 pages.

**RF-SDI-07 — WF compare trace**:

| Scenario | pocBool | wfRaw | wfBool | Diff? | Correct? |
|----------|---------|-------|--------|-------|----------|
| A: POC=true, WF=true | true | true | true | no | YES |
| B: POC=false, WF=absent | false | undefined | false | no | YES |
| C: POC=true, WF=absent | true | undefined | false | YES: poc=true wf=absent | YES |
| Edge: POC key absent | skipped | — | — | no | YES |

SDI_BOOL_FIELDS excluded from generic numeric loop. No double-comparison.

---

### Correctness — PR-3

**RF-SDI-06**: STANDARD_DICTAMEN_KEYS has 18 entries (10 numeric limits + 8 internal flags).
SOLICITAR_DATOS_INTERVINIENTES is NOT in the denylist — surfaces in the panel.
DRY: one definition, imported by all 3 pages.
Details panel absent when no extra props (*ngIf guard).
Forward-compatible: future SET actions surface automatically.

---

### Issues Found

**CRITICAL**: None.

**WARNING**: None.

**SUGGESTION**:

- S-01 (from PR-1): RF-SDI-01 spec could document precheck() union [initEligible+preEligible]
  explicitly. ADR-2 covers it. No code change needed.

- S-02 (from PR-1): Untracked sql/workflow_deploy/wf_delete_mro_motorfecha.sql has incomplete
  SQL (declare @fecha int = with no value). Not part of this change.

- S-03 (new): STANDARD_DICTAMEN_KEYS has 18 vs spec 15. Adds initRejected, preRejected, offerCode
  — real engine fields, correct extension of spec intent. Spec could be updated.

- S-04 (new): PRE preEligibleDetails() returns OfferEvaluationResult[] but extraDictamenEntries()
  declares PreEligibleOffer parameter. Structurally safe (TS structural typing, only dictamen used).
  Cosmetic only.

---

### Test Results

| Suite | Pass | Fail | Skip |
|-------|------|------|------|
| Targeted (rule_engine + offer_scenarios) | 87 | 0 | 0 |
| Full (node --test) | 210 | 0 | 2 |
| Angular Karma | not run | — | — |

---

### Verdict

**PASS — 0 CRITICAL, 0 WARNING, 4 SUGGESTION**

All 7 requirements (RF-SDI-01..07) satisfied. All 17 acceptance criteria (CA-SDI-01..17) met.
Test suite clean (210/0/2 full, 87/0/0 targeted).
WF compare correctly implements absence = false semantics per spec override.
dictamen-extra.ts is DRY and forward-compatible.

---

## Addendum post-archivado — fix de `ng build` (2026-06-10)

**Hallazgo (post-cierre):** CA-SDI-08 (`ng build` sin errores) NO se había ejecutado realmente
durante verify — los sub-agentes no podían correr Karma/build, y la verificación fue solo por
razonamiento de tipos. Al correr `npm run web:build`, falló con **12 errores** (TS2769 + TS2362)
en los 3 simuladores.

**Causa raíz:** el widening de `uiLimits` a `number | boolean | undefined` (RF-SDI-04) rompió las
expresiones de plantilla que indexan `uiLimits()['KEY']` directo en operaciones numéricas:
`{{ uiLimits()['MIN_HIPOTECA'] | number }}` (el pipe `number` no acepta `boolean`, TS2769) y
`((uiLimits()['MAX_LTV'] ?? 0) * 100)` (`boolean * number`, TS2362). El helper `limitFromOffer()`
lee de `offer`, NO de `uiLimits`, por eso no cubría estas lecturas. (engram bugfix #156.)

**Fix aplicado:** accesor tipado `numUiLimit(key): number | undefined` por componente +
migración de las 6 expresiones numéricas (HIPOTECA y LTV en init/pre/final). PLAZO/EDAD_PLAZO sin
tocar (interpolación pura). Tipo ensanchado se mantiene.

**Verificación:** `npm run web:build` → **PASS** (confirmado por el usuario). CA-SDI-08 satisfecho
de verdad. Suite node sigue 87/0/0 (fix solo de frontend).

**Lección:** un cambio de frontend NO está verificado hasta que `ng build` corre de verdad; el
razonamiento de tipos no sustituye a `strictTemplates`.

Next step: sdd-archive.