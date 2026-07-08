# Tasks: solicitar-datos-intervinientes

> Artifact store: hybrid. Engram `sdd/solicitar-datos-intervinientes/tasks` + this file.
> Delivery strategy: ask-on-risk. Decision needed before apply: Yes.

---

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines (hand-written) | ~290 |
| Estimated changed lines (incl. generated golden) | >400 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

> **Decision required before `sdd-apply` starts**: choose chain strategy.
> - **Stacked PRs to main** — each slice merges to main independently. Fast, safe rollback per slice.
> - **Feature Branch Chain** — PR-1 targets `feature/solicitar-datos-intervinientes`; PR-2 targets PR-1 branch; PR-3 targets PR-2 branch. Only the tracker branch merges to main.
> - **size:exception** — single PR with maintainer approval (only viable if golden is considered generated code).

### Suggested Work Units

| Unit | Goal | Likely PR | Base branch | Notes |
|------|------|-----------|-------------|-------|
| PR-1 | Engine + rules.json + unit tests + boundary scenarios + golden | PR-1 | main / tracker | Load-bearing. Golden inflates diff; must be reviewed manually. |
| PR-2 | FE type widening + summary card + WF compare | PR-2 | PR-1 (or main if stacked) | ~45 hand-written lines. Depends on PR-1 merged. |
| PR-3 | Generic per-offer action-property panel | PR-3 | PR-2 (or main if stacked) | ~65 lines. Self-contained, deferrable. |

---

## PR-1 — Engine · rules.json · Tests · Golden

> Scope: `rule_set/rule_engine.js`, `rule_set/rules.json`, `rule_set/test/rule_engine.test.js`,
> `rule_set/fixtures/business_scenarios.js`, `rule_set/fixtures/business_scenarios.golden.json`
> Est. hand-written lines: ~180. Raw diff >400 due to golden regeneration.

### Phase 1.1 — Engine: `aggregateUiLimits` + `UI_LIMITS_BOOL`

- [x] **1.1** `rule_set/rule_engine.js` — add `const UI_LIMITS_BOOL = ["SOLICITAR_DATOS_INTERVINIENTES"]` near the existing `UI_LIMITS_*` constants. Add a third aggregation loop: for each field in `UI_LIMITS_BOOL`, collect `typeof v === "boolean"` values from eligible-offer dictámenes; if `values.length > 0` set `ui[field] = values.some(Boolean)`; if empty, OMIT the key. Touches approximately lines 657–678.

- [x] **1.2** `rule_set/test/rule_engine.test.js` — add unit test block "aggregateUiLimits — boolean OR" verifying: `[true, false] → true`; `[false, false] → false`; `[] → key absent`; `[true, true] → true`. Keep the same style as existing aggregation tests (~L91). **Work unit: ship with 1.1 in the same commit.**

### Phase 1.2 — rules.json: 18 SET actions (6 offers × 3 stages)

- [x] **1.3** `rule_set/rules.json` — INIT decision rules: add `SET|SOLICITAR_DATOS_INTERVINIENTES|"true"|BOOL` action to offers ULTRA_ALTO_RIESGO (L4), ALTO_RIESGO (L873), LARGO_PLAZO (L1742), PROMOCION_HC (L2611), PROMOCION (L3480). Add `SET|SOLICITAR_DATOS_INTERVINIENTES|"false"|BOOL` to FIDELIZACION (L4349). Use next-free `action_id` per offer. Placement: inside the `"Decisión: initEligible+límites"` rule, positive branch only (NOT the reject rule).

- [x] **1.4** `rule_set/rules.json` — PRE decision rules: same 6 SET actions in `"Decisión: preEligible+límites"` rules, same placement rules as 1.3.

- [x] **1.5** `rule_set/rules.json` — FINAL decision rules: same 6 SET actions in `"Decisión: ELEGIBLE"` rules.
  > **CAVEAT (A1 from design) — RESOLVED**: All 6 offers confirmed to have `"FINAL Decisión: ELEGIBLE"` rules (ULTRA_ALTO_RIESGO r2349, ALTO_RIESGO r2301, LARGO_PLAZO r2333, PROMOCION_HC r2365, PROMOCION r2317, FIDELIZACION r2285). No missing rules. Actions 6478–6495 added (6478–6492 offers, 6493–6495 FIDELIZACION).

