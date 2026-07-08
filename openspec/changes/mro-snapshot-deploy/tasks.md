# Tasks: mro-snapshot-deploy

**Change**: mro-snapshot-deploy
**Date**: 2026-06-02
**Delivery strategy**: ask-on-risk
**Strict TDD**: active (`node --test` from `rule_set/`; Angular `ng test`)

> **Source artifacts**: spec #84 · design #85 · decisions #79
>
> **TDD rule**: every implementation task (Ix) is preceded by its RED test task (Tx).
> A task marked `[SQL-LIVE]` requires a live SQL Server connection and cannot run in CI without one.
> Tasks marked `[PURE-JS]` run in CI with no DB.

---

## Phase 1 — SQL: Read SP rewrite (cfg_get_offers_and_params_json)

**Goal**: Closes the evaluation-path gap. Most-recent-wins with TIPO_DS CTE — zero duplicates by construction. This is the main regression risk; engine tests gate the merge.

---

### 1.1 [PURE-JS] RED — engine regression + overlapping-period fixtures

**File**: `rule_set/test/rule_engine.test.js` (extend existing)
**Spec**: RF-MRO-01.1–01.5, Escenarios 01–03, 15

Add test cases (all pure JS, no DB):

| Test ID | What it asserts |
|---------|----------------|
| T1.1a | Config with one AMBOS period → `initcheck/precheck/finalize` returns expected dictamen (baseline fixture) |
| T1.1b | Config where rules come from period A (`TIPO_DS=AMBOS`) and params from period B (`TIPO_DS=PARAMS`, later `DESDE_DT`) → dictamen correct |
| T1.1c | Config with zero-period offer → `initcheck` returns empty `eligibleOffers`, no error |
| T1.1d | Duplicated rules in input config (same `rule_id` twice) → Set size of `rule_id` values equals array length (zero duplicates assertion) |
| T1.1e | Duplicated params in input → last-wins masking: only the last value per key appears in `paramsIndex` |

Commit message: `test(engine): add overlapping-period and zero-duplicate regression fixtures`

---

### 1.2 [PURE-JS] RED — pure resolution helper tests

**File**: `rule_set/test/mro_resolution.test.js` (new file)
**Spec**: RF-MRO-01.1–01.5

Create `resolveWinningPeriod(periods, date, type)` — a **pure JS mirror** of the SQL CTE logic for isolated testing.

| Test ID | What it asserts |
|---------|----------------|
| T1.2a | AMBOS covering date → selected for both REGLAS and PARAMS |
| T1.2b | AMBOS + later PARAMS → REGLAS from AMBOS, PARAMS from PARAMS period |
| T1.2c | Two REGLAS periods covering date → highest `DESDE_DT` wins; tie → highest `MOTORFECHA_ID` |
| T1.2d | No period covering date → returns `null` |
| T1.2e | Period where `HASTA_DT = null` → treated as open-ended ("no end"), included |
| T1.2f | Period where `HASTA_DT` is before date → excluded |
| T1.2g | `TIPO_DS=PARAMS` period → not selected for REGLAS query |

Commit message: `test(mro-resolution): pure period resolution helper tests`

---

### 1.3 [SQL-LIVE] IMPLEMENTATION — rewrite cfg_get_offers_and_params_json

**File**: `rule_set/sql/workflow_deploy/wf_sp_cfg_get_offers_and_params_json.sql`
**Spec**: RF-MRO-01.1–01.6, INV-01

Replace lines 83–109 (the date-only `rules`/`params` CTEs) with two independent winner CTEs:

```
mf_rules_win  — ROW_NUMBER() OVER (PARTITION BY MOTOROFERTA_ID ORDER BY DESDE_DT DESC, MOTORFECHA_ID DESC)
                WHERE TIPO_DS IN ('REGLAS','AMBOS') AND DESDE_DT <= @DATE AND (HASTA_DT IS NULL OR HASTA_DT > @DATE)
                rn = 1

mf_params_win — same pattern, WHERE TIPO_DS IN ('PARAMS','AMBOS')
```

`rules` CTE: JOIN `MRO_MOTORREGLA r` → `mf_rules_win mfw ON mfw.MOTOROFERTA_ID = r.MOTOROFERTA_ID AND mfw.MOTORFECHA_ID = r.MOTORFECHA_ID`
`params` CTE: JOIN `MRO_MOTORPARAM p` → `mf_params_win mfw ON ...`

