# Exploration: vigencia-datetime

> SDD explore phase · project `app-workflow` · artifact store: hybrid
> Engram: `sdd/vigencia-datetime/explore` (obs-120d29894d2af926)

## Executive Summary

The vigencia (desde/hasta) datetime change touches **7 layers** with **~30 specific affected points**. The WF schema (`MRO_MOTORFECHA`) is already `datetime` — no WF schema change needed. The real work is: (1) migrating the POC schema (`cfg_offer_dates.valid_from/valid_to DATE → DATETIME2`), (2) redesigning the deliberately `sql.Date`-based `upsertMotorFecha` exact-match key in `admin_workflow_service.js`, (3) changing the `cfg_get_workflow_snapshot_json` SP from DATE to DATETIME params, (4) updating 10 frontend inputs from `type="date"` to `datetime-local`, and (5) fixing period-closing day arithmetic. The crux is the sql.Date decision — it was a deliberate bug fix, and lifting it to datetime risks reintroducing a false-mismatch regression that creates orphan `MRO_MOTORFECHA` rows on every republish.

## Current State — per layer

**POC DB schema** (`rule_set/sql/data_model.sql`):
- `cfg_offer_dates.valid_from DATE NOT NULL` — line 19
- `cfg_offer_dates.valid_to DATE NULL` — line 20
- Read SP `cfg_get_offers_and_params_json` declares `@DATE DATETIME` — already datetime-ready, range semantics (`<= @DATE`, `> @DATE`)

**WF DB schema** (`rule_set/sql/workflow_deploy/wf_data_model.sql`):
- `MRO_MOTORFECHA.DESDE_DT [datetime]` — line 80
- `MRO_MOTORFECHA.HASTA_DT [datetime]` — line 81
- `BORRAR_VIGENCIA_*_DT [datetime]` on `MRO_MOTORREGLA`/`MRO_MOTORPARAM` — lines 175-176, 151-152
- Already DATETIME — no schema change needed

**WF read SP** (`wf_sp_cfg_get_offers_and_params_json.sql`): `@DATE DATETIME` (line 124), range filters (lines 163, 194) — already datetime-compatible.

**WF snapshot SP** (`sql/workflow_snapshot.sql` — `cfg_get_workflow_snapshot_json`):
- `@VIGENCIA_DESDE DATE = NULL` (33), `@VIGENCIA_HASTA DATE = NULL` (34)
- Exact-match filter `mf.DESDE_DT = @VIGENCIA_DESDE` (106) — NEEDS CHANGE: DATE params force midnight-only matches against a DATETIME column.

**Backend** (`admin_workflow_service.js`): `upsertMotorFecha` `sql.Date` (126-127), `CAST(DESDE_DT AS DATE) = CAST(@desde AS DATE)` (133-134), `sql.Date` INSERT (143-144); `createWorkflowSnapshot` `sql.Date` (592-593).

**Backend** (`admin_fechas_service.js`): `createFecha`/`updateFecha`/`checkOverlap` use `sql.Date`; `duplicateFecha` uses `subtractOneDay()` + `sql.Date`.

**Backend** (`admin_service.js`): `restoreSnapshot` `sql.Date` for `pocFechaDesde` (1186), `CAST(valid_from AS DATE)` match (1188), period-close CAST (1203), `setUTCDate(-1)` day arithmetic (1221).

**config_service.js** (line 102): `sql.DateTime` already — no change.

## Affected Points (exhaustive checklist)

### DB Schema
| Point | File:Line | Status |
|-------|-----------|--------|
| `cfg_offer_dates.valid_from DATE` | `sql/data_model.sql:19` | NEEDS CHANGE |
| `cfg_offer_dates.valid_to DATE` | `sql/data_model.sql:20` | NEEDS CHANGE |
| `MRO_MOTORFECHA.DESDE_DT [datetime]` | `wf_data_model.sql:80` | Already datetime |
| `MRO_MOTORFECHA.HASTA_DT [datetime]` | `wf_data_model.sql:81` | Already datetime |
| `BORRAR_VIGENCIA_*` MRO_MOTORREGLA/MOTORPARAM | `wf_data_model.sql:151-152,175-176` | Already datetime |
| Schema migration script (POC) | (new) | NEEDS CREATE |

