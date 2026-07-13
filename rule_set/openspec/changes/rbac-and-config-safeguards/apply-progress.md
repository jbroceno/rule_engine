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
PR2/PR3/PR4 per `state.yaml` § `chain_plan`.
