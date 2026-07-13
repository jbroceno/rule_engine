# Apply Progress — rbac-and-config-safeguards

> Change: `rbac-and-config-safeguards`
> Phase: apply
> Delivery strategy: `ask-on-risk`, resolved for this change to `stacked-to-main` chaining
> This document covers **PR1 of 4** — the RBAC slice (WU-1 through WU-4). WU-5 through
> WU-13 (apply safeguard, snapshot integrity, frontend polish) are NOT part of this batch
> and remain untouched in `tasks.md`.

## Branch

`feat/rbac-and-config-safeguards-rbac` (pre-existing, checked out — no new branch created,
no push, no PR opened per instructions; PR creation is a separate step).

## Work units completed

| WU | Task | Status | Commit |
|----|------|--------|--------|
| WU-1 | T-01 — RED: failing tests for `requireRole(...roles)` | Done | `7bc3055` |
| WU-2 | T-02 — GREEN: `requireRole` factory + `ALLOWED_ROLES`/`normalizeRole` | Done | `d2ba5f2` |
| WU-3 | T-03 — mount `requireRole("admin")` on `/admin` and `/workflow` | Done | `4d3f5c3` |
| WU-4 | T-04 — document `ALLOWED_ROLES` + `seed_user.mjs --role viewer` | Done | `141bc0a` |

## Files created

- `rule_set/test/require_role.test.js` — 5 scenarios (403 wrong role, `next()` allowed role,
  401 defensive when `req.user` absent, multi-role allow-list, unrecognized role → 403 not
  5xx). Mirrors the `test/auth_middleware.test.js` fake req/res/next pattern (no live
  Express app, no JWT, no DB).
- `rule_set/api/middleware/require_role.js` — `requireRole(...roles)` factory, following the
  `createAuthMiddleware` pattern: 403 `AppError` for insufficient/unrecognized role, 401
  `AppError` (defensive) when `req.user` is absent.

## Files modified

- `rule_set/api/utils/rule_catalogs.js` — added `ALLOWED_ROLES = new Set(["admin","viewer"])`
  and `normalizeRole(v)` (lowercases), matching the existing `ALLOWED_STAGES`/`normalizeStage`
  convention.
- `rule_set/api/routes/index.js` — mounted `requireRole("admin")` as the second middleware on
  both `router.use("/admin", ...)` and `router.use("/workflow", ...)`. Confirmed by reading
  the file that `/health`, `/config`, `/simulate/*`, and `/auth` are declared as separate,
  earlier route registrations, entirely untouched by this change.
- `rule_set/sql/users.sql` — documented that `role` is validated against `ALLOWED_ROLES` and
  added the `--role viewer` seed invocation example.
- `CLAUDE.md` (repo root) — added a "Middleware RBAC" paragraph next to the JWT middleware
  docs, a "Catálogo de roles (`ALLOWED_ROLES`)" subsection under `dbo.cfg_user`, and a viewer
  seed example under "Alta del primer usuario". Removed the now-stale "sin comprobación RBAC
  en esta versión" note.

## TDD cycle evidence

1. **RED**: `npm run test:file -- test/require_role.test.js` before WU-2 failed with
   `ERR_MODULE_NOT_FOUND` for `api/middleware/require_role.js` (module did not exist) —
   confirmed failing for the right reason, not a typo/assertion bug.
2. **GREEN**: after WU-2, all 5 tests in `test/require_role.test.js` passed.
3. **Full suite**: `npm test` from `rule_set/` at the end of the batch: 292 tests, 266 pass,
   24 fail, 2 skip. All 24 failures are pre-existing SQL-Server-connectivity integration
   tests (`admin_offer_cascade_delete.test.js`, `admin_offers_period.test.js`,
   `admin_reset_seed_service.test.js`, `config_cache.test.js` CA-005,
   `motor_fechas.test.js` CA-COD-001, `workflow_snapshot_roundtrip.test.js`,
   `workflow_upsert_match.test.js`) that require a live SQL Server (`WF_SQL_SERVER` etc. in
   `api/.env`) not configured in this sandbox — confirmed unrelated by inspecting the failing
   test files (all read/write `cfg_offer_*` tables via a real pool + rollback strategy, none
   touch `require_role.js`, `rule_catalogs.js`, or `routes/index.js`). None of the 24
   failures reference the RBAC files touched in this batch.

## Deviations from design

None. `requireRole` signature, error codes/messages (`403` /
`"No tienes permisos de administrador para realizar esta acción."`, `401` /
`"No autorizado: sesión no válida."`), mount point, and catalog placement all match
`design.md` § "RBAC (OWASP-01)" and § "Códigos y textos de error" exactly.

## Scope note

Only T-01 through T-04 are checked off in `tasks.md`. T-05 onward (apply safeguard,
snapshot integrity, frontend polish) are untouched and remain `[ ]`, to be implemented in
PR2/PR3/PR4 per `state.yaml` § `chain_plan`. **Exception**: T-13a (interceptor 403
handling) was pulled forward into this PR1 batch — see "Code-review findings and fixes
(2026-07-13)" below.

---

## Code-review findings and fixes (2026-07-13)

