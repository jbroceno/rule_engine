# Archive Report — mro-snapshot-deploy

Archived: 2026-06-02
SDD cycle: COMPLETE
Verify verdict: PASS-WITH-WARNINGS (0 CRITICAL)

---

## IMPORTANT: Deployment Status

**CODE-COMPLETE IN WORKING TREE — NOT COMMITTED, NO PRs CREATED YET.**

The user opted for chained PRs to be assembled at the end of the SDD cycle. All implementation lives on branch `refactor/shared-simulator-form-pages`. Git status shows no committed changes from this change set. PRs to create (in order):

| PR | Scope | Tasks |
|----|-------|-------|
| PR1 | SQL read SP rewrite + engine tests | 1.x |
| PR2a | WF-snapshot SP + assembleWfSnapshotPayload | 2.4, 2.6, 2.7 |
| PR2b | Full write path (upsertMotorFecha, deletePeriodFromMRO, insertMRORecords, tipoDs) | 2.1-2.3, 2.5, 2.8-2.10 |
| PR3 | Angular — all 4 capabilities + verify fixes (C-1, C-2, W-2, W-new-1) | 3.x + Phase 4 |

---

## LIVE-DB-PENDING (BLOCKING for production)

Core SQL logic was NOT verifiable in CI (no SQL Server available). **Before production, run the embedded checklists in the SQL files.**

### Checklist 1 — `rule_set/sql/workflow_deploy/wf_sp_cfg_get_offers_and_params_json.sql` (5 cases)

| Case | Description |
|------|-------------|
| L-01 | most-recent-wins: overlapping AMBOS + later PARAMS → rules from AMBOS, params from PARAMS |
| L-02 | single AMBOS period → both rules and params |
| L-03 | no covering period → 0 rules/params, no error |
| L-04 | TIPO_DS=PARAMS period → rules from AMBOS unaffected |
| L-05 | zero duplicates on overlap (Set size == result count) |

### Checklist 2 — `rule_set/sql/workflow_snapshot.sql` (7 cases)

| Case | Description |
|------|-------------|
| L-06 | snapshot includes DESDE_DT/HASTA_DT/TIPO_DS from MOTORFECHA JOIN |
| L-07 | JSON field names VIGENCIA_DESDE_DT/VIGENCIA_HASTA_DT preserved (alias from MOTORFECHA) |
| L-08 | no inline VIGENCIA_* read from MOTORREGLA/MOTORPARAM columns |
| L-09 | snapshot JSON compatible with restoreSnapshot (round-trip) |
| L-10 | single period per offer — no duplication |
| L-11 | entorno_cd='WF' in snapshot record |
| L-12 | TIPO_DS field present in snapshot JSON per-rule/param |

### Write-path checklist

| Item | Description |
|------|-------------|
| W-01 | No `VIGENCIA_*` written to any `MRO_` table |
| W-02 | `MOTORFECHA_ID` NOT NULL on every inserted row |
| W-03 | Exact-period reuse: existing `MOTORFECHA_ID` reused, dependents deleted+reinserted with new ids |
| W-04 | Different-`TIPO_DS` periods at same range coexist — no cross-period delete |
| W-05 | IDs never reused: high-water mark MAX captured before deletes, new ids start from MAX+1 |

### Spec scenarios pending live-DB verification

Scenarios 04, 05, 06, 08, 11, 12 (see verify-report.md) require SQL Server. They are currently LIVE-DB-PENDING by design.

---

## Quality Note: Mirror/Tautology Anti-Pattern

During apply, the mirror/tautology anti-pattern occurred **3 times** and all instances were removed:

1. **PR1**: `rule_set/lib/mro_resolution.js` — `resolveWinningPeriod()` was a pure-JS reimplementation of the SQL most-recent-wins CTE. Removed (user decision).
2. **PR2b**: `matchFechaKey`, `simulateHighWaterMark`, `buildReglaInsertSql`, `buildParamInsertSql` — test-local copies asserting JS mirrors of SQL logic. 7 tests removed.
3. **Phase 4 (C-1)**: `resolveOfertaId` was a trivial inline mirror called only by its own test. Removed; `parseOfertaIdOverrides` properly exported from production controller and tested via real import.

The final test suite contains **only tests over real production JS code**. SQL logic is verified exclusively via live-DB checklists embedded in `.sql` file headers. See engram observation #88 (`app-workflow/feedback/no-sql-mirror-tests`) for the full anti-pattern documentation.

---

## Outstanding

**S-1** (suggestion, non-blocking): `safetyComment` in `postWorkflowPublicar` response (`admin_snapshots_controller.js:156`) is redundant with the snapshot's stored comment. Only `prePublishSnapshotId` is needed in the response. Optional cleanup.

---

## Test Results (final)

