# Design: Vigencia desde/hasta as exact-second datetime, end-to-end

> SDD design phase for change `vigencia-datetime`. Reads: proposal (engram #135 / `proposal.md`), scope-decisions (#134), explore (#133 / `explore.md`). Artifact store: hybrid.

## 1. Executive summary

Promote vigencia `desde`/`hasta` from day-granular `DATE` to true second-precision datetime end-to-end. Period identity becomes the exact `DESDE_DT` to the second so deploy/republish SUBSTITUTES the externally-created WF-tool period instead of orphaning a parallel `MRO_MOTORFECHA` row. The orphan-row safety that `sql.Date` provided is replaced by a single, pinned **truncate-to-second normalization invariant** applied identically on every write path and in the snapshot SP match. Timezone stays server-LOCAL naive — which forces a CRITICAL `mssql` pool config change (`useUTC: false`) that does not exist today.

## 2. Architecture approach

- **Pattern**: no new layers. This is a cross-cutting type/precision migration through the existing layered stack (SQL schema → SP → backend service → validator → Angular). The architectural lever is a single canonical normalization rule, owned in ONE place, reused everywhere a vigencia is bound or matched.
- **Boundary decision**: normalization is enforced at the **driver-binding boundary** (backend service, via `sql.DateTime2` scale 0) and mirrored at the **SQL match boundary** (column type + SP param type both `DATETIME2(0)`). The DB column type IS the truncation enforcer — JS never has to hand-truncate sub-second, because `DATETIME2(0)` rounds on store and the param type matches on read.
- **Invariant ownership**: a single backend helper `normalizeVigenciaToSecond(value)` produces the canonical `Date` (truncated to whole seconds, interpreted as local wall-clock). Every `request.input(...)` for a vigencia binds `sql.DateTime2(0)` with the output of that helper. The DB column and every SP param are `DATETIME2(0)`. Because store-side rounding and bind-side type are identical, the value INSERTed and the value later MATCHed are byte-identical.

## 3. The crux: truncation mechanism (ADR-001)

**Decision**: Option (c) + (a) combined — declare the column and every SP/query param as `DATETIME2(0)`, and bind via `sql.DateTime2(0)` with a JS `Date` already truncated to whole seconds by `normalizeVigenciaToSecond`. Do NOT use Option (b) (`CONVERT(varchar(19),...,120)` string round-trip) — it is fragile, locale-sensitive, and scatters truncation logic into SQL strings.

**Why**:
- `DATETIME2(0)` has exactly second resolution; storing any value rounds to the nearest second deterministically. The column type is the single source of truncation truth — no sub-second drift can survive a write.
- Binding `sql.DateTime2` with scale 0 tells the driver to send the value as `datetime2(0)`, so the parameter the SQL engine compares is already second-truncated — the MATCH side and the STORE side use the same type, guaranteeing byte-identical comparison.
- The JS-side `normalizeVigenciaToSecond` is belt-and-suspenders: it zeroes milliseconds before binding so the `Date` we send and the `Date` we'd round to are the same, eliminating any half-second rounding ambiguity between two writes of "the same" instant.

**`normalizeVigenciaToSecond` contract** (new, in a shared util e.g. `api/utils/vigencia.js`):
- Accepts: `Date`, ISO string `YYYY-MM-DDTHH:mm:ss`, `YYYY-MM-DDTHH:mm`, or legacy `YYYY-MM-DD`.
- Parses as **local wall-clock** (NOT UTC): for a string, construct so the components are taken verbatim as local time (e.g. `new Date(y, mo-1, d, h, mi, s)` from parsed parts — never `new Date("...Z")` and never rely on `Date.parse` of a bare date which is UTC midnight).
- Returns a `Date` with `.setMilliseconds(0)`.
- `null`/empty → `null` (open-ended `hasta`).

**Applied at**:
| Site | File | Binding |
|------|------|---------|
| `upsertMotorFecha` match SELECT | `admin_workflow_service.js` ~126-135 | `sql.DateTime2(0)`, exact `DESDE_DT = @desde` (drop `CAST(... AS DATE)`) |
| `upsertMotorFecha` INSERT | `admin_workflow_service.js` ~143-149 | `sql.DateTime2(0)` |
| `createWorkflowSnapshot` SP params | `admin_workflow_service.js` ~592-593 | `sql.DateTime2(0)` |
| `cfg_get_workflow_snapshot_json` filter | `sql/workflow_snapshot.sql` ~33-34,106-107,125-126 | params `DATETIME2(0)`, exact `mf.DESDE_DT = @VIGENCIA_DESDE` |
| `cfg_offer_dates` CRUD (create/update/duplicate/overlap) | `admin_fechas_service.js` | `sql.DateTime2(0)` |
| `restoreSnapshot` POC fechas | `admin_service.js` ~1186-1232 | `sql.DateTime2(0)`, exact `valid_from = @fecha` (drop `CAST(... AS DATE)`) |

**Read SPs (`cfg_get_offers_and_params_json` POC + WF, `_cached`, `sp_rules_params`)**: keep `@DATE DATETIME`. They use **range** semantics (`DESDE_DT <= @DATE AND (HASTA_DT IS NULL OR HASTA_DT > @DATE)`), not equality. `DATETIME`'s 3.33 ms rounding is HARMLESS here: a 3 ms shift of the *as-of* probe instant cannot cross a second-aligned period boundary in practice, and the boundary is half-open so there is no double-count. **No change required to read SPs.** (Optional hardening: upgrade to `DATETIME2(0)` for consistency, but it is NOT load-bearing and is OUT of the minimal change.) The ONLY SP that needs the type change is `cfg_get_workflow_snapshot_json`, because it does **exact equality** matching where rounding IS fatal.

## 4. mssql driver binding & the useUTC finding (ADR-002)

**Finding (CRITICAL)**: `api/db/sql_client.js` `buildSqlConfig()` / `buildWfSqlConfig()` set `options: { encrypt, trustServerCertificate }` only. They do NOT set `useUTC`. The `mssql`/`tedious` driver defaults to **`useUTC: true`**. That means today a JS `Date` is sent to SQL Server converted to UTC, and datetime values read back are interpreted as UTC. For the current `sql.Date` path this is invisible (date-only, no time), but the moment we send second-precision local times it will SHIFT every vigencia by the server's UTC offset (e.g. +1/+2h in Europe/Madrid) — which would make our stored `DESDE_DT` NEVER equal the WF tool's `GETDATE()`-based local value. That breaks the entire replace-to-match purpose.

**Decision**: set `options.useUTC = false` in BOTH `buildSqlConfig()` and `buildWfSqlConfig()`. With `useUTC: false`, the driver sends/reads datetime components as-is against the machine's local timezone, matching the WF tool's `GETDATE()` (server local). Combined with `normalizeVigenciaToSecond` parsing strings as local wall-clock, the wall-clock the user types is the wall-clock stored is the wall-clock the WF tool wrote.

**Binding type**: `sql.DateTime2` with scale 0 → `request.input("desde", sql.DateTime2(0), normalizeVigenciaToSecond(desde))`. (`mssql` exposes `sql.DateTime2(scale)`.) Do NOT use `sql.DateTime` for vigencia writes (it is the legacy 3.33 ms type and would reintroduce rounding mismatch on equality compares).

**Risk note**: `useUTC: false` is process-wide for the pool and affects ALL datetime columns read/written through these pools (e.g. `alta_dt`, snapshot `created_at`). Those are display/audit timestamps already written by `GETDATE()`/`SYSDATETIME()` server-side, so reading them as local is actually MORE correct. No functional regression expected, but verify `created_at` display in the snapshots page after the switch (it currently relies on whatever the default produced).

## 5. Period-closing boundary (ADR-003)

**Decision**: closing an open period sets `valid_to`/`HASTA_DT` = the next period's `valid_from`/`DESDE_DT` **EXACTLY** (half-open interval `[from, to)`). Eliminate all `-1 day` arithmetic.

**Why it is correct and gapless**: every read SP uses `DESDE_DT <= @DATE AND (HASTA_DT IS NULL OR HASTA_DT > @DATE)`. The upper bound is **strict `>`**, so at the boundary instant `T` the closing period (`HASTA_DT = T`) is excluded and the next period (`DESDE_DT = T <= T`) is included. No gap, no overlap, no double-count at the exact second. Confirmed: no read SP uses `>=` on the upper bound — `cfg_get_offers_and_params_json` (POC+WF) and the cached wrapper all use `HASTA_DT > @DATE`. The `checkOverlap` predicate in `admin_fechas_service.js` (`@validFrom < valid_to AND valid_from < @validTo`) is already strict-less-than and therefore already treats touching endpoints as non-overlapping — it works unchanged with exact-datetime closing.

**Redesign — these helpers disappear / change**:
- `admin_fechas_service.js::subtractOneDay` → DELETE. In `duplicateFecha`, close source with `valid_to = normalizeVigenciaToSecond(newValidFrom)` (the new period's exact start), bound `sql.DateTime2(0)`.
- `admin_service.js::restoreSnapshot` period-close (`SET valid_to = DATEADD(day,-1,CAST(@fecha AS DATE))`) → `SET valid_to = @fecha` (exact, `sql.DateTime2(0)`), dropping the `CAST(... AS DATE)`.
- `admin_service.js::restoreSnapshot` next-period cap (`d.setUTCDate(d.getUTCDate()-1)`, lines ~1219-1222) → `newValidTo = nextFrom` exactly (the next period's `valid_from`), no day subtraction. The `CAST(valid_from AS DATE) > CAST(@fecha AS DATE)` next-period lookup becomes `valid_from > @fecha`.

## 6. Validator (ADR-004)

**Decision**: accept ISO datetime `YYYY-MM-DDTHH:mm:ss` (and tolerate `YYYY-MM-DDTHH:mm` and legacy `YYYY-MM-DD`). Replace the **lexical** `valid_to <= valid_from` string comparison with a **temporal** comparison: parse both with the same local-wall-clock parser used by `normalizeVigenciaToSecond` and compare the resulting epoch millis. Reject when `to <= from` (equal start=end is invalid). Reject malformed strings explicitly (today any non-empty string silently passes).

**Where**: `admin_validator.js::validateFechaPayloadInternal` ~355-365. Add a small `parseVigencia(str): number | null` used for both format validation and ordering. Keep the helper pure (no DB, no mssql) so it is unit-testable RED-first.

**Why temporal not lexical**: lexical compare of `2026-06-01T09:00:00` vs `2026-06-01` is unreliable once formats mix; and `2026-06-01T09:00` < `2026-06-01T9:00` lexical bugs vanish with epoch compare.

## 7. Frontend (ADR-005)

**Decision**: the 10 vigencia inputs become `<input type="datetime-local" step="1">` (the `step="1"` enables seconds in the picker). The 2 snapshot-list filter inputs (`dateFrom`/`dateTo`, filter on `created_at`) stay `type="date"` — they are NOT vigencia.

**String contract** (backend boundary): backend expects `YYYY-MM-DDTHH:mm:ss` local wall-clock. Angular `datetime-local` quirks:
- The control value is `YYYY-MM-DDTHH:mm` (no seconds) when `step` is minute-granular, and `YYYY-MM-DDTHH:mm:ss` once `step="1"` and seconds are entered — but the browser MAY omit `:ss` when seconds are `00`. So the frontend MUST normalize before sending: if the value has no seconds component, append `:00`. Centralize in a tiny `toVigenciaString(controlValue)` helper.
- The value is ALREADY local wall-clock (no timezone suffix) — exactly what we want. Do NOT call `.toISOString()` (that converts to UTC and reintroduces the shift).

**Specific fixes**:
- `offer-dates-page.component.ts::openEdit` ~107-108: `fecha.valid_from.substring(0, 10)` → `substring(0, 19)` (keep date+time), and ensure the bound value matches the `datetime-local` expected format (`YYYY-MM-DDTHH:mm:ss`). If the backend returns a space separator (`YYYY-MM-DD HH:mm:ss`), replace the space with `T` for the control.
- `sortedFechas` `localeCompare` on `valid_from` (line ~55): still works IF the format is consistently `YYYY-MM-DDTHH:mm:ss` (lexicographic == chronological for fixed-width ISO). Keep but verify format consistency from the API.
- Display pipes `date:'dd/MM/yyyy'` → `date:'dd/MM/yyyy HH:mm:ss'` on the offer-dates table and any vigencia display in configurator/snapshots pages.
- `admin.models.ts`: no TS type change (all already `string`), but document the format contract in a comment.

**Files**: `offer-dates-page.component.html` (3 inputs + display pipes), `offer-dates-page.component.ts` (openEdit, helper), `configurator-page.component.html` (2 inputs), `snapshots-page.component.html` (5 inputs), and the corresponding `.ts` signal/payload assembly that must apply `toVigenciaString`.

## 8. Migration (ADR-006)

**Decision**: `ALTER TABLE dbo.cfg_offer_dates ALTER COLUMN valid_from DATETIME2(0) NOT NULL;` and `ALTER COLUMN valid_to DATETIME2(0) NULL;` Backward-compatible — existing `DATE` values widen to midnight `00:00:00`, no data loss. Also update `sql/data_model.sql` definition to `DATETIME2(0)` for fresh installs.

**Sequencing** (deploy order to avoid a broken intermediate state):
1. Apply column ALTER + redeploy `cfg_get_workflow_snapshot_json` (DATETIME2(0) params). Old backend (still binding `sql.Date`) keeps working against widened columns (date binds to midnight datetime2 fine).
2. Deploy backend (normalization helper + `useUTC:false` + `sql.DateTime2(0)` bindings + exact-match upsert + period-close redesign).
3. Deploy frontend (datetime-local inputs).

This order means the schema/SP step is independently safe, and the backend step is what actually flips behavior. `useUTC:false` must ship in the SAME backend deploy as the datetime bindings — never split them.

**Rollback**: revert backend commits (restore `sql.Date` + remove `useUTC`); `ALTER COLUMN ... DATE` truncates time (data loss unless all values are confirmed midnight). Snapshot-restore remains available for config rollback.

## 9. File-by-file change map

| Layer | File | Change |
|-------|------|--------|
| Schema | `sql/data_model.sql` ~19-20 | `valid_from`/`valid_to` → `DATETIME2(0)` |
| Migration | `sql/migrations/NNN_vigencia_datetime.sql` (new) | `ALTER COLUMN` both columns |
| SP (exact-match) | `sql/workflow_snapshot.sql` ~33-34 | `@VIGENCIA_DESDE/HASTA DATE` → `DATETIME2(0)`; keep exact `=` match (lines 106-107, 125-126) |
| SP (range) | read SPs | NO CHANGE (range semantics, rounding harmless) — optional `DATETIME2(0)` hardening out of scope |
| DB config | `api/db/sql_client.js` ~16-19, 38-41 | add `useUTC: false` to both pool `options` |
| Util (new) | `api/utils/vigencia.js` | `normalizeVigenciaToSecond`, `parseVigencia` (pure, local wall-clock) |
| Backend | `api/services/admin_workflow_service.js` ~126-149 | `upsertMotorFecha`: `sql.DateTime2(0)` + exact `DESDE_DT = @desde` (drop CAST day-match) |
| Backend | `api/services/admin_workflow_service.js` ~592-593 | `createWorkflowSnapshot`: SP params `sql.DateTime2(0)` + normalize |
| Backend | `api/services/admin_fechas_service.js` ~26-27,53-54,184-189,298-300 | `sql.DateTime2(0)` everywhere; delete `subtractOneDay`; close = exact next `valid_from` |
| Backend | `api/services/admin_service.js` ~1186-1232 | `restoreSnapshot`: `sql.DateTime2(0)`, exact `valid_from = @fecha`, close=exact, drop `setUTCDate(-1)` and `CAST(... AS DATE)` |
| Validator | `api/validators/admin_validator.js` ~355-365 | accept datetime format; temporal `to <= from` via `parseVigencia` |
| Frontend | `web/.../offer-dates-page.component.html` | 3 inputs → `datetime-local step="1"`; display pipes `dd/MM/yyyy HH:mm:ss` |
| Frontend | `web/.../offer-dates-page.component.ts` ~107-108 | openEdit `substring(0,19)` + `T` separator; `toVigenciaString` helper |
| Frontend | `web/.../configurator-page.component.html` ~753,757 | 2 inputs → `datetime-local step="1"` |
| Frontend | `web/.../snapshots-page.component.html` ~158,162,216,223,227 | 5 inputs → `datetime-local step="1"`; leave dateFrom/dateTo as `date` |
| Frontend | `web/.../admin.models.ts` | format-contract comments only |
| Spec delta | `openspec/specs/cfg-offer-dates/spec.md` | `DATE` → `DATETIME2(0)` second precision |
| Spec delta | `openspec/specs/workflow-deployment/spec.md` ~47 | period identity = exact second |

## 10. Test strategy (Strict TDD, `node --test`)

**RED-first pure unit-testable helpers** (no DB):
1. `normalizeVigenciaToSecond` — new spec: truncates ms to 0; parses `YYYY-MM-DDTHH:mm:ss`, `...THH:mm`, and `YYYY-MM-DD` as LOCAL wall-clock (assert components, not UTC); two inputs differing only in sub-second produce equal Dates; `null`/`""` → `null`.
2. `parseVigencia` / validator temporal comparison — assert `to <= from` rejected including the equal-instant case; malformed string rejected; `YYYY-MM-DDTHH:mm:ss` accepted; legacy `YYYY-MM-DD` accepted.
3. Period-boundary helper (the close-to-next-start logic, if extracted as a pure function) — assert close value == next `valid_from` exactly, no -1 day.
4. Frontend `toVigenciaString` — appends `:00` when seconds absent; preserves seconds when present; never converts to UTC.

**Existing tests that change**:
- `test/motor_fechas.test.js`: string-compare `valid_to <= valid_from` tests (~40-76) rewrite to temporal expectations; create-payload fixtures gain `THH:mm:ss`; the live-DB `sql.Date` bind (~183) → `sql.DateTime2(0)`.
- `test/workflow_publish.test.js`: `buildWfSafetySnapshotComment` string tests — verify they still hold with datetime strings (comment text format).
- `test/workflow_snapshot_roundtrip.test.js`: fixture `VIGENCIA_DESDE_DT: "2026-01-01"` (~53,63) → add a non-midnight case `"2026-01-01T14:32:07"` and assert the SP exact-match still returns the row; add a regression case proving a midnight-only param does NOT match a non-midnight `DESDE_DT` under the OLD behavior vs DOES under the new normalized path.

**Web specs**: update offer-dates / configurator / snapshots component specs for the `datetime-local` input value handling and `toVigenciaString` normalization.

## 11. ADR index

- ADR-001 Truncation = `DATETIME2(0)` column + `sql.DateTime2(0)` bind + JS ms-zeroing helper. Rejected: SQL `CONVERT(varchar(19))` round-trip (fragile, scattered), pure-JS hand-truncation without column guarantee (drift risk).
- ADR-002 `useUTC: false` on both pools. Rejected: leaving driver default `useUTC:true` (shifts every vigencia by server UTC offset — breaks WF replace-to-match).
- ADR-003 Half-open interval, close = exact next start. Rejected: `-1 day` close (gap at boundary day), end-of-day `23:59:59` (arbitrary, leaves a 1-second gap, fails strict `>` boundary cleanliness).
- ADR-004 Temporal validator comparison. Rejected: keep lexical string compare (breaks on mixed formats).
- ADR-005 `datetime-local step="1"`, normalize seconds, never `.toISOString()`. Rejected: keep `type="date"` (no time capture), send ISO-UTC (timezone shift).
- ADR-006 `ALTER COLUMN ... DATETIME2(0)` backward-compatible, schema/SP first then backend then frontend. `useUTC` ships WITH datetime bindings, never split.

## 12. Risks

- **`useUTC` default is `true` today (HIGH)** — if `useUTC:false` is NOT shipped in the same deploy as the datetime bindings, every vigencia shifts by the server UTC offset and the WF replace-to-match silently orphans rows again. Mitigation: ADR-002 + ADR-006 sequencing; add a roundtrip test asserting a written local wall-clock reads back identical.
- **Orphan-row regression (HIGH)** — only prevented if the normalization invariant is applied on EVERY write + the exact-match snapshot SP. Mitigation: single helper, exhaustive file map §9, roundtrip test.
- **`useUTC:false` side effects on audit timestamps (MED)** — `alta_dt`/`created_at` now read as local. Likely more correct, but verify snapshot/offer-dates timestamp display post-switch.
- **Angular `datetime-local` seconds-omission quirk (MED)** — browser drops `:00` seconds; mitigated by `toVigenciaString`. Needs web spec coverage.
- **Read-SP rounding assumption (LOW)** — leaving read SPs as `DATETIME` relies on range+strict-`>` making 3.33 ms harmless. Validated by boundary analysis; flagged if any future read SP switches to `=` or `>=`.
- **Open question carried from proposal**: confirm the WF tool stores LOCAL (not UTC). If it stores UTC, ADR-002 flips to `useUTC:true` and the helper must parse as UTC. Proceeding under confirmed-local assumption.