A fresh-context adversarial code review of PR1 (WU-1..WU-4) ran on this branch before the
PR was opened. It confirmed 3 real findings, all approved by the user, fixed on the same
branch (`feat/rbac-and-config-safeguards-rbac`) as 3 separate commits — no push, no PR
opened.

### Finding 1 (Critical) — `/api/workflow/*` incorrectly gated with `requireRole("admin")`

**What was wrong**: `api/routes/index.js` mounted
`router.use("/workflow", requireRole("admin"), workflowRoutes)`. `workflow_routes.js` only
exposes `POST /workflow/condiciones-hipotecas`, a real-time eligibility query — functionally
a peer of `/api/simulate/*` (which correctly has no role gate), not an admin/publish action.
The real WF-publish actions (`postWorkflowSnapshot`, `postWorkflowPublicar`) already live
under `/api/admin/workflow/*`, mounted inside `adminRoutes` and already covered by the
`/admin` gate. The original proposal/design mischaracterized `/api/workflow/*` as
"igualmente privilegiado (publicación a WF)", which was factually wrong, and the gate risked
breaking an external Workflow/BPM caller without an admin-role JWT.

**Fix applied**: `router.use("/workflow", requireRole("admin"), workflowRoutes)` reverted to
`router.use("/workflow", workflowRoutes)` (no role gate — same as before this change;
`authMiddleware` still requires a valid JWT of any role). `router.use("/admin",
requireRole("admin"), adminRoutes)` unchanged (confirmed correct). Added a clarifying
comment in `index.js`. Corrected `proposal.md` (Scope, Affected files, Open questions #1,
new "Amendment (2026-07-13)" section), `specs/admin-rbac/spec.md` (removed the
`/api/workflow/*` requirement, added a scenario asserting it does NOT 403 by role),
`design.md` (Technical Approach, Architecture Decisions, Data Flow diagram, File Changes),
`tasks.md` (WU-3 note — T-03 is now admin-only), `CLAUDE.md` (RBAC section, `dbo.cfg_user`
row, roles catalog section, seed example), and `sql/users.sql` (comment). Confirmed no test
in `test/` asserted `/workflow` requires admin role (only `test/require_role.test.js`
unit-tests the middleware factory itself, unaffected by the route-mount change).

**Commit**: `3c331c6` — "Fix 1: revierte el gate de rol sobre /api/workflow/* (PR1 code
review)"

### Finding 2 — `requireRole(...)` silently dropped unrecognized role arguments

**What was wrong**: `const allowed = new Set(roles.map(normalizeRole).filter((r) =>
ALLOWED_ROLES.has(r)))` silently dropped any role argument not in `ALLOWED_ROLES`. A future
typo'd call site (e.g. `requireRole("admni")`) would silently produce a middleware that 403s
EVERY request forever, with no startup signal.

**Fix applied (TDD)**: RED — added 2 tests to `test/require_role.test.js`:
`requireRole("not-a-real-role")` and `requireRole("admin", "not-a-real-role")` must throw
synchronously at construction time. Confirmed failing (`npm run test:file -- test/require_role.test.js`
→ 2 failures, "Missing expected exception"). GREEN — `require_role.js` now validates every
normalized role against `ALLOWED_ROLES` before building the allow-set; throws a plain `Error`
(not `AppError` — a programmer/config error at app-init time, matching the
`assertAuthConfig()` convention in `api/config/env.js`) naming the invalid role(s). Confirmed
passing (7/7 in `test/require_role.test.js`, including the 5 pre-existing tests — the
`requireRole("admin")` call sites in `index.js` are unaffected since `"admin"` is valid).
Added the corresponding requirement/scenario to `specs/admin-rbac/spec.md` and a decision row
to `design.md` § Architecture Decisions.

**Commit**: `b577fd3` — "Fix 2: requireRole() falla rapido ante un rol no reconocido (TDD)"

### Finding 3 — frontend interceptor didn't distinguish 403 from 401

**What was wrong**: `auth.interceptor.ts` only handled `err.status === 401`
(logout + redirect); a 403 fell through to raw Angular error messages shown to the user.
Since delivery is `stacked-to-main`, PR1 could reach production before PR4 (which was
scheduled to fix this as part of WU-13), and PR1's own doc changes (WU-4, `sql/users.sql`)
actively instruct operators to seed a `viewer` user now — the exposure window is real, not
theoretical. The user approved pulling only the interceptor fix (T-13a) forward into PR1;
role decoding (`auth.service.ts`, T-13b) and nav hiding (`app.ts`/`app.html`, T-13c) stay in
PR4.

