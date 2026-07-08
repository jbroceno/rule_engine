# Verification Report -- params-active-period

**Change**: params-active-period
**Branch**: feat/params-active-period
**Commit**: b131b00 (delta re-verify; original commit 25146aa)
**Date**: 2026-06-05
**Mode**: Strict TDD

---

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 14 |
| Tasks complete | 14 |
| Tasks incomplete | 0 |

All 14 WUs DONE. WU-12 merged into WU-08/09 (accepted). WU-14 was a no-op.

---

## Build and Tests Execution

**Frontend (Karma / ChromeHeadless)**: 69/69 SUCCESS -- exit code 0

    TOTAL: 69 SUCCESS

**Backend (Node.js)**: 164 pass, 2 skipped, 0 fail -- exit code 0. Pre-existing skips.

**Coverage**: Not available.

### Delta re-verify (commit b131b00)

Commit b131b00 adds 139 lines to `configurator-page.component.spec.ts` only. No production code changed. Suite count grew from 62 to 69 (+7 tests). All 69 pass.

---

## Spec Compliance Matrix

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| FR-001 / CA-001 | openCreateRuleEditor injects activePeriodRules offer_date_id | T7 | COMPLIANT |
| FR-002 / CA-003 | openCreateParamEditor injects activePeriodParams offer_date_id | T8a | COMPLIANT |
| FR-003 / CA-015 | No select for offer_date_id in rules create form | T14a | COMPLIANT |
| FR-004 / CA-016 | No select for offer_date_id in params create form | T14b | COMPLIANT |
| FR-005 / CA-017 | buildRulePayloadFromForm create has positive offer_date_id | T9 | COMPLIANT |
| FR-006 / CA-018 | saveParam create has positive offer_date_id | T8b | COMPLIANT |
| FR-007 / CA-005 | Create rules button disabled when activePeriodRules null | T4 | COMPLIANT |
| FR-008 / CA-006 | Create params button disabled when activePeriodParams null | T6a | COMPLIANT |
| FR-009 / CA-005 | Period banner with /offer-dates link (rules panel) | T5a | COMPLIANT |
| FR-010 / CA-006 | Period banner with /offer-dates link (params panel) | T6c | COMPLIANT |
| FR-011 / CA-009 | editRule: offer_date_id immutable, not overwritten by signal | T10 WU-08 | COMPLIANT |
| FR-012 / CA-010 | editParam: offer_date_id immutable, not overwritten by signal | WU-09 test | COMPLIANT |
| FR-013 / CA-009 | buildRulePayloadFromForm edit uses form value not signal | T10 WU-05 | COMPLIANT |
| FR-014 / CA-010 | saveParam edit uses form value not signal | updateParam spy: offer_date_id=5 vs signal=9 (b131b00) | COMPLIANT |
| FR-015 | Readonly period text shows id + from + to | T13c | COMPLIANT |
| FR-016 / CA-011 | Rules list visible with rule editor open | T11 | COMPLIANT |
| FR-017 / CA-012 | Params list visible with param editor open | T12 | COMPLIANT |
| FR-018 | Editor inline above list | HTML: form before table-wrapper | COMPLIANT |
| FR-019 / CA-013 | Params grid 2x2 (Oferta/Key/ValueType/Value) | T14b + HTML diff | COMPLIANT |
| FR-020 | No period select in params grid create mode | T14b + HTML diff | COMPLIANT |
| FR-021 / CA-014 | Readonly period above params grid in edit | HTML: .readonly-period-line above .form-grid-params | COMPLIANT |
| FR-022 | No offer_date_id=null in create payloads | Button disabled guard + submit re-reads signal | COMPLIANT |
| FR-023 | No API contract changes | No backend files changed | COMPLIANT |
| CA-002 | Create rule with period tipo_cd AMBOS | T7 uses REGLAS only | PARTIAL |
| CA-004 | Create param with period tipo_cd AMBOS | T8a uses PARAMS only | PARTIAL |
| CA-007 | canCreateRule and canCreateParam independent (rules null, params ok) | Explicit CA-007 test | COMPLIANT |
| CA-008 | canCreateParam null does not affect canCreateRule | CA-008 reverse independence (b131b00): both panels asserted via DOM | COMPLIANT |
| CA-019 | Create-rule button reactively re-enables when signal changes | CA-019 signal null->valid + detectChanges, DOM asserted (b131b00) | COMPLIANT |
| CA-020 | Create-param button reactively re-enables when signal changes | CA-020 signal null->valid + detectChanges, DOM asserted (b131b00) | COMPLIANT |

