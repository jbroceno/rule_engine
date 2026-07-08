# Proposal: SQL Server Cache for Rules Resolution SP

## Intent

The SP `dbo.cfg_get_offers_and_params_json` is invoked on every WF mortgage simulation. It runs multi-CTE queries with nested `FOR JSON PATH` to build two large JSON columns and is computationally expensive. For a given input the result is deterministic and stable (generic call = active rules until next config publish; historical call = immutable once the moment passes). With high call volume and very few input combinations (currently 2 offers), recomputing on every request is wasteful and inflates response latency in WF.

We solve this with a SQL-Server-resident cache table plus a wrapper SP, pre-materializing the generic case on config publish so the steady-state hit rate approaches 100%.

## Scope

### In Scope
- New table `dbo.cfg_rules_cache` (disk-based, clustered on `cache_key`).
- New SP `dbo.cfg_get_offers_and_params_json_cached` (cache lookup + miss path with `sp_getapplock` anti-stampede + insert; FIFO eviction by `created_at` bounded by caller-supplied size param).
- New SP `dbo.cfg_refresh_rules_cache` (rebuild all `G` entries; invoked after admin publish).
- Wire `api/services/admin_service.js::applyConfig()` to call `cfg_refresh_rules_cache` at the end of the publish flow.
- Switch `api/services/config_service.js` to call `cfg_get_offers_and_params_json_cached` with cache-size parameter.
- SQL deploy script under `/rule_set/sql/workflow_deploy/`.

### Out of Scope
- In-Memory OLTP migration (deferred; staging RAM is tight at 6 GB; revisit after monitoring on production with 128 GB RAM).
- Redis or any external cache.
- Angular/UI changes.
- Changing the original `cfg_get_offers_and_params_json` body (wrapper-only design).

## Capabilities

### New Capabilities
- `rules-cache`: SQL Server-resident cache for the rules-resolution SP, covering generic (current) and historical date queries, with pre-materialization on config publish and bounded FIFO eviction for historical entries.

### Modified Capabilities
- None — `config_service` and `admin_service` Node modules are rewired but their public contracts do not change at the spec level. (If existing specs for these services surface during spec phase, they may need a delta — verify in `sdd-spec`.)

## Approach

Wrapper SP pattern over the existing expensive SP. Two row classes in one table distinguished by `kind`:

| `kind` | Cache key | Lifetime | Population |
|--------|-----------|----------|------------|
| `G` (generic / current) | `ISNULL(@offer_codes,'__ALL__') + '\|__CURRENT__'` | Invalidated and rebuilt on config publish | Pre-materialized by `cfg_refresh_rules_cache` |
| `H` (historical) | `ISNULL(@offer_codes,'__ALL__') + '\|' + CONVERT(varchar(19), @DATE, 120)` | Immutable once written | Lazy on miss; bounded FIFO by `created_at` |

Periods are true `DATETIME`. Cache keys use second-precision (`varchar(19)`, style 120) — no date-only normalization.

Miss path uses `sp_getapplock` keyed on `cache_key` to serialize concurrent misses for the same input and avoid stampede on the underlying SP. Cache size is a parameter of the cached SP so the caller controls eviction headroom without redeploying.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `/rule_set/sql/workflow_deploy/` | New | New deploy script: table + 2 SPs + initial refresh call |
| `dbo.cfg_get_offers_and_params_json` | Unchanged | Wrapped, not modified |
| `api/services/config_service.js` | Modified | Switch SP call; pass cache-size param |
| `api/services/admin_service.js` | Modified | Invoke `cfg_refresh_rules_cache` at end of `applyConfig()` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Stampede on first cold miss for a popular key | Med | `sp_getapplock` per `cache_key` in the miss path |
| Stale `G` entries after publish | Low | `cfg_refresh_rules_cache` runs synchronously at end of `applyConfig()` |
| Unbounded growth of `H` entries | Low | FIFO eviction by `created_at`, ceiling = caller-supplied size param |
| Time-precision mismatch (date vs datetime) | Med | Cache key uses `CONVERT(varchar(19), @DATE, 120)` — second precision preserved |
| Disk-based table slower than memory-optimized | Low | Disk-based first; revisit In-Memory OLTP after prod monitoring on 128 GB host |
| Lock contention on `cfg_refresh_rules_cache` during publish | Low | Publish is admin-triggered, low frequency; refresh runs after rule write completes |

## Rollback Plan

1. Revert the two Node.js changes (`config_service.js`, `admin_service.js`) — Node resumes calling the original `cfg_get_offers_and_params_json` directly.
2. Optionally drop `dbo.cfg_rules_cache`, `dbo.cfg_get_offers_and_params_json_cached`, and `dbo.cfg_refresh_rules_cache` — original SP is untouched, so dropping the new objects has no functional impact.
3. No data migration required; cache table is purely derived.

## Dependencies

- SQL Server 2017 Enterprise (already in place).
- Existing `dbo.cfg_get_offers_and_params_json` (unchanged contract).
- Production host has 128 GB RAM; staging has 6 GB (constrains memory-optimized rollout, not disk-based).

## Success Criteria

- [ ] Steady-state cache hit rate for generic (`G`) calls is ~100% between admin publishes.
- [ ] Historical (`H`) calls hit cache on the second and subsequent identical requests.
- [ ] `applyConfig()` produces a fresh `G` row set before returning success to the admin caller.
- [ ] No regression in WF simulation response payload (byte-identical JSON vs. direct SP call).
- [ ] Concurrent identical misses do not produce duplicate underlying SP executions (verified via `sp_getapplock`).
- [ ] `H` entries respect the caller-supplied size cap with FIFO eviction.
