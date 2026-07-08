# Archive Report: params-active-period

**Change**: params-active-period
**Archived**: 2026-06-05
**Artifact Store**: openspec + engram (hybrid)

---

## Change Summary

**Proposal**: Eliminate manual selection of active period in rule and param creation forms (configurator). Auto-inject the active period from `ActivePeriodService`. Disable create buttons when no active period exists. Keep lists visible while editor is open. Compact the params form grid to 2×2. Period becomes immutable in edit mode. Frontend-only change (Angular), no API/SQL modifications.

**Implementation Summary**: 
- Auto-inject `offer_date_id` at open-time and re-sync at submit-time in creation
- Disable create buttons reactively with banner linking to `/offer-dates`
- Show period as read-only text in edit mode
- Remove `*ngIf="!isXEditorOpen()"` guards from lists/pagers/search
- Compact params grid from 6-col with full-width Value to 2×2 with Value in grid
- Fixes silent 400 bug: backend validators required positive `offer_date_id` but FE sent null on create

**Commits**: `25146aa` (main implementation, 14 WUs in single commit) + `b131b00` (test-only fixes, +139 lines spec, +7 tests)

**Branch**: `feat/params-active-period`

**Status**: CLOSED — Implementation complete, verified (69/69 frontend tests + 164/164 backend tests), and archived.

---

## Artifact References

### Engram Observations (for traceability)
| Artifact | ID | Type |
|----------|----|----|
| Explore | 122 | architecture |
| Proposal | 124 | architecture |
| Spec | 125 | architecture |
| Design | 126 | architecture |
| Tasks | 127 | architecture |
| Apply-progress (batch 1) | 128 | architecture |
| Verify-report (re-verify) | 129 | architecture |
| Archive-report | (this archive) | architecture |

### OpenSpec Files
- `openspec/specs/configurator/spec.md` — Main spec (created from delta spec; no existing configurator spec existed)
- `openspec/changes/archive/2026-06-05-params-active-period/explore.md`
- `openspec/changes/archive/2026-06-05-params-active-period/proposal.md`
- `openspec/changes/archive/2026-06-05-params-active-period/specs/configurator/spec.md`
- `openspec/changes/archive/2026-06-05-params-active-period/design.md`
- `openspec/changes/archive/2026-06-05-params-active-period/tasks.md`
- `openspec/changes/archive/2026-06-05-params-active-period/verify-report.md`
- `openspec/changes/archive/2026-06-05-params-active-period/archive-report.md` (this file)

---

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| configurator | Created | New main spec created: `openspec/specs/configurator/spec.md`. Delta spec (23 FRs, 20 CAs) converted to main spec. No existing configurator spec; no merge required. |

---

## Archive Contents

- explore.md ✅
- proposal.md ✅
- specs/configurator/spec.md ✅
- design.md ✅
- tasks.md ✅ (14/14 tasks complete)
- verify-report.md ✅

---

## Source of Truth Updated

The main configurator spec is now persistent:
- `openspec/specs/configurator/spec.md` — Full spec for configurator period management feature

---

## Implementation Details

