# Design: SQL Server Cache for Rules Resolution SP

## 1. Architecture Overview

A wrapper SP pattern in SQL Server. The expensive `dbo.cfg_get_offers_and_params_json` is left untouched and is fronted by a new SP `dbo.cfg_get_offers_and_params_json_cached` that hits a disk-based cache table `dbo.cfg_rules_cache`. A second SP, `dbo.cfg_refresh_rules_cache`, pre-materializes the generic (current) entries and is invoked synchronously by `admin_service.applyConfig()` after a successful publish. The Node API switches its config-loading call to the cached SP; the admin publish flow gains a best-effort refresh call. Two row classes coexist in one cache table, distinguished by `cache_type`:

```
                   ┌────────────────────────────────────────┐
                   │  Node API                              │
                   │                                        │
   simulate ─────► │  config_service.loadNormalizedConfig() │
                   │     └─► EXEC cfg_get_offers_..._cached │
                   │                                        │
   publish  ─────► │  admin_service.applyConfig()           │
                   │     ├─► (existing apply transaction)   │
                   │     └─► EXEC cfg_refresh_rules_cache   │
                   └────────────────────────┬───────────────┘
                                            │
                   ┌────────────────────────▼───────────────┐
                   │  SQL Server                            │
                   │                                        │
                   │  cfg_get_offers_..._cached (wrapper)   │
                   │    ├─ SELECT from cfg_rules_cache      │
                   │    ├─ sp_getapplock (H only)           │
                   │    ├─ EXEC cfg_get_offers_..._json     │
                   │    │     (unchanged, expensive)        │
                   │    ├─ INSERT row, FIFO evict (H only)  │
                   │    └─ RETURN cached JSONs              │
                   │                                        │
                   │  cfg_refresh_rules_cache               │
                   │    └─ rebuild each DISTINCT G key      │
                   │       (DELETE + INSERT in tx)          │
                   │                                        │
                   │  cfg_rules_cache (disk-based)          │
                   │    PK (clustered): cache_key           │
                   │    IX: (cache_type, offer_codes_key,   │
                   │         created_at) for eviction       │
                   └────────────────────────────────────────┘
```

## 2. Table DDL — `dbo.cfg_rules_cache`

```sql
CREATE TABLE dbo.cfg_rules_cache
(
  cache_key         NVARCHAR(500) NOT NULL,
  cache_type        CHAR(1)       NOT NULL,   -- 'G' = generic/current, 'H' = historical
  offer_codes_key   NVARCHAR(500) NOT NULL,   -- ISNULL(@offer_codes,'__ALL__'); used for eviction
  ofertas_json      NVARCHAR(MAX) NOT NULL,
  parametros_json   NVARCHAR(MAX) NOT NULL,
  created_at        DATETIME2(0)  NOT NULL CONSTRAINT DF_cfg_rules_cache_created_at DEFAULT SYSDATETIME(),
  CONSTRAINT PK_cfg_rules_cache PRIMARY KEY CLUSTERED (cache_key),
  CONSTRAINT CK_cfg_rules_cache_type CHECK (cache_type IN ('G','H'))
);

CREATE NONCLUSTERED INDEX IX_cfg_rules_cache_evict
  ON dbo.cfg_rules_cache (cache_type, offer_codes_key, created_at)
  INCLUDE (cache_key);
```

Rationale:
- Clustered PK on `cache_key` → O(1)-ish lookup on the hot path.
- Non-clustered index on `(cache_type, offer_codes_key, created_at)` → FIFO eviction queries seek a single contiguous range.
- `DATETIME2(0)` (second precision) for `created_at` — matches cache-key time resolution and saves bytes vs default `DATETIME2(7)`.

## 3. SP — `dbo.cfg_get_offers_and_params_json_cached`