Remove all references to `VIGENCIA_DESDE_DT`/`VIGENCIA_HASTA_DT`. Keep column projection identical (`OFERTA_ID`, `OFERTA_CD`, `OFERTA_DS`, `REGLAS`, `PARAMS`).

Verification: apply SP → run `npm test` (green = done).

Commit message: `sql(read-sp): rewrite cfg_get_offers_and_params_json with TIPO_DS winner CTEs`

---

### 1.4 [SQL-LIVE] INSPECT + MIGRATE cfg_get_rules_json (fallback SP)

**File**: `rule_set/sql/workflow_deploy/wf_sp_cfg_get_rules_json.sql`
**Spec**: design risk "cfg_get_rules_json fallback SP not yet inspected"

**Finding (pre-read)**: Lines 108–109 and 130–131 have VIGENCIA_* filters commented out (`--`). The fallback reads ALL active rows regardless of date/period. No MOTORFECHA_ID JOIN exists.

**Decision criteria**:
- If the fallback SP is never called in a live environment (config_service always uses the primary SP), add a code comment documenting this and close the task.
- If it can be called, add a `MOTORFECHA_ID` JOIN using `GETDATE()` as the cutoff, mirroring the same winner-CTE pattern.

**Required action regardless**: Remove the commented-out VIGENCIA_* lines (they are dead code and mislead reviewers).

Commit message: `sql(fallback-sp): remove dead VIGENCIA_* comments; document fallback scope`

---

## Phase 2 — API: publish path migration

**Goal**: `deletePeriodFromMRO` keyed by `MOTORFECHA_ID`; `insertMRORecords` drops VIGENCIA_*; `getMaxIds` adds `maxFecha`; new `upsertMotorFecha`; `publishCfgToWorkflow` / `publishSnapshotToWorkflow` wired to new TX order; `createWorkflowSnapshot` SP call updated; `tipoDs` contract field; auto-safety snapshot on publish; cap-4 WF-origin guard removed.

> Phase 2 is **sequential after Phase 1** (SQL must be deployed before API tests can pass against live DB). The pure-JS parts (2.1–2.4) can run in CI immediately.

---

### 2.1 [PURE-JS] RED — deletePeriodFromMRO scope-by-tipo tests

**File**: `rule_set/test/workflow_publish.test.js` (extend)
**Spec**: RF-MRO-02.2, Escenarios 06–07

Extract / inline the `deletePeriodFromMRO` key-selection logic as a pure helper for isolated testing:

| Test ID | What it asserts |
|---------|----------------|
| T2.1a | `tipo=REGLAS` → tables deleted = `[CONDVAL, COND, ACCION, REGLA]`; MOTORPARAM not touched |
| T2.1b | `tipo=PARAMS` → only `MOTORPARAM` deleted |
| T2.1c | `tipo=AMBOS` → both REGLA chain and MOTORPARAM deleted |
| T2.1d | Called with a `motorFechaId` that doesn't exist → deletes 0 rows, no error |

Commit message: `test(publish): deletePeriodFromMRO scope-by-tipo unit tests`

---

### 2.2 [PURE-JS] RED — ID high-water-mark and upsertMotorFecha tests

**File**: `rule_set/test/workflow_publish.test.js` (extend)
**Spec**: RF-MRO-02.1, RF-MRO-03.1–03.4, Escenarios 04–05, 08

| Test ID | What it asserts |
|---------|----------------|
| T2.2a | `upsertMotorFecha` with no matching period → new id = `maxFecha + 1` |
| T2.2b | `upsertMotorFecha` with exact `(DESDE_DT, HASTA_DT, TIPO_DS)` match → reuses existing `MOTORFECHA_ID`; dependent ids continue from `maxFecha` + 1 |
| T2.2c | High-water mark: `MAX(REGLA_ID)=100` before delete, 5 rows deleted (96–100) → new ids start at 101 (not 96) |
| T2.2d | `matchFechaKey(desde, hasta, tipo, existing[])` helper: returns matching record or null |
| T2.2e | `tipoDs` validation: rejects values outside `{REGLAS, PARAMS, AMBOS}`; defaults to `AMBOS` when absent |

Commit message: `test(publish): upsertMotorFecha and high-water-mark ID tests`

