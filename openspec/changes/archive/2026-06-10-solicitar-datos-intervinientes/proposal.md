# Proposal — solicitar-datos-intervinientes

> Artifact store: hybrid. Mirror of engram `sdd/solicitar-datos-intervinientes/proposal`.
> Phase: PROPOSE. Status: ready for spec + design.

## Intent (Why)

**Problem.** The mortgage simulator needs to tell the UI whether it must request the
data of all titulares/intervinientes. Today the rule engine produces only numeric
`uiLimits` (MIN/MAX financial limits); there is no decision flag that the frontend can
read to drive that behavior. The functional semantics are already documented in
`docs/offers-settings.md` (JOffers → `true` but FIDELIZACION → `false`) but they are **not yet
wired** into `rules.json`, the engine aggregation, or the simulators.

**Why now.** The decision rule per offer already has a clean place to assign the flag
(`SET|SOLICITAR_DATOS_INTERVINIENTES|...`), the engine already coerces `BOOL` values, and
the `uiLimits` aggregation pattern is the natural carrier. The cost of wiring it now is
low and it unblocks the frontend behavior that depends on it.

**Success looks like.**
1. Each eligible offer carries `SOLICITAR_DATOS_INTERVINIENTES` in its `dictamen` across
   INIT, PRE and FINAL.
2. `uiLimits.SOLICITAR_DATOS_INTERVINIENTES` is the **logical OR** over eligible offers
   (any `true` → `true`; only-FIDELIZACION eligible → `false`).
3. All three simulator pages display the flag in their uiLimits summary card.
4. Each simulator surfaces a **generic per-offer panel** listing every action-assigned
   property of that offer — forward-compatible for future flags.
5. The golden snapshot is regenerated and human-reviewed; a dedicated unit test and a
   boundary scenario lock the OR semantics.

## Scope (What changes)

### In scope

**Engine — `rule_set/rule_engine.js`**
- Add `UI_LIMITS_BOOL = ["SOLICITAR_DATOS_INTERVINIENTES"]` alongside the existing
  `UI_LIMITS_MIN` / `UI_LIMITS_MAX` lists (~line 657).
- Extend `aggregateUiLimits()` (~660–678) with a third loop that aggregates BOOL fields
  via `values.some(Boolean)` over `typeof v === "boolean"` values. Mirrors the MIN/MAX
  pattern exactly. Applies automatically to all three callers — `initcheck()`,
  `precheck()`, `finalize()` — since they all call `aggregateUiLimits()`.

**Config — `rule_set/rules.json`**
- Add `SET|SOLICITAR_DATOS_INTERVINIENTES|true|BOOL` to the decision/limit rules of the
   offers but `...|false|BOOL` to FIDELIZACION.
- Assign in **all three stages** (INIT, PRE, FINAL) consistent with how MIN/MAX uiLimits
  are populated today — wherever each offer has a decision/limit rule per stage. (Doc
  currently shows INIT only; spec/tasks must enumerate the exact rules per stage.)

**Frontend — types — `rule_set/web/src/app/models/api.models.ts`**
- Widen `uiLimits` on the three simulation responses (lines ~151, 246, 252) from
  `Record<string, number | undefined>` to `Record<string, number | boolean | undefined>`.

**Frontend — uiLimits card — all three simulator pages**
- `init-simulator-page.component.{ts,html}`, `pre-simulator-page.component.{ts,html}`,
  `final-simulator-page.component.{ts,html}`: render `SOLICITAR_DATOS_INTERVINIENTES` in
  the uiLimits summary card.
- **Arithmetic audit:** confirm no code iterates over `uiLimits` values doing arithmetic
  (NaN risk now that a value can be boolean). `limitFromOffer()` already filters to
  `typeof === "number"`, so booleans are safely ignored there.

**Frontend — generic per-offer visibility panel — all three simulator pages**
- Add an expandable panel per offer that lists **all non-standard action-assigned
  properties** present in `offer.dictamen` (those outside the known numeric-limit set and
  the standard flags). Design it generically: iterate the dictamen keys and render
  whatever is there, so any future action-assigned property appears with no further
  frontend change. This is the explicitly-requested forward-compatible surface, not a
  one-off display of the single flag.

**Tests & evidence — `rule_set/test/` + `rule_set/fixtures/`**
- Add a unit test in `test/rule_engine.test.js` for boolean OR aggregation (mixed
  true/false → true; all false → false; absent → absent).
- Add a boundary scenario in `fixtures/business_scenarios.js`: only FIDELIZACION eligible →
  `uiLimits.SOLICITAR_DATOS_INTERVINIENTES = false`, with its expected winner.