```sql
CREATE OR ALTER PROCEDURE dbo.cfg_get_offers_and_params_json_cached
  @offer_codes        NVARCHAR(MAX) = NULL,
  @DATE               DATETIME      = NULL,
  @max_history_size   INT           = 50
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @is_generic       BIT,
          @effective_date   DATETIME,
          @offer_codes_key  NVARCHAR(500),
          @cache_key        NVARCHAR(500),
          @cache_type       CHAR(1);

  SET @is_generic      = CASE WHEN @DATE IS NULL THEN 1 ELSE 0 END;
  SET @effective_date  = ISNULL(@DATE, SYSDATETIME());
  SET @offer_codes_key = ISNULL(@offer_codes, N'__ALL__');
  SET @cache_type      = CASE WHEN @is_generic = 1 THEN 'G' ELSE 'H' END;
  SET @cache_key       = @offer_codes_key + N'|' +
                         CASE WHEN @is_generic = 1
                              THEN N'__CURRENT__'
                              ELSE CONVERT(varchar(19), @effective_date, 120)
                         END;

  -- 1) Fast path: cache hit
  IF EXISTS (SELECT 1 FROM dbo.cfg_rules_cache WHERE cache_key = @cache_key)
  BEGIN
    SELECT ofertas_json AS OFERTAS_JSON,
           parametros_json AS PARAMETROS_JSON
    FROM dbo.cfg_rules_cache
    WHERE cache_key = @cache_key;
    RETURN 0;
  END

  -- 2) Miss path. Generic skips the applock (G is pre-materialized; cold race is acceptable).
  DECLARE @lock_acquired BIT = 0;
  IF @is_generic = 0
  BEGIN
    DECLARE @lock_result INT;
    EXEC @lock_result = sp_getapplock
      @Resource     = @cache_key,
      @LockMode     = 'Exclusive',
      @LockOwner    = 'Session',
      @LockTimeout  = 5000;

    IF @lock_result < 0
    BEGIN
      -- Lock timeout or failure: fall through and compute without caching guarantees.
      SET @lock_acquired = 0;
    END
    ELSE
    BEGIN
      SET @lock_acquired = 1;
      -- 3) Re-check: another session may have populated while we waited
      IF EXISTS (SELECT 1 FROM dbo.cfg_rules_cache WHERE cache_key = @cache_key)
      BEGIN
        EXEC sp_releaseapplock @Resource = @cache_key, @LockOwner = 'Session';
        SELECT ofertas_json AS OFERTAS_JSON,
               parametros_json AS PARAMETROS_JSON
        FROM dbo.cfg_rules_cache
        WHERE cache_key = @cache_key;
        RETURN 0;
      END
    END
  END

  -- 4) Compute via original SP into temp table
  DECLARE @tmp TABLE (OFERTAS_JSON NVARCHAR(MAX), PARAMETROS_JSON NVARCHAR(MAX));
  INSERT INTO @tmp (OFERTAS_JSON, PARAMETROS_JSON)
  EXEC dbo.cfg_get_offers_and_params_json
    @offer_codes = @offer_codes,
    @DATE        = @effective_date;

  -- 5) Insert into cache (best-effort: ignore PK violation if a race slipped through)
  BEGIN TRY
    INSERT INTO dbo.cfg_rules_cache
      (cache_key, cache_type, offer_codes_key, ofertas_json, parametros_json, created_at)
    SELECT @cache_key, @cache_type, @offer_codes_key,
           OFERTAS_JSON, PARAMETROS_JSON, SYSDATETIME()
    FROM @tmp;
  END TRY
  BEGIN CATCH
    IF ERROR_NUMBER() <> 2627 AND ERROR_NUMBER() <> 2601 THROW;
  END CATCH

  -- 6) FIFO eviction (H only)
  IF @is_generic = 0
  BEGIN
    ;WITH ranked AS (
      SELECT cache_key,
             ROW_NUMBER() OVER (ORDER BY created_at DESC, cache_key DESC) AS rn
      FROM dbo.cfg_rules_cache
      WHERE cache_type = 'H'
        AND offer_codes_key = @offer_codes_key
    )
    DELETE FROM dbo.cfg_rules_cache
    WHERE cache_key IN (SELECT cache_key FROM ranked WHERE rn > @max_history_size);
  END

  -- 7) Release lock and return
  IF @lock_acquired = 1
    EXEC sp_releaseapplock @Resource = @cache_key, @LockOwner = 'Session';

  SELECT OFERTAS_JSON, PARAMETROS_JSON FROM @tmp;
  RETURN 0;
END
GO
```

## 4. SP — `dbo.cfg_refresh_rules_cache`