---

### 2.3 [PURE-JS] RED — insert column contract test

**File**: `rule_set/test/workflow_publish.test.js` (extend)
**Spec**: RF-MRO-02.4, INV-01, INV-02

| Test ID | What it asserts |
|---------|----------------|
| T2.3a | `insertMRORecords` invocations include `MOTORFECHA_ID` in the INSERT column list |
| T2.3b | `insertMRORecords` invocations do NOT include `VIGENCIA_DESDE_DT` or `VIGENCIA_HASTA_DT` |
| T2.3c | Each inserted `MOTORREGLA` record carries `MOTORFECHA_ID = motorFechaId` (FK set) |

These tests mock the `tx.request()` and capture the SQL strings.

Commit message: `test(publish): INSERT column contract — MOTORFECHA_ID set, VIGENCIA_* absent`

---

### 2.4 [PURE-JS] RED — snapshot round-trip tests

**File**: `rule_set/test/workflow_snapshot_roundtrip.test.js` (new file)
**Spec**: RF-MRO-04.1–04.4, RF-MRO-05.4, RF-MRO-06.4, Escenarios 09–11

| Test ID | What it asserts |
|---------|----------------|
| T2.4a | Mock WF-snapshot SP output contains `DESDE_DT`, `HASTA_DT`, `TIPO_DS` per rule/param (not `VIGENCIA_*`) |
| T2.4b | `createWorkflowSnapshot` calls SP with no VIGENCIA params; snapshot row has `ENTORNO_CD='WF'` |
| T2.4c | Publish-to-WF response includes `snapshot_id` of auto safety snapshot |
| T2.4d | Safety snapshot created before MRO writes (verify call order in mock) |
| T2.4e | Offer `code`/`oferta_id` + param dedupe survive the round-trip (publish → snapshot JSON → restore payload) |

Commit message: `test(snapshot-roundtrip): WF snapshot shape and publish safety-snapshot ordering`

---

### 2.5 [SQL-LIVE] IMPLEMENTATION — admin_workflow_service.js core rewrite

**File**: `rule_set/api/services/admin_workflow_service.js`
**Spec**: RF-MRO-02.1–02.5, RF-MRO-03.1–03.4, INV-01, INV-02, INV-05, INV-06

Changes (all within one commit):

| Function | Change |
|----------|--------|
| `getMaxIds(tx)` | Add `ISNULL(MAX(MOTORFECHA_ID),0) AS maxFecha` from `MRO_MOTORFECHA WITH (UPDLOCK, ROWLOCK)` |
| NEW `upsertMotorFecha(tx, desde, hasta, tipo, maxIdRef)` | SELECT with UPDLOCK; exact key match → return existing id; else `++maxIdRef.val` + INSERT |
| `deletePeriodFromMRO(tx, motorFechaId, tipo)` | Replace VIGENCIA_* parameter signature with `(motorFechaId, tipo)`; JOIN all deletes on `MOTORFECHA_ID = @fid`; scope by `tipo` |
| `insertMRORecords(tx, entries, motorFechaId, maxIds)` | Remove `vigDesde`/`vigHasta` parameters; add `motorFechaId`; rewrite MOTORREGLA INSERT (drop VIGENCIA_* columns, add `MOTORFECHA_ID`); rewrite MOTORPARAM INSERT (same) |
| `publishCfgToWorkflow` | TX order: `getMaxIds` → `upsertMotorFecha(tipo)` → `deletePeriodFromMRO(fid, tipo)` → `upsertMotorOferta loop` → `insertMRORecords(fid)`. Add `tipoDs` option (default `AMBOS`). Auto-create safety WF snapshot before TX begin; include `snapshot_id` in response. |
| `publishSnapshotToWorkflow` | Same TX order as above. Add `tipoDs` option. Auto safety snapshot. |

Commit message: `feat(workflow-service): migrate to MOTORFECHA_ID; upsertMotorFecha; drop VIGENCIA_* writes`

---

### 2.6 [SQL-LIVE] IMPLEMENTATION — cfg_get_workflow_snapshot_json SP migration

**File**: `rule_set/sql/workflow_snapshot.sql`
**Spec**: RF-MRO-04.1–04.2, Escenario 09

Replace inline `VIGENCIA_*` reads (lines 34–35, 76–77, 89–90, 93–94) with MOTORFECHA_ID JOIN:

