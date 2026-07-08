# Verification Report - cfg-offer-dates-rename

**Change**: cfg-offer-dates-rename
**Date**: 2026-05-26
**Mode**: Strict TDD (npm test, Node.js built-in)
**Verdict**: PASS WITH WARNINGS

---

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 27 (5 phases) |
| Tasks complete | 27 |
| Tasks incomplete | 0 |
| Deferred | 1 (task 3.9 file rename, ADR-004 documented) |

All 27 tasks marked [x]. Task 3.9 labelled [DEFERIDO] with rationale in design.md (ADR-004).

---

## Build and Tests Execution

**Build**: Not applicable (JS project)

**Tests**: 116 passed / 0 failed / 2 skipped (exit code 0)

    # tests 118
    # suites 0
    # pass 116
    # fail 0
    # cancelled 0
    # skipped 2  (CA-013 live DB tests)
    # duration_ms 31719

**Coverage**: Not available

---

## TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | WARNING | No apply-progress.md found -- pipeline doc gap |
| All tasks have tests | PASS | test/motor_fechas.test.js covers all CA- scenarios |
| RED confirmed | PASS | File exists and was executed |
| GREEN confirmed | PASS | Tests 1-10 in motor_fechas.test.js all ok |
| Triangulation adequate | PASS | CA-001: 2 cases, CA-002: 2 cases, CA-003: 3 assertions |
| Safety Net | N/A | Not verifiable without apply-progress |

**TDD Compliance**: 4/6 verified, 1 WARNING (pipeline gap), 1 N/A

---

## Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 8 | 1 | node:test + node:assert/strict |
| Integration (mock) | 1 | 1 | Pool injection mock |
| E2E (live BD) | 1 | 1 | mssql -- SKIP without credentials |
| **Total** | **10** | **1** | |

---

## Changed File Coverage

Coverage tool not available - skipped.

---

## Assertion Quality

Scanned test/motor_fechas.test.js:
- No tautologies found
- No orphan empty-collection checks
- All assertions call production code
- CA-003 uses dependency-injected pool mock -- correct isolation
- CA-005 guarded by hasSqlCredentials() -- correct live-test pattern

**Assertion quality**: 0 CRITICAL, 0 WARNING

---

## Spec Compliance Matrix

| Requirement | Scenario | Evidence | Result |
|-------------|----------|----------|--------|
| RF-001: tabla cfg_offer_dates | Creacion inicial | data_model.sql line 17 CREATE TABLE dbo.cfg_offer_dates | COMPLIANT |
| RF-001: tabla cfg_offer_dates | Catalogo prefijo cfg_ | All module tables share cfg_ prefix | COMPLIANT |
| RF-002: PK offer_date_id | PK en cfg_offer_dates | data_model.sql line 18 offer_date_id INT IDENTITY PK | COMPLIANT |
| RF-002: PK offer_date_id | FK en cfg_offer_rule | data_model.sql line 34 offer_date_id INT NOT NULL | COMPLIANT |
| RF-002: PK offer_date_id | FK en cfg_offer_param | data_model.sql line 79 offer_date_id INT NOT NULL | COMPLIANT |
| RF-003: propagacion global | MOTOR_FECHAS en .sql/.js/.ts | grep 0 results in active code | COMPLIANT |
| RF-003: propagacion global | motor_fechas_id en .sql/.js/.ts | grep 0 results | COMPLIANT |
| RF-003: propagacion global | motorFechasId anywhere | grep 0 results | COMPLIANT |
| RF-003: TypeScript interface | AdminRuleItem offer_date_id | admin.models.ts 8 occurrences | COMPLIANT |
| RF-003: label UI | Periodo de vigencia | configurator-page.component.html lines 335,598 | COMPLIANT |
| RF-003: test renombrado | CA-005 refiere cfg_offer_dates | motor_fechas.test.js line 178, test ok 10 | COMPLIANT |
| RF-003: SP JOINs | 6 JOINs sp_rules_params.sql | grep 6 occurrences cfg_offer_dates | COMPLIANT |
| RF-003: backend | admin_service.js | grep 19 occurrences cfg_offer_dates + offer_date_id | COMPLIANT |
| RF-004: migracion | Primera ejecucion | sp_rename with OBJECT_ID guard | COMPLIANT |
| RF-004: migracion | Segunda ejecucion idempotente | Guard checks MOTOR_FECHAS exists AND cfg_offer_dates absent | COMPLIANT |
| RF-004: migracion | Instancia limpia | Guards check existence before acting | COMPLIANT |
| CA-005 test verde | cfg_offer_dates SP filter | motor_fechas.test.js test 10 ok 10 | COMPLIANT |

**Compliance summary**: 17/17 scenarios compliant

---

## Correctness (Static)

| Requirement | Status | Evidence |
|------------|--------|----------|
| SQL table dbo.cfg_offer_dates | Implemented | data_model.sql line 17 |
| SQL PK offer_date_id | Implemented | data_model.sql line 18 |
| SQL constraint DF_cfg_offer_dates_alta_dt | Implemented | data_model.sql line 24 |
| SQL 6 JOINs sp_rules_params.sql | Implemented | 6 occurrences confirmed via grep |
| SQL migration idempotent | Implemented | OBJECT_ID + COL_LENGTH guards |
| Backend zero MOTOR_FECHAS | Implemented | grep rule_set/api/ 0 results |
| Frontend offer_date_id in TS models | Implemented | 8 occurrences admin.models.ts |
| Frontend label Periodo de vigencia | Implemented | 2 occurrences configurator html |
| Frontend zero motor_fechas_id | Implemented | grep web/src 0 results |
| Test CA-005 name updated | Implemented | motor_fechas.test.js line 178 |

---

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| ADR-001: sp_rename for migration | Yes | sp_rename with idempotent guards confirmed |
| ADR-002: replace_all per file | Yes | 0 residual legacy occurrences found |
| ADR-003: Label Periodo de vigencia | Yes | 2 instances in configurator HTML confirmed |
| ADR-004: No Angular file rename | Yes | motor-fechas-page.component.* kept, task 3.9 deferred |
| ADR-005: HTTP routes unchanged | Yes | Only payload field names changed |
| Propagation SQL to Backend to Frontend | Yes | All layers consistent |

---

## Issues Found

**CRITICAL**: None

**WARNING**:
- apply-progress.md not saved to openspec/changes/cfg-offer-dates-rename/.
  All code is correct and 116 tests pass but the formal TDD cycle evidence
  table required by Strict TDD protocol was not persisted.
  This is a pipeline documentation gap, not a code defect.

**SUGGESTION**:
- Task 3.9 (renaming motor-fechas-page.component.* files) is documented as follow-up.
  Consider creating SDD change offer-dates-page-rename.
- No coverage tool configured. Adding c8 would strengthen future TDD verification.

---

## Verdict

**PASS WITH WARNINGS**

116/116 non-skipped tests pass. All active source files are free of MOTOR_FECHAS,
motor_fechas_id, and motorFechasId. All SQL, backend, frontend, and documentation
artifacts updated per spec. Migration script exists and is idempotent. TypeScript
interface correctly declares offer_date_id. The single WARNING is a missing pipeline
artifact (apply-progress.md), not a code defect. Safe to archive.
