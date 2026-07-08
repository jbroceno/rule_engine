# Design — wf-offer-mapping

## 1. Solution overview

Add an **optional, ephemeral `oferta_id` override map** to the two existing Workflow publication paths so an operator can remap each offer's `oferta_id` at publish time without touching `cfg_offer_ruleset` or the SQL schema.

Both dialogs (configurator → Publicar a WF, snapshots → Restaurar a WF) gain a **mapping table** pre-filled with the offers currently in `cfg_offer_ruleset`. Each row is `offerCode → editable oferta_id input`. The default value is the offer's DB `oferta_id`, so confirming without changes preserves today's behaviour (PRO → PRO).

The full table is sent as `ofertaIdOverrides: Record<offerCode, number>` in the publish payload. The backend service layer (`admin_workflow_service.js`) resolves the **effective** `oferta_id` per offer with the precedence:

```
effectiveOfertaId = ofertaIdOverrides[offerCode] ?? offerRow.oferta_id
```

`upsertMotorOferta` is invoked with the effective ID. The FK check against `dbo.HIPO_OFERTA` in the target environment now sees the operator-provided value. No tables created, no rows persisted beyond the auto-snapshot taken pre-publish.

### Flow

```
┌─────────────────────────────┐
│ Configurator / Snapshots UI │
│  Dialog with mapping table  │
│  pre-filled from offers     │
└────────────┬────────────────┘
             │ POST /api/admin/workflow/publicar          (configurator)
             │ POST /api/admin/snapshots/:id/restore      (snapshots, destino=WF)
             ▼
┌─────────────────────────────┐
│ admin_snapshots_controller  │   – Parses body
│   postWorkflowPublicar      │   – Validates ofertaIdOverrides shape
│   postSnapshotRestore       │   – Forwards to service
└────────────┬────────────────┘
             ▼
┌─────────────────────────────┐
│  admin_workflow_service     │
│  publishCfgToWorkflow       │   – Resolves effective oferta_id per offer
│  publishSnapshotToWorkflow  │   – Calls upsertMotorOferta(effectiveOfertaId, ...)
└────────────┬────────────────┘
             ▼
┌─────────────────────────────┐
│  WF DB (MRO_MOTOROFERTA)    │   – INSERT OFERTA_ID = effective ID
│  FK → dbo.HIPO_OFERTA       │   – Satisfied with operator-supplied ID
└─────────────────────────────┘
```

## 2. File changes

| File | Type | Change |
|---|---|---|
| `web/src/app/models/admin.models.ts` | modify | Extend `AdminWorkflowPublicarPayload` and add `ofertaIdOverrides?` to `restoreSnapshot` options shape (or new payload type for restore). |
| `web/src/app/services/admin-api.service.ts` | modify | `publishToWorkflow` forwards `ofertaIdOverrides`. `restoreSnapshot` accepts and forwards `ofertaIdOverrides` for `destino === "WF"`. |
| `web/src/app/pages/configurator-page.component.ts` | modify | New signal `publicarOfertaIdOverrides = signal<Record<string, number | null>>({})`; init from `offers()` signal on dialog open; computed validity flag; payload assembly in `executePublicarWf`. |
| `web/src/app/pages/configurator-page.component.html` | modify | New `<table>` section inside the "publicar-wf" dialog: rows iterate `offers()`, each row binds an `<input type="number" min="1">` to the override map. |
| `web/src/app/pages/configurator-page.component.css` | modify | Minimal styling for the new table (re-use existing dialog table classes if any). |
| `web/src/app/pages/snapshots-page.component.ts` | modify | New signals `wfOffers = signal<AdminOffer[]>([])` and `restoreOfertaIdOverrides = signal<Record<string, number | null>>({})`. On `confirmRestore` open with `destino === "WF"` (or on toggle to WF), call `adminApiService.listOffers()` and seed the overrides map. Forward in `executeRestore` when `destino === "WF"`. |
| `web/src/app/pages/snapshots-page.component.html` | modify | New mapping table inside the restore dialog, shown only when `restoreDestino() === 'WF'`. |
| `web/src/app/pages/snapshots-page.component.css` | modify | Same styling additions as configurator. |
| `api/controllers/admin_snapshots_controller.js` | modify | `postWorkflowPublicar` and `postSnapshotRestore` parse + validate `ofertaIdOverrides` from `req.body` and forward to the service. Reject with 400 if shape is wrong. |
| `api/services/admin_workflow_service.js` | modify | `publishCfgToWorkflow(offerDateId, rangoDestino, options)` and `publishSnapshotToWorkflow(snapshotRules, snapshotParams, rangoDestino, options)` accept `options.ofertaIdOverrides`. Resolve effective `oferta_id` per offer before calling `upsertMotorOferta`. `upsertMotorOferta` signature unchanged — the caller passes the effective ID directly. |
| `api/services/admin_service.js` | modify | `restoreSnapshot(snapshotId, { createdBy, destino, rangoDestino, ofertaIdOverrides })` — accept and forward `ofertaIdOverrides` to `publishSnapshotToWorkflow` when `destino === "WF"`. |
| `api/validators/admin_validator.js` | modify (optional) | Add `validateOfertaIdOverrides(value)` helper if a validator layer exists for the WF routes; otherwise inline validation in the controller. |

