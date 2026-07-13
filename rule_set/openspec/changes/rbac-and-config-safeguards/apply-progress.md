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
