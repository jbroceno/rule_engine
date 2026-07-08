# Design: mro-snapshot-deploy

> Architectural design (the HOW). Encodes decisions v4 (#79) and proposal v3 (#80). Does NOT re-litigate scope.
> Validity is **MOTORFECHA_ID only**. `VIGENCIA_*` on `MRO_MOTORREGLA`/`MRO_MOTORPARAM` are removed from the model and must NOT be written.

## Outcome

Migrate the four WF deploy/publish/snapshot flows and the two stored procedures to the MRO validity model
(`MRO_MOTORFECHA` + FK `MOTORFECHA_ID`), so that:

- No code writes `VIGENCIA_DESDE_DT` / `VIGENCIA_HASTA_DT` on rules or params.
- The engine read SP resolves a **single applicable period per offer and per object type** (`REGLAS` vs `PARAMS`), honoring `TIPO_DS` and overlap with most-recent-wins.
- INIT/PRE/FINAL simulations stay green in regression, with **zero duplicated rules/params**.

## Grounding discovery (load-bearing — affects task plan)

A schema/code mismatch already exists today and is the root of the change:

| Component | Today | Truth in `wf_data_model.sql` |
|-----------|-------|------------------------------|
| `insertMRORecords` (rules) | INSERTs `VIGENCIA_DESDE_DT, VIGENCIA_HASTA_DT` into `MRO_MOTORREGLA` | `MRO_MOTORREGLA` has **no** `VIGENCIA_*` columns — only `BORRAR_VIGENCIA_*` and `MOTORFECHA_ID` |
| `insertMRORecords` (params) | INSERTs `VIGENCIA_DESDE_DT, VIGENCIA_HASTA_DT` into `MRO_MOTORPARAM` | `MRO_MOTORPARAM` has `BORRAR_VIGENCIA_*` + `MOTORFECHA_ID`, **no** `VIGENCIA_*` |
| `deletePeriodFromMRO` | filters by `CAST(VIGENCIA_*_DT AS DATE)` on rule/param rows | columns do not exist → query is invalid against current schema |
| Engine SP read | already JOINs `MRO_MOTORFECHA ON mf.MOTORFECHA_ID = r.MOTORFECHA_ID` | consistent with model, but filters by date only (no `TIPO_DS`, no most-recent-wins) |

So the insert/delete path is **already broken** against the real schema and never assigns `MOTORFECHA_ID`. The SP reads `MOTORFECHA_ID` rows that nothing populates. This change closes that gap end to end.

---

## Architecture approach

Layering is unchanged (Express route → controller → service → SQL). The change is concentrated in:

1. **SQL layer** — two stored procedures rewritten; both moved fully onto `MOTORFECHA_ID`.
2. **Service layer** — `admin_workflow_service.js` gains a `MOTORFECHA` upsert helper and reworks insert/delete around `MOTORFECHA_ID`; `admin_service.restoreSnapshot` already covers the WF→POC transform (capability 4) and needs no structural change.
3. **API contract** — add an optional `tipoDs` field to publish payloads (default `AMBOS`).
4. **Angular** — add a "Publicar a WF" action and a WF-row deploy-to-POC action on the snapshots page; extend models for `tipoDs`.

Boundary principle: **resolution of which period applies lives in SQL** (the read SP). The JS engine stays a pure consumer of already-resolved config. This keeps most-recent-wins logic in one place and avoids duplicating temporal logic in JS.

---

## Open design question 1 — SQL shape of most-recent-wins

### Decision: `ROW_NUMBER()` partitioned per offer + object type, materialized in CTEs

Chosen over correlated subquery and `CROSS APPLY TOP 1`.

| Option | Correctness for per-type recency | Performance (small N periods) | Readability | Verdict |
|--------|----------------------------------|-------------------------------|-------------|---------|
| `ROW_NUMBER() OVER (PARTITION BY offer, type ORDER BY DESDE_DT DESC)` then `rn=1` join | Clean: pick winning `MOTORFECHA_ID` per (offer,type), then join rules/params to it | One sort over a tiny set; fine | High — winner CTE is explicit | **Chosen** |
| Correlated subquery (`MOTORFECHA_ID = (SELECT TOP 1 ... ORDER BY DESDE_DT DESC)`) | Correct but the correlation repeats per row; easy to drift between rules and params blocks | Re-evaluated per outer row | Low | Rejected |
| `CROSS APPLY (SELECT TOP 1 ...)` | Correct | Comparable | Medium, but couples winner selection into each FROM | Rejected — duplicates selection in two places |

Period counts per offer are expected to be small (a handful of vigencias). `ROW_NUMBER` cost is negligible and the winner CTE is reused by both the offer-existence check and the rules/params projections — single source of truth.

### Per-type, per-offer resolution (the load-bearing detail)

A single offer can take its **rules from one `MOTORFECHA`** and its **params from another** (different recency). The design resolves them in **two independent winner CTEs** so they never have to share a period:

- Rules winner considers `mf.TIPO_DS IN ('REGLAS','AMBOS')`.
- Params winner considers `mf.TIPO_DS IN ('PARAMS','AMBOS')`.

Both restricted to periods covering `@DATE` (`DESDE_DT <= @DATE AND (HASTA_DT IS NULL OR HASTA_DT > @DATE)`), then `rn = 1` by `DESDE_DT DESC` (tie-break `MOTORFECHA_ID DESC`).

### Rewritten CTE structure (sketch)

```sql
;WITH filter_codes AS ( /* unchanged XML CSV split */ ),

-- winning MOTORFECHA per offer for RULES
mf_rules AS (
  SELECT r.MOTOROFERTA_ID, r.MOTORFECHA_ID,
         ROW_NUMBER() OVER (
           PARTITION BY r.MOTOROFERTA_ID
           ORDER BY mf.DESDE_DT DESC, mf.MOTORFECHA_ID DESC) AS rn
  FROM dbo.MRO_MOTORREGLA r
  JOIN dbo.MRO_MOTORFECHA mf ON mf.MOTORFECHA_ID = r.MOTORFECHA_ID
  WHERE ISNULL(r.BORRADO_FL,0) = 0
    AND ISNULL(mf.BORRADO_FL,0) = 0
    AND mf.TIPO_DS IN ('REGLAS','AMBOS')
    AND mf.DESDE_DT <= @DATE
    AND (mf.HASTA_DT IS NULL OR mf.HASTA_DT > @DATE)
  GROUP BY r.MOTOROFERTA_ID, r.MOTORFECHA_ID, mf.DESDE_DT  -- collapse to distinct (offer, fecha)
),
mf_rules_win AS (SELECT MOTOROFERTA_ID, MOTORFECHA_ID FROM mf_rules WHERE rn = 1),

-- winning MOTORFECHA per offer for PARAMS (independent recency)
mf_params AS (
  SELECT p.MOTOROFERTA_ID, p.MOTORFECHA_ID,
         ROW_NUMBER() OVER (
           PARTITION BY p.MOTOROFERTA_ID
           ORDER BY mf.DESDE_DT DESC, mf.MOTORFECHA_ID DESC) AS rn
  FROM dbo.MRO_MOTORPARAM p
  JOIN dbo.MRO_MOTORFECHA mf ON mf.MOTORFECHA_ID = p.MOTORFECHA_ID
  WHERE ISNULL(p.BORRADO_FL,0) = 0
    AND ISNULL(mf.BORRADO_FL,0) = 0
    AND mf.TIPO_DS IN ('PARAMS','AMBOS')
    AND mf.DESDE_DT <= @DATE
    AND (mf.HASTA_DT IS NULL OR mf.HASTA_DT > @DATE)
  GROUP BY p.MOTOROFERTA_ID, p.MOTORFECHA_ID, mf.DESDE_DT
),
mf_params_win AS (SELECT MOTOROFERTA_ID, MOTORFECHA_ID FROM mf_params WHERE rn = 1),

rs AS ( /* offers that have a winning rules period (EXISTS mf_rules_win) */ ),

rules AS (
  SELECT r.MOTOROFERTA_ID, r.MOTORREGLA_ID, r.MOTORREGLA_DS, r.PRIORIDAD_NM, r.PARAR_PROCESO_FL
  FROM dbo.MRO_MOTORREGLA r
  JOIN mf_rules_win w ON w.MOTOROFERTA_ID = r.MOTOROFERTA_ID
                     AND w.MOTORFECHA_ID = r.MOTORFECHA_ID   -- only winning period
  WHERE ISNULL(r.BORRADO_FL,0) = 0
),

params AS (
  SELECT rs.OFERTA_ID, rs.OFERTA_CD, p.PARAM_KEY_CD, p.TIPO_VALOR_CD, p.VALOR_DS
  FROM dbo.MRO_MOTORPARAM p
  JOIN mf_params_win w ON w.MOTOROFERTA_ID = p.MOTOROFERTA_ID
                      AND w.MOTORFECHA_ID = p.MOTORFECHA_ID  -- only winning period
  JOIN rs ON rs.MOTOROFERTA_ID = p.MOTOROFERTA_ID
  WHERE ISNULL(p.BORRADO_FL,0) = 0
)
SELECT OFERTAS_JSON = (...), PARAMETROS_JSON = (...);  -- projection unchanged
```

Net effect vs today: the date-only `EXISTS`/JOINs at lines 72-108 are replaced by joins to the two winner CTEs. Because rules and params are constrained to exactly one `MOTORFECHA_ID` per offer, overlap can no longer produce duplicate rows. **Duplicates = 0 by construction**, which is the regression invariant.

> The fallback SP `cfg_get_rules_json` (GETDATE-based, no historical eval) is out of scope unless it also reads inline — confirm during apply; if it has no `MOTORFECHA`/`VIGENCIA` temporal filter it needs no change.

---

## Open design question 2 — does `rule_engine.js` need changes?

### Decision: NO change to `rule_engine.js`.

Evidence from reading the consumption path:

- `config_service.loadNormalizedConfig` executes the SP, parses `OFERTAS_JSON`/`PARAMETROS_JSON`, and calls `normalizeConfig(parsed, { strictValidation: true })`.
- `normalizeConfig` (rule_engine.js L364) maps `offers[].rules` 1:1 and builds `paramsIndex` via `buildParamsIndex` (L335). It does **no** temporal filtering and no dedup of rules.
- `initcheck`/`precheck`/`finalize` iterate exactly the rules the SP returned, in priority order.

Therefore the engine is a pure consumer: if the SP returns one resolved period per offer/type, the engine behaves correctly with no edit.

**Risk if SP is wrong**: `normalizeConfig` would happily accept duplicated rules (the engine would evaluate the same rejection rule twice — usually idempotent, but priority/stop_processing interactions could shift dictámenes silently). `buildParamsIndex` is last-wins per key, so duplicate param groups would be masked (no error, wrong value possible). This is exactly why the no-duplicate invariant must be asserted at the SP boundary, not relied upon downstream. No JS change — but JS-level regression fixtures must feed the engine SP-shaped JSON that already contains duplicates to prove the SP, once fixed, eliminates them (see test plan).

---

## Open design question 3 — TIPO_DS in the UI / API

### Decision: default `AMBOS`; expose a selector only where it is cheap (publish-current-config), default elsewhere.

| Flow | TIPO_DS source | Rationale |
|------|----------------|-----------|
| Cap. 2 — Publish current config to WF | Optional `tipoDs` field, default `AMBOS` | The configurator already knows the source period's `tipo_cd` (`AdminFechaItem.tipo_cd` exists). Forwarding it is cheap and correct. |
| Cap. 3 — Publish POC snapshot to WF | `AMBOS` (snapshots carry both rules and params) | A snapshot is a full config slice; partial-type publishing of a snapshot adds no value now. |
| Cap. 4 — Deploy WF snapshot to POC | N/A (POC uses `cfg_offer_dates.tipo_cd`, not MRO) | Engine read in POC is the existing path; `tipo_cd` already chosen at period creation. |
| Cap. 1 — Take WF snapshot | N/A (read-only export) | No write to MRO. |

### API contract field

Add to `AdminWorkflowPublicarPayload` and `publishCfgToWorkflow` / `publishSnapshotToWorkflow` options:

```ts
tipoDs?: 'REGLAS' | 'PARAMS' | 'AMBOS'; // default 'AMBOS'
```

Controller validates against `{REGLAS, PARAMS, AMBOS}`; rejects anything else with 400. When omitted → `AMBOS`. Partial-period publishing (REGLAS-only / PARAMS-only) is supported by the backend (the `MOTORFECHA` upsert keys on `TIPO_DS`) but the UI only surfaces a selector in the configurator publish dialog; the snapshots page hardcodes `AMBOS`.

---

## Component design

### C1. `upsertMotorFecha(tx, desde, hasta, tipo, maxIdRef)`

```
key = (DESDE_DT, HASTA_DT, TIPO_DS)
SELECT TOP 1 MOTORFECHA_ID WITH (UPDLOCK, ROWLOCK)
  WHERE CAST(DESDE_DT AS DATE)=@desde
    AND ( (@hasta IS NULL AND HASTA_DT IS NULL) OR CAST(HASTA_DT AS DATE)=@hasta )
    AND TIPO_DS=@tipo AND ISNULL(BORRADO_FL,0)=0
exists? -> return MOTORFECHA_ID (exact-period reselect: caller will delete dependents of covered type, reinsert)
else    -> newId = ++maxIdRef.val; INSERT MRO_MOTORFECHA(MOTORFECHA_ID, DESDE_DT, HASTA_DT, TIPO_DS, BORRADO_FL, ALTA_DT); return newId
```

- `UPDLOCK` mirrors the existing `getMaxIds` locking discipline to keep the high-water-mark race-safe within the transaction.
- Returns the `MOTORFECHA_ID` that insert/delete will key on.

### C2. `getMaxIds` — add MOTORFECHA high-water mark

Add one line to the existing single-query `SELECT`:

```sql
ISNULL((SELECT MAX(MOTORFECHA_ID) FROM dbo.MRO_MOTORFECHA WITH (UPDLOCK, ROWLOCK)), 0) AS maxFecha
```

`maxFecha` becomes the seed for `upsertMotorFecha`'s `maxIdRef` (`{ val: maxIds.maxFecha }`). Captured **before** any delete so reused-period deletes never lower the high-water mark (no id reuse), per decisions.

### C3. `deletePeriodFromMRO(tx, motorFechaId, tipo)` — keyed by MOTORFECHA_ID

New signature: takes the resolved `MOTORFECHA_ID` (from `upsertMotorFecha`) and the covered `tipo`, replacing the `VIGENCIA_*` date filtering.

Delete order (FK-safe, child → parent), scoped to the period and the types it covers:

```
if tipo IN ('REGLAS','AMBOS'):
  DELETE cv FROM MRO_MOTORCONDICIONVALOR cv JOIN MRO_MOTORCONDICION c ... JOIN MRO_MOTORREGLA r WHERE r.MOTORFECHA_ID=@fid
  DELETE c  FROM MRO_MOTORCONDICION c JOIN MRO_MOTORREGLA r WHERE r.MOTORFECHA_ID=@fid
  DELETE a  FROM MRO_MOTORACCION a JOIN MRO_MOTORREGLA r WHERE r.MOTORFECHA_ID=@fid
  DELETE    FROM MRO_MOTORREGLA WHERE MOTORFECHA_ID=@fid
if tipo IN ('PARAMS','AMBOS'):
  DELETE    FROM MRO_MOTORPARAM WHERE MOTORFECHA_ID=@fid
```

- No general range delete; overlapping periods of different `tipo`/range **coexist** untouched.
- Delete-on-reuse only fires when `upsertMotorFecha` reused an existing `MOTORFECHA_ID` (exact-period reselect). For a brand-new `MOTORFECHA_ID` the deletes match nothing (idempotent).

### C4. `insertMRORecords` — drop VIGENCIA_*, set MOTORFECHA_ID

- Replace the `vigDesde/vigHasta` parameters with a single `motorFechaId`.
- `MRO_MOTORREGLA` INSERT column list drops `VIGENCIA_DESDE_DT, VIGENCIA_HASTA_DT`, adds `MOTORFECHA_ID`.
- `MRO_MOTORPARAM` INSERT column list drops `VIGENCIA_DESDE_DT, VIGENCIA_HASTA_DT`, adds `MOTORFECHA_ID`.
- `BORRAR_VIGENCIA_*` left untouched (out of scope feature).

### C5. `publishCfgToWorkflow` / `publishSnapshotToWorkflow` — orchestration change

Inside the WF transaction, the new order is:

```
maxIds = getMaxIds(tx)                       // includes maxFecha, captured BEFORE deletes
fechaRef = { val: maxIds.maxFecha }
tipo = options.tipoDs ?? 'AMBOS'
motorFechaId = upsertMotorFecha(tx, vigDesde, vigHasta, tipo, fechaRef)
deletePeriodFromMRO(tx, motorFechaId, tipo)  // only deletes if period was reused
... upsertMotorOferta loop (unchanged) ...
insertMRORecords(tx, { ruleEntries, paramEntries }, motorFechaId, { maxRegla, ... })
commit
```

`rangoDestino.{vigDesde,vigHasta}` still drives the period; it now flows into `upsertMotorFecha` instead of inline columns.

### C6. `createWorkflowSnapshot` + WF-snapshot SP migration

- SP `cfg_get_workflow_snapshot_json`: replace inline reads (L34-35 rule `VIGENCIA_*`, L76-77 rule WHERE, L89-90 param projection, L93-94 param WHERE) with a JOIN to `MRO_MOTORFECHA` on `MOTORFECHA_ID`. The `@VIGENCIA_DESDE/@VIGENCIA_HASTA` filter parameters now compare against `mf.DESDE_DT`/`mf.HASTA_DT`:
  ```sql
  JOIN dbo.MRO_MOTORFECHA mf ON mf.MOTORFECHA_ID = r.MOTORFECHA_ID
  WHERE (@VIGENCIA_DESDE IS NULL OR CAST(mf.DESDE_DT AS DATE) = @VIGENCIA_DESDE)
    AND (@VIGENCIA_HASTA IS NULL OR CAST(mf.HASTA_DT AS DATE) = @VIGENCIA_HASTA)
  ```
  Project `mf.DESDE_DT`/`mf.HASTA_DT` into the JSON in place of the removed rule/param columns (keep field names `VIGENCIA_DESDE_DT`/`VIGENCIA_HASTA_DT` in the JSON output so `admin_service` consumers stay compatible — the JSON contract is unchanged, only the source column moves to `MOTORFECHA`).
- `createWorkflowSnapshot` JS: no change — it just stores the SP's JSON into `cfg_config_snapshot` with `entorno_cd='WF'`.

### C7. Capability 4 (WF-origin → POC) — already implemented

`admin_service.restoreSnapshot` already: detects `entorno_cd='WF'`, resolves POC offer codes via `oferta_id` FK (precedence over WF text code), requires `pocFechaDesde`, creates/reuses the target `cfg_offer_dates` period, and dedupes params last-wins per offer/key. **No structural change**; only verification that the WF snapshot JSON now sourced from `MOTORFECHA` still carries the fields it reads (`OFERTA_ID`, `VIGENCIA_*` JSON keys preserved per C6). Angular only needs to enable the deploy-to-POC action for WF-origin rows.

### C8. Angular

| File | Change |
|------|--------|
| `admin.models.ts` | Add `tipoDs?: 'REGLAS'\|'PARAMS'\|'AMBOS'` to `AdminWorkflowPublicarPayload`. (Snapshot WF→POC types already present.) |
| `admin-api.service.ts` | `publishToWorkflow` already exists; pass `tipoDs` through. No new method needed for cap. 1/4 (existing `createWorkflowSnapshot`, `restoreSnapshot`). |
| `configurator-page.component.*` | "Publicar a WF" button + dialog with `tipoDs` selector (default AMBOS) feeding `publishToWorkflow`. |
| `snapshots-page.component.*` | Enable deploy-to-POC action on WF-origin rows (cap. 4); publish-POC-snapshot-to-WF action on POC rows (cap. 3) calling `restoreSnapshot` with `destino:'WF'`. |

---

## Data-flow sketch — Cap. 2: publish current config to WF (end to end)

```
[Angular configurador]
  click "Publicar a WF" → dialog (offerDateId, rangoDestino, tipoDs=AMBOS, createdBy)
        │  POST /api/admin/workflow/publicar
        ▼
[admin_workflow_controller] validate tipoDs ∈ {REGLAS,PARAMS,AMBOS}, parse overrides
        │  publishCfgToWorkflow(offerDateId, rangoDestino, { tipoDs, ofertaIdOverrides })
        ▼
[admin_workflow_service]
  POC pool: read offers + rules + conditions + condValues + actions + params (offer_date_id)
  WF pool TX:
    maxIds = getMaxIds(tx)                         // + maxFecha, captured before deletes
    motorFechaId = upsertMotorFecha(tx, vigDesde, vigHasta, tipoDs, {val:maxFecha})
    deletePeriodFromMRO(tx, motorFechaId, tipoDs)  // replace if period reused
    upsertMotorOferta loop → MOTOROFERTA_ID per ruleset
    insertMRORecords(tx, {ruleEntries, paramEntries}, motorFechaId, maxIds)
       → MRO_MOTORREGLA/COND/CONDVAL/ACCION/PARAM rows with FK MOTORFECHA_ID, NO VIGENCIA_*
    commit
        │  { published, rules, params }
        ▼
[later: any simulation]  POST /api/simulate/{init|pre|final}
        │
        ▼
[config_service] EXEC cfg_get_offers_and_params_json_cached(@DATE)
        │   SP: mf_rules_win + mf_params_win (TIPO_DS + most-recent-wins) → single period/offer/type
        ▼
  normalizeConfig(parsed)  →  initcheck/precheck/finalize  →  dictamen (duplicates = 0)
```

---

## Strict TDD test plan (RED first)

Test runner: `node --test` from `rule_set/`. Angular: `ng test`. Follow the existing pattern (extract pure helpers, avoid live-DB mocks where possible; SP behavior is covered by feeding engine-shaped JSON fixtures through `normalizeConfig` + pipeline).

### Engine-regression fixtures (the critical risk) — `rule_set/test/rule_engine.test.js`

| RED test | Setup | Assertion |
|----------|-------|-----------|
| most-recent-wins, overlapping AMBOS periods | SP-shaped JSON where the SP correctly returned only the newer period | dictamen equals newer-period expectation; `offers[].rules.length` equals the single resolved set |
| zero-duplicate invariant | feed JSON that (pre-fix) would contain duplicated rules; assert the resolved input has no duplicate `MOTORREGLA_ID` per offer | `new Set(ruleIds).size === ruleIds.length` |
| per-type split recency | rules from period P1 (older), params from P2 (newer) for same offer | rule set from P1, `paramsIndex[offer][key]` from P2 |
| params last-wins masking guard | duplicate param groups same key different value | document that engine masks → SP MUST dedupe; assert resolved JSON has one group per offer |

### SQL SP behavior — `rule_set/test/mro_resolution.test.js` (new)

Extract the most-recent-wins resolution intent as pure helper(s) mirroring the SP (`resolveWinningPeriod(periods, date, type)`), unit-test:
- picks max `DESDE_DT` covering date; tie-break max id.
- `REGLAS`/`AMBOS` for rules, `PARAMS`/`AMBOS` for params; excludes non-covering and `BORRADO_FL=1`.
- empty when no covering period.

### Publish/insert/delete helpers — `rule_set/test/workflow_publish.test.js` (extend)

| RED test | Assertion |
|----------|-----------|
| `upsertMotorFecha` key match (pure helper `matchFechaKey(existing, desde, hasta, tipo)`) | exact (desde,hasta,tipo) → reuse; any diff → new |
| ID high-water-mark on republish | `nextId(maxFecha)` never reuses; capture-before-delete sequence keeps monotonic ids |
| `deletePeriodFromMRO` scope (pure helper deciding which tables by tipo) | REGLAS→rules tables only; PARAMS→param only; AMBOS→both |
| insert column contract | the built INSERT shape contains `MOTORFECHA_ID` and NOT `VIGENCIA_DESDE_DT`/`VIGENCIA_HASTA_DT` |
| `tipoDs` validation | controller helper rejects values ∉ {REGLAS,PARAMS,AMBOS}; undefined → AMBOS |

### Round-trip — `rule_set/test/workflow_snapshot_roundtrip.test.js` (new)

Pure transform-level: publish payload → MRO record shape → WF-snapshot JSON shape → restore payload. Assert offer codes/oferta_id and param dedupe survive the round trip (no live DB).

### Angular — `*.spec.ts`

- `admin-api.service.spec.ts`: `publishToWorkflow` includes `tipoDs` in the POST body; default AMBOS when omitted.
- `snapshots-page.component.spec.ts`: WF-origin row shows deploy-to-POC action; POC row shows publish-to-WF action.

---

## Risks

- **CRITICAL** — Rewriting `cfg_get_offers_and_params_json` touches ALL simulations. A wrong winner CTE silently changes dictámenes. Mitigation: winner-CTE design makes duplicates structurally impossible; RED tests assert per-type recency + zero duplicates; do not merge without green `node --test`.
- **HIGH** — `MRO_MOTORFECHA` has no insert path today; `MAX+1` under concurrency. Mitigation: `upsertMotorFecha` + `getMaxIds` both use `UPDLOCK` inside the same TX; capture max before deletes (high-water mark).
- **HIGH** — Insert/delete code is already invalid against the real schema (writes non-existent `VIGENCIA_*`). This is not a regression risk but means the publish path is currently non-functional; apply must land SQL SP + service together.
- **MEDIUM** — WF-snapshot SP migration: keep JSON field names stable (`VIGENCIA_DESDE_DT`/`HASTA_DT` sourced from `MOTORFECHA`) so `restoreSnapshot` consumers don't break. Covered by round-trip test.
- **MEDIUM** — `cfg_get_rules_json` fallback SP not yet inspected; confirm it has no inline temporal read during apply.

## Conflicts with decisions doc

None. The only divergence from the proposal narrative is a factual correction: the engine SP **already** joins `MOTORFECHA_ID` (proposal said the inconsistency was insert-writes-VIGENCIA vs SP-reads-MOTORFECHA — confirmed true); additionally `MRO_MOTORREGLA` has no `VIGENCIA_*` columns at all, so the current insert/delete code is already broken. This strengthens, not contradicts, the decision to migrate fully.
