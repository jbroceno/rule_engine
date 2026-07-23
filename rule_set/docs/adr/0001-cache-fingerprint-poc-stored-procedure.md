# ADR-0001: Fingerprint/TTL cache for the POC config-loading stored procedure

## Status

Accepted (2026-07-10)

## Decision in one paragraph

`dbo.cfg_get_offers_and_params_json_cached` on the POC track is today a no-op passthrough shim. We are replacing it with a real fingerprint-keyed, TTL-bounded cache — a 1:1 adaptation of the mechanism already running in the Workflow (WF) deployment (`rule_set/sql/workflow_deploy/wf_sp_cfg_rules_cache.sql`), rebuilt against POC's own tables. The wrapper's call signature does not change, so `config_service.js` and everything above it (API, Angular) needs **zero** changes.

## Context

### Where this sits in the system

`rule_set/api/services/config_service.js::loadNormalizedConfig` calls `dbo.cfg_get_offers_and_params_json_cached(@offer_codes, @DATE, @max_history_size)` first, falling back to `dbo.cfg_get_rules_json` only if the primary SP doesn't exist. This caller is already generic — it has no idea whether the SP it's calling actually caches anything.

### What exists today (POC)

`rule_set/sql/sp_cached_wrapper.sql` is a pure passthrough:

```sql
CREATE OR ALTER PROCEDURE dbo.cfg_get_offers_and_params_json_cached
  @offer_codes NVARCHAR(MAX) = NULL, @DATE DATETIME = NULL, @max_history_size INT = 50
AS
BEGIN
  EXEC dbo.cfg_get_offers_and_params_json @offer_codes = @offer_codes, @DATE = @DATE;
END
```

No cache table, no TTL, no eviction. It works correctly — it's just not doing any caching.

### What exists today (WF) — the precedent

WF already has a production-grade version of the same-named SP, deployed against its own SQL Server: `rule_set/sql/workflow_deploy/wf_sp_cfg_rules_cache.sql`. It maintains a `dbo.cfg_rules_cache` table keyed by a fingerprint over the *winning* rule/param periods per offer, with:

- a TTL fast path (default 14 days),
- `sp_getapplock`-based anti-stampede locking on cache miss,
- best-effort insert (ignoring PK-violation errors 2627/2601 from concurrent writers),
- opportunistic TTL purge and FIFO eviction bounded by `@max_history_size`.

That script documents its own design history inline via `ADR-001` through `ADR-007` comments — there is no standalone ADR file anywhere in this repo (confirmed by search across `docs/`, `openspec/`, and `doc/`). This document is the repo's **first** written ADR; the WF inline comments are cited below as prior art.

### Why POC needs its own copy, not a shared one

POC and WF run against **physically separate SQL Server instances** (per project convention: no Workflow tables in the POC/demo database). WF's `cfg_rules_cache` table cannot be reused — POC needs a fresh, POC-local copy of the same mechanism.

### Why do this at all

This is explicitly **not** required for POC/TFM functional correctness — the current passthrough already returns correct results. The motivation is purely didactic: to give the TFM a complete, working demonstration of a real caching/invalidation architecture pattern (fingerprint + TTL + anti-stampede + FIFO), self-contained in the POC's own schema, mirroring the production design used on the WF track.

## Decision

Adapt WF's mechanism **1:1** into POC's schema (`cfg_offer_ruleset` / `cfg_offer_dates` / `cfg_offer_rule` / `cfg_offer_param`), delivered as a single idempotent rewrite of `rule_set/sql/sp_cached_wrapper.sql` — not a numbered migration, since the cache is disposable derived data, not a persistent business table.

