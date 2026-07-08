# Archive Report — offers-page-and-period-cascade

**Change**: offers-page-and-period-cascade  
**Archived**: 2026-06-19  
**Artifact Store**: hybrid (engram + openspec)  
**Verify Verdict**: PASS

---

## Executive Summary

The `offers-page-and-period-cascade` change has been fully implemented, verified, and is now archived. All 17 tasks across 3 chained PRs completed. Backend: 249/251 tests pass (2 expected skips). Frontend: 111/111 tests pass. All 24 spec compliance scenarios pass. Change is closed and ready for deployment.

---

## Artifacts Archived

### Engram (Persistent Memory)

Observation IDs for traceability:
- `#181` — `sdd/offers-page-and-period-cascade/proposal`
- `#182` — `sdd/offers-page-and-period-cascade/spec`
- `#183` — `sdd/offers-page-and-period-cascade/design`
- `#184` — `sdd/offers-page-and-period-cascade/tasks`
- `#188` — `sdd/offers-page-and-period-cascade/verify-report`

### OpenSpec (File-based — Archive)

All change artifacts moved to:  
`openspec/changes/archive/2026-06-19-offers-page-and-period-cascade/`

Contents:
- `proposal.md`
- `design.md`
- `tasks.md`
- `verify-report.md`
- `specs/offer-entity-management/spec.md`
- `specs/period-scoped-rule-cleanup/spec.md`

### Main Specs Updated

Two new capability specs created (no prior specs existed — these are complete specs, not deltas):

| Domain | Path | Status |
|--------|------|--------|
| offer-entity-management | `openspec/specs/offer-entity-management/spec.md` | Created |
| period-scoped-rule-cleanup | `openspec/specs/period-scoped-rule-cleanup/spec.md` | Created |

---

## Change Summary

### Scope
Two new capabilities:

1. **offer-entity-management** — New page `/ofertas` for complete lifecycle management of `cfg_offer_ruleset` entity (create, edit, enable/disable, delete with cascading rules and params across all periods).

2. **period-scoped-rule-cleanup** — Configurator panel for offer/period scoped rule cleanup. Lists only offers with rules in the active period. "Delete" removes rules+params for that offer in that period only (entity survives). "Edit" reuses `updateOffer`.

### Delivery Model
3 chained PRs:
- **PR1** (5 tasks): /ofertas frontend extraction (~280-350 lines, Medium risk)
- **PR2a** (7 tasks): Backend — listOffersInPeriod + deleteRulesForOfferInPeriod + controller + route (~250-320 lines, Medium risk)
- **PR2b** (5 tasks): Configurator period-scoped panel + AdminApiService extensions (~220-280 lines, Medium risk)

Parallel development: PR1 and PR2a can be developed in parallel; PR2b depends on PR2a merging first.

### Key Design Decisions (ADRs)

| Decision | Rationale |
|----------|-----------|
| **ADR-1**: Query param `offerDateId` on GET /admin/offers | Symmetry with existing rules/params filtering; no new route |
| **ADR-2**: New endpoint DELETE /offers/:offerCode/rules | Semantic clarity; avoids applyConfig abuse |
| **ADR-3**: Snapshot outside transaction | Matches existing deleteOffer pattern; acceptable snapshot size |
| **ADR-4**: DISTINCT from cfg_offer_rule join | Shows only offers with rules in period, excluding disabled offers |
| **ADR-5**: 5 FK-ordered DELETEs + AND offer_date_id | Scoped deletion; cfg_offer_ruleset entity remains untouched |
| **ADR-6**: /ofertas as mechanical extraction | No shared state service (YAGNI); clean separation |

---

## Test Results

### Backend (Node.js)
```
tests:    251
pass:     249
fail:     0
skipped:  2 (CA-013 — live workflow service credentials, expected)
duration: 37653 ms
```

### Frontend (Angular + Karma)
```
Chrome 149.0.0 (Windows 10): 111/111 SUCCESS
Duration: 1.764s (compilation), 1.597s (execution)
```

### Spec Compliance
- **24/24 scenarios** fully compliant
- **All critical structural checks** passed
- Route ordering, scope isolation, snapshot creation, confirmation text distinctness verified

---

## Verification Verdict

**PASS** (Approved for archive)

All 17 tasks complete. Implementation coherent with design. No critical issues. Two minor warnings (rollback atomicity test implicit coverage, enabled rule filter nuance) are not blocking archive.

---

## Artifacts Inventory

### openspec/specs/ (Main Specs)
```
openspec/specs/
├── offer-entity-management/
│   └── spec.md (NEW)
└── period-scoped-rule-cleanup/
    └── spec.md (NEW)
```

### openspec/changes/archive/2026-06-19-offers-page-and-period-cascade/
```
2026-06-19-offers-page-and-period-cascade/
├── proposal.md
├── design.md
├── tasks.md
├── verify-report.md
└── specs/
    ├── offer-entity-management/
    │   └── spec.md
    └── period-scoped-rule-cleanup/
        └── spec.md
```

---

## Next Steps

- [ ] Merge PR1 (frontend /ofertas)
- [ ] Merge PR2a (backend services + controller + route)
- [ ] Merge PR2b (Configurator period-scoped panel)
- [ ] Deploy to production
- [ ] Post-deploy monitoring: snapshot creation, period filtering, cascading deletes

No follow-up changes needed. SDD cycle complete.

---

## Archive Metadata

- **Changed**: 2 new spec files created
- **Moved**: Entire change folder to archive with date prefix (2026-06-19)
- **Traceability**: Full artifact chain preserved via Engram observation IDs
- **Audit Trail**: openspec archive folder provides git history and peer review trail
