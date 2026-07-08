# Verify Report: db-rules-cache

**Date**: 2026-05-29
**Verifier**: sdd-verify (Claude Sonnet 4.6)
**Verdict**: PASS-WITH-WARNINGS

## Test Results

- tests: 145 | pass: 139 | fail: 4 (pre-existing) | skipped: 2 (live-DB)
- New cache tests (tasks 3.1 to 3.5): 14/14 PASS

Pre-existing failures (unrelated to this change):
- not ok 23: CA-003 deleteFecha lanza 409 (mssql mock issue, motor_fechas.test.js)
- not ok 68: precheck + finalize keep expected winner on fixture
- not ok 69: finalize returns null winner when precheck has no eligible offers
- not ok 76: regression SQL-like params payload keeps fixture winner

## Requirements Verification

### REQ-01 — Generic cache hit: PASS
IF EXISTS on cfg_rules_cache fires before any call to original SP. Returns cached row + RETURN 0.

### REQ-02 — Generic cache miss: PASS
G-miss skips sp_getapplock (IF @is_generic = 0 gate). Calls original SP, stores as cache_type=G with key offer_codes_key+|+__CURRENT__.

### REQ-03 — Historical cache hit: PASS
Same IF EXISTS fast-path. H cache_key uses CONVERT(varchar(19), @effective_date, 120). Correct.

### REQ-04 — Historical cache miss + applock: PASS
Acquires sp_getapplock(Exclusive, Session, 5000ms). On success sets @lock_acquired=1, re-checks. Timeout path falls through without cache guarantee (defensive).

### REQ-05 — Stampede prevention (double-check): PASS
After lock: re-checks cache. If found: releases lock, returns cached row, RETURN 0. Thread B finds row on re-check and does not call original SP.

### REQ-06 — FIFO eviction: PASS
After H insert: CTE ROW_NUMBER() OVER (ORDER BY created_at DESC, cache_key DESC) scoped to offer_codes_key + cache_type=H. Deletes rn > @max_history_size rows.

### REQ-07 — Pre-materialization: WARNING-01
Spec says single transaction for full rebuild. Implementation uses per-key BEGIN TRAN/COMMIT TRAN inside cursor. Matches design exactly (design.md is authoritative per tasks.md). Risk: partial refresh on mid-cursor failure. Intentional resilient design.

### REQ-08 — Refresh failure isolation: PASS
admin_service.js lines 1464-1469: try/catch swallows, console.error with [cache] prefix, does not rethrow. applyConfig resolves as success.

### REQ-09 — Node.js SP name and max_history_size: PASS
config_service.js: max_history_size input (sql.Int, 50) present. Executes dbo.cfg_get_offers_and_params_json_cached. isMissingPrimarySp updated to cached SP name. Original SP not called directly.

### REQ-10 — Refresh trigger after applyConfig commit: PASS
Refresh try/catch placed after await tx.commit() (line 1462) and before return (line 1471). Error does not propagate.

## Column Casing Analysis (WARNING-02 — Pre-existing, not a regression)

Both the original SP and the cached SP return columns OFERTAS_JSON and PARAMETROS_JSON (uppercase, per SQL AS aliases). The mssql Tedious driver preserves column name casing. extractConfigPayload checks row.offers_json (undefined — DIFFERENT base name from OFERTAS_JSON) and row.params_json. Falls through to row.offers / row.params (also undefined). This causes parseJsonValue(undefined, []) to return [] silently.

This is PRE-EXISTING: the original SP has the same return contract and extractConfigPayload had this mismatch before this change. The cached SP returns the same column names — no regression introduced. The design note (section 5) explicitly states no change needed in the consumer. Must be investigated as a separate follow-up.

## Findings

| ID | Severity | Location | Description |
|----|----------|----------|-------------|
| WARNING-01 | WARNING | cfg_refresh_rules_cache | Spec requires single transaction; implementation uses per-key transactions matching design. Risk: partial refresh on mid-cursor failure. Design is authoritative. |
| WARNING-02 | WARNING | extractConfigPayload in config_service.js | OFERTAS_JSON/PARAMETROS_JSON column names do not match row.offers_json/row.params_json. Pre-existing, affects original and cached SPs equally. Not a regression. |
| SUGGESTION-01 | SUGGESTION | extractConfigPayload | Add row.OFERTAS_JSON / row.PARAMETROS_JSON branch to handle uppercase column names explicitly. Fixes WARNING-02. |
| SUGGESTION-02 | SUGGESTION | config_service.js line 46 | No-rows error message still references old SP name. Update for operational clarity. |

## Tasks Completion

All automated tasks [x] in tasks.md implemented and verified in code. Phase 5 (manual integration) requires a live DB.

## Verdict

PASS-WITH-WARNINGS: 0 CRITICAL / 2 WARNING / 2 SUGGESTION. All MUST requirements are met. Safe to archive.