### Stored Procedures
| Point | File:Line | Status |
|-------|-----------|--------|
| `cfg_get_offers_and_params_json` (POC) `@DATE DATETIME` | `data_model.sql:92` | Already datetime |
| `cfg_get_offers_and_params_json` (sp_rules_params) `@DATE DATETIME` | `sp_rules_params.sql:135` | Already datetime |
| `cfg_get_offers_and_params_json` (WF) `@DATE DATETIME` | `wf_sp_cfg_get_offers_and_params_json.sql:124` | Already datetime |
| `cfg_get_offers_and_params_json_cached` `@DATE DATETIME` | `wf_sp_cfg_rules_cache.sql:56` | Already datetime |
| `cfg_get_workflow_snapshot_json` `@VIGENCIA_DESDE DATE` | `sql/workflow_snapshot.sql:33` | NEEDS CHANGE |
| `cfg_get_workflow_snapshot_json` `@VIGENCIA_HASTA DATE` | `sql/workflow_snapshot.sql:34` | NEEDS CHANGE |
| Exact-match filter `mf.DESDE_DT = @VIGENCIA_DESDE` | `sql/workflow_snapshot.sql:106,125` | NEEDS REDESIGN |
| `cfg_get_rules_json` (fallback) uses `GETDATE()` inline | `sp_rules_params.sql:82` | No DATE param — no change |

### Backend Services
| Point | File:Line | Status |
|-------|-----------|--------|
| `upsertMotorFecha` sql.Date desde | `admin_workflow_service.js:126` | NEEDS CHANGE |
| `upsertMotorFecha` sql.Date hasta | `admin_workflow_service.js:127` | NEEDS CHANGE |
| `upsertMotorFecha` CAST match query | `admin_workflow_service.js:133-134` | NEEDS REDESIGN |
| `upsertMotorFecha` sql.Date INSERT | `admin_workflow_service.js:143-144` | NEEDS CHANGE |
| `createWorkflowSnapshot` sql.Date VIGENCIA_DESDE | `admin_workflow_service.js:592` | NEEDS CHANGE |
| `createWorkflowSnapshot` sql.Date VIGENCIA_HASTA | `admin_workflow_service.js:593` | NEEDS CHANGE |
| `restoreSnapshot` sql.Date pocFechaDesde | `admin_service.js:1186` | NEEDS CHANGE |
| `restoreSnapshot` CAST(valid_from AS DATE) match | `admin_service.js:1188` | NEEDS REDESIGN |
| `restoreSnapshot` period-close CAST arithmetic | `admin_service.js:1203` | NEEDS REVIEW |
| `restoreSnapshot` `setUTCDate(-1)` day arithmetic | `admin_service.js:1221` | NEEDS REDESIGN |
| `createFecha` sql.Date | `admin_fechas_service.js:26-27` | NEEDS CHANGE |
| `updateFecha` sql.Date | `admin_fechas_service.js:53-54` | NEEDS CHANGE |
| `duplicateFecha` subtractOneDay + sql.Date | `admin_fechas_service.js:185-189` | NEEDS REDESIGN |
| `checkOverlap` sql.Date | `admin_fechas_service.js:299-300` | NEEDS CHANGE |
| `config_service.js` sql.DateTime `@DATE` | `config_service.js:102` | Already datetime |

### Validators
| Point | File:Line | Status |
|-------|-----------|--------|
| `validateFechaPayloadInternal` valid_from string check | `admin_validator.js:355-358` | NEEDS CHANGE — accept datetime format |
| `valid_to <= valid_from` string comparison | `admin_validator.js:363` | NEEDS REDESIGN — string comparison breaks with mixed formats |

