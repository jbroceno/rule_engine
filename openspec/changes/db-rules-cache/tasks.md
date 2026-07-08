# Tasks: db-rules-cache

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~155 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | N/A — single PR |

---

## Design Discrepancy Note (authoritative: design.md)

The spec uses column names `kind`, `result_json`, and `offer_codes` (5-column table). The design DDL uses `cache_type`, `ofertas_json` + `parametros_json` (two JSON columns, no combined result), and `offer_codes_key`. The design is authoritative — it contains the actual SP code that defines the contract. All tasks below follow the design.

---

## Phase 1 — Infrastructure: DDL + Deploy Script

### [x] 1.1 — Create deploy SQL script file

**File**: `/rule_set/sql/workflow_deploy/wf_sp_cfg_rules_cache.sql`
**Action**: Create new file. The file will hold all SQL objects for this change (table + both SPs + seed call). Starting with the table DDL.
**Deliverable**: File exists with `CREATE TABLE dbo.cfg_rules_cache` block — columns `cache_key NVARCHAR(500) NOT NULL PK`, `cache_type CHAR(1) NOT NULL CHECK IN ('G','H')`, `offer_codes_key NVARCHAR(500) NOT NULL`, `ofertas_json NVARCHAR(MAX) NOT NULL`, `parametros_json NVARCHAR(MAX) NOT NULL`, `created_at DATETIME2(0) NOT NULL DEFAULT SYSDATETIME()`.
**Satisfies**: Data Contract (spec § Data Contract), design § 2.
**Parallel**: No — must exist before tasks 1.2 and 1.3 append to it.

### [x] 1.2 — Add eviction index to deploy script

**File**: `/rule_set/sql/workflow_deploy/wf_sp_cfg_rules_cache.sql`
**Action**: Append `CREATE NONCLUSTERED INDEX IX_cfg_rules_cache_evict ON dbo.cfg_rules_cache (cache_type, offer_codes_key, created_at) INCLUDE (cache_key)` after the table DDL.
**Deliverable**: Index DDL present in the same script.
**Satisfies**: ADR-4 (eviction query needs a seek range, not a scan).
**Parallel**: Sequential after 1.1.

---

## Phase 2 — SQL: Stored Procedures

### [x] 2.1 — Append wrapper SP to deploy script

**File**: `/rule_set/sql/workflow_deploy/wf_sp_cfg_rules_cache.sql`
**Action**: Append `CREATE OR ALTER PROCEDURE dbo.cfg_get_offers_and_params_json_cached` exactly as written in design § 3. Covers: cache key derivation, G/H branching, fast-path SELECT, `sp_getapplock` for H-miss, double-check, call to `dbo.cfg_get_offers_and_params_json`, best-effort INSERT (swallowing PK violations 2627/2601), FIFO eviction CTE, lock release, result SELECT from `@tmp`.
**Deliverable**: SP body in file; no logic invented beyond what design § 3 specifies.
**Satisfies**: REQ-01 through REQ-06.
**Parallel**: Sequential after 1.2 (append to same file). Can be drafted in parallel with 2.2 if editing separate buffers and merging — but serialize to avoid conflicts.

### [x] 2.2 — Append refresh SP to deploy script

**File**: `/rule_set/sql/workflow_deploy/wf_sp_cfg_rules_cache.sql`
**Action**: Append `CREATE OR ALTER PROCEDURE dbo.cfg_refresh_rules_cache` exactly as written in design § 4. Covers: CURSOR over DISTINCT `offer_codes_key` where `cache_type = 'G'`, per-key `DELETE + INSERT` inside `BEGIN TRAN / COMMIT TRAN`, `CATCH` block with `ROLLBACK + RAISERROR severity 10` (non-propagating).
**Deliverable**: SP body in file.
**Satisfies**: REQ-07.
**Parallel**: Sequential after 2.1.

### [x] 2.3 — Append one-shot seed call to deploy script

**File**: `/rule_set/sql/workflow_deploy/wf_sp_cfg_rules_cache.sql`
**Action**: Append `EXEC dbo.cfg_refresh_rules_cache;` at end of file as the initial G-entry seeding step, preceded by a `GO` batch separator.
**Deliverable**: Seed call present; deploy script is complete and runnable top-to-bottom.
**Satisfies**: Design § 7 ("one-shot EXEC dbo.cfg_refresh_rules_cache to seed G entries").
**Parallel**: Sequential after 2.2.

