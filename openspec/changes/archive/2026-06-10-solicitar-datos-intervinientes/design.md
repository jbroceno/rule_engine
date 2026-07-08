# Design: solicitar-datos-intervinientes

Technical design (the HOW at architectural level). Implements the proposal `sdd/solicitar-datos-intervinientes/proposal`.

## 0. Architecture summary

A new boolean decision flag `SOLICITAR_DATOS_INTERVINIENTES` rides on the **existing dictamen → uiLimits aggregation contract**. The engine already supports `SET ... BOOL` actions and the `dictamen` object is the universal carrier. The only structural gap is that `aggregateUiLimits()` only folds NUMBER fields (MIN/MAX). We add a third, parallel aggregation path for booleans using logical OR. No new action type, no SQL DDL, no validator changes. Everything downstream (3 stage functions, 3 simulators) inherits the change because they all consume the same `aggregateUiLimits()` output and the same `dictamen` shape.

Guiding principle: **extend the existing contract, do not invent a new mechanism.** Mirror the MIN/MAX pattern exactly so the code stays uniform and a future maintainer sees one obvious extension point.

---

## 1. Engine — `rule_engine.js`

### 1.1 `aggregateUiLimits()` (lines 657-678)

Add a third static list and a third loop, mirroring `UI_LIMITS_MIN` / `UI_LIMITS_MAX`.

**Before:**
```js
const UI_LIMITS_MIN = ["MIN_HIPOTECA", "MIN_PLAZO", "MIN_PLAZO_MESES", "MIN_LTV_EXCLUSIVE", "MIN_LTV_RATIO"];
const UI_LIMITS_MAX = ["MAX_HIPOTECA", "MAX_PLAZO", "MAX_PLAZO_MESES", "MAX_LTV", "MAX_LTV_RATIO", "EDAD_PLAZO"];

function aggregateUiLimits(offersWithDictamen) {
  const ui = {};
  for (const field of UI_LIMITS_MIN) { /* Math.min */ }
  for (const field of UI_LIMITS_MAX) { /* Math.max */ }
  return ui;
}
```

**After (added pieces only):**
```js
const UI_LIMITS_BOOL = ["SOLICITAR_DATOS_INTERVINIENTES"];

function aggregateUiLimits(offersWithDictamen) {
  const ui = {};
  // ... existing MIN loop ...
  // ... existing MAX loop ...
  for (const field of UI_LIMITS_BOOL) {
    const values = offersWithDictamen
      .map((offer) => offer.dictamen?.[field])
      .filter((v) => typeof v === "boolean");
    if (values.length) {
      ui[field] = values.some(Boolean);
    }
  }
  return ui;
}
```

### 1.2 Decisions and rationale

- **OR via `values.some(Boolean)`** — the business contract: if ANY eligible offer requests intervinientes data, the UI must request it. Only when every eligible offer is `false` (only-FIDELIZACION case) does the result stay `false`.
- **Missing/absent value defaults to "not present", which behaves as `false` in the OR.** The `.filter((v) => typeof v === "boolean")` discards `undefined`/`null`. If no eligible offer carries the field at all, the `if (values.length)` guard means the key is **omitted entirely** from `uiLimits` — it is NOT forced to `false`. This is deliberate and matches the MIN/MAX behaviour (absent → key omitted). The only way to get `uiLimits.SOLICITAR_DATOS_INTERVINIENTES === false` is when at least one eligible offer explicitly set `false` and none set `true`.
- **No `applyActions()` / `coerce()` change.** `coerce(value, "BOOL")` already maps `"true"/"false"` strings to real booleans (lines 52-67) and `SET` writes directly to `dictamen[field]` (line 571). The engine is already generic enough.
- **NOT final-only.** `SOLICITAR_DATOS_INTERVINIENTES` is intentionally absent from `FINAL_ONLY_ACTION_FIELDS` (line 19). It must be settable in INIT and PRE rules — adding it there would break the design. Do not touch line 19.
- **`typeof === "boolean"` filter (not truthiness)** so a stray numeric/string never pollutes the OR. Symmetric with the numeric path's `typeof === "number"`.