| Component | Decision |
|---|---|
| **Cache table** | New POC-local `dbo.cfg_rules_cache` — byte-identical DDL to WF's (`cache_key` PK, `offer_codes_key`, `ofertas_json`, `parametros_json`, `created_at`) plus the same `IX_cfg_rules_cache_evict (offer_codes_key, created_at) INCLUDE (cache_key)` FIFO-eviction index. |
| **Winner resolution** | Inline TVF `dbo.cfg_resolve_offer_dates_winners(@offer_codes, @DATE)` computing **two independent winners per ruleset**: a rules-winner and a params-winner, using `cfg_offer_dates.tipo_cd IN ('REGLAS'\|'PARAMS'\|'AMBOS')` and `ROW_NUMBER() OVER (PARTITION BY ruleset_id ORDER BY valid_from DESC, offer_date_id DESC)`. Mirrors WF's `mf_rules_win` / `mf_params_win` CTEs, renamed to POC's schema (`ruleset_id`, `offer_date_id`, `tipo_cd`). |
| **Fingerprint** | `STRING_AGG(ruleset_id:rules_did:params_did, '|') WITHIN GROUP (ORDER BY ruleset_id ASC)`, with `ISNULL(...,0)` so an offer with no covering period contributes `:0:0` — this makes activating a future period a *controlled cache miss* rather than a silent stale hit. |
| **Cache key** | `<offer_codes_key>|FP:<fingerprint>`, same shape as WF. |
| **TTL** | Default 14 days, same as WF; hit requires `created_at >= cutoff`. |
| **Anti-stampede** | `sp_getapplock` keyed on `@cache_key`, exclusive, session-scoped, with re-check after acquiring the lock (another session may have already populated the entry while we waited). |
| **Eviction** | FIFO, bounded by `@max_history_size`, scoped per `offer_codes_key`. |
| **Wrapper signature** | Unchanged: `(@offer_codes NVARCHAR(MAX)=NULL, @DATE DATETIME=NULL, @max_history_size INT=50, @ttl_days INT=14)`. `@ttl_days` is new but defaults, and `config_service.js` never sends it — so **zero JS/API/Angular changes** are required. |
| **Delivery** | One idempotent script: `DROP INDEX/TABLE IF EXISTS` → `CREATE TABLE/INDEX` → `CREATE OR ALTER` for the TVF and the wrapper SP. Safe to re-run; parallels the sibling `wf_sp_cfg_rules_cache.sql` file structure. |

## Alternatives Considered

| Alternative | Verdict | Why |
|---|---|---|
| **Simplified single fingerprint per ruleset** (one winner per ruleset, ignoring `tipo_cd`) | Rejected | POC's `cfg_offer_dates.tipo_cd` genuinely distinguishes REGLAS/PARAMS/AMBOS, and `cfg_offer_rule`/`cfg_offer_param` hold **independent** `offer_date_id` FKs — a rule and a param for the same offer can legitimately come from different periods. Collapsing to one winner would misrepresent the schema and produce a stale-or-wrong cache key whenever rule and param periods diverge. |
| **Reuse WF's existing `cfg_rules_cache` table** | Rejected | POC and WF run on physically separate SQL Server instances; there is no shared database to point at. POC must own its own copy of the table. |

## Consequences

### Positive

- Gives the TFM a complete, working demonstration of a real caching/invalidation pattern (fingerprint keying + TTL + anti-stampede locking + FIFO eviction), fully exercised against the POC's own schema.
- Zero blast radius: no changes to `config_service.js`, the Express API, or the Angular frontend — the wrapper's call contract is preserved exactly. Existing tests (`config_cache.test.js`, which encodes the fingerprint/TTL/FIFO semantics via in-memory JS mirrors) remain green, unchanged.
- Rollback is cheap: revert to the passthrough shim and drop the new table/TVF; the caller is unaffected either way.

### Negative / risks

- **No live-SQL automated test coverage.** This repo's CI has no SQL Server available (the same limitation WF's precedent lives with — see the 2 intentionally-skipped `workflow_service` tests, CA-013). Verification of the actual T-SQL is a manual checklist, not an automated gate.
- **TTL-based staleness is an accepted tradeoff, not a correctness guarantee.** If rules or params are edited *in place* while reusing the same `offer_date_id` — notably the "Grabar configuración" flow with `deleteAllPeriods: true` — the fingerprint does not change, so the cache keeps serving the pre-edit result until the 14-day TTL expires. This mirrors WF's own accepted tradeoff (its inline `ADR-006`: "TTL is storage management, not a correctness guarantee") and should be called out explicitly in the TFM write-up as intentional design, not an oversight.
- **Winner semantics won't perfectly mirror the POC base SP on overlapping periods.** The POC's current base SP (`cfg_get_offers_and_params_json`) has no winner-dedup logic of its own — it naively joins every period covering `@DATE`, so overlapping periods can produce duplicate rule/param rows. The new fingerprint TVF *does* pick a single winner per ruleset/dimension, which won't reproduce that duplication if it ever occurs. In practice this is a non-issue because admin CRUD creates one period at a time, and fixing the base SP's dedup gap is out of scope for this change — it is a pre-existing, separate concern.

## References

- `rule_set/sql/workflow_deploy/wf_sp_cfg_rules_cache.sql` — the WF precedent this change adapts. Its inline `ADR-001` through `ADR-007` comments document the original design rationale (cache key shape, TVF semantics, applock strategy, TTL-vs-correctness tradeoff, FIFO eviction, signature stability) and are the origin of the pattern formalized here; this is the repo's first standalone ADR document.
- `rule_set/sql/sp_cached_wrapper.sql` — current POC no-op passthrough being replaced.
- `rule_set/api/services/config_service.js` — confirms the wrapper is called generically and needs no changes.
- Engram SDD trail for this change (project `rule_engine`): `sdd/poc-config-sp-cache/explore`, `sdd/poc-config-sp-cache/proposal`, `sdd/poc-config-sp-cache/design`.
