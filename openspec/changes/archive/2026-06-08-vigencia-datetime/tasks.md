# Tasks: vigencia-datetime (exact-second datetime end-to-end)

> Artifact store: hybrid | Delivery strategy: ask-on-risk | TDD: strict (`node --test`)

---

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 520–620 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (schema+SP+helper+pool) → PR 2 (backend services+validator) → PR 3 (frontend) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units → PR slices

| WU | Goal | Likely PR | Notes |
|----|------|-----------|-------|
| WU-01 | Migration SQL + data_model.sql update | PR 1 | No code deps; safe to land alone |
| WU-02 | SP `cfg_get_workflow_snapshot_json` DATETIME2 params | PR 1 | Co-ships with schema (schema-first, then SP) |
| WU-03 | `api/utils/vigencia.js` helper + RED tests | PR 2 base | Foundation for all WU ≥4 |
| WU-04 | `api/db/sql_client.js` `useUTC:false` | PR 2 | **Must ship WITH WU-05/06** — never split |
| WU-05 | `admin_fechas_service.js` bindings + period-close redesign | PR 2 | Depends WU-03, WU-04 |
| WU-06 | `admin_workflow_service.js` upsert + snapshot SP bindings | PR 2 | Depends WU-03, WU-04 |
| WU-07 | `admin_service.js` restoreSnapshot period-close | PR 2 | Depends WU-03, WU-04 |
| WU-08 | `admin_validator.js` temporal validation | PR 2 | Depends WU-03 |
| WU-09 | Frontend — Angular 10 inputs + display pipes + toVigenciaString | PR 3 | Depends PR 2 merged |
| WU-10 | Resolve open items: `HASTA_DT IS NULL` match + web spec seconds-quirk | PR 2/3 | Explicit debt tasks from design risks |

---

## Phase 1 — Schema & SP Foundation (PR 1)

### WU-01 — Migration script + data_model.sql

- [x] **1.1 RED** — Write test in `rule_set/test/motor_fechas.test.js` asserting `DATETIME2(0)` column metadata via `INFORMATION_SCHEMA.COLUMNS` (CA-COD-001). Mark `skip` if no live DB in CI; document as integration checkpoint.
- [x] **1.2 GREEN** — Create `rule_set/sql/migrations/001_vigencia_datetime.sql`: idempotent `IF` guard, `ALTER TABLE dbo.cfg_offer_dates ALTER COLUMN valid_from DATETIME2(0) NOT NULL`, `ALTER COLUMN valid_to DATETIME2(0) NULL`. Covers RF-COD-06; Escenario migración idempotente.
- [x] **1.3** — Update `rule_set/sql/data_model.sql` lines ~19-20: `valid_from DATETIME2(0) NOT NULL`, `valid_to DATETIME2(0) NULL`. Keeps fresh-install schema in sync.

### WU-02 — SP `cfg_get_workflow_snapshot_json` DATETIME2 params

- [x] **2.1 RED** — Add failing case to `rule_set/test/workflow_snapshot_roundtrip.test.js`: fixture `VIGENCIA_DESDE_DT = "2026-01-01T14:32:07"` (non-midnight) must be returned by SP exact-match. Assert non-empty result. Covers RF-VDT-04, CA-VDT-004.
- [x] **2.2 RED** — Add negative-path case: SP with midnight `00:00:00` does NOT match non-midnight row (documents old bug, proves test catches regression). Covers RF-VDT-04 negative scenario.
- [x] **2.3 GREEN** — Update `rule_set/sql/workflow_snapshot.sql` ~33-34, 106-107, 125-126: `@VIGENCIA_DESDE DATE`/`@VIGENCIA_HASTA DATE` → `DATETIME2(0)`; remove `CAST(... AS DATE)` from WHERE clauses; use exact `mf.DESDE_DT = @VIGENCIA_DESDE`. Covers INV-VDT-03.

---

## Phase 2 — Backend Services & Validator (PR 2)

> **All WUs in this phase ship as ONE PR.** `useUTC:false` (WU-04) and the `sql.DateTime2(0)` bindings (WU-05/06/07) are co-dependent per ADR-002/ADR-006. Splitting them mid-deploy corrupts data.

### WU-03 — `api/utils/vigencia.js` helper (pure, no DB)

- [x] **3.1 RED** — Create `rule_set/test/vigencia_utils.test.js`. Write failing tests for `normalizeVigenciaToSecond`: (a) `YYYY-MM-DDTHH:mm:ss` preserves local wall-clock components; (b) `YYYY-MM-DDTHH:mm` → appends `:00`; (c) legacy `YYYY-MM-DD` → midnight; (d) two inputs differing only in ms produce `===` Dates; (e) `null`/`""` → `null`. Covers ADR-001 belt-and-suspenders contract.
- [x] **3.2 RED** — Same file: failing tests for `parseVigencia`: (a) valid `YYYY-MM-DDTHH:mm:ss` returns epoch number; (b) `valid_to <= valid_from` → null/throws (for use in validator); (c) malformed string → null; (d) legacy `YYYY-MM-DD` accepted. Covers ADR-004, RF-COD-04.
- [x] **3.3 GREEN** — Create `rule_set/api/utils/vigencia.js` with `normalizeVigenciaToSecond(value)` and `parseVigencia(str)`. Local wall-clock parse (`new Date(y, m-1, d, h, mi, s)`). `.setMilliseconds(0)`. Covers INV-COD-02, INV-VDT-02.

