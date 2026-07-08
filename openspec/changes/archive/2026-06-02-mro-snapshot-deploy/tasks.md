# Tasks: mro-snapshot-deploy

> Engram observation: #86

## Phase 1 — SQL read SP rewrite

- [x] 1.1 [RED PURE-JS] rule_engine.test.js: overlapping-period + zero-duplicate fixtures (T1.1a–e)
- [REMOVED] 1.2 [RED PURE-JS] mro_resolution.test.js — REMOVED: resolveWinningPeriod was a JS mirror of the SQL winner CTE. Deleted per user decision (PR1) and anti-mirror rule.
- [x] 1.3 [SQL-LIVE IMPL] Rewrite wf_sp_cfg_get_offers_and_params_json.sql with mf_rules_win + mf_params_win winner CTEs (ROW_NUMBER TIPO_DS); drop VIGENCIA_* references
- [x] 1.4 [SQL-LIVE IMPL] Inspect wf_sp_cfg_get_rules_json.sql fallback SP; remove dead VIGENCIA_* comments; document scope

## Phase 2 — API publish path migration (sequential after 1.3 deployed)

- [x] 2.1 [RED PURE-JS] workflow_publish.test.js: deletePeriodFromMRO scope-by-tipo (T2.1a–d) — GREEN
- [REMOVED] 2.2a-d [RED PURE-JS] upsertMotorFecha new-vs-reuse tests — REMOVED: logic lives in SQL (UPDLOCK SELECT + INSERT); mirror-tested a JS reimplementation. Deleted per anti-mirror rule.
- [x] 2.2e tipoDs validation via getDeleteScope — KEPT (real exported fn)
- [REMOVED] 2.3a-c [RED PURE-JS] INSERT column contract tests — REMOVED: asserting test-local copies of INSERT SQL strings is a tautology. Verified at SQL/schema level only (live-DB checklist).
- [x] 2.4 [RED PURE-JS] workflow_snapshot_roundtrip.test.js: assembleWfSnapshotPayload shape (T2.4a–e) — GREEN
- [x] 2.5 [SQL-LIVE IMPL] admin_workflow_service.js: getMaxIds +maxFecha; upsertMotorFecha; rewrite deletePeriodFromMRO; rewrite insertMRORecords drop VIGENCIA_*; tipoDs option. LIVE-DB-PENDING.
- [x] 2.6 [SQL-LIVE IMPL] workflow_snapshot.sql: migrate cfg_get_workflow_snapshot_json to MOTORFECHA_ID JOIN; keep JSON field names VIGENCIA_DESDE_DT/HASTA_DT; add TIPO_DS. LIVE-DB-PENDING.
- [x] 2.7 [IMPL] admin_workflow_service.js: createWorkflowSnapshot refactored to assembleWfSnapshotPayload
- [x] 2.8 [IMPL] admin_service.js: VERIFIED no-change needed — WF→POC fully implemented
- [x] 2.9 [IMPL] admin_snapshots_controller.js: tipoDs field + parseTipoDs; default AMBOS; 400 on invalid
- [x] 2.10 [RED+IMPL PURE-JS] admin_validator.js: validateEntornoCd (T2.10a–d) — GREEN

## Phase 3 — Angular UI (DONE — ng test 36/36 GREEN after C-2 fix)

- [x] 3.1 [RED Angular] admin-api.service.spec.ts: 7 tests T3.1a–e + T3.cap1a-b (C-2 fix) — ng test GREEN
- [x] 3.2 [IMPL] admin.models.ts: tipoDs on AdminWorkflowPublicarPayload; new AdminWorkflowPublicarSnapshotPayload; AdminWorkflowSnapshotPayload → REVERTED to vigDesde/vigHasta (C-2 fix)
- [x] 3.3 [IMPL] admin-api.service.ts: publishSnapshotToWorkflow; createWorkflowSnapshot sends vigDesde/vigHasta (C-2 fix)
- [x] 3.4 [IMPL] configurator-page: publicarTipoDs signal + TIPO_DS selector in dialog; executePublicarWf passes tipoDs (cap-2)
- [x] 3.5 [IMPL] snapshots-page: publishWfDialog + openPublishWfDialog/executePublishWf; POC-row button + dialog (cap-3)
- [x] 3.6 [IMPL] snapshots-page: cap-4 enabled (restore button not gated by entorno_cd); improved WF→POC success message
- [x] 3.7 [IMPL — C-2 FIXED] snapshots-page: WF snapshot dialog reverted to date range (snapshotVigDesde + snapshotVigHasta signals; two date inputs)

## Phase 4 — Verify fixes (post-verify round, ALL DONE)

- [x] C-1: FIXED — removed resolveOfertaId mirror+tests; exported parseOfertaIdOverrides from controller; rewrote 8 tests to use real import.
- [x] C-2: FIXED — reverted cap-1 to date range (vigDesde/vigHasta) throughout Angular + models.
- [x] W-2: FIXED — exported buildWfSafetySnapshotComment; safety snapshot called in postWorkflowPublicar before publish; prePublishSnapshotId in response; 3 pure-JS tests GREEN.
- [x] W-1: DONE — tasks updated with [REMOVED] markers and verify-fix completions.
- [x] W-new-1: FIXED — validateEntornoCd imported and called in admin_snapshots_controller.js postSnapshotRestore; rejects destino outside POC/WF with 400.

## Phase 5 — Regression gate (CONFIRMED)

- [x] 4.1 npm test: 163 tests — 156 pass / 5 fail (pre-existing only) / 2 skip
- [x] ng test: 36/36 pass

## Delivery (chained PRs — NOT YET committed)

- PR1: tasks 1.x — COMPLETE in working tree
- PR2a: tasks 2.4, 2.6, 2.7 — COMPLETE in working tree
- PR2b: tasks 2.1–2.3, 2.5, 2.8–2.10 — COMPLETE in working tree
- PR3: tasks 3.x — COMPLETE in working tree
- PR4 (verify fixes): C-1, C-2, W-2, W-new-1 — COMPLETE in working tree

## Key files changed

- rule_set/sql/workflow_deploy/wf_sp_cfg_get_offers_and_params_json.sql
- rule_set/sql/workflow_snapshot.sql
- rule_set/test/rule_engine.test.js
- rule_set/test/workflow_publish.test.js
- rule_set/test/workflow_snapshot_roundtrip.test.js
- rule_set/api/controllers/admin_snapshots_controller.js
- rule_set/api/services/admin_workflow_service.js
- rule_set/api/services/admin_service.js
- rule_set/api/validators/admin_validator.js
- rule_set/web/src/app/models/admin.models.ts
- rule_set/web/src/app/services/admin-api.service.ts
- rule_set/web/src/app/services/admin-api.service.spec.ts
- rule_set/web/src/app/pages/snapshots-page.component.ts
- rule_set/web/src/app/pages/snapshots-page.component.html
- rule_set/web/src/app/pages/configurator-page.component.ts
- rule_set/web/src/app/pages/configurator-page.component.html