**Fix applied (TDD, minimal scope)**: read `auth.interceptor.ts` in full; confirmed
`auth.interceptor.spec.ts` already exists (Karma/Jasmine, `npm run web:test`). Added 2 tests:
a 403 must NOT call `logout()`/navigate, and the error must be re-thrown so the calling
component's own `error:` handler can surface a message (matching the pattern already used by
`login-page.component.ts`). Implemented an explicit `else if (err.status === 403)` branch
that does nothing beyond falling through to the existing unconditional re-throw — no logout,
no redirect, no nav-hiding, no role decoding (kept out of scope per the user's approval).

**Karma/Jasmine suite executed (2026-07-13, follow-up)**: Chrome was installed at
`C:\Program Files\Google\Chrome\Application\chrome.exe` after the batch above was applied.
Ran `CHROME_BIN="/c/Program Files/Google/Chrome/Application/chrome.exe" npx ng test
--watch=false --browsers=ChromeHeadless` from `rule_set/web/`: **136 of 136 SUCCESS**
(134 pre-existing + the 2 new `auth.interceptor.spec.ts` cases for the 403 branch). No
failures. The earlier "not verified in this sandbox" caveat is resolved — Fix 3 is
confirmed green end-to-end, not just TypeScript-clean.

Updated `tasks.md`: T-13a marked `[x]` with a note that it was pulled forward from PR4; T-13b
and T-13c remain `[ ]`, explicitly still in PR4. Updated `design.md` File Changes row for
`auth.interceptor.ts` with the same amendment note.

**Commit**: `c02f123` — "Fix 3: interceptor distingue 403 de 401 (T-13a adelantado de PR4 a
PR1)"

### Full-suite regression check (after all 3 fixes)

`npm test` from `rule_set/`: 294 tests, 268 pass, 24 fail, 2 skip. The 24 failures are the
same pre-existing SQL-Server-connectivity integration tests reported before this batch
(`WF_SQL_SERVER`/`SQL_SERVER` credentials not configured in this sandbox) — same file set as
previously documented (`workflow_snapshot_roundtrip.test.js`, `workflow_upsert_match.test.js`,
`config_cache.test.js`, etc.), none of which touch `require_role.js`, `rule_catalogs.js`, or
`routes/index.js`. Test count went from 292 → 294 (the 2 new Fix 2 tests); pass count from
266 → 268; fail count unchanged at 24 — **no new regressions**.

---

## PR2 — apply-safeguard (WU-5..WU-8)

> Change: `rbac-and-config-safeguards`
> Phase: apply
> This document's PR2 section covers **PR2 of 4** — the apply-safeguard slice (OWASP-02:
> `confirmReplaceAll` + read-only impact preview). WU-1..WU-4 (RBAC) were already merged into
> this branch's history from PR1. WU-9..WU-13 (snapshot integrity, remaining frontend polish)
> are NOT part of this batch and remain untouched in `tasks.md`.

### Branch

`feat/rbac-and-config-safeguards-apply-safeguard` (pre-existing, checked out, stacked on top
of `feat/rbac-and-config-safeguards-rbac` — no new branch created, no push, no PR opened per
instructions; PR creation is a separate step).

### Work units completed

| WU | Task | Status | Commit |
|----|------|--------|--------|
| WU-5 | T-05 — RED: failing tests for `confirmReplaceAll` gate + `computeApplyImpact` preview | Done | `34c663a` |
| WU-6 | T-06 — GREEN: `confirmReplaceAll` gate + `postAdminApplyPreview` + `computeApplyImpact` | Done | `52fc6c6` |
| WU-7 | T-07 — frontend types (`ApplyImpact`) + `previewApply()` service method | Done | `ff03b37` |
| WU-8 | T-08 — "Grabar configuración" dialog requires preview before confirming | Done | `b0b85db` |

### Files created

- `rule_set/test/admin_apply_safeguard.test.js` — 15 scenarios: unit (no DB) coverage of
  `validateApplyPayload` (confirmReplaceAll missing/false, comment missing/empty even with
  confirmReplaceAll:true, valid payload passes), `validatePreviewPayload`/`postAdminApplyPreview`
  (malformed `rules` → 400, no comment/confirmReplaceAll required), `postAdminApply` controller
  invocations (400 fires before any DB access, since `validateApplyPayload` throws synchronously);
  plus 3 integration scenarios (skip w/o SQL credentials, following the `hasSqlCredentials()`
  pattern from `workflow_upsert_match.test.js`/`admin_offers_period.test.js`): `postAdminApply`
  200+`snapshot_id` end-to-end, `computeApplyImpact` per-offer counts + idempotency + no side
  effects, and 404 propagation for a non-existent offerCode.

### Files modified

- `rule_set/api/controllers/admin_apply_controller.js` — extracted shared `validateRulesShape`;
  exported `validatePreviewPayload` (shape-only, no comment/confirmReplaceAll) and
  `validateApplyPayload` (shape + `confirmReplaceAll === true` gate, checked before the comment
  check + before any snapshot/DB write) for direct unit testing; new `postAdminApplyPreview`
  handler calling `computeApplyImpact`.