- Parameters: change `@VIGENCIA_DESDE`/`@VIGENCIA_HASTA` to `@MOTORFECHA_ID INT = NULL` (NULL = export all).
- `reglas` query: JOIN `MRO_MOTORFECHA mf ON mf.MOTORFECHA_ID = r.MOTORFECHA_ID`; filter `WHERE @MOTORFECHA_ID IS NULL OR r.MOTORFECHA_ID = @MOTORFECHA_ID`.
- `params` query: same JOIN pattern.
- Projection: replace `r.VIGENCIA_DESDE_DT`, `r.VIGENCIA_HASTA_DT` with `mf.DESDE_DT AS VIGENCIA_DESDE_DT`, `mf.HASTA_DT AS VIGENCIA_HASTA_DT` — **keep these JSON field names** so `restoreSnapshot` stays compatible (design decision: stable field names, sourced from MOTORFECHA).
- Add `mf.TIPO_DS` to both rule and param projections.

Commit message: `sql(snapshot-sp): migrate cfg_get_workflow_snapshot_json to MOTORFECHA_ID JOIN`

---

### 2.7 IMPLEMENTATION — createWorkflowSnapshot JS call update

**File**: `rule_set/api/services/admin_workflow_service.js`
**Spec**: RF-MRO-04.1, RF-MRO-04.3
**Depends on**: 2.6

Update `createWorkflowSnapshot` to:
- Accept `motorFechaId` instead of `vigDesde`/`vigHasta`.
- Pass `@MOTORFECHA_ID` (sql.Int) to the SP instead of VIGENCIA params.
- Keep `ENTORNO_CD='WF'` in the snapshot INSERT (already correct).