```sql
CREATE OR ALTER PROCEDURE dbo.cfg_refresh_rules_cache
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @offer_codes_key NVARCHAR(500),
          @offer_codes_arg NVARCHAR(MAX);

  DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
    SELECT DISTINCT offer_codes_key
    FROM dbo.cfg_rules_cache
    WHERE cache_type = 'G';

  OPEN cur;
  FETCH NEXT FROM cur INTO @offer_codes_key;

  WHILE @@FETCH_STATUS = 0
  BEGIN
    SET @offer_codes_arg =
      CASE WHEN @offer_codes_key = N'__ALL__' THEN NULL ELSE @offer_codes_key END;

    DECLARE @tmp TABLE (OFERTAS_JSON NVARCHAR(MAX), PARAMETROS_JSON NVARCHAR(MAX));

    BEGIN TRY
      INSERT INTO @tmp (OFERTAS_JSON, PARAMETROS_JSON)
      EXEC dbo.cfg_get_offers_and_params_json
        @offer_codes = @offer_codes_arg,
        @DATE        = NULL;

      BEGIN TRAN;
        DELETE FROM dbo.cfg_rules_cache
        WHERE cache_type = 'G'
          AND offer_codes_key = @offer_codes_key;

        INSERT INTO dbo.cfg_rules_cache
          (cache_key, cache_type, offer_codes_key, ofertas_json, parametros_json, created_at)
        SELECT @offer_codes_key + N'|__CURRENT__', 'G', @offer_codes_key,
               OFERTAS_JSON, PARAMETROS_JSON, SYSDATETIME()
        FROM @tmp;
      COMMIT TRAN;
    END TRY
    BEGIN CATCH
      IF @@TRANCOUNT > 0 ROLLBACK TRAN;
      -- Log via RAISERROR but do NOT propagate — refresh is best-effort per key
      DECLARE @err NVARCHAR(2048) = ERROR_MESSAGE();
      RAISERROR(N'[cfg_refresh_rules_cache] key=%s failed: %s', 10, 1,
                @offer_codes_key, @err) WITH NOWAIT;
    END CATCH

    DELETE FROM @tmp;
    FETCH NEXT FROM cur INTO @offer_codes_key;
  END

  CLOSE cur;
  DEALLOCATE cur;
END
GO
```

## 5. Node.js Changes

### `api/services/config_service.js`

Switch SP name and add `max_history_size` input. Keep the existing fallback to `dbo.cfg_get_rules_json` for environments where the new SP is missing.

```diff
   try {
     const request = pool.request();
     request.input("offer_codes", sql.NVarChar(sql.MAX), offerCodesCsv);
     request.input("DATE", sql.DateTime, parseAsOfDate(options.asOfDate));
-    result = await request.execute("dbo.cfg_get_offers_and_params_json");
+    request.input("max_history_size", sql.Int, 50);
+    result = await request.execute("dbo.cfg_get_offers_and_params_json_cached");
   } catch (error) {
     const isMissingPrimarySp = String(error?.message ?? "")
       .toLowerCase()
-      .includes("could not find stored procedure 'dbo.cfg_get_offers_and_params_json'");
+      .includes("could not find stored procedure 'dbo.cfg_get_offers_and_params_json_cached'");
```

Notes:
- `extractConfigPayload` reads `row.offers_json` / `row.params_json` — the cached SP returns columns named `OFERTAS_JSON` / `PARAMETROS_JSON` to match the original SP's output contract, so no change needed in the consumer.
- AppError message updated to mention the new SP name for diagnosability.

### `api/services/admin_service.js`

`applyConfig()` already commits its transaction at line 1462. Add a best-effort refresh call AFTER the existing `await tx.commit();` but BEFORE the return — the refresh must observe the freshly committed config.

```diff
     await tx.commit();
+
+    try {
+      const refreshRequest = pool.request();
+      await refreshRequest.execute("dbo.cfg_refresh_rules_cache");
+    } catch (refreshErr) {
+      console.error("[cache] cfg_refresh_rules_cache failed:", refreshErr?.message ?? refreshErr);
+    }
+
     return { applied: { rules: rulesApplied, params: paramsApplied }, offerCodes };
```

`pool` is already in scope from line 1333 (`const pool = await getSqlPool();`). The catch swallows refresh failures so a transient cache error does not break the admin publish flow.

## 6. Architecture Decisions Record