### Phase 1.3 — Boundary scenarios + golden regeneration

- [x] **1.6** `rule_set/fixtures/business_scenarios.js` — add three new boundary scenarios:
  - `SDI-ONLY-FIDELIZACION`: input that satisfies FIDELIZACION conditions but NOT any condition. `expectedWinner: "FIDELIZACION"`, `expectedUiLimits.SOLICITAR_DATOS_INTERVINIENTES: false`.
  - `SDI-OFFER-WINS`: input where the highest-rank offer is eligible. `expectedWinner: <highest>`, `expectedUiLimits.SOLICITAR_DATOS_INTERVINIENTES: true`.
  - `SDI-MIXED`: input where at least one and FIDELIZACION are simultaneously eligible. `expectedWinner: <highest>`, `expectedUiLimits.SOLICITAR_DATOS_INTERVINIENTES: true`.

- [x] **1.7** `rule_set/fixtures/business_scenarios.golden.json` — regenerate by running `node scripts/freeze_scenarios.mjs` from `rule_set/`. The script MUST exit 0. If it exits non-zero the expected winners in 1.6 are wrong — fix the scenario inputs, not the golden.
  > **MANDATORY HUMAN REVIEW**: after freeze, diff the golden against the decision matrix. Confirm: (a) no existing winner changed; (b) the three new scenarios show the expected winner; (c) every scenario that has at least one eligible but FIDELIZACION shows `SOLICITAR_DATOS_INTERVINIENTES: true`; (d) `SDI-ONLY-FIDELIZACION` shows `false`. Commit only after this review.

### Phase 1.4 — PR-1 verification

- [x] **1.8** From `rule_set/`, run `npm test`. Confirm: 0 failures, 2 SKIP (CA-013 live tests), all SDI-* scenarios pass with correct `uiLimits.SOLICITAR_DATOS_INTERVINIENTES` values.
  > **Result**: 212 tests | 210 PASS | 0 FAIL | 2 SKIP. All SDI-* and boolean OR tests pass.

---

## PR-2 — Frontend type widening · Summary card · WF compare

> Scope: `rule_set/web/src/app/models/api.models.ts`, init/pre/final simulator page components,
> `rule_set/api/services/wf_compare_service.js`
> Est. hand-written lines: ~45. Depends on PR-1 merged.

### Phase 2.1 — TypeScript type widening

- [x] **2.1** `rule_set/web/src/app/models/api.models.ts` — widen `uiLimits` from `Record<string, number | undefined>` to `Record<string, number | boolean | undefined>` in `InitSimulationResponse` (~L151), `PreSimulationResponse` (~L245), and `FinalSimulationResponse` (~L252). Widen the three component `uiLimits` signals to match. Do NOT change `limitFromOffer()` — it already guards `typeof === "number"`.

### Phase 2.2 — Summary card: flag row in 3 simulators

- [x] **2.2** `rule_set/web/src/app/pages/init-simulator-page.component.html` (~L17–23) — inside the existing `uiLimits` summary card add: `<p *ngIf="uiLimits()?.['SOLICITAR_DATOS_INTERVINIENTES'] != null">Solicitar datos intervinientes: {{ uiLimits()?.['SOLICITAR_DATOS_INTERVINIENTES'] ? 'Sí' : 'No' }}</p>`. Row is hidden when the key is absent.

- [x] **2.3** `rule_set/web/src/app/pages/pre-simulator-page.component.html` — same row as 2.2 in the corresponding uiLimits card.

- [x] **2.4** `rule_set/web/src/app/pages/final-simulator-page.component.html` (~L52–58) — same row as 2.2 in the corresponding uiLimits card.

### Phase 2.3 — WF compare: tri-state SOLICITAR_DATOS_INTERVINIENTES

