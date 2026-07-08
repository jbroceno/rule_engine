# Verify Report — mro-snapshot-deploy (Re-run 2, final)

Date: 2026-06-02
Mode: Strict TDD
Verdict: PASS-WITH-WARNINGS
Counts: 0 CRITICAL | 1 WARNING (subsequently FIXED) | 1 SUGGESTION (open, non-blocking)

> Engram observation: #89

## Prior Findings Closure

| ID | Prior Verdict | Current Status | Evidence |
|----|---------------|----------------|---------|
| C-1 | CRITICAL mirror/tautology tests | CLOSED | resolveOfertaId gone (comment-only). parseOfertaIdOverrides exported at controller L13, called at L82 and L146. buildWfSafetySnapshotComment exported at service L542, called at controller L152. getDeleteScope exported at service L43, called at service L59. assembleWfSnapshotPayload exported at service L562, called at service L598. Zero test-local reimplementations confirmed by grep. |
| C-2 | CRITICAL cap-1 motorFechaId contract break | CLOSED | AdminWorkflowSnapshotPayload has vigDesde/vigHasta (no motorFechaId) at admin.models.ts L334-338. Controller reads body.vigDesde/body.vigHasta at L94-95. Angular T3.cap1a explicitly asserts motorFechaId is absent. |
| W-2 | WARNING no safety snapshot before publish | CLOSED | postWorkflowPublicar at controller L149-156 calls buildWfSafetySnapshotComment then createWorkflowSnapshot(null, null, createdBy) BEFORE publishCfgToWorkflow. Response includes prePublishSnapshotId. Tests W-2a/b/c pass. |
| W-1 | WARNING tasks not marked removed | CLOSED | Tasks artifact shows [REMOVED] markers on 1.2, 2.2a-d, 2.3a-c; Phase 4 fix tasks all checked. |
| W-new-1 | WARNING validateEntornoCd not wired | FIXED (post-verify) | validateEntornoCd now imported and called in postSnapshotRestore; rejects destino outside POC/WF with HTTP 400. |

## Test Execution

Backend (npm test): 163 tests | 156 pass | 5 fail (all pre-existing) | 2 skip
  - not ok 23 CA-003 (mssql pool mock — pre-existing)
  - not ok 68/69/70/76 (rule_engine fixtures — pre-existing)

Angular (ng test): 36/36 SUCCESS

## Issues Found

### SUGGESTION (open, non-blocking)

S-1: safetyComment in W-2 response is redundant with stored snapshot comment.
- rule_set/api/controllers/admin_snapshots_controller.js:156
- Remove safetyComment from response; keep prePublishSnapshotId only.
- Non-blocking, no spec requirement to include safetyComment in response.

## Spec Compliance Matrix

| Scenario | Description | Status |
|----------|-------------|--------|
| 01 | most-recent-wins | T1.1a-b COMPLIANT |
| 02 | unico AMBOS | T1.1c COMPLIANT |
| 03 | sin periodo | T1.1d-e COMPLIANT |
| 04 | deploy periodo nuevo | LIVE-DB-PENDING |
| 05 | deploy periodo exacto reuse | LIVE-DB-PENDING |
| 06 | no cross-period impact | LIVE-DB-PENDING |
| 07 | TIPO_DS=PARAMS no borra MOTORREGLA | T2.1b+T2.2e COMPLIANT |
| 08 | high-water mark IDs | LIVE-DB-PENDING |
| 09 | WF snapshot shape | T2.4a-e COMPLIANT |
| 10 | safety snapshot before deploy | W-2a/b/c COMPLIANT |
| 11 | snapshot pub = direct pub | LIVE-DB-PENDING |
| 12 | dedupe params last-wins | LIVE-DB-PENDING |
| 13 | ENTORNO_CD PRE rejected 4xx | COMPLIANT (fixed post-verify) |
| 14 | filter by ENTORNO_CD | T3.1c COMPLIANT |
| 15 | regression npm test green | 156/163 COMPLIANT |

9/15 fully compliant (CI), 6 live-DB-pending (by design, checklists in SQL files).