This change is automatically picked up by `initcheck()` (line 701), `precheck()` (line 759), and `finalize()` (line 816) — all three call `aggregateUiLimits()`.

---

## 2. rules.json — exact placement per offer × stage

There are **6 offers**: 5  (flag = `true`) and 1 FIDELIZACION (flag = `false`).

| Offer | offerCode line | Flag value |
|-------|---------------|------------|
| ULTRA_ALTO_RIESGO | 4 | true |
| ALTO_RIESGO | 873 | true |
| LARGO_PLAZO | 1742 | true |
| PROMOCION_HC | 2611 | true |
| PROMOCION | 3480 | true |
| FIDELIZACION | 4349 | true=**false** |

### 2.1 Stage placement decision — INIT + PRE + FINAL (all three)

The doc (`offers-settings.md`) only specifies INIT. **Design decision: set the flag in INIT, PRE, AND FINAL decision rules.** Rationale, driven by the actual data flow:

1. Each stage is **independent** — `precheck()` and `finalize()` do NOT inherit dictamen state from prior stages (CLAUDE.md "Each simulator is independent"). If the flag is only set in INIT, then `precheck()`'s and `finalize()`'s `aggregateUiLimits()` would NOT see it (the offers re-evaluated for PRE/FINAL would have empty `dictamen[SOLICITAR_...]`), so the PRE and FINAL uiLimits cards would never show it.
2. The **golden snapshot** (`scenario_runner.js` line 41) takes `uiLimits` from `finalRes.uiLimits`. For the flag to appear in the frozen golden at all, it MUST be set by the FINAL decision rule. This is the decisive constraint — INIT-only would leave the golden unchanged and the success criteria unmet.

So the flag goes into the **eligibility/decision rule of each stage**:

| Stage | Rule | Where the action goes |
|-------|--------------------------|------------------------|
| INIT | `"INIT Decisión: initEligible + límites"` (e.g. rule_id 2340 for ULTRA_ALTO_RIESGO, 2282 for FIDELIZACION) | append a `SET` action alongside `initEligible` |
| PRE | `"PRE Decisión: preEligible + límites"` (e.g. rule_id 2343 / 2283) | append a `SET` action alongside `preEligible` |
| FINAL | `"FINAL Decisión: ELEGIBLE"` (e.g. rule_id 2349 / 2284's positive sibling) | append a `SET` action alongside `eligible=true` |

> FINAL: the flag is added ONLY to the **positive** `FINAL Decisión: ELEGIBLE` rule (the `eligible=true` branch), NOT the `NO elegible` branch — uiLimits aggregates only eligible offers, so a rejected offer's flag is never read. Adding it to the reject rule would be dead config.

### 2.2 Action JSON to add (per rule)

```json
{
  "action_id": <next_free_id_in_offer>,
  "action_type": "SET",
  "field": "SOLICITAR_DATOS_INTERVINIENTES",
  "value": "true",
  "value_type": "BOOL"
}
```

- FIDELIZACION → `"value": "false"`. Other offers → `"value": "true"`. 
- `action_id`: use the next free integer within each offer's existing id range (e.g. ULTRA_ALTO_RIESGO INIT rule currently ends at 6407 → use 6408; PRE ends at 6420 → 6421; FINAL ELEGIBLE ends at 6432 → 6433). Keep ids unique within the offer; they are not globally significant for the file engine but stay consistent for traceability.
- Total new action entries: **6 offers × 3 stages = 18** SET actions.

### 2.3 Optional naming aid

To stay consistent with the codebase's inversion-doc convention, no `neg.:` prefix is needed (this is a positive decision flag, not a rejection rule). The action lives in already-named decision rules.

---

## 3. Frontend type widening — `api.models.ts`

Widen the three `uiLimits` typings from `number | undefined` to `number | boolean | undefined`:

- Line 151 — `InitSimulationResponse.uiLimits?: Record<string, number | boolean | undefined>`
- Line 245 — `PreSimulationResponse.uiLimits?: Record<string, number | boolean | undefined>`
- Line 252 — `FinalSimulationResponse.uiLimits?: Record<string, number | boolean | undefined>`

### 3.1 Guard against boolean reaching numeric rendering

The component signals are typed `Record<string, number | undefined>` (e.g. `initUiLimits`, line 27). Two options:

- **A (chosen):** widen the component signal types to match the model (`number | boolean | undefined`) AND keep all numeric template expressions reading only the known numeric keys (`MIN_HIPOTECA`, `MAX_LTV`, etc.). The boolean key is read by a dedicated, separate template expression (section 4). The numeric multiplications (`* 100`) only ever touch numeric keys, so no boolean enters arithmetic.
- Rejected B: a runtime coercion wrapper — unnecessary, the keys are statically known.

**NaN safety for the per-offer cards is already guaranteed:** `limitFromOffer()` (init/pre 2-arg, final 3-arg) filters `typeof === "number"` and returns `null` for booleans, and every numeric template does `(... ?? 0) * 100`. A boolean dictamen value silently yields `null → 0`, never `NaN`. **No change to `limitFromOffer()` is required.**

---

## 4. Frontend summary render — uiLimits card

In each simulator's "Resumen uiLimits" `<article>` (init line 17-23, pre equivalent, final line 52-58), add ONE line after the existing limits:

```html
<p *ngIf="initUiLimits()['SOLICITAR_DATOS_INTERVINIENTES'] != null">
  Solicitar datos intervinientes:
  {{ initUiLimits()['SOLICITAR_DATOS_INTERVINIENTES'] ? 'Sí' : 'No' }}
</p>
```

- Use the matching signal per page (`initUiLimits` / `preUiLimits` / `finalUiLimits`).
- `!= null` guard hides the line when the key is absent (e.g. no eligible offers, or a config without the flag) — consistent with how `EDAD_PLAZO` is conditionally rendered.
- Render `Sí` / `No` (Spanish, matches the app's UI language) rather than `true`/`false`.

---

## 5. Generic per-offer action-property panel

This is the **forward-compatible** requirement: show ALL action-assigned, non-standard dictamen properties per offer, so future SET flags appear automatically with zero UI changes.

### 5.1 Data source and exclusion set

Each eligible offer result already carries `dictamen?: Record<string, unknown>` (model lines 99, 215, 224). The panel derives its rows by filtering `dictamen` keys against a static **STANDARD_DICTAMEN_KEYS** exclusion set — the keys already rendered as dedicated lines plus internal/engine bookkeeping fields.

Add to each component (or a shared helper):

```ts
const STANDARD_DICTAMEN_KEYS = new Set<string>([
  // already shown as dedicated numeric lines:
  "MIN_HIPOTECA", "MAX_HIPOTECA", "MIN_PLAZO", "MAX_PLAZO",
  "MIN_PLAZO_MESES", "MAX_PLAZO_MESES",
  "MIN_LTV_EXCLUSIVE", "MIN_LTV_RATIO", "MAX_LTV", "MAX_LTV_RATIO", "EDAD_PLAZO",
  // engine/internal bookkeeping — never user-facing as "extra props":
  "motivos", "initEligible", "preEligible", "eligible", "rejected",
  "initRejected", "preRejected", "selectedOffer", "offerCode",
]);

protected extraProps(offer: { dictamen?: Record<string, unknown> }): Array<{ key: string; value: unknown }> {
  const d = offer.dictamen ?? {};
  return Object.keys(d)
    .filter((k) => !STANDARD_DICTAMEN_KEYS.has(k))
    .sort()
    .map((k) => ({ key: k, value: d[k] }));
}
```

`SOLICITAR_DATOS_INTERVINIENTES` is NOT in the exclusion set, so it surfaces automatically. Any future SET flag also surfaces with no code change — this is the forward-compatibility contract.

### 5.2 Template — expandable panel per offer card

Inside each per-offer `result-card`, after the fixed limit lines, add a collapsible block driven by `extraProps(offer)`:

```html
<details *ngIf="extraProps(offer).length" class="extra-props">
  <summary>Propiedades adicionales ({{ extraProps(offer).length }})</summary>
  <dl>
    <ng-container *ngFor="let p of extraProps(offer)">
      <dt>{{ p.key }}</dt>
      <dd>{{ formatExtra(p.value) }}</dd>
    </ng-container>
  </dl>
</details>
```

With a small value formatter so booleans render `Sí/No` and objects render JSON:

```ts
protected formatExtra(v: unknown): string {
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (v == null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
```

### 5.3 Rationale

- `<details>/<summary>` is native, zero-dependency, keyboard-accessible — no new component, no state signal.
- The exclusion-set approach (denylist of known keys) rather than an allowlist is what makes it forward-compatible: new flags are "extra" by default.
- Applied identically to init / pre / final per-offer cards. Consider extracting `STANDARD_DICTAMEN_KEYS`, `extraProps`, `formatExtra` into a tiny shared util (`web/src/app/util/dictamen-extra.ts`) to avoid triplication — recommended but optional; if the three components diverge in their offer typing, inline is acceptable.

---

## 6. WF compare — `api/services/wf_compare_service.js`

### 6.1 The problem (confirmed in scope)

`compareLimites()` (lines 126-138) iterates the **union** of POC and WF limit keys and flags any key where `String(pocVal) !== String(wfVal)`. Once POC's `uiLimits` includes `SOLICITAR_DATOS_INTERVINIENTES`, but WF's `RESULTADO.LIMITES` does not return it, the comparison would produce a **spurious POC-only diff** (`"true"` vs `String(null)` = `"null"`), turning every WF comparison red.

### 6.2 Decision — include the field with WF-aware normalization

The field IS in scope for the comparison (CONFIRMED). Design:

1. **Locate the WF value flexibly.** WF may expose the flag under several names/shapes. Read it from `wfResult.RESULTADO` with a tolerant lookup:
   ```js
   function readWfSolicitarDatos(wfResult) {
     const r = wfResult?.RESULTADO ?? {};
     const candidates = [
       r.LIMITES?.SOLICITAR_DATOS_INTERVINIENTES,
       r.SOLICITAR_DATOS_INTERVINIENTES,
       r.SOLICITAR_DATOS_INTERVINIENTES_FL,
       r.solicitarDatosIntervinientes,
     ];
     return candidates.find((v) => v !== undefined);
   }
   ```
2. **Normalize both sides to a tri-state before comparing**: `true | false | undefined` (absent). Reuse the same string→bool mapping the engine uses (`"true"/"1"/"yes"` → true, `"false"/"0"/"no"` → false).
3. **Behavior when WF omits it:** if the WF value normalizes to `undefined` (WF does not return the field at all), **exclude** `SOLICITAR_DATOS_INTERVINIENTES` from the diff entirely — do NOT emit a difference. This avoids the spurious always-red comparison while WF has not yet implemented the field. When WF DOES return it, compare normalized booleans and emit a diff only on a real mismatch.

Implementation shape — special-case the key inside `compareLimites()` (or pre-process before the generic loop):

```js
function compareLimites(pocLimits, wfLimits, wfResult) {
  const KEY = "SOLICITAR_DATOS_INTERVINIENTES";
  const all = new Set([...Object.keys(pocLimits ?? {}), ...Object.keys(wfLimits ?? {})]);
  const diferencias = [];

  for (const key of all) {
    if (key === KEY) continue; // handled separately below
    const pocVal = pocLimits?.[key] ?? null;
    const wfVal = wfLimits?.[key] ?? null;
    if (String(pocVal) !== String(wfVal)) {
      diferencias.push({ campo: key, poc: pocVal, wf: wfVal });
    }
  }

  // Tri-state comparison for the boolean flag
  if (KEY in (pocLimits ?? {})) {
    const pocBool = toBool(pocLimits[KEY]);
    const wfBool = toBool(readWfSolicitarDatos(wfResult)); // undefined if WF omits
    if (wfBool !== undefined && pocBool !== wfBool) {
      diferencias.push({ campo: KEY, poc: pocBool, wf: wfBool });
    }
  }

  return { match: diferencias.length === 0, diferencias };
}
```

`compareResults()` (line 170) passes `wfResult` through to `compareLimites(pocLimites, wfLimites, wfResult)`. The `toBool` helper mirrors `coerce(..., "BOOL")` semantics (extract a tiny local helper; do not import the engine into the API service to keep the boundary clean).

### 6.3 Rationale

- Tri-state (absent ≠ false) is the correct model: WF not implementing the field is NOT the same as WF saying "no". Treating absence as a real diff would block adoption; treating it as `false` could hide a future genuine mismatch. Absence → skip is the safe middle.
- The frontend WF-compare table (final HTML lines 96-103) needs no change — it renders whatever `diferencias` contains; booleans display fine as `true/false`. (Optional polish: map to Sí/No there too, but not required.)

---

## 7. Tests and evidence

### 7.1 Unit test — `test/rule_engine.test.js`

Add a focused test for the OR aggregation, in the same style as "finalize uiLimits only aggregates FINAL eligible offers" (line 91). Cover three cases in one or three tests:

1. **OR true:** two eligible offers, one sets `SOLICITAR_DATOS_INTERVINIENTES=true`, one `false` → `uiLimits.SOLICITAR_DATOS_INTERVINIENTES === true`.
2. **All false:** every eligible offer sets `false` (only-FIDELIZACION analogue) → `=== false`.
3. **Absent:** no offer sets it → key is **omitted** from `uiLimits` (`assert.equal(result.uiLimits.SOLICITAR_DATOS_INTERVINIENTES, undefined)` and `assert.ok(!("SOLICITAR_DATOS_INTERVINIENTES" in result.uiLimits))`).

Use minimal synthetic offers (PRE decision + FINAL accept) like the existing test; assert on `finalize(...).uiLimits`.

### 7.2 Boundary scenario — `fixtures/business_scenarios.js`

Add (at least) one scenario whose ONLY eligible offer is FIDELIZACION, with expected `uiLimits.SOLICITAR_DATOS_INTERVINIENTES === false`, plus the natural eligible scenarios will assert `true` via the golden. The hand-authored `expected winner` stays as-is; the new assertion rides on the golden snapshot, so the key thing is to ensure a FIDELIZACION-only path exists in the scenario set (if one already exists, no new scenario is needed — just re-freeze).

### 7.3 Golden regeneration + MANDATORY human review

`uiLimits` for EVERY scenario gains the new key once FINAL decision rules set it. Process (per CLAUDE.md):

```bash
# from rule_set/
node scripts/freeze_scenarios.mjs   # fails loudly if any engine winner != hand-authored expected winner
```

- `freeze_scenarios.mjs` regenerates `business_scenarios.golden.json` and FAILS if winners diverge — this catches accidental rule breakage.
- **HUMAN REVIEW IS MANDATORY:** diff the new golden and confirm `SOLICITAR_DATOS_INTERVINIENTES` is `true` exactly in scenarios where an offer is final-eligible and `false`/absent where only FIDELIZACION (or none) is eligible. Winners must be unchanged for all existing scenarios — the only delta is the new uiLimits key.
- `test/offer_scenarios.test.js` then passes automatically via `assert.deepEqual` against the reviewed golden — no test code change needed there.
- Run the full suite and build evidence per CLAUDE.md (`evidencia-full-<fecha>.txt`, per-file TAP, `gen_evidencia_report.mjs`).

---

## 8. Size estimate and PR-slice boundaries

| Slice | Files | Est. hand-written lines |
|-------|-------|--------------------------|
| **PR-1: engine + config + tests** | `rule_engine.js` (~10), `rules.json` (18 action blocks, ~110 incl. formatting), `test/rule_engine.test.js` (~50), `fixtures/business_scenarios.js` (~10), golden regen (machine-generated, large but reviewed not authored) | ~180 hand-written + golden |
| **PR-2: FE types + summary card + WF compare** | `api.models.ts` (3 lines), 3 component `.ts` signal widening (~3), 3 `.html` summary `<p>` (~9), `wf_compare_service.js` (~30) | ~45 |
| **PR-3: generic per-offer panel** | shared `dictamen-extra.ts` (~25) OR inline ×3, 3 `.html` `<details>` blocks (~30), CSS (~10) | ~65 |

Total hand-written ≈ **290 lines** (excluding machine-generated golden). Under the 400-line budget for a single PR IF the golden is counted as generated/reviewed rather than authored. However, the golden diff inflates the raw line count well past 400.

**Recommendation — chained PRs (3 slices), each independently mergeable:**

1. **PR-1 (engine + rules.json + tests + golden):** self-contained backend behavior; the golden lives here. This is the load-bearing slice. Tests green prove the contract.
2. **PR-2 (FE types + summary card + WF compare):** depends on PR-1's `uiLimits` shape; ships the user-visible flag + correct WF comparison.
3. **PR-3 (generic per-offer panel):** the most self-contained UI slice and the clearest candidate to defer — pure additive UI, forward-compatible, no backend coupling. If timeline is tight, PR-1+PR-2 deliver the full functional requirement; PR-3 is the "nice, future-proof" layer.

Each PR = work-unit commits (code + its tests + docs together), conventional commit messages, issue-first per branch. If the team prefers a single PR, request a `size:exception` because the golden diff alone exceeds 400 lines despite being machine-generated.

---

## 9. ADR-style decisions

- **ADR-1: Extend `aggregateUiLimits` with a third boolean OR path** rather than a separate flags channel. Rationale: dictamen→uiLimits is the established carrier; one extension point, uniform code. Rejected: a parallel "flags" object in each stage result (more plumbing, new TS types, new FE wiring).
- **ADR-2: Set the flag in INIT + PRE + FINAL decision rules**, not INIT-only. Rationale: stages are independent and the golden reads `finalRes.uiLimits`; INIT-only would leave PRE/FINAL cards and the golden empty. Rejected: INIT-only (doc-literal but functionally incomplete).
- **ADR-3: Absent ≠ false in aggregation** (key omitted when no eligible offer carries it). Rationale: mirrors MIN/MAX; only an explicit `false` with no `true` yields `false`. Rejected: defaulting to `false` (would assert a decision the config never made).
- **ADR-4: WF compare uses tri-state with "absent → skip".** Rationale: WF not yet returning the field must not turn every comparison red; a genuine mismatch is still caught once WF returns it. Rejected: treat WF-absent as `false` (hides future real diffs) and treat WF-absent as a diff (spurious permanent red).
- **ADR-5: Generic per-offer panel via denylist of standard keys.** Rationale: forward-compatibility — new SET flags surface automatically. Rejected: per-field allowlist (defeats the forward-compatible requirement).
- **ADR-6: No SQL DDL, no validator/catalog change, flag stays out of `FINAL_ONLY_ACTION_FIELDS`.** Confirmed by exploration: BOOL value_type and free-form action `field` are already accepted.

---

## 10. Risks and assumptions

- **R1 (golden review):** all ~35 scenario goldens change. Automated regen, but human review is the only guard against a silent winner regression — `freeze_scenarios.mjs` fails on winner mismatch, mitigating most of it.
- **R2 (WF field shape unknown):** the tolerant `readWfSolicitarDatos` lookup guesses WF key names. If WF uses a different name, the comparison silently treats it as absent (skip) — acceptable per ADR-4, but validate against a real WF response once available.
- **R3 (TS widening blast radius):** widening `uiLimits` to include `boolean` could surface in any code doing arithmetic on `uiLimits` values. Audit confirmed the only arithmetic is in templates over known numeric keys, guarded by `?? 0`; `limitFromOffer` already filters to numbers. Low risk.
- **A1 (assumption):** the FINAL "ELEGIBLE" positive rule exists per offer (confirmed for ULTRA_ALTO_RIESGO rule_id 2349; assume symmetric across the other 5 — verify during apply).
- **A2 (assumption):** only-FIDELIZACION → `false` is the intended business outcome (confirmed in proposal/explore; locked by the boundary scenario).
