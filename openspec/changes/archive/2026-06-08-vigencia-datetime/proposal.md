# Proposal: Vigencia desde/hasta as exact-second datetime, end-to-end

## Intent

The external WF tool creates `MRO_MOTORFECHA` periods with full second-precision, non-midnight `DESDE_DT` (e.g. `14:32:07`). Today our publish/restore binds vigencia as `sql.Date` (midnight). That `sql.Date` was a DELIBERATE fix to stop orphan rows — but it made it IMPOSSIBLE to replace a WF-tool-created period: the day-granular match never aligns with a non-midnight `DESDE_DT`, so every republish either misses or spawns a parallel orphan `MOTORFECHA` row. We promote vigencia to true datetime (seconds) end-to-end so our deploy can SUBSTITUTE the exact externally-created period instead of orphaning it.

## Scope

### In Scope
- **POC schema**: `cfg_offer_dates.valid_from/valid_to` `DATE` → `DATETIME2(0)` (+ migration script).
- **Backend bindings** `sql.Date` → datetime across: `admin_workflow_service.js` (`upsertMotorFecha`, `createWorkflowSnapshot`), `admin_fechas_service.js` (`createFecha`/`updateFecha`/`checkOverlap`/`duplicateFecha`), `admin_service.js` (`restoreSnapshot`).
- **`upsertMotorFecha` match key**: remove `CAST(DESDE_DT AS DATE)` day match → exact `DESDE_DT = @desde` at second precision (the replace-to-match driver).
- **Snapshot SP** `cfg_get_workflow_snapshot_json`: `@VIGENCIA_*` `DATE` → `DATETIME2`, exact second match (drop CAST-to-date).
- **Validator** `admin_validator.js`: accept datetime format; replace string `valid_to <= valid_from` with datetime-aware comparison.
- **Period-closing arithmetic**: `subtractOneDay` / `setUTCDate(-1)` → datetime boundary (next period's `valid_from` exactly).
- **Frontend**: 10 inputs `type="date"` → `datetime-local step="1"`; remove `substring(0,10)` truncation; display pipes `dd/MM/yyyy` → `dd/MM/yyyy HH:mm:ss`.
- Tests + spec deltas for the above.

### Out of Scope
- **WF schema** (`MRO_MOTORFECHA.DESDE_DT/HASTA_DT`, `BORRAR_VIGENCIA_*`) — already `datetime`.
- **Read SPs already datetime-ready** (confirmed): `cfg_get_offers_and_params_json` (POC + WF + sp_rules_params), `cfg_get_offers_and_params_json_cached`, `config_service.js` (`sql.DateTime`). No change.
- **The external WF tool itself** — we adapt to it, not vice versa.
- UTC handling — explicitly excluded (see approach).

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `cfg-offer-dates`: vigencia stored/validated/displayed at second precision.
- `workflow-deployment`: period identity and replace-to-match at exact second precision.

## Approach

Adopt **Approach C upgraded to exact-second identity** (not display-only, not naive ms-exact).

**Normalization invariant (the safety mechanism).** Orphan-row regression is prevented ONLY if every write path AND the snapshot SP match normalize precision IDENTICALLY — truncate to whole seconds (`DATETIME2(0)`, no sub-second drift) on every insert/lookup. This invariant replaces the old `sql.Date` truncation as the thing that guarantees a republish hits the SAME row. It MUST be stated and enforced wherever vigencia is bound or matched.

**Period identity.** Exact `DESDE_DT = @desde` to the second. Two activations the same calendar day at different times are DISTINCT periods.

**Period-closing boundary.** Closing a period sets `valid_to` = the new period's `valid_from` EXACTLY (no -1 day). Justified: read SP range is strict `<= @DATE` / `> @DATE`, so an exclusive upper bound equal to the next start yields no gap and no overlap at the second boundary.

**Timezone.** Server-local / naive everywhere — no UTC conversion. Required so our stored datetimes line up with the WF tool's `GETDATE()`-based local `DESDE_DT` for replace-to-match.

## Migration note

`ALTER COLUMN ... DATE → DATETIME2(0)` is backward-compatible: existing date values become midnight. Production DDL needs a maintenance window.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Orphan-row regression on republish | High | Normalization invariant (truncate-to-second on every write + SP match) + exact `DESDE_DT` match |
| Validator string-comparison bug (mixed formats) | Med | Replace string compare with datetime-aware comparison |
| Timezone mismatch vs WF tool | Med | Naive server-local everywhere; no UTC conversion |
| Broad frontend regression (10 inputs + pipes) | Med | Slice frontend as its own work unit; visual + e2e checks |
| Period-closing off-by-boundary gap/overlap | Med | Exclusive `valid_to = next valid_from`, validated against `<= / >` read range |

## Rollback Plan

Revert backend/frontend commits; re-apply prior `sql.Date` bindings. POC schema rollback via `ALTER COLUMN ... DATETIME2(0) → DATE` (truncates time — only safe once datetimes are confirmed midnight, otherwise data loss). Snapshot-restore remains available for config rollback.

## Dependencies

- WF-tool timezone behavior (assumed local — see open question).

## Open Questions

- **WF tool stores UTC?** If the external WF tool persists `DESDE_DT` in UTC rather than server-local, the naive-local timezone decision FLIPS. Flagged; proceeding under the local assumption.

## Delivery outlook

Estimated change spans 7 layers (~30 points) and will exceed the 400-line PR budget — chained-PR territory. Natural slices for tasks phase: (1) POC schema + SP, (2) backend bindings + upsert/restore, (3) validator + period-close, (4) frontend inputs + display, (5) tests + spec deltas. Use work-unit commits (code+tests+docs together), conventional commits.

## Success Criteria

- [ ] A WF-tool-created non-midnight period is REPLACED (not orphaned) on republish.
- [ ] No new orphan `MRO_MOTORFECHA` rows after repeated publishes of the same period.
- [ ] POC vigencia stored and round-tripped at second precision.
- [ ] Snapshot SP returns the row for non-midnight `DESDE_DT`.
- [ ] Frontend captures/displays seconds; validator accepts datetime and rejects `valid_to <= valid_from`.