### Frontend — Angular
| Point | File:Line | Status |
|-------|-----------|--------|
| `type="date"` valid_from (create/edit) | `offer-dates-page.component.html:118` | NEEDS CHANGE |
| `type="date"` valid_to (create/edit) | `offer-dates-page.component.html:126` | NEEDS CHANGE |
| `type="date"` duplicate dialog new-from | `offer-dates-page.component.html:181` | NEEDS CHANGE |
| `type="date"` publicarVigDesde | `configurator-page.component.html:753` | NEEDS CHANGE |
| `type="date"` publicarVigHasta | `configurator-page.component.html:757` | NEEDS CHANGE |
| `type="date"` snapshotVigDesde | `snapshots-page.component.html:158` | NEEDS CHANGE |
| `type="date"` snapshotVigHasta | `snapshots-page.component.html:162` | NEEDS CHANGE |
| `type="date"` restorePocFechaDesde | `snapshots-page.component.html:216` | NEEDS CHANGE |
| `type="date"` restoreVigDesde | `snapshots-page.component.html:223` | NEEDS CHANGE |
| `type="date"` restoreVigHasta | `snapshots-page.component.html:227` | NEEDS CHANGE |
| `substring(0, 10)` truncation in openEdit | `offer-dates-page.component.ts:107-108` | NEEDS CHANGE |
| Date display pipes `date:'dd/MM/yyyy'` | `offer-dates-page.component.html:12,19,58,59` | NEEDS UPDATE to include HH:mm |
| `localeCompare` sort on valid_from string | `offer-dates-page.component.ts:54` | Review — OK if ISO consistent |
| `AdminFechaItem.valid_from/valid_to: string` | `admin.models.ts:286-287` | Format contract only |
| `rangoDestino: { vigDesde; vigHasta }` | `admin.models.ts:347` | No type change |
| `AdminFechaPayload.valid_from/valid_to: string` | `admin.models.ts:296-297` | No type change |
| `type="date"` dateFrom/dateTo in snapshots list filter | `snapshots-page.component.html:16,20` | NOT affected (filters created_at) |

### Tests
| Point | File:Line | Status |
|-------|-----------|--------|
| `validateFechaCreatePayload` `YYYY-MM-DD` | `motor_fechas.test.js:17,27` | Update if format changes |
| `valid_to <= valid_from` string comparison tests | `motor_fechas.test.js:40-76` | WILL BREAK with datetime strings |
| Live DB test uses `sql.Date` for `@DATE` | `motor_fechas.test.js:183` | NEEDS CHANGE → sql.DateTime |
| Snapshot fixture `VIGENCIA_DESDE_DT: "2026-01-01"` | `workflow_snapshot_roundtrip.test.js:53,63` | Review (string value only) |

### Docs / Specs
| Point | File | Status |
|-------|------|--------|
| `valid_from DATE`, `valid_to DATE` schema refs | `openspec/specs/cfg-offer-dates/spec.md` | NEEDS DELTA UPDATE |
| Vigencia date semantics | `openspec/specs/workflow-deployment/spec.md:47` | NEEDS DELTA UPDATE |

## Key Risk — The sql.Date Decision (CRITICAL)

`upsertMotorFecha` does an **exact-match lookup** on `MRO_MOTORFECHA` before deciding whether to reuse a period ID or create a new one:

```js
existsReq.input("desde", sql.Date, desde);  // truncates to date-only
// query: CAST(DESDE_DT AS DATE) = CAST(@desde AS DATE)
```

This was a deliberate fix: `DESDE_DT` is `datetime`, so a stored row with a non-midnight time (e.g. `2026-01-01 14:32:00`) would never match a param bound as pure `2026-01-01 00:00:00`. The consequence was that every republish silently created a new `MOTORFECHA_ID`, accumulating orphan rows.