**No DB / schema changes. No new endpoints.**

## 3. Architecture Decision Records

### ADR-001 — Where to source the offers list for the mapping table

**Decision**: Re-use the existing `offers` signal in `ConfiguratorPageComponent`. In `SnapshotsPageComponent`, fetch fresh via `GET /api/admin/offers` when the restore dialog opens with `destino === "WF"`.

**Rationale**:
- Configurator already has `offers = signal<AdminOffer[]>([])` populated at page init and refreshed on offer CRUD. No extra HTTP call needed.
- Snapshots page has no concept of offers today — adding a permanent `offers` signal there would be dead state most of the time (only used when restoring to WF). Loading on demand is cleaner.
- Pre-filling from `GET /admin/offers` matches the proposal's success criterion #1 and #2: the operator sees the **current** DB IDs as defaults, regardless of when the snapshot was taken (snapshot-time `oferta_id`s could be stale).

**Rejected alternatives**:
- *Load from the snapshot's `rules_json` / `params_json`*: snapshots store rule/param data but **not the offers catalog**. The snapshot payload doesn't include `oferta_id` per offer code, so this is technically impossible without changing the snapshot schema (out of scope).
- *Add a permanent `offers` signal to snapshots page loaded at construction*: wastes a HTTP roundtrip on every snapshots-page visit even when the user only browses, never restores to WF.

### ADR-002 — Override payload format

**Decision**: Frontend sends the **full table** as `ofertaIdOverrides: Record<offerCode, number>`, including unchanged rows. Backend uses provided value when key exists; otherwise falls back to DB value.

**Rationale**:
- Simplest backend logic: `effectiveOfertaId = overrides[offerCode] ?? offerRow.oferta_id`. No merge, no diff.
- Resilient to UI bugs: if the frontend forgets to include an offer code, the backend still works (uses DB value).
- The payload size is trivially small (current rulesets have 2–10 offers).
- Operator intent is unambiguous: every row visible in the dialog is sent as-is.

**Rejected alternatives**:
- *Send only changed values (diff against DB)*: requires the frontend to read the DB-side `oferta_id` and compare against the input. Adds complexity and a subtle race if the DB value changes between dialog open and submit.
- *Always send all values, but require all of them*: brittle. If a new offer is added between dialog open and submit, the publish fails. Treating missing keys as "use DB value" is more forgiving.

### ADR-003 — Form validation for `oferta_id`

**Decision**: Use HTML5 `<input type="number" min="1" required>` with a computed signal (`publicarOverridesValid`) that returns `false` if any visible row is empty, non-numeric, or `< 1`.

**Rationale**:
- The mapping table is small (one row per offer, usually 2–10 rows). FormGroup/FormArray adds boilerplate for no real benefit.
- Signals + computed already power the rest of the configurator. Consistent stack.
- HTML5 `min="1"` rejects zero and negatives at the input level; the computed signal handles empty/NaN.
- The Publicar button binds `[disabled]="!publicarOverridesValid()"`. Error text rendered inline beneath the table when invalid.

**Rejected alternatives**:
- *Reactive forms (FormGroup with dynamic FormArray)*: overkill for a flat table whose row set is fixed for the dialog's lifetime.
- *Template-driven (`ngModel` + per-field validation)*: works but mixes paradigms with the rest of the page (which is signal-driven). Inconsistent.

### ADR-004 — Shared component for the mapping table

**Decision**: **Do not extract** a shared component yet. Inline the table in both pages.

**Rationale**:
- Only two call sites today. Premature abstraction risks a poor API shape (different parent state, different submit lifecycles).
- The duplication is ~30 lines of template + ~10 lines of signal wiring per page. Acceptable.
- If a third publish target appears (e.g. "Publicar a STAGING"), extract a `<app-offer-id-mapping-table [offers] [overrides] (overridesChange)>` then, with one input/output pair and `ChangeDetectionStrategy.OnPush`.

