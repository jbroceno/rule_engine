# db-rules-cache — Specification

## Purpose

This spec defines the observable behavior added to the WF system by the SQL Server cache layer for `dbo.cfg_get_offers_and_params_json`. The cache eliminates redundant executions of the rules-resolution SP by storing results keyed on offer codes and date precision, pre-materializing generic entries on config publish, and serializing concurrent misses via application-level locking. No existing SP contracts change; all new behavior is introduced through new database objects and two narrow call-site rewirings in Node.js.

---

## Scope

### In scope
- Table `dbo.cfg_rules_cache` and its row model (columns, types, constraints)
- SP `dbo.cfg_get_offers_and_params_json_cached` — full lookup + miss + eviction behavior
- SP `dbo.cfg_refresh_rules_cache` — pre-materialization and failure isolation contract
- Node.js call-site changes in `config_service.js` and `admin_service.js`
- Cache key format for both row kinds

### Out of scope
- Body of `dbo.cfg_get_offers_and_params_json` (unchanged)
- In-Memory OLTP migration
- Angular / UI layer
- External caches (Redis, Memcached, etc.)

---

## Requirements

| ID | Strength | Statement |
|----|----------|-----------|
| REQ-01 | MUST | The wrapper SP SHALL return the cached `result_json` for a generic (`G`) entry without invoking `cfg_get_offers_and_params_json` when a matching cache key exists. |
| REQ-02 | MUST | On a generic cache miss the wrapper SP MUST call `cfg_get_offers_and_params_json`, store the result as a `G` row with the correct cache key, and return the result. No `sp_getapplock` is required for `G` entries (pre-materialization makes cold-start collisions negligible). |
| REQ-03 | MUST | The wrapper SP SHALL return the cached `result_json` for a historical (`H`) entry without invoking `cfg_get_offers_and_params_json` when a matching key exists. |
| REQ-04 | MUST | On a historical cache miss the wrapper SP MUST acquire `sp_getapplock` scoped to the exact `cache_key`, re-check the cache (double-check), call `cfg_get_offers_and_params_json` if still absent, store the result as an `H` row, release the lock, and return the result. |
| REQ-05 | MUST | A concurrent thread that acquires the `sp_getapplock` after another thread has already written the same `H` entry MUST return the row found on re-check and MUST NOT invoke `cfg_get_offers_and_params_json` again. |
| REQ-06 | MUST | After inserting a new `H` row, if the count of `H` rows for the same `offer_codes` value exceeds `@max_history_size`, the wrapper SP MUST delete the oldest rows (by `created_at` ascending) until the count equals `@max_history_size`. |
| REQ-07 | MUST | `cfg_refresh_rules_cache` MUST rebuild all `G` entries that already exist in the cache table. For each distinct `offer_codes` value present as a `G` row it MUST execute a DELETE followed by an INSERT (not MERGE). The entire rebuild MUST run inside a single transaction. |
| REQ-08 | SHOULD | If `cfg_refresh_rules_cache` raises an error, `admin_service.js` MUST catch the error, log it, and resolve `applyConfig()` as a success. The error MUST NOT propagate to the HTTP caller. |
| REQ-09 | MUST | `config_service.js` MUST call `cfg_get_offers_and_params_json_cached` and MUST pass `@max_history_size` with every invocation. It MUST NOT call the original `cfg_get_offers_and_params_json` directly. |
| REQ-10 | MUST | `admin_service.js` MUST call `cfg_refresh_rules_cache` after a successful `applyConfig()` write. A failure in the refresh call MUST NOT cause `applyConfig()` to return an error to its caller. |

---

## Scenarios

### Requirement: Generic Cache Hit (REQ-01)

#### Scenario: Steady-state generic lookup

- GIVEN a `G` row exists in `dbo.cfg_rules_cache` with key `'__ALL__|__CURRENT__'`
- WHEN `cfg_get_offers_and_params_json_cached` is called with `@offer_codes = NULL` and no `@DATE`
- THEN the SP returns the stored `result_json`
- AND `cfg_get_offers_and_params_json` is NOT executed

---

### Requirement: Generic Cache Miss (REQ-02)

#### Scenario: Cold start — no G entry present

- GIVEN no `G` row exists for the requested `offer_codes`
- WHEN `cfg_get_offers_and_params_json_cached` is called
- THEN `cfg_get_offers_and_params_json` is called once
- AND the result is stored as a `G` row with key `ISNULL(@offer_codes,'__ALL__') + '|__CURRENT__'`
- AND the result is returned to the caller

---

### Requirement: Historical Cache Hit (REQ-03)

#### Scenario: Repeated historical lookup for the same datetime

- GIVEN an `H` row exists with key `'__ALL__|2025-03-15 10:00:00'`
- WHEN `cfg_get_offers_and_params_json_cached` is called with `@DATE = '2025-03-15 10:00:00'`
- THEN the stored `result_json` is returned
- AND `cfg_get_offers_and_params_json` is NOT executed

---

### Requirement: Historical Cache Miss (REQ-04)

#### Scenario: First historical request for a datetime