Two options for the upsert key under datetime:

- **Option 1 — keep CAST day matching** (preserve fix): day-granular upsert; two publishes the same calendar day share one MOTORFECHA row; no regression — but no real sub-day precision for MRO.
- **Option 2 — exact datetime matching**: needs guaranteed time normalization on every write path; any ms drift re-creates orphan rows. Viable only with strict truncation (e.g. `CONVERT(datetime, CONVERT(varchar(19), @desde, 120), 120)`).

Additionally: `cfg_get_workflow_snapshot_json` uses `mf.DESDE_DT = @VIGENCIA_DESDE` with DATE params — if DESDE_DT gains a time component and the param stays DATE, the filter returns zero rows. Most immediate breakage.

## Open Questions (must be answered before proposal)

1. **Semantic intent**: (a) display-only (store midnight, UI shows HH:mm cosmetically), (b) true sub-day activation (rules become active at a specific hour), or (c) audit timestamp only?
2. **WF engine matching**: does the engine match periods with `DESDE_DT <= execution_datetime`? The read SP (`wf_sp_cfg_get_offers_and_params_json.sql:153,163`) orders by `DESDE_DT DESC` and filters `<= @DATE` — so sub-day precision IS honored at read time.
3. **Timezone**: UTC or local (Europe/Madrid)? SQL Server `datetime` is timezone-naive.
4. **Precision**: minutes (HH:mm) or seconds? `datetime-local` defaults to minute precision.
5. **Snapshot filter semantics**: exact datetime match vs CAST-to-date for `cfg_get_workflow_snapshot_json`.
6. **Period-closing boundary**: `valid_to = nextDay 00:00:00` (exclusive next-day start) vs `nextDay - 1 day 23:59:59` (inclusive prev-day end). Current SP uses `valid_to > @DATE`.
7. **Existing data migration**: ALTER COLUMN DATE → DATETIME2 is backward-compatible (existing values become midnight) — confirm production migration plan.

## Approaches Sketch

| Approach | Description | Pros | Cons | Effort |
|----------|-------------|------|------|--------|
| **A — Display-only** | POC → DATETIME2(0), always store midnight. Frontend datetime-local but strip time before send. Keep CAST matching. | Zero regression. Minimal change. | Misleading UX; no sub-day precision. | Medium |
| **B — True datetime** | sql.Date → sql.DateTime throughout. Exact datetime upsert. Normalize to seconds. | Full precision, honest. | HIGH RISK: orphan rows on ms drift; period-closing redesign; timezone needed. | High |
| **C — Hybrid (recommended if sub-day needed)** | POC → DATETIME2(0). Backend → sql.DateTime. upsertMotorFecha keeps CAST day-granular upsert. Snapshot SP DATE → DATETIME + CAST filter. Period-close uses "next day 00:00:00". | POC gains real datetime; WF upsert stays safe; no orphan regression; snapshot SP fixed. | Two-environment interplay; validator + period-close redesign. | High-Medium |

**Pre-condition**: answers to OQ 1 and 2. If the WF engine only matches by day, Approach A wins and cuts scope ~40%. The read SP evidence suggests sub-day IS honored at read time.

## Risks
1. False-mismatch regression in `upsertMotorFecha` — highest risk.
2. `cfg_get_workflow_snapshot_json` breaks for non-midnight DESDE_DT if SP params stay DATE.
3. Period-closing arithmetic (`subtractOneDay`, `setUTCDate(-1)`) wrong with datetime.
4. `valid_to <= valid_from` string comparison wrong with mixed formats.
5. Timezone ambiguity — `GETDATE()` vs browser-local `datetime-local` vs UTC backend.
6. `cfg_offer_dates` ALTER COLUMN is production DDL — maintenance window.
7. 10 frontend inputs + 4 display pipes — broad regression surface.