### ADR-1: Disk-based table, not In-Memory OLTP (for now)
**Choice**: `CREATE TABLE` on the default filegroup with a clustered PK.
**Alternatives considered**: `MEMORY_OPTIMIZED = ON` hash/range tables.
**Rationale**: Staging host has only 6 GB RAM — memory-optimized filegroups demand reserved buffer pool we cannot afford there. Production has 128 GB and can be revisited, but disk-based already collapses the hot path to a clustered seek + two NVARCHAR(MAX) reads, which is orders of magnitude cheaper than the multi-CTE+FOR JSON PATH original. Switching backends later only requires the deploy script — wrapper SP contract is unchanged.

### ADR-2: DELETE+INSERT for G entries, not MERGE
**Choice**: Inside `cfg_refresh_rules_cache`, each G key is rebuilt as `DELETE … ; INSERT …;` inside a transaction.
**Alternatives considered**: `MERGE` with `WHEN MATCHED THEN UPDATE`.
**Rationale**: `MERGE` has well-documented concurrency bugs on SQL Server (e.g. KB3074434 race conditions, unique-key violations under HEKATON / parallel plans) and the team standard is to avoid it. DELETE+INSERT within an explicit `BEGIN TRAN ... COMMIT` gives atomic swap semantics with predictable locking. The G keyspace is tiny (one row per distinct `offer_codes` shape) so per-key transactions are cheap.

### ADR-3: `sp_getapplock` only on the H path, not on G
**Choice**: The wrapper SP serializes concurrent misses for H keys via `sp_getapplock(@cache_key)`; G misses bypass the lock.
**Alternatives considered**: Lock on every miss; or no locking at all.
**Rationale**: G entries are pre-materialized at publish time, so steady-state G hit-rate is ~100% and a stampede on G is essentially impossible. The only G "miss" window is the brief gap between a fresh deploy and the first `applyConfig()`, where a single duplicate underlying-SP call is harmless. H keys, by contrast, are populated lazily and a popular historical date could trigger a thundering herd on cold cache — the applock is exactly what `sp_getapplock` was designed for. Skipping the lock for G saves ~1 ms per request on the dominant code path.

### ADR-4: FIFO eviction by `created_at`, not LRU
**Choice**: When H rows exceed `@max_history_size` for a given `offer_codes_key`, delete the oldest by `created_at`.
**Alternatives considered**: LRU (track and update a `last_accessed_at`).
**Rationale**: LRU would require a write on every cache HIT, defeating the point of the cache (the hot path is supposed to be SELECT-only). FIFO needs no metadata mutation on reads. Historical queries are append-only by nature (a past date is immutable), so "oldest entry" is also a reasonable proxy for "least relevant". The caller controls the ceiling via `@max_history_size`, so the trade-off (eviction churn vs storage) is tunable without code changes.

### ADR-5: Refresh-on-publish, not TTL
**Choice**: `admin_service.applyConfig()` calls `cfg_refresh_rules_cache` synchronously after commit. No background TTL job.
**Alternatives considered**: TTL on each row + a SQL Agent job; lazy invalidation by version column.
**Rationale**: The publish flow already runs at admin cadence (low frequency, human-initiated) and already creates a snapshot — adding one more SP call costs a few hundred ms in a flow nobody profiles. TTL would either be too short (defeats the cache) or too long (stale config served after publish). Event-driven invalidation gives correct semantics with zero background infrastructure. The refresh is best-effort (caught and logged) so a transient cache failure cannot break a successful publish.

## 7. File Changes

| File | Action | Description |
|------|--------|-------------|
| `/rule_set/sql/workflow_deploy/wf_sp_cfg_rules_cache.sql` | Create | Deploy script: table DDL + both new SPs + one-shot `EXEC dbo.cfg_refresh_rules_cache` to seed `G` entries. |
| `/rule_set/api/services/config_service.js` | Modify | Switch SP name to `_cached`; add `max_history_size` input. |
| `/rule_set/api/services/admin_service.js` | Modify | Best-effort `EXEC cfg_refresh_rules_cache` after `applyConfig` commit. |

## 8. Open Questions

- [ ] Should `max_history_size` come from an env var on the Node side instead of being hard-coded to `50`? Default to `50` for now; revisit if H workload grows.
- [ ] Do we need a manual "purge all cache" admin endpoint, or is `applyConfig` enough? Defer until ops asks for it.