**Rejected alternatives**:
- *Extract now into `web/src/app/components/offer-id-mapping-table.component.ts`*: yields a 1-input/1-output component that codifies "use signal-based two-way binding" for one use case. Saves <50 lines today, locks in API choices for hypothetical future callers.

### ADR-005 — Resolution layer (controller vs. service)

**Decision**: Resolve the override map in the **service layer**, not the controller. Controllers only validate shape and forward.

**Rationale**:
- Matches the project convention: "Controllers thin: validate → service → return. Services own all DB logic."
- `publishCfgToWorkflow` and `publishSnapshotToWorkflow` already own the loop that calls `upsertMotorOferta`. The override resolution lives next to its only consumer.
- `upsertMotorOferta`'s signature stays unchanged — it keeps accepting a single `ofertaId`. The override merge happens in the caller, so the upsert primitive is reusable for any future caller that doesn't have overrides.

**Rejected alternatives**:
- *Resolve in the controller and pass an already-flattened `offers` array to the service*: requires the controller to read `cfg_offer_ruleset`. Violates the "service owns DB" rule.
- *Push `ofertaIdOverrides` into `upsertMotorOferta` itself*: leaks UI concerns into a primitive. The upsert doesn't need to know about overrides; it just needs the final ID.

## 4. Data flow

### 4.1 Configurator → Publicar a WF

```
1. User opens dialog (openPublicarDialog)
   └─ publicarOfertaIdOverrides initialised from offers() signal:
      offers().reduce((acc, o) => ({ ...acc, [o.offerCode]: o.oferta_id ?? null }), {})

2. User edits any oferta_id input (writes to publicarOfertaIdOverrides signal)
   └─ Inline validation: number ≥ 1; computed publicarOverridesValid()

3. User clicks "Publicar" (executePublicarWf)
   └─ Builds AdminWorkflowPublicarPayload:
      { offerDateId, rangoDestino, createdBy, ofertaIdOverrides: publicarOfertaIdOverrides() }
   └─ adminApiService.publishToWorkflow(payload)

4. HTTP POST /api/admin/workflow/publicar
   └─ postWorkflowPublicar(req, res, next)
      ├─ Validate offerDateId, rangoDestino.vigDesde (existing)
      ├─ Validate ofertaIdOverrides (new): object, keys = strings, values = positive ints
      └─ publishCfgToWorkflow(offerDateId, rangoDestino, { ofertaIdOverrides })

5. publishCfgToWorkflow
   ├─ Reads offers from cfg_offer_ruleset (existing query, plus the `code` column needed for the lookup)
   ├─ For each offer:
   │    effectiveOfertaId = options.ofertaIdOverrides?.[offer.code] ?? offer.oferta_id
   │    upsertMotorOferta(tx, effectiveOfertaId, offer.offer_rank, offer.published_version, ref)
   └─ Existing rule/param insertion unchanged

6. Response: { published, rules, params } (unchanged shape)
```

### 4.2 Snapshots → Restaurar a WF

```
1. User clicks "Restaurar" on a snapshot (confirmRestore)
   ├─ restoreDestino default = "POC"
   └─ Dialog opens

2. User selects destino = "WF"
   ├─ (new) Triggers loadOffersForWfMapping():
   │    adminApiService.listOffers() → seeds wfOffers signal
   │    restoreOfertaIdOverrides built from wfOffers() (same pattern as configurator)
   └─ Mapping table renders below vigDesde/vigHasta fields

3. User edits oferta_id, clicks "Restaurar"
   └─ executeRestore builds payload:
      { createdBy, destino: "WF", rangoDestino, ofertaIdOverrides: restoreOfertaIdOverrides() }

4. HTTP POST /api/admin/snapshots/:id/restore
   └─ postSnapshotRestore(req, res, next)
      ├─ Existing validation
      ├─ (new) Validate ofertaIdOverrides if destino === "WF"
      └─ restoreSnapshot(snapshotId, { createdBy, destino, rangoDestino, ofertaIdOverrides })

5. restoreSnapshot (admin_service.js)
   ├─ Loads snapshot rules/params (existing)
   ├─ Creates pre-restore auto-snapshot (existing)
   ├─ if (destino === "WF"):
   │    publishSnapshotToWorkflow(rules, params, rangoDestino, { ofertaIdOverrides })
   └─ else: applyConfig(...) — unchanged

6. publishSnapshotToWorkflow
   ├─ Reads offers from cfg_offer_ruleset (existing — already loads `code`, oferta_id, etc.)
   ├─ Builds offerMap by code (existing)
   ├─ For each code in allCodes:
   │    const offer = offerMap.get(code);
   │    effectiveOfertaId = options.ofertaIdOverrides?.[code] ?? offer.ofertaId
   │    upsertMotorOferta(tx, effectiveOfertaId, offer.offerRank, offer.publishedVersion, ref)
   └─ Existing rule/param insertion unchanged

7. Response: { published, rules, params, preRestoreSnapshotId } (unchanged shape)
```

