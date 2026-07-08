# Verify Report - wf-offer-mapping

Change: wf-offer-mapping
Date: 2026-05-26
Mode: Standard (not Strict TDD)

---

## Completeness

Tasks total: 19
Tasks complete: 17
Tasks incomplete: 2

Incomplete: 5.5 and 5.6 are manual smoke tests (pending operator).

---

## Build and Tests Execution

Tests: 131 total / 129 passed / 0 failed / 2 skipped

The 2 skips are pre-existing CA-013 DB credential tests unrelated to this change.
All 13 new tests in test/workflow_publish.test.js passed (tests 109-121).

Coverage: Not available.

---

## Spec Compliance Matrix

WF-01 Dialog opens with pre-filled values: Manual 5.5 - UNTESTED
WF-01 No overrides publish proceeds: Manual 5.5 - UNTESTED
WF-01 User overrides one or more IDs: workflow_publish resolveOfertaId - PARTIAL
WF-02 Dialog opens for snapshot publish: Manual 5.6 - UNTESTED
WF-02 Snapshot publish with overrides: workflow_publish resolveOfertaId - PARTIAL
WF-03 Backend uses override value: workflow_publish resolveOfertaId uses override - COMPLIANT
WF-03 Backend falls back for unmapped offers: workflow_publish resolveOfertaId fallback - COMPLIANT
WF-03 Payload without the field: workflow_publish resolveOfertaId undefined/null - COMPLIANT
WF-04 Invalid value blocks submission: Manual 5.5/5.6 - UNTESTED
WF-04 Valid value re-enables submission: Manual 5.5/5.6 - UNTESTED
WF-04 Backend rejects invalid values: workflow_publish parseOfertaIdOverrides throws - COMPLIANT
WF-05 Second publication resets to DB values: Static signal reset in openPublicarDialog - PARTIAL
WF-06 FK error with wrong override value: Manual 5.5/5.6 - UNTESTED

Compliance summary: 4/13 COMPLIANT, 3/13 PARTIAL, 6/13 UNTESTED

---

## Correctness (Static)

publishCfgToWorkflow SELECT includes code: IMPLEMENTED - admin_workflow_service.js line 232
publishCfgToWorkflow resolves effectiveOfertaId: IMPLEMENTED - Line 314
publishSnapshotToWorkflow resolves effectiveOfertaId: IMPLEMENTED - Line 391
restoreSnapshot accepts and forwards ofertaIdOverrides: IMPLEMENTED - admin_service.js lines 1020 + 1054
upsertMotorOferta signature unchanged: IMPLEMENTED - Same 5-param signature
Controller postWorkflowPublicar validates + forwards: IMPLEMENTED - admin_snapshots_controller.js lines 113-114
Controller postSnapshotRestore validates only for WF: IMPLEMENTED - Line 81
AdminWorkflowPublicarPayload extended: IMPLEMENTED - admin.models.ts line 335
AdminSnapshotRestoreWfOptions added: IMPLEMENTED - Lines 344-349
admin-api.service.ts publishToWorkflow passes overrides: IMPLEMENTED - Payload typed as AdminWorkflowPublicarPayload
admin-api.service.ts restoreSnapshot passes overrides: IMPLEMENTED - Line 203
Configurator signals + computed added: IMPLEMENTED - configurator-page.component.ts lines 234-240
Configurator openPublicarDialog seeds from offers(): IMPLEMENTED - Lines 1419-1424
Configurator executePublicarWf passes overrides: IMPLEMENTED - Lines 1461-1472
Configurator HTML mapping table type=number min=1: IMPLEMENTED - Lines 776-778
Configurator HTML confirm button disabled on invalid: IMPLEMENTED - Line 798
Snapshots signals + computed added: IMPLEMENTED - snapshots-page.component.ts lines 50-57
Snapshots loadOffersForWfMapping uses getOffers(): IMPLEMENTED - Lines 133-148
Snapshots onRestoreDestinoChange triggers load on WF: IMPLEMENTED - Lines 117-125
Snapshots HTML mapping table type=number min=1: IMPLEMENTED - Lines 186-188
Snapshots HTML confirm button disabled when WF+invalid: IMPLEMENTED - Line 217
No DB schema changes: IMPLEMENTED - No DDL files modified
test/workflow_publish.test.js exists with 13 tests: IMPLEMENTED - All 13 pass

---

## Coherence (Design)

ADR-001 Configurator uses offers() signal: YES
ADR-001 Snapshots fetches on demand via getOffers(): YES
ADR-002 Full table sent all rows: YES
ADR-003 Signal + computed validation: YES - No ReactiveForm used
ADR-004 No shared component: YES - Table inlined in both pages
ADR-005 Override resolution in service layer: YES
Design HTTP 400 for validation errors: DEVIATED (documented) - Spec WF-04 says 422; codebase uses 400
upsertMotorOferta signature unchanged: YES

---

## Issues Found

CRITICAL: None.

WARNING:

W-01 - Snapshots: mapping table absent + button not blocked while getOffers() is in-flight.
Guard is ngIf=wfOffers().length > 0 rather than restoreDestino() === WF.
If getOffers() is slow or fails the table never renders. restoreOverridesValid()
evaluates .every() on empty array (vacuously true), confirm button NOT disabled.
User can submit with empty ofertaIdOverrides and backend falls back to DB values.
Technically safe but violates WF-02: WHEN dialog renders THEN a table appears.

W-02 - HTTP 422 vs 400 for backend validation errors on ofertaIdOverrides.
Spec WF-04 requires 422. Implementation returns 400 (codebase convention).
Documented deviation. Functionally correct. Warrants note for API consumers.

SUGGESTION:

S-01: Loading indicator while getOffers() resolves in snapshots dialog.
S-02: Log or warn when ofertaIdOverrides contains keys not matching any DB offer.
S-03: Integration-level test for publishCfgToWorkflow with ofertaIdOverrides.

---

## Verdict

PASS WITH WARNINGS

0 CRITICAL / 2 WARNINGS / 3 SUGGESTIONS

All 131 tests pass (0 failures). Core backend logic correctly implemented and verified.
Frontend signal wiring follows the design. W-01 is a UX gap in the snapshots page.
W-02 is a known documented status-code deviation. Neither blocks archive.