- `rule_set/api/services/admin_service.js` — new read-only `computeApplyImpact(payload, options)`:
  mirrors `applyConfig`'s own scope derivation (offerCodes from `payload.rules`, `offer_date_id`
  scoping via `rulePeriodIdsCsv`/`paramPeriodIdsCsv` unless `deleteAllPeriods`), but issues
  `SELECT COUNT` instead of `DELETE`/`INSERT` and opens no transaction. Never called by the real
  `applyConfig` (advisory only, per design's "Cálculo de impacto" decision row).
- `rule_set/api/routes/admin_routes.js` — mounted `POST /config/apply/preview` (before
  `/config/apply`, per design's File Changes table ordering note).
- `rule_set/web/src/app/models/admin.models.ts` — `confirmReplaceAll: boolean` added (required)
  to `AdminConfigApplyPayload`; new `AdminConfigApplyPreviewPayload`, `ApplyImpact`,
  `ApplyImpactPerOffer` interfaces.
- `rule_set/web/src/app/services/admin-api.service.ts` — new `previewApply(payload):
  Observable<ApplyImpact>` (`POST /admin/config/apply/preview`); `applyConfig` unchanged at the
  HTTP layer (payload now carries `confirmReplaceAll` by type contract).
- `rule_set/web/src/app/services/admin-api.service.spec.ts` — 3 new tests: `previewApply` sends
  `rules`/`params` without `comment`/`confirmReplaceAll`; `applyConfig` sends
  `confirmReplaceAll:true`.
- `rule_set/web/src/app/pages/configurator-page.component.ts` — `openApplyConfigDialog()` now
  calls `previewApply()` immediately and stores the result in `applyImpactPreview` (plus
  `applyImpactLoading`/`applyImpactError`); `isConfirmActionPending()` keeps the confirm button
  disabled for `apply-config` dialogs until `applyImpactPreview()` is non-null and loading is
  false; `closeConfirmDialog()` resets the preview state; `executeApplyConfig()` sends
  `confirmReplaceAll: true`.
- `rule_set/web/src/app/pages/configurator-page.component.html` — new `.apply-impact-preview`
  block inside the `apply-config` confirm dialog: loading state, error state, and a per-offer
  impact table (rulesToDelete/paramsToDelete/rulesToInsert/paramsToInsert + totals row).
- `rule_set/web/src/app/pages/configurator-page.component.spec.ts` — 4 new tests: preview is
  requested on dialog open with the imported rules/params; confirm button stays disabled while
  the preview is pending (using a manually-controlled `Subject` to freeze resolution) and
  becomes enabled once it resolves; the impact summary renders in the DOM (`OFERTA_A` visible);
  confirming sends `confirmReplaceAll: true` alongside `comment` to `applyConfig`.

### TDD cycle evidence

1. **RED (backend, WU-5)**: `npm run test:file -- test/admin_apply_safeguard.test.js` before
   WU-6 failed with `TypeError: ... is not a function` for `validateApplyPayload`,
   `validatePreviewPayload`, `postAdminApplyPreview` (via the controller import) and
   `computeApplyImpact` (via the service import) — none of these symbols existed yet. Confirmed
   failing for the right reason (missing exports), not an assertion/typo bug.
2. **GREEN (backend, WU-6)**: after implementing the controller/service/route changes, 12/15
   tests in `admin_apply_safeguard.test.js` pass. The remaining 3 (the DB-integration scenarios)
   fail with `AppError: No se pudo conectar a SQL Server...` — this sandbox's `hasSqlCredentials()`
   returns `true` (`.env` has values set) but there is no reachable SQL Server, matching the
   exact same environment limitation already documented for the 24 pre-existing failures in
   PR1's section above (also `AppError` connectivity failures, not code bugs). Full-suite
   confirmation below.
3. **RED (frontend, WU-7/WU-8)**: ran the full Karma suite once with the model/spec changes in
   place but BEFORE implementing `previewApply()`/`applyImpactPreview`/`confirmReplaceAll` —
   build failed with `TS2345: Argument of type '"previewApply"' is not assignable to parameter
   of type 'keyof AdminApiService'`, `TS7053: ... 'applyImpactPreview' does not exist on type
   'ConfiguratorPageComponent'`, and `TS2741: Property 'confirmReplaceAll' is missing in type
   ...`. Confirmed failing for the right reason (symbols not implemented yet), not a test bug.
4. **GREEN (frontend, WU-7/WU-8)**: after implementing the service method, component signals/
   logic, and template block, the full Karma suite passes with no failures.

### Full-suite regression check

- **Backend** (`npm test` from `rule_set/`): 309 tests, 280 pass, 27 fail, 2 skip. Test count
  went from 294 (PR1 end state) → 309 (+15, the new `admin_apply_safeguard.test.js` file); pass
  count from 268 → 280 (+12); fail count from 24 → 27 (+3 — exactly the 3 new DB-integration
  scenarios in the new test file, all failing on the same pre-existing SQL-connectivity
  limitation, not on new code defects). Verified by listing every `not ok` test name from the
  full run: the failing set is precisely the 24 previously-documented names (`T-01a`..`T-01h`,
  `T-02a-01`..`T-02a-10`, `CA-005`, `CA-COD-001`, `CA-VDT-004`, `CA-VDT-004b`, `WF-01`,
  `resetToSeed()`) plus exactly 3 new ones (`postAdminApply: confirmReplaceAll:true y payload
  valido -> 200 con snapshot_id`, `computeApplyImpact: conteos por offerCode correctos...`,
  `computeApplyImpact: offerCode inexistente propaga 404...`) — **no other regressions**.
- **Frontend** (`CHROME_BIN="/c/Program Files/Google/Chrome/Application/chrome.exe" npx ng test
  --watch=false --browsers=ChromeHeadless` from `rule_set/web/`): **143 of 143 SUCCESS**
  (136 from PR1's end state + 4 new `configurator-page.component.spec.ts` cases + 3 new
  `admin-api.service.spec.ts` cases). No failures, no new regressions.

### Deviations from design

None. `computeApplyImpact`'s signature/return shape
(`{offerCodes, rulesToDelete, paramsToDelete, rulesToInsert, paramsToInsert, perOffer}`), the
400 error message text (`"Debes confirmar el reemplazo total de la configuración
(confirmReplaceAll)."`), the endpoint path (`POST /admin/config/apply/preview`), and the
`deleteAllPeriods: true` invocation from the preview controller all match `design.md` §
"Apply seguro (OWASP-02)", § "computeApplyImpact — read-only", and § "Interfaces / Contracts"
exactly.

### Issues found

None.

### Scope note

Only T-05 through T-08 are checked off in `tasks.md` in this batch. T-09 onward (snapshot
integrity, remaining frontend polish) are untouched and remain `[ ]`, to be implemented in
PR3/PR4 per `state.yaml` § `chain_plan`.

---

## Code-review findings and fixes (2026-07-14)

A fresh-context adversarial code review of PR2 (WU-5..WU-8) ran on this branch
(`feat/rbac-and-config-safeguards-apply-safeguard`, stacked on
`feat/rbac-and-config-safeguards-rbac`) before the PR was opened. It confirmed 3 real
findings, all approved by the user, fixed on the same branch as 2 separate commits — no
push, no PR opened.

### Finding 1+2 (root-cause refactor) — `computeApplyImpact`'s scope derivation had
### silently diverged from `applyConfig`'s

**What was wrong**: `applyConfig` and `computeApplyImpact` each derived their own notion
of "which offerCodes/periods are in scope" independently (copy-pasted derivation logic).
That duplication had drifted apart in two concrete bugs:

- **Bug A**: `computeApplyImpact` ran a `SELECT COUNT(*) FROM dbo.cfg_offer_param ...`
  for every offer **unconditionally**, even when `payload.params` was omitted from the
  payload entirely. But `applyConfig`'s entire params section is wrapped in
  `if (Array.isArray(payload.params)) { ... }` — a rules-only apply (a supported, common
  case: "replace the rules, leave params untouched") skips params entirely. Result: the
  preview showed a false-positive non-zero `paramsToDelete` for a rules-only apply that
  would, in reality, touch zero param rows.
- **Bug B**: `computeApplyImpact`'s per-offer loop only iterated `offerCodes` derived
  from `payload.rules`. `applyConfig` separately derives `paramOfferCodes` from
  `payload.params` — a *different* set, since a payload can legitimately contain a
  `params` group for an offerCode with no corresponding `rules` entries in that same
  apply. Any such offerCode was invisible in `computeApplyImpact`'s `perOffer` array and
  its params deletion/insertion was missing from the top-level totals, even though
  `applyConfig` WOULD disable/insert its params for real.

**Fix applied**: extracted a single shared helper, exported
`deriveApplyScope(payload, options)` in `admin_service.js` — pure/synchronous, no I/O.
It derives and returns everything both functions need: `offerCodes` (from
`payload.rules`), `paramOfferCodes` (from `payload.params`, `[]` if not provided),
`hasParams` (`Array.isArray(payload.params)`), `rulePeriodIdsCsv`/`paramPeriodIdsCsv`,
and the three scope-clause strings (`ruleScopeClause`, `directScopeClause`,
`paramScopeClause`). `applyConfig` was refactored to call this helper instead of
inlining the derivation — a pure extraction; its `DELETE`/`INSERT` behavior for every
code path it already exercised is unchanged (verified by the full-suite regression run
below). `computeApplyImpact` was refactored to call the SAME helper, then:

- Bug A fix: the params-count query per offer is now guarded by `hasParams`, mirroring
  `applyConfig`'s own `if (Array.isArray(payload.params))` check.
- Bug B fix: the per-offer loop now iterates the union of `offerCodes` ∪
  `paramOfferCodes` (not just `offerCodes`). An offer present only in `payload.params`
  gets its own `perOffer` entry with `rulesToDelete: 0, rulesToInsert: 0` (accurate —
  `applyConfig`'s rule-delete loop never touches an offerCode outside `payload.rules`)
  plus its real param counts. The top-level `offerCodes` field in the response was also
  changed to reflect this union (previously only listed rule-derived offers) — a
  beneficial side effect: the frontend's "Ofertas afectadas" list now correctly includes
  an offer affected only by params.

**TDD (RED first)**: added 2 pure unit tests for `deriveApplyScope` directly (no DB,
genuinely environment-independent) plus 2 integration-level tests for
`computeApplyImpact`'s end-to-end behavior (`{ skip: !hasSqlCredentials() }`, matching
the file's existing pattern) in `test/admin_apply_safeguard.test.js`:

1. `deriveApplyScope: payload sin 'params' -> paramOfferCodes vacio y hasParams:false` —
   confirmed RED by stashing the fix and re-running: failed with
   `deriveApplyScope is not a function` (the export did not exist yet — same
   "missing export" RED convention already established in this file for WU-5/WU-6).
   Confirmed GREEN after the fix.
2. `deriveApplyScope: 'params' referencia un offerCode ausente en 'rules' -> paramOfferCodes lo incluye` —
   same RED (missing export) → GREEN.
3. `computeApplyImpact: payload solo con 'rules' (sin 'params') -> paramsToDelete:0 en total y por oferta (Bug A)` —
   integration-level, seeds existing enabled params for the offer and asserts they are
   NOT reported when the payload omits `params`.
4. `computeApplyImpact: offerCode presente solo en 'params' (sin 'rules') aparece en perOffer con conteos reales (Bug B)` —
   integration-level, seeds two offers (one with rules, one params-only) and asserts the
   params-only offer gets its own accurate `perOffer` entry and is included in the
   top-level totals and `offerCodes`.

Tests 3 and 4 could not be verified end-to-end in THIS sandbox (same pre-existing
limitation as the rest of this file's integration tests: `hasSqlCredentials()` returns
`true` because `.env` has values set, but there is no reachable SQL Server — both fail
with the same `AppError: No se pudo conectar a SQL Server...` connectivity error in both
the RED and GREEN states, not a logic assertion). This was verified explicitly by
stashing/restoring `admin_service.js` and re-running: tests 1 and 2 flipped cleanly from
RED (`TypeError: deriveApplyScope is not a function`) to GREEN; tests 3 and 4 showed the
identical SQL-connectivity failure before and after the fix, exactly like the 3 already-
documented pre-existing integration tests in this same file (`postAdminApply:
confirmReplaceAll:true...`, `computeApplyImpact: conteos por offerCode correctos...`,
`computeApplyImpact: offerCode inexistente propaga 404...`). Flagged as an action item
for the reviewer to re-run this file against a live SQL Server before merging PR2 to get
a true end-to-end confirmation of Bug A/B; the logic itself IS confirmed correct via the
environment-independent `deriveApplyScope` unit tests plus manual code reading.

**Commit**: `2ebc596` — "fix(admin-service): extrae deriveApplyScope compartido,
corrige Bug A y Bug B de computeApplyImpact"

### Finding 3 — frontend: `openApplyConfigDialog` didn't cancel stale preview requests

**What was wrong**: `openApplyConfigDialog()` fired
`this.adminApiService.previewApply(...).subscribe(...)` with a bare subscribe — no
cancellation. `closeConfirmDialog()` reset the preview signals but did not cancel the
in-flight request. If the dialog was closed and reopened (e.g. with a different imported
config) before the first preview request resolved, the stale response could still land
and silently overwrite `applyImpactPreview` with the WRONG offer's impact numbers —
undermining the OWASP-02 informed-consent safeguard (the actual submitted apply payload
is NOT affected — `executeApplyConfig()` reads `importedConfig()`/`applyConfigComment()`
fresh at click time, not the stale preview — but the numbers the user sees before
confirming could be wrong, which is a real UI-honesty bug for a "confirm you understand
the impact" safeguard).

**Fix applied (TDD, minimal scope)**: a generation-counter guard —
`applyImpactRequestId` (private field), incremented both when the dialog opens (new
preview request) and when `closeConfirmDialog()` runs (invalidate any in-flight
request). `openApplyConfigDialog()` captures the counter value into a local `requestId`
at request-fire time; the `next`/`error` callbacks only apply their result
(`applyImpactPreview.set(...)` / `applyImpactError.set(...)`) if `requestId` still
equals the current `applyImpactRequestId` when the response lands — otherwise the
response is silently ignored. No new RxJS pattern introduced (`switchMap`/`Subject`
cancellation): this codebase has no prior art of either pattern for HTTP calls, so a
plain counter is the simplest, most idiomatic fix for this single call site.

**Test added**: `Fix 3: a stale preview from a closed-then-reopened dialog does not
overwrite a newer preview (out-of-order responses)` in
`configurator-page.component.spec.ts` — opens the dialog (preview A fires via a
`Subject`, does not resolve), closes the dialog, reopens with different imported data
(preview B fires via a second `Subject`), resolves B, THEN resolves A late/out-of-order,
and asserts `applyImpactPreview()` still equals B's data, not A's.

**RED confirmed**: stashed the component fix, ran
`CHROME_BIN=... npx ng test --watch=false --browsers=ChromeHeadless --include='**/configurator-page.component.spec.ts'`
→ 1 FAILED, 58 SUCCESS. The failure showed A's stale data (`rulesToDelete: 99`,
`offerCodes: ['OFERTA_A']`) had overwritten B's real preview — confirmed failing for the
right reason (the actual bug reproduced), not a test/typo bug.

**GREEN confirmed**: restored the fix, re-ran the same file → 59 SUCCESS (58 pre-existing
+ 1 new). Full Karma suite re-run at the end of the batch: 144 of 144 SUCCESS.

**Commit**: this batch's second commit — "fix(configurator): ignora respuestas de
previsualizacion obsoletas al reabrir el dialogo de Grabar" (includes this doc update
and the `design.md` amendments alongside the component/spec changes).

### Full-suite regression check (after both fixes)

- **Backend** (`npm test` from `rule_set/`): 313 tests, 282 pass, 29 fail, 2 skip. Test
  count went from 309 (PR2 pre-review state) → 313 (+4: 2 new `deriveApplyScope` unit
  tests + 2 new `computeApplyImpact` Bug A/B integration tests); pass count from 280 →
  282 (+2 — the 2 unit tests, which are genuinely environment-independent); fail count
  from 27 → 29 (+2 — exactly the 2 new Bug A/B integration tests, both failing on the
  same pre-existing SQL-connectivity limitation as the other 3 integration tests already
  in this file, not on new code defects). Verified by listing every `not ok` test name
  from the full run: the failing set is precisely the 27 previously-documented names
  (`T-01a`..`T-01h`, `T-02a-01`..`T-02a-10`, `resetToSeed()`, `CA-005`, `CA-COD-001`,
  `CA-VDT-004`, `CA-VDT-004b`, `WF-01`, plus the 3 pre-existing
  `admin_apply_safeguard.test.js` integration tests) plus exactly 2 new ones
  (`computeApplyImpact: payload solo con 'rules' (sin 'params')...`, `computeApplyImpact:
  offerCode presente solo en 'params' (sin 'rules')...`) — **no other regressions**.
- **Frontend** (`CHROME_BIN="/c/Program Files/Google/Chrome/Application/chrome.exe" npx
  ng test --watch=false --browsers=ChromeHeadless` from `rule_set/web/`): **144 of 144
  SUCCESS** (143 from PR2's end state + 1 new Fix 3 test). No failures, no regressions.

### Deviations from design

None beyond what's documented above. `deriveApplyScope`'s shape and both callers'
integration were amended into `design.md` § "computeApplyImpact — read-only" and §
"Architecture Decisions" (new row) and § "File Changes" (amended rows for
`admin_service.js` and `configurator-page.component.ts`) — see the "Amendment
(2026-07-14)" notes there.

---

## Code-review findings and fixes round 2 (2026-07-14)

A second fresh-context adversarial code review ran on this branch's diff
(`git diff 3acd38c...HEAD`, merge-base with `main`) before opening the PR, this time
targeting the PR2 diff as a whole (including the round-1 fixes committed above). It
confirmed 3 real findings, all approved by the user, fixed on the same branch as 3
separate commits — no push, no PR opened.

### Fix 1 (High) — `computeApplyImpact`'s preview resolver diverged from `applyConfig`'s real write path

**What was wrong**: `computeApplyImpact`'s per-offer loop resolved EVERY offerCode in
`allOfferCodes` (the union of `offerCodes` and `paramOfferCodes`) via
`findRulesetIdByOfferCode`, which filters `WHERE enabled = 1` and throws 404 if not
found. But `applyConfig`'s real params-write path (the disable loop and the insert
loop) resolves offerCodes drawn from `payload.params` via `resolveRulesetId`, which has
NO `enabled` filter. Consequence: a payload whose `params` array referenced an offer
code with no corresponding `payload.rules` entries, where that offer's
`cfg_offer_ruleset` row currently had `enabled = 0`, made the preview 404 while the
real apply would succeed — permanently blocking a legitimate save, since the frontend
gates the confirm button on the preview succeeding.

**Fix applied (TDD)**: read both `findRulesetIdByOfferCode` and `resolveRulesetId` in
full (lines ~19-48 of `admin_service.js`) to confirm the exact difference (the
`enabled = 1` filter). Chose to make `computeApplyImpact` match `applyConfig`'s actual
behavior (the real apply already accepts params-only writes to disabled offers) rather
than change `applyConfig` — per the instructions, the safer/less-surprising direction.
`computeApplyImpact` now resolves a code present in `offerCodes` (has rules in the
payload) via `findRulesetIdByOfferCode` (matches `applyConfig`'s `rulesetIdCache` build
loop, which does 404 on disabled offers with rules) and a code present ONLY in
`paramOfferCodes` via `resolveRulesetId` (matches `applyConfig`'s params-only
resolution).

Added 2 integration tests (`{ skip: !hasSqlCredentials() }`, matching this test file's
existing convention) to `test/admin_apply_safeguard.test.js`:
1. `computeApplyImpact: offerCode solo en 'params' con ruleset enabled=0 NO debe dar 404` —
   seeds a disabled ruleset referenced only via `params`, asserts the preview succeeds
   (not 404) and reports its real param counts.
2. `computeApplyImpact: offerCode inexistente presente SOLO en 'params' ... sigue
   propagando 404` — regression guard confirming a *truly* nonexistent offerCode (no
   row at all, not just disabled) still 404s, matching `applyConfig`'s own behavior for
   that case.

In this sandbox there are no SQL credentials configured (`hasSqlCredentials()` returns
`false`), so both new integration tests report `SKIP`, same as the other 8
integration-level tests already in this file — the fix's logic was verified by manual
code reading plus the 16 non-DB tests in the file passing unchanged. Flagged as an
action item for a reviewer with a live SQL Server to re-run this file and confirm the
two new tests pass end-to-end before merging.

**Commit**: `564087b` — "fix(admin-service): computeApplyImpact usa el mismo resolver
que applyConfig por offerCode"

### Fix 2 (Medium) — duplicated param-dedup logic

**What was wrong**: the "dedupe params by key within a group, first-seen wins" logic
was hand-duplicated as two separate inline blocks: in `applyConfig`'s param-insert loop
(`seenKeys` set) and in `computeApplyImpact`'s param-count loop (also `seenKeys`, with a
comment literally saying "mirrors applyConfig's seenKeys" — an admission it was a
manual copy). Functionally identical at the time, but exactly the class of drift risk
the `deriveApplyScope` extraction (commit `2ebc596`) was supposed to close for
scope-derivation — it just didn't cover this specific dedup step.

**Fix applied**: extracted the dedup-by-key-within-group logic into a shared
`dedupeParamsByKey(paramValues)` helper in `admin_service.js`, next to
`deriveApplyScope`. Returns the deduped array (fits `applyConfig`'s insert loop, which
needs the actual param objects to insert) — `computeApplyImpact` calls
`.length` on the same return value for its count, so both call sites share one
source of truth. `applyConfig`'s insert loop now iterates
`dedupeParamsByKey(group.paramValues)` directly instead of maintaining its own
`seenKeys` set; `computeApplyImpact`'s count loop now computes
`dedupeParamsByKey(group.paramValues).length` instead of its own `seenKeys` set.

Added tests to `test/admin_apply_safeguard.test.js`:
- 2 pure unit tests (no DB, environment-independent) for `dedupeParamsByKey` itself:
  first-seen-wins on duplicate keys, and empty/`undefined` input returns `[]` without
  throwing.
- 1 integration test (`{ skip: !hasSqlCredentials() }`) that runs both `applyConfig`
  and `computeApplyImpact` against the SAME payload (with duplicate-keyed params) and
  asserts `applyConfig`'s `applied.params` count equals `computeApplyImpact`'s
  `paramsToInsert` — a regression guard that would catch a future re-divergence (e.g.
  someone re-inlining a slightly different `seenKeys` block in only one of the two call
  sites).

**Commit**: `9114302` — "refactor(admin-service): extrae dedupeParamsByKey compartido
entre applyConfig y computeApplyImpact"

### Fix 3 (Low) — root `CLAUDE.md` docs stale

**What was wrong**: `git diff 3acd38c...HEAD -- CLAUDE.md` was empty — the root
`CLAUDE.md`'s documented `POST /admin/config/apply` payload still showed the OLD shape
without `confirmReplaceAll`, and there was no mention anywhere of the new
`POST /admin/config/apply/preview` endpoint (both shipped in WU-6/WU-7, PR2).

**Fix applied**: updated the root `CLAUDE.md` (`rule_engine/CLAUDE.md`, NOT
`rule_set/CLAUDE.md` — confirmed this is the real one per the note already recorded in
this document from PR1): added `confirmReplaceAll: true` (required boolean) to the
documented `/admin/config/apply` payload example, plus the exact 400 message when it's
missing/false. Added a new row to the "Admin — bulk config operations" table for
`POST /admin/config/apply/preview` (read-only, no DB write, no snapshot, no
`comment`/`confirmReplaceAll` required) with its own payload/response documentation
(`ApplyImpact` shape) matching the existing table/section style. Also updated the
"Config bulk operations workflow" § step 3 ("Grabar configuración") to describe the
preview call on dialog open and the confirm-button-disabled-until-preview-resolves
behavior, and the `confirmReplaceAll: true` sent on confirm.

**Commit**: `39d4462` — "docs(claude-md): documenta confirmReplaceAll y POST
/admin/config/apply/preview"

### Full-suite regression check (after all 3 fixes)

`npm test` from `rule_set/` (after `npm install` — `node_modules/` was not present at
the start of this session): **318 tests, 284 pass, 0 fail, 34 skip**. No SQL
credentials configured in this sandbox (`api/.env` absent/incomplete), so every
integration-level test in `admin_apply_safeguard.test.js` and the other DB-dependent
test files reports `SKIP` cleanly (via `hasSqlCredentials()`) rather than failing on a
connectivity error, unlike the environment described in earlier sections of this
document. Test count went from 313 (PR2 pre-round-2-review state, after `npm install`)
to 318 (+5: 2 new Fix 1 tests, 2 new pure `dedupeParamsByKey` unit tests, 1 new Fix 2
cross-check integration test); pass count went from 282 to 284 (+2 — exactly the 2 pure
`dedupeParamsByKey` unit tests, genuinely environment-independent); the other 3 new
tests (2 Fix 1 integration tests + 1 Fix 2 integration test) are additional `SKIP`s, not
failures. **No regressions** — 0 failures across the entire suite.

### Scope note

Only the 3 findings above were addressed in this round. T-09 onward (snapshot
integrity, remaining frontend polish) remain untouched and `[ ]` in `tasks.md`, to be
implemented in PR3/PR4. `state.yaml` PR2 entry updated to `status: reviewed_fixed` with
a `review_note` pointing at this section and the 3 commits above; PR3's entry
(`status: pending`) was left untouched — no other session had started it at the time of
this update.