## 5. Type changes

### 5.1 Frontend — `admin.models.ts`

```ts
// EXTENDED
export interface AdminWorkflowPublicarPayload {
  offerDateId: number;
  rangoDestino: { vigDesde: string; vigHasta: string | null };
  createdBy?: string;
  ofertaIdOverrides?: Record<string, number>;   // NEW — keys are offerCode
}

// NEW (or extend the inline options type on restoreSnapshot)
export interface AdminSnapshotRestoreWfOptions {
  createdBy?: string;
  destino: "WF";
  rangoDestino: { vigDesde: string; vigHasta: string | null };
  ofertaIdOverrides?: Record<string, number>;   // NEW
}
```

`admin-api.service.ts` — `restoreSnapshot` options type extended to include the optional `ofertaIdOverrides` field (only forwarded when `destino === "WF"`).

### 5.2 Backend — service signatures

```js
// admin_workflow_service.js
export async function publishCfgToWorkflow(offerDateId, rangoDestino, options = {}) { ... }
export async function publishSnapshotToWorkflow(snapshotRules, snapshotParams, rangoDestino, options = {}) { ... }

// admin_service.js
export async function restoreSnapshot(snapshotId, { createdBy, destino = "POC", rangoDestino, ofertaIdOverrides } = {}) { ... }
```

`options.ofertaIdOverrides` shape: `Record<string, number>` (positive integers). Missing or `undefined` → behave exactly as today.

`upsertMotorOferta(tx, ofertaId, ofertaRank, publishedVersion, maxIdRef)` — **signature unchanged**. Callers pass `effectiveOfertaId` directly.

### 5.3 Validation contract (controller / validator)

```
ofertaIdOverrides:
  - optional
  - if present: must be a plain object (not array)
  - each key: non-empty string
  - each value: integer >= 1
  - reject (400) otherwise: "ofertaIdOverrides debe ser un objeto de {offerCode: oferta_id} con enteros positivos."
```

Unknown offer codes in the map are **silently ignored** (the lookup falls back to DB rows; codes not in the DB simply never match a `for` iteration). This matches today's behaviour where the snapshot publish skips rules whose `offerCode` is not in `cfg_offer_ruleset`.

## 6. No DB schema changes

This change is entirely additive to the request payload and the in-memory resolution inside the service. No DDL, no migrations, no new tables. The auto-snapshot taken pre-publish continues to capture the pre-publish state, providing the same rollback guarantee as before.

Optional traceability nicety (deferred — open question #3 in proposal): include the `ofertaIdOverrides` summary in the auto-snapshot's `comment` text. Cheap to add but not required for v1.

## 7. Risks and assumptions

| Risk / assumption | Mitigation |
|---|---|
| Operator typo writes wrong `OFERTA_ID` to `MRO_MOTOROFERTA` | Pre-fill defaults to DB value (no-op on confirm). HTML5 `min="1"`. Auto-snapshot pre-publish allows rollback. |
| `HIPO_OFERTA` row missing in target environment for the typed ID | FK error surfaces with the operator-supplied ID — diagnosis is immediate ("ID 42 doesn't exist in PRE HIPO_OFERTA"). No code change can prevent this; it's the operator's responsibility. |
| Snapshot taken under one offer catalog, restored to another | The override table is sourced from **current** `cfg_offer_ruleset`, not the snapshot. If the snapshot references an `offerCode` that has been deleted, today's behaviour skips it; that does not change. |
| Two dialogs to keep in sync | Accepted (ADR-004). Re-evaluate if a third caller appears. |
| Mid-dialog DB change (offer added/removed/renamed) | Out of scope. Probability is low (operators don't reorganise offers during a publish). Backend's `??` fallback makes the worst case "use DB value for the missing key", which is the safe default. |
| `publishCfgToWorkflow` currently selects `ruleset_id, oferta_id, offer_rank, published_version` from `cfg_offer_ruleset` but **not `code`** | Add `code` to the SELECT list to enable the override lookup. Trivial change. |

## 8. Out-of-scope (recap from proposal)

- Persistent per-environment mapping table.
- Auto-detect target environment from API context.
- Bulk import of mappings from a JSON file.
- Overrides for non-`oferta_id` fields.
- Structured audit log of which overrides were used.

These remain explicit follow-ups; none block the immediate need.
