# Archive Report: wf-offer-mapping

**Change**: wf-offer-mapping  
**Archived**: 2026-05-26  
**Artifact Store**: openspec + engram (hybrid)  

---

## Change Summary

**Proposal**: Add an editable, ephemeral `ofertaIdOverrides: Record<offerCode, number>` map to the WF publish flow (both config and snapshot routes) so PRO config can be published to PRE where `dbo.HIPO_OFERTA` IDs differ.

**Status**: CLOSED — Implementation complete, verified, and archived.

---

## Artifact References

### Engram Observations (for traceability)
| Artifact | ID | Type |
|----------|----|----|
| Proposal | 31 | architecture |
| Spec | 32 | architecture |
| Design | 33 | architecture |
| Tasks | 34 | architecture |
| Verify Report | 36 | architecture |

### OpenSpec Files
- `openspec/changes/archive/2026-05-26-wf-offer-mapping/proposal.md`
- `openspec/changes/archive/2026-05-26-wf-offer-mapping/specs/wf-offer-mapping.spec.md`
- `openspec/changes/archive/2026-05-26-wf-offer-mapping/design.md`
- `openspec/changes/archive/2026-05-26-wf-offer-mapping/tasks.md`
- `openspec/changes/archive/2026-05-26-wf-offer-mapping/verify-report.md`
- `openspec/changes/archive/2026-05-26-wf-offer-mapping/archive-report.md` (this file)

---

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| workflow-deployment | Updated | Added section 10b referencing wf-offer-mapping ephemeral override map; links to archived change folder for full spec. |

---

## Archive Contents

- proposal.md ✅
- specs/wf-offer-mapping.spec.md ✅
- design.md ✅
- tasks.md ✅
- verify-report.md ✅

---

## Source of Truth Updated

The main workflow-deployment spec now reflects the new offer ID override capability:
- `openspec/specs/workflow-deployment/spec.md` — section 10b added

---

## Verification Summary

**Verdict**: PASS WITH WARNINGS — 0 CRITICAL / 2 WARNINGS / 3 SUGGESTIONS

**Test Results**:
- 131 total / 129 passed / 0 failed / 2 skipped
- All 13 new tests in `test/workflow_publish.test.js` passed (tests 109–121)

**Warnings**:
- W-01: Snapshots mapping table not shown during `getOffers()` in-flight (mitigation: safe fallback to DB values)
- W-02: HTTP 400 vs 422 (intentional codebase-wide pattern, documented)

---

## SDD Cycle Complete

The change has been fully planned, implemented, verified, and archived. Ready for the next change.

**Next Steps**: None. This change is fully closed.