**Compliance summary**: 27/29 fully compliant, 2 partial (CA-002/CA-004 tipo_cd=AMBOS -- S-01 suggestion only, no regression).

---

## Correctness (Static)

| Requirement | Status | Notes |
|------------|--------|-------|
| RouterLink imported | Implemented | component.ts:4 |
| canCreateRule computed | Implemented | component.ts:260 |
| canCreateParam computed | Implemented | component.ts:261 |
| activeRulesPeriodLabel computed | Implemented | component.ts:264-266 |
| activeParamsPeriodLabel computed | Implemented | component.ts:267-269 |
| formatPeriodById protected | Implemented | component.ts:1906 |
| formatPeriod private | Implemented | component.ts:1899 |
| openCreateRuleEditor injects activePeriodRules | Implemented | component.ts:742 |
| duplicateRule uses activePeriodRules not source | Implemented | component.ts:766 |
| openCreateParamEditor injects activePeriodParams | Implemented | component.ts:970 |
| buildRulePayloadFromForm re-syncs on create | Implemented | component.ts:1547-1549 |
| saveParam re-syncs on create | Implemented | component.ts:922-924 |
| Rules select offer_date_id removed | Implemented | HTML: replaced by readonly-period spans |
| Params select offer_date_id removed | Implemented | HTML: removed; readonly-period-line above grid |
| Value label moved into form-grid-params | Implemented | HTML diff confirmed |
| !isRuleEditorOpen() guards removed | Implemented | Grep: zero matches in template |
| !isParamEditorOpen() guards removed | Implemented | Grep: zero matches in template |
| Panel-search unconditional | Implemented | Search label has no ngIf |
| CSS .readonly-period | Implemented | component.css:474-481 |
| CSS .readonly-period-line | Implemented | component.css:484-488 |
| CSS .period-banner | Implemented | component.css:491-501 |

---

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| ADR-1: offer_date_id as non-rendered control | Yes | No select rendered; FormGroup intact |
| ADR-2: Submit re-reads signal create; edit uses form value | Yes | Lines 1547-1549, 922-924 |
| ADR-3: Period immutable in edit | Yes | Spans with formatPeriodById; no input |
| ADR-4: Inline layout, all guards removed | Yes | Zero matches !isXEditorOpen() in HTML |
| ADR-5: Params period as .readonly-period-line above grid | Yes | HTML 586-589 before .form-grid-params |
| duplicateRule re-injects active period | Yes | component.ts:766 |
| formatPeriodById protected for template access | Yes | |
| Banner below panel-head before form | Yes | HTML 299-302, 568-571 |
| CA-007 independence test explicit | Yes | spec:237 |

---

## Issues Found

**CRITICAL**: None.

**WARNING**:

W-01: CLOSED (commit b131b00). CA-008 reverse independence covered by two tests in describe(CA-008 reverse signal independence): (1) params button disabled + params banner visible; (2) rules button enabled + rules banner absent. Both panels asserted via DOM querySelector.

W-02: CLOSED (commit b131b00). CA-019 and CA-020 reactive re-enablement covered by signal-mutation tests. Each test creates fixture with signal null, asserts disabled+banner-present, then mutates signal + calls detectChanges, asserts enabled+banner-absent. Real state-transition verification.

W-03 (pre-existing, noted only): WU-01..WU-14 committed as one commit (25146aa) instead of 14 work-unit commits. b131b00 follows same single-commit pattern for the fix batch. No behavioral impact. Accepted deviation.

W-04: CLOSED (commit b131b00). FR-014 payload immutability covered by describe(FR-014 saveParam edit sends original offer_date_id): spy on AdminApiService.updateParam, active signal id=9, row param offer_date_id=5, asserts updateParam called with objectContaining({ offer_date_id: 5 }).

**SUGGESTION**:

S-01: Add tests for CA-002/CA-004 using tipo_cd=AMBOS periods. Still open.

S-02: CLOSED (commit b131b00). formatPeriodById covered for open-ended periods (T13c-ext: valid_to null shows infinity symbol) and closed periods (T13c-closed: valid_to 2026-06-30 shows 30/06/2026, does not show infinity symbol).

---

## Verdict

PASS

69/69 frontend tests pass. 164/164 backend tests pass (2 pre-existing skips). All 23 FRs implemented and structurally confirmed. All design ADRs followed. Warnings W-01, W-02, W-04 closed by commit b131b00 with genuine behavioral assertions (no tautologies). S-02 closed. Remaining partials are CA-002/CA-004 (tipo_cd=AMBOS, S-01 suggestion only). No CRITICAL issues. Ready for sdd-archive.