| Suite | Passed | Failed | Skip | Note |
|-------|--------|--------|------|------|
| Backend `npm test` | 156 | 5 | 2 | 5 failures all pre-existing (CA-003, rule_engine fixtures 68/69/70/76) |
| Angular `ng test` | 36 | 0 | 0 | |

---

## Files Changed

### SQL

| File | Change |
|------|--------|
| `rule_set/sql/workflow_deploy/wf_sp_cfg_get_offers_and_params_json.sql` | Full rewrite: `mf_rules_win`/`mf_params_win` winner CTEs with `ROW_NUMBER` + `TIPO_DS`; dropped `VIGENCIA_*` references; 5-case live-DB checklist in header |
| `rule_set/sql/workflow_snapshot.sql` | `cfg_get_workflow_snapshot_json` migrated to `MOTORFECHA_ID JOIN`; stable JSON aliases; 7-case live-DB checklist |

### API

| File | Change |
|------|--------|
| `rule_set/api/services/admin_workflow_service.js` | `getMaxIds` + `maxFecha`; `upsertMotorFecha`; `deletePeriodFromMRO` by `MOTORFECHA_ID`; `insertMRORecords` drops `VIGENCIA_*`; `assembleWfSnapshotPayload`; `buildWfSafetySnapshotComment`; `tipoDs` option throughout |
| `rule_set/api/services/admin_service.js` | `restoreSnapshot` WF-origin support (already implemented, verified no-change needed) |
| `rule_set/api/controllers/admin_snapshots_controller.js` | `parseOfertaIdOverrides` exported; `validateEntornoCd` wired (400 on invalid destino); safety snapshot in `postWorkflowPublicar`; `prePublishSnapshotId` in response |
| `rule_set/api/validators/admin_validator.js` | `validateEntornoCd` exported |
| `rule_set/api/routes/admin_routes.js` | Workflow routes (publicar, snapshot) |

### Angular

| File | Change |
|------|--------|
| `rule_set/web/src/app/models/admin.models.ts` | `tipoDs` on `AdminWorkflowPublicarPayload`; `AdminWorkflowPublicarSnapshotPayload`; `AdminWorkflowSnapshotPayload` → `vigDesde/vigHasta` (C-2 fix) |
| `rule_set/web/src/app/services/admin-api.service.ts` | `publishSnapshotToWorkflow`; `createWorkflowSnapshot` with `vigDesde/vigHasta` |
| `rule_set/web/src/app/pages/snapshots-page.component.ts` | Cap-3 (pub POC→WF), Cap-4 (deploy WF→POC), WF snapshot date-range dialog (C-2 fix) |
| `rule_set/web/src/app/pages/snapshots-page.component.html` | Corresponding template changes |
| `rule_set/web/src/app/pages/configurator-page.component.ts` | `publicarTipoDs` signal + `TIPO_DS` selector in dialog (Cap-2) |
| `rule_set/web/src/app/pages/configurator-page.component.html` | Corresponding template changes |

### Tests

| File | Change |
|------|--------|
| `rule_set/test/rule_engine.test.js` | Fixtures T1.1a-e: most-recent-wins, zero-duplicate, per-type split, params last-wins guard |
| `rule_set/test/workflow_publish.test.js` | T2.1a-d: `deletePeriodFromMRO` scope-by-tipo; T2.2e: `getDeleteScope` |
| `rule_set/test/workflow_snapshot_roundtrip.test.js` | T2.4a-e: `assembleWfSnapshotPayload` shape (DESDE_DT/HASTA_DT/TIPO_DS, no VIGENCIA_*) |
| `rule_set/web/src/app/services/admin-api.service.spec.ts` | T3.1a-e + T3.cap1a-b (C-2 fix: asserts vigDesde/vigHasta, not motorFechaId) |

---

## Engram Observation IDs (traceability)

| Artifact | Observation ID |
|----------|---------------|
| Decisions (v4) | #79 |
| Proposal (v3) | #80 |
| Spec | #84 |
| Design | #85 |
| Tasks | #86 |
| Apply progress | #87 |
| Anti-mirror feedback | #88 |
| Verify report (re-run 2) | #89 |
| Archive report | (this save) |

---

## SDD Cycle Summary

| Phase | Status |
|-------|--------|
| Explore / Propose | Complete (engram #79, #80) |
| Spec | Complete (engram #84) |
| Design | Complete (engram #85) |
| Tasks | Complete (engram #86) |
| Apply | Complete — code in working tree, NOT committed (engram #87) |
| Verify | PASS-WITH-WARNINGS → all critical/warnings resolved (engram #89) |
| Archive | COMPLETE (this report) |

**Next step**: assemble and push chained PRs (PR1 → PR2a → PR2b → PR3) from branch `refactor/shared-simulator-form-pages`.