- GIVEN no `H` row exists for key `'__ALL__|2025-03-15 10:00:00'`
- WHEN `cfg_get_offers_and_params_json_cached` is called with that `@DATE`
- THEN `sp_getapplock` is acquired on the key
- AND the cache is re-checked
- AND `cfg_get_offers_and_params_json` is called (still absent after re-check)
- AND the result is stored as an `H` row
- AND `sp_getapplock` is released
- AND the result is returned

---

### Requirement: Concurrent Miss — Stampede Prevention (REQ-05)

#### Scenario: Second thread arrives during first thread's miss path

- GIVEN thread A has acquired `sp_getapplock` on key `K` and has stored the `H` row
- WHEN thread B acquires the lock after thread A releases it
- THEN thread B finds the `H` row on its re-check
- AND thread B returns the cached row
- AND `cfg_get_offers_and_params_json` is NOT called by thread B

---

### Requirement: FIFO Eviction for H Entries (REQ-06)

#### Scenario: H entry count exceeds cap after insert

- GIVEN `@max_history_size = 3` and 3 `H` rows already exist for `offer_codes = NULL`
- WHEN a new `H` row is inserted for a new `@DATE`
- THEN the row with the oldest `created_at` is deleted
- AND exactly 3 `H` rows remain for `offer_codes = NULL`

#### Scenario: H entry count at or below cap — no eviction

- GIVEN `@max_history_size = 50` and 10 `H` rows exist for `offer_codes = NULL`
- WHEN a new `H` row is inserted
- THEN no rows are deleted
- AND 11 `H` rows exist for `offer_codes = NULL`

---

### Requirement: Pre-materialization (REQ-07)

#### Scenario: Refresh rebuilds all G entries atomically

- GIVEN the cache contains `G` rows for `offer_codes IN (NULL, 'HJ')` and some `H` rows
- WHEN `cfg_refresh_rules_cache` is called
- THEN all existing `G` rows are deleted
- AND new `G` rows are inserted by calling `cfg_get_offers_and_params_json` for each distinct `offer_codes`
- AND `H` rows are NOT modified
- AND all deletes and inserts execute within a single transaction

#### Scenario: Refresh is atomic on failure

- GIVEN the refresh transaction begins
- WHEN `cfg_get_offers_and_params_json` raises an error during rebuild
- THEN the transaction is rolled back
- AND the cache table is left in the pre-refresh state

---

### Requirement: Refresh Failure Isolation (REQ-08)

#### Scenario: Refresh raises — publish still succeeds

- GIVEN `cfg_refresh_rules_cache` throws a SQL error
- WHEN `admin_service.js` catches the error
- THEN the error is logged (not re-thrown)
- AND `applyConfig()` resolves as success to its HTTP caller
- AND the stale `G` entries remain in the cache until the next successful refresh

---

### Requirement: Node.js — Cached SP Wiring (REQ-09)

#### Scenario: config_service calls cached SP with size param

- GIVEN a WF simulation request arrives
- WHEN `config_service.js` queries for rules
- THEN it executes `cfg_get_offers_and_params_json_cached`
- AND passes `@max_history_size` as an explicit parameter
- AND does NOT reference `cfg_get_offers_and_params_json`

---

### Requirement: Node.js — Refresh Trigger (REQ-10)

#### Scenario: Successful publish triggers cache refresh

- GIVEN `applyConfig()` has written rule configuration successfully
- WHEN the write completes
- THEN `cfg_refresh_rules_cache` is called
- AND any error from that call is caught, logged, and NOT re-thrown

---

## Data Contract

### Table: `dbo.cfg_rules_cache`

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `cache_key` | `varchar(300)` | NOT NULL | Clustered PK |
| `kind` | `char(1)` | NOT NULL | `'G'` = generic, `'H'` = historical |
| `offer_codes` | `varchar(200)` | NULL | Raw `@offer_codes` value (NULL preserved) |
| `result_json` | `nvarchar(MAX)` | NOT NULL | Serialized output of `cfg_get_offers_and_params_json` |
| `created_at` | `datetime` | NOT NULL | Defaults to `GETDATE()`; used for FIFO eviction ordering |

### SP: `dbo.cfg_get_offers_and_params_json_cached`

```
@offer_codes    varchar(200)  = NULL
@DATE           datetime      = NULL
@max_history_size int         = 50
```

Returns the same result set as `cfg_get_offers_and_params_json`.

### SP: `dbo.cfg_refresh_rules_cache`

No parameters. Rebuilds all `G` entries found in the cache. Returns nothing (or a row count for diagnostic purposes — MAY be omitted).

### Cache Key Format

| Kind | Formula |
|------|---------|
| `G` | `ISNULL(@offer_codes, '__ALL__') + '|__CURRENT__'` |
| `H` | `ISNULL(@offer_codes, '__ALL__') + '|' + CONVERT(varchar(19), @DATE, 120)` |

DATETIME style 120 produces `yyyy-mm-dd hh:mi:ss` (second precision). No date-only normalization is applied.

---

## Open Questions

None. All design decisions were resolved at proposal time:
- Cache size default: `@max_history_size = 50`
- G-entry swap: DELETE + INSERT (not MERGE)
- Refresh failure: log and continue
- Date precision: second-level DATETIME (style 120), no normalization
- Storage: disk-based first; In-Memory OLTP deferred