### WU-04 — `api/db/sql_client.js` `useUTC:false`

- [x] **4.1** — In `buildSqlConfig()` (~line 16-19), add `useUTC: false` to `options`. Same in `buildWfSqlConfig()` (~line 38-41). Covers ADR-002; ships WITH WU-05/06/07.
- [x] **4.2** — Code-review note in commit: verify `created_at`/`alta_dt` display in snapshots page after deploy (MED risk per design §12). No code change required; document as acceptance checkpoint CA-VDT-007 extended.

### WU-05 — `admin_fechas_service.js` bindings + period-close

- [x] **5.1 RED** — Update `rule_set/test/motor_fechas.test.js` ~40-76: replace string-compare `valid_to <= valid_from` assertions with temporal epoch-millis expectations; add `THH:mm:ss` fixtures; change `sql.Date` bind assertion ~183 to `sql.DateTime2(0)`. Covers RF-COD-01/02/03, CA-COD-003.
- [x] **5.2 RED** — Add test: close-period sets `valid_to = valid_from_of_new_period` exactly (no `-1 day`). Covers INV-COD-04, Escenario A, CA-COD-010.
- [x] **5.3 GREEN** — `admin_fechas_service.js` ~26-27, 53-54, 184-189, 298-300: replace `sql.Date` → `sql.DateTime2(0)` with `normalizeVigenciaToSecond`; delete `subtractOneDay`; period-close = `valid_to = normalizeVigenciaToSecond(newValidFrom)`. Covers INV-COD-05, ADR-003.

### WU-06 — `admin_workflow_service.js` upsert + snapshot SP bindings

- [x] **6.1 RED** — `rule_set/test/workflow_publish.test.js`: add case asserting `upsertMotorFecha` SQL uses exact `DESDE_DT = @desde` (no `CAST ... AS DATE`); assert params bound as `sql.DateTime2(0)`. Add idempotency case (Escenario 05, CA-VDT-001). Covers RF-VDT-01/02/05, INV-VDT-01.
- [x] **6.2 RED** — `workflow_publish.test.js`: add midnight-compatibility case (Escenario 02, CA-VDT-008). Confirm `buildWfSafetySnapshotComment` string tests still pass with datetime strings (RF-VDT-06, CA-VDT-009).
- [x] **6.3** — **Explicit design open item (a)**: inspect `upsertMotorFecha` WHERE clause for `HASTA_DT IS NULL` vs `= NULL` in upsert match — ALREADY CORRECT: `(@hasta IS NULL AND HASTA_DT IS NULL)`. No code change needed; documented in WU-06 commit.
- [x] **6.4 GREEN** — `admin_workflow_service.js` ~126-149: `sql.DateTime2(0)` + `normalizeVigenciaToSecond`; exact `DONDE DESDE_DT = @desde` (drop `CAST(DESDE_DT AS DATE)`). Lines ~592-593: SP params `sql.DateTime2(0)` + `normalizeVigenciaToSecond`. Covers RF-VDT-01/02/04, INV-VDT-01/02/04, CA-VDT-005/006.

### WU-07 — `admin_service.js` restoreSnapshot period-close

- [x] **7.1 RED** — `rule_set/test/wf_restore_transform.test.js` (or new `restore_snapshot.test.js`): assert `restoreSnapshot` period-close sets `valid_to = @fecha` exactly; assert next-period cap = `nextFrom` exactly (no `setUTCDate(-1)`); assert no `CAST(... AS DATE)` in generated SQL. Covers ADR-003, CA-COD-009, CA-COD-010 restoreSnapshot path.
- [x] **7.2 GREEN** — `admin_service.js` ~1186-1232: `sql.DateTime2(0)` + `normalizeVigenciaToSecond`; `SET valid_to = @fecha` (drop `CAST(... AS DATE)` and `DATEADD(day,-1,...)`); `valid_from > @fecha` next-period lookup; `newValidTo = nextFrom` (drop `setUTCDate(-1)`). Covers ADR-003.

### WU-08 — `admin_validator.js` temporal validation

- [x] **8.1 RED** — `rule_set/test/motor_fechas.test.js` (or dedicated validator test): failing cases for RF-COD-04 — `valid_to < valid_from` rejected (400); `valid_to == valid_from` rejected (400); `valid_to = valid_from + 1s` accepted; lexicographic-trick case (`2026-10-01` vs `2026-09-30`) rejected correctly. Covers CA-COD-004.
- [x] **8.2 GREEN** — `admin_validator.js` ~355-365: add `parseVigencia` import from `vigencia.js`; replace lexical `valid_to <= valid_from` with `parseVigencia(to) <= parseVigencia(from)`. Accept `YYYY-MM-DDTHH:mm:ss` and `YYYY-MM-DD`. Reject malformed. Covers ADR-004, RF-COD-04, RNF-COD-03.

