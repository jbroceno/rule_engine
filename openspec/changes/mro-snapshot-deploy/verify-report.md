# Verify Report: mro-snapshot-deploy
Date: 2026-06-02
Verdict: PASS-WITH-WARNINGS
2 CRITICAL | 3 WARNING | 3 SUGGESTION

---

## CRITICAL

### C-1: Two mirror helpers in workflow_publish.test.js

File: rule_set/test/workflow_publish.test.js L25-56

resolveOfertaId (L25) and parseOfertaIdOverrides (L34-56) are defined locally in the
test file and are NOT exported from any production module.

- resolveOfertaId: reimplements the inline ternary from publishCfgToWorkflow and
  publishSnapshotToWorkflow in admin_workflow_service.js.
- parseOfertaIdOverrides: reimplements the private function of the same name in
  admin_snapshots_controller.js (L13-38).

These tests prove the local copies match themselves, not that production code is correct.
This is the exact anti-pattern documented in engram #88 and removed twice in this change
(PR1: mro_resolution.js; PR2b: matchFechaKey, simulateHighWaterMark, buildReglaInsertSql).

These tests originate from wf-offer-mapping and predate the codified rule, but are present
in the working tree and must be addressed before archive.

Fix for resolveOfertaId: delete the 4 tests. No exported helper exists to test.
Fix for parseOfertaIdOverrides: either export it from admin_snapshots_controller.js and
import it in the test, OR delete the 8 tests entirely.

---

### C-2: Angular cap-1 contract break -- motorFechaId sent by UI is silently dropped

Angular model (admin.models.ts L334-337): AdminWorkflowSnapshotPayload uses motorFechaId.
Angular service (admin-api.service.ts L259-263): sends { motorFechaId, createdBy }.

Backend controller (admin_snapshots_controller.js L93-97): reads body.vigDesde and
body.vigHasta -- does NOT read body.motorFechaId.
Backend service (admin_workflow_service.js L576-582): createWorkflowSnapshot(vigDesde,
vigHasta, createdBy) still passes @VIGENCIA_DESDE and @VIGENCIA_HASTA to the SQL SP.

Task 2.7 explicitly required updating the controller to accept motorFechaId and changing
the service function signature. The Angular side was done; the backend was not.

Consequence: user specifies motorFechaId=42, backend reads vigDesde=null, vigHasta=null,
SP is called with both NULLs, returns ALL MRO records instead of the targeted period.
Snapshot silently captures a full dump. No crash, but wrong data is stored.

Note: workflow_snapshot.sql also retains @VIGENCIA_DESDE / @VIGENCIA_HASTA at L33-35.
Task 2.6 partially applied -- SP body now joins via MOTORFECHA_ID (L102, L122), but the
input parameter interface was not changed to @MOTORFECHA_ID.

Fix:
1. admin_snapshots_controller.js: read body.motorFechaId (integer or null).
2. admin_workflow_service.js: change signature to createWorkflowSnapshot(motorFechaId, createdBy).
3. Change SP call to pass @MOTORFECHA_ID sql.Int.
4. workflow_snapshot.sql: change @VIGENCIA_DESDE / @VIGENCIA_HASTA to @MOTORFECHA_ID INT = NULL.

---

## WARNING

### W-1: tasks.md does not reflect removal of tasks 1.2 and 2.2a-d

Tasks 1.2 (mro_resolution.test.js T1.2a-g) and 2.2a-d were removed as mirror anti-patterns
per user decision. Apply-progress engram #87 notes this, but tasks.md still shows them open.
Mark them REMOVED with reason.

### W-2: No auto-safety snapshot before cap-2 publish (postWorkflowPublicar)

Task 2.5 and spec scenario 10 require an automatic safety snapshot before every WF publish,
with snapshot_id in the response. publishCfgToWorkflow returns { published, rules, params,
motorFechaId } (L418) -- no snapshot_id. Controller does not call createWorkflowSnapshot
before publishCfgToWorkflow. Compare: postSnapshotRestore creates a safety snapshot via
restoreSnapshot.

### W-3: workflow_snapshot.sql parameter interface partially migrated (task 2.6 incomplete)

Retains @VIGENCIA_DESDE DATE / @VIGENCIA_HASTA DATE at L33-35. SP body correctly joins
via MOTORFECHA_ID. This partial state is the direct cause of C-2 and must be completed
as part of the C-2 fix.

---

## SUGGESTION

### S-1: Duplicate tipoDs validation

admin_snapshots_controller.js L124-132 validates tipoDs inline. getDeleteScope in
admin_workflow_service.js validates the same set. Consider extracting to the validator
module alongside validateEntornoCd.

### S-2: workflow_publish.test.js header comment is stale

L1-13 only references wf-offer-mapping tasks 5.1-5.4. File now also covers T2.1a-d,
T2.2e, T2.10a-d from mro-snapshot-deploy. Update the header.

### S-3: No live-DB checklist in admin_workflow_service.js

SQL files have embedded live-DB verification checklists. The JS write path has no
equivalent. Consider adding a LIVE-DB-PENDING comment block.

---

## Spec Coverage

Scenario 01 most-recent-wins AMBOS+PARAMS:          implemented-live-DB-pending
Scenario 02 unique AMBOS both types:                implemented-live-DB-pending
Scenario 03 no period zero results:                 implemented-live-DB-pending
Scenario 04 deploy new period no VIGENCIA_*:        implemented-CI (T2.1a-d T2.2e) + live-DB-pending
Scenario 05 deploy exact period reuses id:          implemented-live-DB-pending
Scenario 06 re-pub X does not affect period Y:      implemented-live-DB-pending
Scenario 07 TIPO_DS=PARAMS no delete MOTORREGLA:    implemented-CI (T2.1b)
Scenario 08 high-water mark IDs:                    implemented-live-DB-pending
Scenario 09 snapshot WF DESDE_DT/HASTA_DT/TIPO_DS: PARTIAL -- SP joined; backend not migrated (C-2)
Scenario 10 auto-safety snapshot before deploy:     MISSING for cap-2 (W-2)
Scenario 11 pub snapshot POC to WF equals direct:   implemented-live-DB-pending
Scenario 12 dedupe params WF to POC last-wins:      implemented-live-DB-pending
Scenario 13 ENTORNO_CD PRE rejected 4xx:            implemented-CI (T2.10c)
Scenario 14 ENTORNO_CD filter correct:              implemented-CI (T2.10a-b)
Scenario 15 npm test green zero duplicates:         implemented-CI

---

## Test Results

Backend npm test from rule_set/:
  tests 164 | pass 157 | fail 5 (pre-existing) | skip 2
  Pre-existing: CA-003 (23), fixture tests 68/69/70/76
  No new failures.

Angular ng test from rule_set/web/:
  34 tests: 34 pass / 0 fail

---

## Design Decisions

VIGENCIA_* never written in INSERTs                  PASS
MOTORFECHA_ID set on rule/param inserts (L195 L258)  PASS
upsert key (DESDE_DT HASTA_DT TIPO_DS)               PASS
deletePeriodFromMRO keyed by MOTORFECHA_ID + tipo     PASS
getMaxIds includes maxFecha before deletes            PASS
Read SP two independent winner CTEs with TIPO_DS      PASS
ENTORNO_CD validated to POC/WF                        PASS
tipoDs default AMBOS threaded controller to service   PASS
rule_engine.js unchanged (git diff empty)             PASS
Known mirrors removed (mro_resolution etc.)           PASS
cap-1 motorFechaId end-to-end contract                FAIL (C-2)