---

## Phase 3 — Tests (write BEFORE Node.js changes — Strict TDD)

All test tasks target `/rule_set/test/config_cache.test.js` (new file). Use Node.js built-in `node:test` + `node:assert/strict`. Mock the mssql pool via extracted pure helpers or a thin mock object — do NOT require a live DB. Pattern: extract logic under test into a helper function (as done in `workflow_publish.test.js`) and test the helper.

### [x] 3.1 — Test: config_service calls cached SP name

**File**: `/rule_set/test/config_cache.test.js`
**Action**: Write a unit test that validates the SP name constant used by config_service is `'dbo.cfg_get_offers_and_params_json_cached'` (not the old name). Extract the SP name as a testable string or mock the `request.execute` call and assert it receives the right name.
**Deliverable**: Failing test (SP name not yet changed in source).
**Satisfies**: REQ-09.
**Parallel**: Can run in parallel with 3.2 and 3.3.

### [x] 3.2 — Test: config_service passes @max_history_size param

**File**: `/rule_set/test/config_cache.test.js`
**Action**: Write a test that the `request.input("max_history_size", ...)` call is made with a numeric value (50) when the cached SP is invoked. Use a mock `request` object that records inputs.
**Deliverable**: Failing test.
**Satisfies**: REQ-09.
**Parallel**: Yes — with 3.1 and 3.3.

### [x] 3.3 — Test: config_service fallback error message references cached SP

**File**: `/rule_set/test/config_cache.test.js`
**Action**: Write a test that when the error message contains `"could not find stored procedure 'dbo.cfg_get_offers_and_params_json_cached'"`, it triggers the fallback path (not a thrown AppError). Extracts the `isMissingPrimarySp` check logic as a testable predicate.
**Deliverable**: Failing test.
**Satisfies**: REQ-09 (error message must reference new SP name for diagnosability).
**Parallel**: Yes — with 3.1 and 3.2.

### [x] 3.4 — Test: admin_service calls cfg_refresh_rules_cache after applyConfig commit

**File**: `/rule_set/test/config_cache.test.js`
**Action**: Write a test using a mock `pool.request().execute` that records calls. After a successful `applyConfig` commit, assert that `cfg_refresh_rules_cache` was executed exactly once.
**Deliverable**: Failing test.
**Satisfies**: REQ-10.
**Parallel**: Yes — with 3.1, 3.2, 3.3.

### [x] 3.5 — Test: refresh failure is swallowed — applyConfig still resolves

**File**: `/rule_set/test/config_cache.test.js`
**Action**: Write a test where `execute("dbo.cfg_refresh_rules_cache")` throws. Assert that `applyConfig` does NOT reject and the resolved value contains `applied`. Assert that `console.error` was called (spy or capture).
**Deliverable**: Failing test.
**Satisfies**: REQ-08 and REQ-10.
**Parallel**: Yes — with 3.1–3.4.

---

## Phase 4 — Node.js: Implementation

### [x] 4.1 — Update config_service.js: switch SP name to cached variant

**File**: `/rule_set/api/services/config_service.js`
**Action**: On line 95, change `request.execute("dbo.cfg_get_offers_and_params_json")` to `request.execute("dbo.cfg_get_offers_and_params_json_cached")`. On line 99, update the `isMissingPrimarySp` string check to `"could not find stored procedure 'dbo.cfg_get_offers_and_params_json_cached'"`. Update the AppError message on line 103 accordingly.
**Deliverable**: Tests 3.1 and 3.3 now pass.
**Satisfies**: REQ-09.
**Parallel**: No — sequential after Phase 3 tests are written. 4.1 and 4.2 can proceed in parallel with each other once tests exist.

### [x] 4.2 — Update config_service.js: add @max_history_size input

**File**: `/rule_set/api/services/config_service.js`
**Action**: Add `request.input("max_history_size", sql.Int, 50)` after the existing `request.input("DATE", ...)` line (line 94), before the execute call.
**Deliverable**: Test 3.2 now passes.
**Satisfies**: REQ-09.
**Parallel**: Can be done in same commit as 4.1.