---

## Phase 3 — Frontend (PR 3)

### WU-09 — Angular 10 datetime-local inputs + pipes + toVigenciaString

- [x] **9.1** — **Explicit design open item (b)**: add web spec (Karma/Jasmine) for `toVigenciaString`: (a) value with no seconds → appends `:00`; (b) value with seconds → unchanged; (c) never calls `.toISOString()`. Covers ADR-005, design risk "Angular seconds-omission quirk (MED)".
- [x] **9.2** — `offer-dates-page.component.ts`: add `toVigenciaString(val: string): string` helper; `openEdit` ~107-108 change `substring(0, 10)` → `substring(0, 19)` + replace space with `T`; apply `toVigenciaString` in payload assembly. Covers RF-COD-03/05, CA-COD-006.
- [x] **9.3** — `offer-dates-page.component.html`: change 3 date inputs to `<input type="datetime-local" step="1">`; change display pipes `date:'dd/MM/yyyy'` → `date:'dd/MM/yyyy HH:mm:ss'` on `valid_from`/`valid_to` columns. Covers RF-COD-05, CA-COD-006/007.
- [x] **9.4** — `configurator-page.component.html` ~753, 757: 2 vigencia inputs → `datetime-local step="1"`; apply `toVigenciaString` in payload. Covers ADR-005 scope.
- [x] **9.5** — `snapshots-page.component.html` ~158, 162, 216, 223, 227: 5 vigencia inputs → `datetime-local step="1"`; leave `dateFrom`/`dateTo` (`created_at` filter) as `type="date"` unchanged. Covers ADR-005.
- [x] **9.6** — `admin.models.ts`: add format-contract comment `// YYYY-MM-DDTHH:mm:ss local wall-clock` on vigencia string fields. Covers ADR-005 docs.

---

## Phase 4 — Integration Verification

- [ ] **10.1** — Run `npm test` from `rule_set/`: all existing tests green + new tests green. Covers CA-VDT-010.
- [ ] **10.2** — Verify round-trip: POST `valid_from="2026-03-15T14:32:07"`, GET → same value back. Covers CA-COD-005, Escenario C.
- [ ] **10.3** — Verify no `sql.Date` binding remains for vigencia fields: `rg "sql\.Date" rule_set/api/services/admin_fechas_service.js rule_set/api/services/admin_workflow_service.js rule_set/api/services/admin_service.js`. Covers CA-COD-003, CA-VDT-005.
- [ ] **10.4** — Manual smoke: open `/offer-dates` — confirm inputs are `datetime-local`, table shows `HH:mm:ss`, create non-midnight period, close previous period verifies `valid_to = valid_from_new` exactly. Covers CA-COD-006/007/009/010.
- [ ] **10.5** — Verify `cfg_config_snapshot.created_at` display in `/snapshots` after `useUTC:false` switch — visual regression check. Covers design risk §12 MED.

---

## Dependency Graph

```
WU-01 ──────────────────────────────────────────── PR 1 (independent)
WU-02 ──────────────────────────────────────────── PR 1 (independent)

WU-03 ──┐
WU-04 ──┼── WU-05, WU-06, WU-07, WU-08 ─────────── PR 2 (atomic deploy)
        │   (all in same PR, useUTC co-dep)
        └── WU-08 (validator, depends WU-03 only)

WU-09 ───────────────────────────────────────────── PR 3 (depends PR 2 merged)
```

Parallel within PR 2: WU-05, WU-06, WU-07, WU-08 can be implemented concurrently once WU-03 and WU-04 exist in the branch. They must all be in the same PR (cannot split `useUTC:false` from the datetime bindings).

---

## Spec → WU traceability

| Spec requirement | WU |
|------------------|----|
| RF-COD-01 (DATETIME2 column) | WU-01, WU-05 |
| RF-COD-02 (overlap at second) | WU-05 |
| RF-COD-03 (edit preserves time) | WU-05, WU-09 |
| RF-COD-04 (temporal validator) | WU-08 |
| RF-COD-05 (datetime-local step=1) | WU-09 |
| RF-COD-06 (migration idempotent) | WU-01 |
| INV-COD-04 (close = exact next from) | WU-05, WU-07 |
| INV-COD-05 (no sql.Date) | WU-04, WU-05, WU-06, WU-07 |
| RF-VDT-01 (upsert exact second) | WU-06 |
| RF-VDT-02 (replace WF-tool period) | WU-06 |
| RF-VDT-03 (distinct datetime = new row) | WU-06 |
| RF-VDT-04 (SP DATETIME2 params) | WU-02 |
| RF-VDT-05 (normalize on every write) | WU-03, WU-05, WU-06, WU-07 |
| RF-VDT-06 (snapshot unaffected) | WU-06 (no-change assertion) |
| ADR-002 (useUTC:false) | WU-04 |
| Design open (a): HASTA_DT IS NULL match | WU-06.3 |
| Design open (b): web spec seconds-quirk | WU-09.1 |