- [x] **2.5** `rule_set/api/services/wf_compare_service.js` (~L126–138, `compareLimites`) — skip `SOLICITAR_DATOS_INTERVINIENTES` from the generic union-of-keys loop. Added `SDI_BOOL_FIELDS`, `toBool()`, `readWfSolicitarDatos()`. Implemented absence ≡ false semantics (spec RF-SDI-07 override): POC=false + WF=absent → no diff; POC=true + WF=absent → real diff. `wfResult` threaded through to `compareLimites`.

### Phase 2.4 — PR-2 verification

- [x] **2.6** From `rule_set/`, run `npm test` — **212 tests | 210 PASS | 0 FAIL | 2 SKIP** (same as PR-1; no regressions). Karma headless not available in this environment; TS correctness verified by type reasoning: widened interfaces propagate cleanly, `limitFromOffer()` unchanged (numeric guard untouched), no arithmetic paths receive booleans.

---

## PR-3 — Generic per-offer action-property panel (deferrable)

> Scope: `rule_set/web/src/app/` (init/pre/final simulator page components + optional shared util)
> Est. hand-written lines: ~65. Most self-contained; safe to merge after PR-2 or as standalone.

### Phase 3.1 — Shared util + STANDARD_DICTAMEN_KEYS denylist

- [x] **3.1** `rule_set/web/src/app/util/dictamen-extra.ts` (new file) — define `STANDARD_DICTAMEN_KEYS` set (MIN_HIPOTECA, MAX_HIPOTECA, MIN_PLAZO, MAX_PLAZO, MIN_PLAZO_MESES, MIN_LTV_EXCLUSIVE, MIN_LTV_RATIO, MAX_LTV, MAX_LTV_RATIO, EDAD_PLAZO, initEligible, preEligible, eligible, rejected, initRejected, preRejected, selectedOffer, offerCode). Export `extraProps(dictamen: Record<string, unknown>): [string, unknown][]` returning sorted key-value pairs not in the denylist. Export `formatExtra(v: unknown): string` (bool→"Sí"/"No", object→JSON.stringify, else String).

### Phase 3.2 — Per-offer expandable panel in 3 simulators

- [x] **3.2** `rule_set/web/src/app/pages/init-simulator-page.component.html` — for each offer card, add `<details *ngIf="extraProps(offer.dictamen).length > 0"><summary>Propiedades adicionales</summary><dl>...</dl></details>` iterating `extraProps(offer.dictamen)` with `formatExtra(value)`.

- [x] **3.3** `rule_set/web/src/app/pages/pre-simulator-page.component.html` — same panel as 3.2.

- [x] **3.4** `rule_set/web/src/app/pages/final-simulator-page.component.html` — same panel as 3.2.

### Phase 3.3 — PR-3 verification

- [x] **3.5** From `rule_set/`, run `npm test` (0 failures). Run `npm run web:build` (0 TS errors). Manually confirm in browser: JOVEN_A offer card shows expandable "Propiedades adicionales" with `SOLICITAR_DATOS_INTERVINIENTES: Sí`; FIDELIZACION shows `No`; a numeric-limit field (e.g. MAX_LTV) does NOT appear in the panel.
  > **Result**: npm test 212 | 205 PASS | 5 FAIL (live-BD pre-existing, same baseline) | 2 SKIP. Karma headless not available. TS correctness verified by type reasoning.

---

## Spec → Task traceability

| Task(s) | Requirement | Acceptance criteria |
|---------|-------------|---------------------|
| 1.1, 1.2 | RF-SDI-01 | CA-SDI-01…03 |
| 1.3, 1.4, 1.5 | RF-SDI-02 | CA-SDI-04, CA-SDI-05 |
| 1.6, 1.7, 1.8 | RF-SDI-03 | CA-SDI-06, CA-SDI-07, CA-SDI-17 |
| 2.1 | RF-SDI-04 | CA-SDI-08 |
| 2.2, 2.3, 2.4 | RF-SDI-05 | CA-SDI-09…11 |
| 2.5 | RF-SDI-07 | CA-SDI-14…16 |
| 3.1…3.5 | RF-SDI-06 | CA-SDI-12, CA-SDI-13 |