Update `postWorkflowSnapshot` controller to accept `motorFechaId` from the request body.
Update `adminRouter` if the route signature changes (it shouldn't, POST body only).

Commit message: `feat(workflow-snapshot): createWorkflowSnapshot uses MOTORFECHA_ID parameter`

---

### 2.8 IMPLEMENTATION — cap-4 WF-origin guard in restoreSnapshot

**File**: `rule_set/api/services/admin_service.js`
**Spec**: RF-MRO-07.1–RF-MRO-07.3, Escenario 12

**Current state**: `restoreSnapshot` already implements the WF→POC transform (oferta_id FK resolution, `pocFechaDesde` period create/reuse, param dedupe last-wins). The only missing piece is the guard that previously blocked `ENTORNO_CD='WF'` snapshots from being restored to POC.

Action: verify (or remove) any guard that rejects `entorno_cd='WF'` when `destino='POC'`. Confirm param dedupe last-wins by `DESDE_DT` is active. Confirm `ENTORNO_CD='POC'` safety snapshot is created before POC apply.

Commit message: `feat(restore-snapshot): enable WF-origin snapshots for POC deploy (cap-4)`

---

### 2.9 IMPLEMENTATION — tipoDs field on publishCfgToWorkflow controller

**File**: `rule_set/api/controllers/admin_snapshots_controller.js`
**Spec**: RF-MRO-05.1–05.3 (design Q3)

Add `tipoDs` extraction + validation to `postWorkflowPublicar`:
- Read `body.tipoDs` (optional, default `AMBOS`).
- Validate: must be one of `REGLAS`, `PARAMS`, `AMBOS`; 400 otherwise.
- Pass to `publishCfgToWorkflow(..., { tipoDs })`.

Commit message: `feat(publish-controller): add tipoDs field validation (default AMBOS)`

---

### 2.10 [PURE-JS] RED + IMPLEMENTATION — ENTORNO_CD validation

**File**: `rule_set/test/workflow_publish.test.js` (test) + `rule_set/api/validators/admin_validator.js` (impl)
**Spec**: RF-MRO-08.1, Escenario 13

| Test ID | What it asserts |
|---------|----------------|
| T2.10a | `validateEntornoCd('POC')` → passes |
| T2.10b | `validateEntornoCd('WF')` → passes |
| T2.10c | `validateEntornoCd('PRE')` → throws AppError 400 |
| T2.10d | `validateEntornoCd(undefined)` → throws AppError 400 |

Commit message: `feat(validator): ENTORNO_CD must be POC or WF`

---

## Phase 3 — Angular: UI capabilities

**Goal**: Configurator "Publicar a WF" dialog (cap-2), snapshots-page WF-row deploy-to-POC (cap-4, already wired via `restoreSnapshot` — needs entorno guard unlock) and POC-row publish-to-WF (cap-3, `destino:WF`), `tipoDs` type, snapshot WF dialog removes VIGENCIA fields.

> Phase 3 is parallel to Phase 2 once models are defined (3.1 can start while 2.5 is in progress).

---

### 3.1 [PURE-JS] RED — Angular service tipoDs and WF-deploy type tests

**File**: `rule_set/web/src/app/services/admin-api.service.spec.ts` (Angular)
**Spec**: RF-MRO-05.1, RF-MRO-06.1 (design Angular plan)

| Test ID | What it asserts |
|---------|----------------|
| T3.1a | `publishToWorkflow({ ..., tipoDs: 'AMBOS' })` sends `tipoDs` in HTTP body |
| T3.1b | `publishToWorkflow({...})` without `tipoDs` omits the field (backend defaults to AMBOS) |
| T3.1c | `restoreSnapshot(id, { destino: 'WF', rangoDestino, ... })` sets `destino='WF'` in body |

Commit message: `test(admin-api.service): publishToWorkflow tipoDs and WF-restore body assertions`

---

### 3.2 IMPLEMENTATION — admin.models.ts: tipoDs type

**File**: `rule_set/web/src/app/models/admin.models.ts`
**Spec**: design Q3, cap-2/3

Changes:
- Add `tipoDs?: 'REGLAS' | 'PARAMS' | 'AMBOS'` to `AdminWorkflowPublicarPayload`.
- Add `AdminWorkflowPublicarSnapshotPayload` interface (cap-3: publish snapshot to WF): `{ snapshotId: number; rangoDestino: { vigDesde: string; vigHasta: string | null }; tipoDs?: 'REGLAS' | 'PARAMS' | 'AMBOS'; createdBy?: string; }`.
- Update `AdminWorkflowSnapshotPayload`: replace `vigDesde`/`vigHasta` with `motorFechaId?: number | null` (nullable, null = full export).

Commit message: `feat(admin.models): add tipoDs to publish payload; update WF snapshot to motorFechaId`

---

### 3.3 IMPLEMENTATION — admin-api.service.ts: new WF publish methods

**File**: `rule_set/web/src/app/services/admin-api.service.ts`
**Spec**: RF-MRO-05.1, RF-MRO-06.1–06.4

Changes:
- `publishToWorkflow(payload: AdminWorkflowPublicarPayload)`: already exists as `postWorkflowPublicar`; update to pass `tipoDs`.
- Add `publishSnapshotToWorkflow(payload: AdminWorkflowPublicarSnapshotPayload)`: `POST /api/admin/snapshots/:snapshotId/restore` with `destino: 'WF'`.
- Update `createWorkflowSnapshot` to send `motorFechaId` instead of `vigDesde`/`vigHasta`.

Commit message: `feat(admin-api.service): add publishSnapshotToWorkflow; update WF snapshot call`

---

### 3.4 IMPLEMENTATION — configurator-page: "Publicar a WF" dialog (cap-2)

**File**: `rule_set/web/src/app/pages/configurator-page.component.ts` + `.html`
**Spec**: RF-MRO-05.1–05.4

Add to the configurator publish operations bar:

- "Publicar a WF" button (visible when there is an active `offerDateId`).
- Dialog fields:
  - Período origen (read-only, shows selected `offer_date_id`)
  - `vigDesde` / `vigHasta` for `rangoDestino` in MRO
  - `TIPO_DS` selector (`REGLAS` | `PARAMS` | `AMBOS`; default `AMBOS`)
  - `createdBy` (optional)
  - Motivo/Comment (required, forwarded as comment to safety snapshot)
- On confirm: call `adminApiService.publishToWorkflow(...)`.
- Show response: `snapshot_id` of safety snapshot in success message.

Commit message: `feat(configurator): add Publicar a WF dialog with tipoDs selector (cap-2)`

---

### 3.5 IMPLEMENTATION — snapshots-page: cap-3 (POC row → publish to WF)

**File**: `rule_set/web/src/app/pages/snapshots-page.component.ts` + `.html`
**Spec**: RF-MRO-06.1–RF-MRO-06.4

In the snapshots list, for rows where `entorno_cd === 'POC'`:
- Add "Publicar a WF" action button (alongside existing Restore button).
- Opens a dialog with: `vigDesde` / `vigHasta` for MRO `rangoDestino`, `tipoDs` selector (hardcoded `AMBOS` per design — no selector needed on this path), `createdBy`.
- On confirm: call `adminApiService.publishSnapshotToWorkflow({ snapshotId, rangoDestino, tipoDs: 'AMBOS', createdBy })`.
- Success: show snapshot_id of auto safety snapshot.

Commit message: `feat(snapshots-page): add Publicar a WF action for POC-origin snapshots (cap-3)`

---

### 3.6 IMPLEMENTATION — snapshots-page: cap-4 (WF row → deploy to POC)

**File**: `rule_set/web/src/app/pages/snapshots-page.component.ts` + `.html`
**Spec**: RF-MRO-07.1–RF-MRO-07.4, Escenario 12

The existing `executeRestore()` and `confirmRestore()` already handle WF→POC via `destino='POC'` + `pocFechaDesde`. The backend guard (task 2.8) unblocks the `entorno_cd='WF'` path.

Required Angular changes:
- The restore dialog already shows `pocFechaDesde` when `isWfSnap && destino === 'POC'` — verify this condition is correct and complete.
- Ensure the "Restaurar en POC" button is visible for WF-origin rows (not disabled/hidden).
- Update success message to clarify origin was WF.

Commit message: `feat(snapshots-page): enable deploy-to-POC for WF-origin snapshots (cap-4)`

---

### 3.7 IMPLEMENTATION — snapshots-page: cap-1 UI update (WF snapshot dialog)

**File**: `rule_set/web/src/app/pages/snapshots-page.component.ts` + `.html`
**Spec**: RF-MRO-04.1–RF-MRO-04.4, Escenario 09

Replace the `vigDesde`/`vigHasta` fields in the "Tomar snapshot WF" dialog with a `motorFechaId` input (optional integer; null = export all periods). Update `executeSnapshotWf()` to send `motorFechaId` instead of vigencia range.

Commit message: `feat(snapshots-page): WF snapshot dialog uses motorFechaId (cap-1)`

---

## Phase 4 — Regression gate

### 4.1 [PURE-JS] Verify full test suite green

**Spec**: RNF-MRO-04, Escenario 15

Run `npm test` from `rule_set/`. All existing tests plus all new tests added in phases 1–3 must pass. This is the merge gate for PR1 (phases 1 + 2 pure-JS parts) and the final gate for all PRs.

No code changes. Task is a checklist checkpoint.

---

## Task Dependency Graph

```
Phase 1 (SQL)
  1.1 [RED] ─┐
  1.2 [RED] ─┤
  1.3 [IMPL]─┤← depends on 1.1, 1.2 passing
  1.4 [IMPL] └ independent

Phase 2 (API)
  2.1 [RED] ─┐
  2.2 [RED] ─┤  ← can start in parallel with Phase 1
  2.3 [RED] ─┤
  2.4 [RED] ─┤
  2.5 [IMPL]─┤← depends on 2.1–2.4 RED, 1.3 SQL deployed
  2.6 [IMPL] │← independent (separate SP file)
  2.7 [IMPL]─┤← depends on 2.6
  2.8 [IMPL] │← independent (admin_service.js)
  2.9 [IMPL] │← independent (controller only)
  2.10[RED+I]─┘← independent

Phase 3 (Angular)
  3.1 [RED] ─┐
  3.2 [IMPL] │← can start once design confirmed
  3.3 [IMPL]─┤← depends on 3.2 types
  3.4 [IMPL]─┤← depends on 3.2, 3.3
  3.5 [IMPL]─┤← depends on 3.2, 3.3
  3.6 [IMPL]─┤← depends on 2.8 + 3.2
  3.7 [IMPL]─┘← depends on 2.7 + 3.2

Phase 4 (Gate)
  4.1 ← depends on all above
```

**Sequential constraints**:
- 1.3 (SQL deployed) must precede 2.5 for live-DB tests.
- 2.7 must precede 3.7 (SP signature change propagates to JS then to Angular).
- 2.8 must precede 3.6 (WF-origin guard must be removed before Angular flow can succeed).

**Parallel groups**:
- 1.1 + 1.2 in parallel.
- 2.1 + 2.2 + 2.3 + 2.4 in parallel with Phase 1.
- 2.6 + 2.8 + 2.9 + 2.10 in parallel with 2.5.
- 3.2 + 3.1 can start in parallel with Phase 2.

---

## Spec → Task Traceability

| Spec Requirement | Tasks |
|-----------------|-------|
| RF-MRO-01 (read SP) | 1.1, 1.2, 1.3 |
| RF-MRO-02 (upsert MOTORFECHA) | 2.1, 2.2, 2.3, 2.5 |
| RF-MRO-03 (IDs) | 2.2, 2.5 |
| RF-MRO-04 (cap-1 snapshot WF) | 2.4, 2.6, 2.7, 3.7 |
| RF-MRO-05 (cap-2 publish to WF) | 2.4, 2.5, 2.9, 3.2, 3.3, 3.4 |
| RF-MRO-06 (cap-3 publish snapshot to WF) | 2.4, 2.5, 3.2, 3.3, 3.5 |
| RF-MRO-07 (cap-4 deploy WF to POC) | 2.8, 3.6 |
| RF-MRO-08 (ENTORNO_CD) | 2.10 |
| INV-01 (no VIGENCIA_* writes) | 1.4, 2.3, 2.5, 2.6 |
| INV-02 (MOTORFECHA_ID FK) | 2.3, 2.5 |
| INV-05, INV-06 (IDs before delete) | 2.2, 2.5 |
| RNF-MRO-02 (zero duplicates) | 1.1d, 1.2, 1.3 |
| RNF-MRO-04 (npm test green) | 4.1 |
| Design: fallback SP inspection | 1.4 |
| Escenarios 01–15 (acceptance) | Distributed above; each scenario maps to a T-prefixed test |

---

## Review Workload Forecast

| Metric | Estimate |
|--------|----------|
| SQL files changed | 2 (`wf_sp_cfg_get_offers_and_params_json.sql`, `workflow_snapshot.sql`) + 1 inspection (`wf_sp_cfg_get_rules_json.sql`) |
| API files changed | 2 (`admin_workflow_service.js`, `admin_service.js`) + 1 controller (`admin_snapshots_controller.js`) + 1 validator |
| Angular files changed | 3 TS + 2 HTML + 1 models (6 files) |
| Test files changed/new | 4 JS + 1 Angular spec |
| **Estimated changed lines** | SQL ~120 + API ~250 + Angular ~200 + Tests ~300 = **~870 lines** |
| 400-line budget risk | **HIGH** — well above the 400-line threshold |
| Chained PRs recommended | **YES** |
| Decision needed before apply | **YES** (ask-on-risk triggered) |

### Suggested PR slices

**PR1 — SQL + engine regression** (~200 lines)
- Tasks: 1.1, 1.2, 1.3, 1.4
- Files: `wf_sp_cfg_get_offers_and_params_json.sql`, `wf_sp_cfg_get_rules_json.sql`, `rule_engine.test.js` (extended), `mro_resolution.test.js` (new)
- Self-contained: SQL is deployed; `npm test` is green with new fixtures.
- Merge gate: `npm test` green.

**PR2 — API publish path** (~450 lines)
- Tasks: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10
- Files: `admin_workflow_service.js`, `admin_service.js`, `admin_snapshots_controller.js`, `admin_validator.js`, `workflow_snapshot.sql`, `workflow_publish.test.js` (extended), `workflow_snapshot_roundtrip.test.js` (new)
- Depends on PR1 merged and SQL applied.
- Merge gate: `npm test` green + manual verify against live WF DB.

> PR2 is above 400 lines. Consider splitting at the SQL SP (2.6 + 2.7 into PR2a) vs service rewrites (2.5 + 2.8 + 2.9 + 2.10 into PR2b) if the reviewer requests it.

**PR3 — Angular UI** (~200 lines)
- Tasks: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
- Files: `admin.models.ts`, `admin-api.service.ts`, `admin-api.service.spec.ts`, `configurator-page.component.{ts,html}`, `snapshots-page.component.{ts,html}`
- Depends on PR2 merged.
- Merge gate: `ng test` green.

**PR4 — Regression gate** (0 new lines)
- Task: 4.1
- Checklist-only: full `npm test` + `ng test` run on merged branch.