### [x] 4.3 — Update admin_service.js: best-effort refresh after applyConfig commit

**File**: `/rule_set/api/services/admin_service.js`
**Action**: After line 1462 (`await tx.commit();`) and before the `return { applied: ... }` statement, insert the try/catch block from design § 5: `const refreshRequest = pool.request(); await refreshRequest.execute("dbo.cfg_refresh_rules_cache");` inside try, `console.error("[cache] cfg_refresh_rules_cache failed:", refreshErr?.message ?? refreshErr)` in catch. `pool` is already in scope from line 1333.
**Deliverable**: Tests 3.4 and 3.5 now pass. All Phase 3 tests green.
**Satisfies**: REQ-08, REQ-10.
**Parallel**: Can be done in same commit as 4.1 + 4.2 (single work-unit commit: tests + implementation together).

---

## Phase 5 — Integration Verification (Manual Checklist)

These are not automated tests — they require a running SQL Server instance with the deploy script applied.

### 5.1 — Deploy script runs clean on a fresh schema

**Action**: Run `wf_sp_cfg_rules_cache.sql` against a dev/staging DB. Verify no errors; verify `dbo.cfg_rules_cache` table exists; verify both SPs exist; verify the seed `EXEC` produced at least one `G` row if any `cfg_offer_ruleset` data exists.
**Satisfies**: REQ-07 (seed path).

### 5.2 — Generic cache hit: no second call to original SP

**Action**: Call `EXEC dbo.cfg_get_offers_and_params_json_cached` once (cold). Confirm a `G` row is inserted. Call again. Use SQL Profiler or Extended Events to confirm the second call does NOT execute `cfg_get_offers_and_params_json`.
**Satisfies**: REQ-01, REQ-02.

### 5.3 — Historical cache hit + FIFO eviction

**Action**: Call the cached SP with `@DATE = '2025-01-01 10:00:00'` and `@max_history_size = 2`. Repeat with two more distinct `@DATE` values. Confirm only 2 `H` rows remain for that `offer_codes` (oldest was evicted).
**Satisfies**: REQ-03, REQ-04, REQ-06.

### 5.4 — Refresh rebuilds G entries after config change

**Action**: Via `POST /api/admin/config/apply`, apply a config change. Check `cfg_rules_cache` — `G` rows should have been replaced (new `created_at`). Confirm subsequent simulation request returns updated rules from cache.
**Satisfies**: REQ-07, REQ-10.

### 5.5 — Refresh failure does not break applyConfig HTTP response

**Action**: Temporarily break `cfg_refresh_rules_cache` (e.g., rename the SP). Call `POST /api/admin/config/apply`. Verify the HTTP response is 200 (success). Verify Node.js console shows `[cache] cfg_refresh_rules_cache failed:` log line.
**Satisfies**: REQ-08.

---

## Task Dependency Summary

```
1.1 → 1.2 → 2.1 → 2.2 → 2.3      (sequential, single file)

3.1 ─┐
3.2 ─┤ (all parallel, new test file)
3.3 ─┤
3.4 ─┤
3.5 ─┘

Phase 3 must complete before Phase 4 starts.

4.1 + 4.2 → 4.3   (4.1 and 4.2 in same commit; 4.3 in same commit or next)

Phase 4 completion → Phase 5 (manual; requires live DB)
```

## Commit Strategy (work-unit-commits)

| Commit | Scope | Content |
|--------|-------|---------|
| `feat(sql): add cfg_rules_cache table and cached SP` | SQL only | Tasks 1.1, 1.2, 2.1, 2.2, 2.3 |
| `test(cache): unit tests for cached SP wiring and refresh isolation` | Tests only | Tasks 3.1–3.5 (all failing) |
| `feat(config): wire config_service to cached SP with max_history_size` | impl | Tasks 4.1, 4.2 — makes 3.1, 3.2, 3.3 pass |
| `feat(admin): trigger cache refresh after applyConfig commit` | impl | Task 4.3 — makes 3.4, 3.5 pass |

> Per `work-unit-commits` convention: code + tests ship together. The test-only commit (row 2) is the TDD "red" commit. Rows 3 and 4 are the "green" commits. They can be squashed into a single `feat` commit if the reviewer prefers one-shot delivery — both are acceptable.