### Production Code Changes
- **File**: `rule_set/web/src/app/pages/configurator-page.component.ts`
  - Added computed signals: `canCreateRule`, `canCreateParam`
  - Added helper `formatPeriodById(id)` to resolve period text
  - Modified `openCreateRuleEditor()` to auto-inject `activePeriodRules().offer_date_id`
  - Modified `openCreateParamEditor()` to auto-inject `activePeriodParams().offer_date_id`
  - Modified `buildRulePayloadFromForm()` to re-sync period at submit-time (create mode)
  - Modified `saveParam()` to re-sync period at submit-time (create mode)
  - Modified `duplicateRule()` to re-inject active rules period (not source rule's period)

- **File**: `rule_set/web/src/app/pages/configurator-page.component.html`
  - Replaced `<select>` period in rules create form with conditional text (empty in create, read-only in edit)
  - Replaced `<select>` period in params create form with conditional text
  - Added banner `.period-banner` to both panels (visible when no active period)
  - Moved "Value" field into `.form-grid-params` grid for params
  - Removed `*ngIf="!isRuleEditorOpen()"` guards from rules list/pager/search/states
  - Removed `*ngIf="!isParamEditorOpen()"` guards from params list/pager/search/states

- **File**: `rule_set/web/src/app/pages/configurator-page.component.css`
  - Added `.readonly-period` style (read-only text within label)
  - Added `.readonly-period-line` style (full-width text line for params period)
  - Added `.period-banner` style (alert-like banner with link)
  - Grid adjustments for 2×2 params form layout

### Test Code (New)
- **File**: `rule_set/web/src/app/pages/configurator-page.component.spec.ts` (CREATED)
  - TestBed scaffolding + mocks for `AdminApiService`, `ActivePeriodService`
  - 69 total tests across all behaviors
  - Tests cover: `canCreateX` computeds, button disable/enable reactivity, banners, open-time/submit-time injection, signal re-sync on create, immutability on edit, list visibility, grid layout, read-only period text

### Tests Verification
- **Frontend (Karma/ChromeHeadless)**: 69/69 PASS
  - Batch 1 (commit 25146aa): 62 tests
  - Batch 2 (commit b131b00): +7 tests (re-verify fixes)
  - All tests green
- **Backend (Node.js)**: 164/164 PASS (2 pre-existing skips, no new failures)

### Verification Results
- **Verdict**: PASS
- **Compliance**: 27/29 fully compliant (CA-002/CA-004 tipo_cd=AMBOS partial, suggestion only — S-01)
- **Critical Issues**: None
- **Warnings Closed**: W-01, W-02, W-04 (all addressed by test-only commit b131b00)
- **Design ADRs Followed**: All 5 ADRs correctly implemented

---

## Bug Fixed

Silent 400 on rule/param creation without explicit period selection:
- **Root Cause**: Backend validators `admin_validator.js:59-61` (rules) and `:197-200` (params) required `offer_date_id` as positive integer, but FE left it as `null` by default when user didn't manually select period from dropdown
- **Manifestation**: Create form would submit, backend returns 400 without clear error message
- **Fix**: Auto-inject active period from `ActivePeriodService` at open-time (pre-populate) and re-read at submit-time (handles period change while editor open). Disable create button entirely when no active period exists (button becomes unreachable, so `null` never sends)
- **Scope**: Frontend-only; no API/SQL changes needed

---

## Design Decisions

**ADR-1**: Keep `offer_date_id` as non-rendered control in FormGroup
- Decision: Control stays in form group (for `setValue` compatibility), but removed from HTML template
- Impact: Minimal surface area; update logic unchanged

**ADR-2**: Re-read period from signal at submit-time for create
- Decision: Signal is source of truth; re-read on submit to catch period changes with editor open
- Impact: Robust to user navigating to `/offer-dates` mid-edit

**ADR-3**: Period immutable in edit mode
- Decision: Delete + recreate to reassign period (user's request)
- Impact: Simpler than edit-form reassignment; prevents accidental period drift

**ADR-4**: Inline layout (editor above list, no side-by-side)
- Decision: Remove `*ngIf="!isXEditorOpen()"` guards; list always visible below form
- Impact: Lower implementation cost than layout restructure; acceptable UX

**ADR-5**: Params period as full-width text line above grid
- Decision: Period display outside grid; "Value" moves into grid as 4th cell
- Impact: Clean 2×2 grid without full-width row

---

## Tasks Completed

| WU | Title | Status |
|----|-------|--------|
| WU-01 | TestBed scaffolding | DONE |
| WU-02 | Computeds + helpers | DONE |
| WU-03 | Disable button + banner (rules) | DONE |
| WU-04 | Disable button + banner (params) | DONE |
| WU-05 | Auto-inject + re-sync (rules) | DONE |
| WU-06 | Auto-inject + re-sync (params) | DONE |
| WU-07 | duplicateRule re-inject | DONE |
| WU-08 | Read-only period (rules edit) | DONE |
| WU-09 | Read-only period (params edit) | DONE |
| WU-10 | Remove guards (rules list) | DONE |
| WU-11 | Remove guards (params list) | DONE |
| WU-12 | Remove period select (cleanup) | MERGED into WU-08/09 |
| WU-13 | CSS styles | DONE |
| WU-14 | CLAUDE.md docs | NO-OP |

**All 14 WUs complete** (WU-12 merged, WU-14 was no-op).

---

## Verification Summary

**Test Results**:
- Frontend: 69/69 SUCCESS (exit 0)
- Backend: 164 pass, 2 skipped, 0 fail (exit 0)
- No regressions

**Spec Compliance**: 27/29 criteria
- CA-001 through CA-020: 18/20 fully compliant
- CA-002, CA-004: Partial (tipo_cd=AMBOS not tested — suggestion only, no impact)

**Static Verification**:
- All 23 FRs implemented ✅
- All 5 ADRs followed ✅
- No API/SQL changes ✅
- RouterLink imported ✅
- Grid 2×2 layout verified ✅

---

## SDD Cycle Complete

The change has been fully planned, implemented, verified, and archived.

**Change status**: CLOSED
**Next steps**: None. This change is complete and ready for production.

**Commits for reference**:
- `25146aa`: Main implementation (WU-01 to WU-14, single commit)
- `b131b00`: Test-only enhancements (+7 tests, verify PASS)

**Branch**: `feat/params-active-period` (ready for merge to main)