- Regenerate `fixtures/business_scenarios.golden.json` via
  `node scripts/freeze_scenarios.mjs` (it fails loudly if any engine winner diverges from
  the hand-authored expected winner). **Human review of the regenerated golden is a
  required step** — every scenario's `uiLimits` gains the new key.

### Out of scope (What does NOT change)

- **SQL DDL.** `cfg_offer_rule_action.field` is a free-form string; `coerce()` and
  `admin_validator.js` already accept `BOOL`. No schema migration, no catalog whitelist
  change.
- **Action dispatch in the engine.** `SET` already writes `dictamen[field]`; no new
  action type.
- **`FINAL_ONLY_ACTION_FIELDS`.** The flag stays out of this set — it is intentionally
  set in INIT/PRE rules, not FINAL-only.
- **SQL seed files** (`param.sql`, `rule_sets.sql`) — they use the legacy 2-offer model
  and are not the engine's source of truth (`rules.json` is). Touch only if the change
  owner asks to align seeds; not required for the feature.
- **WF compare enablement for the new field** — see risk #3; no behavioral change to
  `wf_compare_service.js` in this change beyond what is needed to avoid spurious diffs.

## Approach summary

Reuse the existing `uiLimits` aggregation contract rather than inventing a new transport.
The flag rides on each offer's `dictamen` (already the case for `SET` actions) and the
engine folds it into `uiLimits` with a third, boolean, aggregation path that is a direct
mirror of the MIN/MAX lists. This keeps the engine generic and the blast radius small.

The frontend gets two layers: (1) a targeted display of the known flag in the uiLimits
card, and (2) a **generic per-offer panel** that reflects whatever action-assigned
properties the engine produces, so the system is forward-compatible without further UI
work when new flags arrive.

Correctness is locked by a focused unit test (OR truth table) plus a data-driven boundary
scenario, with the golden regenerated and reviewed so the test report and client evidence
never diverge.

## Impact / risks

1. **Golden regeneration (high blast radius, low risk).** Every scenario's `uiLimits`
   gains `SOLICITAR_DATOS_INTERVINIENTES`, so all ~35 goldens change. The regeneration is
   automated and fails loudly on winner mismatch, but the new golden MUST be
   human-reviewed against the decision matrix before commit.
2. **TS type widening (low risk).** Widening to `number | boolean | undefined` could break
   any caller assuming numeric-only values. Audit confirms `limitFromOffer()` already
   guards with `typeof === "number"`; the audit step is explicit in scope to catch any
   other arithmetic over uiLimits values (NaN risk in LTV-style calcs).
3. **WF compare spurious diffs (needs confirmation).** If `wf_compare_service.js` compares
   all `uiLimits` fields and WF does not return this boolean, the field would always show
   as a POC-only difference. Spec/design must decide whether to exclude the field from WF
   compare or treat absence as equivalent. Open question carried from exploration.
4. **Boolean OR + FIDELIZACION semantics.** Only-FIDELIZACION-eligible must yield `false`; any
   other eligible yields `true`. Confirmed intentional; covered by the boundary
   scenario.

## Size estimate & PR strategy

Rough estimate (per `chained-pr` standard, threshold 400 changed lines):

| Area | Approx lines |
|------|--------------|
| Engine aggregation (`rule_engine.js`) | ~12 |
| `rules.json` action entries (6 offers × up to 3 stages) | ~80–120 |
| TS type widening | ~3 |
| uiLimits card display (3 pages × ts+html) | ~30 |
| Generic per-offer panel (3 pages × ts+html) | ~120–180 |
| Unit test + boundary scenario | ~40 |
| Golden regeneration (generated) | large but mechanical/generated |

Hand-written, reviewable lines total roughly **285–385**, i.e. near but likely under the
400-line budget. The regenerated golden inflates the diff but is machine-generated and
reviewed as data, not as logic.

**Recommendation:** plan as a **single PR**, but stage commits as work units
(`work-unit-commits`): (1) engine + unit test + rules.json + golden; (2) frontend types +
uiLimits card display; (3) generic per-offer panel. If the generic per-offer panel grows
beyond expectation and pushes the hand-written diff over 400 lines, split it into its own
follow-up PR (`chained-pr`) — it is the most self-contained, independently-mergeable
slice. Per `branch-pr`, open a GitHub issue before the PR and put the test plan
(unit + scenario + golden review) in the PR body.

## Next recommended

`sdd-spec` and `sdd-design` (can run in parallel). Design should resolve the WF-compare
decision (risk #3) and the exact per-stage rule placement in `rules.json`.
