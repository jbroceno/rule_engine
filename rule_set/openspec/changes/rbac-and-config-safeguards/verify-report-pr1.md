# Verify Report - PR1 (RBAC slice, WU-1..WU-4 + T-13a)

> Change: rbac-and-config-safeguards
> Scope: PR1 of 4 only (feat/rbac-and-config-safeguards-rbac, commit 3acd38c).
> WU-5 through WU-13 (apply safeguard, snapshot integrity, remaining frontend polish
> T-13b/T-13c) are out of scope for this pass and intentionally unimplemented -
> not a defect. A separate change-level verify-report.md will run after PR2-4 land.
> Verdict: PASS WITH WARNINGS

## Environment note (read first)

The repo working directory was checked out to feat/rbac-and-config-safeguards-apply-safeguard
(PR2, stacked on PR1) with two uncommitted WIP files (api/services/admin_service.js,
test/admin_apply_safeguard.test.js - a deriveApplyScope refactor, unrelated to RBAC),
not feat/rbac-and-config-safeguards-rbac as the verify instructions stated. To verify PR1
in isolation without touching that WIP or the checked-out branch, a temporary git worktree
was created at C:\pr1v pinned to feat/rbac-and-config-safeguards-rbac (confirmed
identical to origin/feat/rbac-and-config-safeguards-rbac, no local/remote divergence).
All code reading, backend (npm test) and frontend (ng test) runs below were executed
against that clean PR1 worktree. The worktree was removed after verification; no files in
the actual working tree/branch were modified by this process other than this report and
state.yaml.

## Completeness - tasks vs code

| Task | Description | tasks.md status | Code confirmed | Test confirmed |
|------|-------------|------------------|----------------|-----------------|
| T-01 | RED tests for requireRole | [x] | -- | test/require_role.test.js -- 7 tests |
| T-02 | requireRole factory + ALLOWED_ROLES/normalizeRole | [x] | api/middleware/require_role.js, api/utils/rule_catalogs.js -- match design exactly | PASS |
| T-03 | Mount gate on /admin only (/workflow ungated) | [x] | api/routes/index.js l.22/30 -- confirmed | No automated integration test (see WARNING-1); confirmed by direct code reading |
| T-04 | Docs: ALLOWED_ROLES catalog + seed_user.mjs --role viewer | [x] | sql/users.sql, root CLAUDE.md -- both updated, diff-identical to current branch (untouched by PR2) | N/A (docs) |
| T-13a | Interceptor distinguishes 403 from 401 (pulled forward from PR4) | [x] | web/src/app/interceptors/auth.interceptor.ts -- explicit else-if (err.status === 403) branch, no logout/redirect | auth.interceptor.spec.ts -- 2 new + 5 pre-existing cases, all pass |
| T-13b | auth.service.ts role decode | [ ] | Not implemented (by design -- still PR4) | N/A |
| T-13c | Nav hiding for viewer | [ ] | Not implemented (by design -- still PR4) | N/A |

All PR1 tasks (T-01..T-04, T-13a) are correctly marked [x] in tasks.md and match the
actual code state. T-13b/T-13c correctly remain [ ] - consistent with the amendment note
that only T-13a was pulled forward.

## Test execution evidence (run by this verify pass, not taken from apply-progress)

Backend - cd rule_set && npm test (worktree C:\pr1v, commit 3acd38c):

```
1..294
# pass 268
# fail 0
# skipped 26
```

npm run test:file -- test/require_role.test.js: 7/7 pass (5 original scenarios + 2
fail-fast-on-invalid-role scenarios added during the code-review fix).

Note: this run shows 0 fail / 26 skip, whereas apply-progress.md reported "294 tests, 268
pass, 24 fail, 2 skip" for the same commit. The pass count (268) matches exactly. The
difference is environmental: this worktree has no api/.env SQL credentials, so
hasSqlCredentials() correctly returns false and those 24 extra tests report SKIP (no
attempted connection); the apply-progress environment had SQL credentials configured but no
reachable server, so the same tests attempted a connection and failed. Confirmed by cause:
identical pass count, and the 24 additional fail-to-skip tests are exactly the SQL-integration
tests already named in apply-progress.md (workflow_snapshot_roundtrip.test.js,
workflow_upsert_match.test.js, admin_offer_cascade_delete.test.js, etc.) - none touch
require_role.js, rule_catalogs.js, or routes/index.js. Not a regression.

Frontend - CHROME_BIN=".../chrome.exe" npx ng test --watch=false --browsers=ChromeHeadless
(worktree C:\pr1v\rule_set\web, same commit): 136 of 136 SUCCESS, independently
reproducing the exact count apply-progress.md reported after Chrome was installed.

## Spec compliance matrix (specs/admin-rbac/spec.md, current/corrected version)

| Requirement / Scenario | Implementation | Test | Status |
|---|---|---|---|
| Acceso a rutas administrativas - admin accede con normalidad | router.use("/admin", requireRole("admin"), adminRoutes) | requireRole unit test (role=admin then next(), no error) | PASS (unit-level; route-mount confirmed by direct reading, no HTTP-level integration test - see WARNING-1) |
| Usuario viewer recibe 403 en ruta admin | Same middleware, 403 AppError with Spanish message; chain halts before controller (no DB effect) | require_role.test.js viewer-to-403 | PASS (unit-level; same WARNING-1 caveat for HTTP-level) |
| Usuario viewer NO recibe 403 en /api/workflow/* (fuera de alcance) | router.use("/workflow", workflowRoutes) - no requireRole call - confirmed by reading index.js l.23-30; this is the corrected code, not a leftover of the original (buggy) draft | No dedicated regression test asserting /workflow is NOT gated (see WARNING-2) | PASS (code-verified) - this was the critical regression from the original PR1 draft; confirmed genuinely fixed in the actual mounted code, not just in docs |
| Sin token sigue siendo 401, no 403 | authMiddleware (app.js, mounted before apiRoutes) returns 401 before requireRole ever runs; requireRole own defensive 401 branch is a backstop | auth_middleware.test.js (pre-existing) + require_role.test.js (req.user absent then 401) | PASS |
| Rutas no administrativas no exigen rol | /config, /simulate/*, /workflow declared before/independent of the requireRole mount | Confirmed by reading index.js | PASS |
| Middleware factory requireRole - 403 insuficiente / 401 defensivo | api/middleware/require_role.js | require_role.test.js (both cases) | PASS |
| Rol permitido en lista de varios roles | requireRole("admin","viewer") builds a Set of all normalized+valid roles | require_role.test.js multi-role case | PASS |
| Rol no reconocido en el catalogo -> 403, no 5xx | if (!allowed.has(role)) -> AppError 403 (never throws) | require_role.test.js unrecognized-role case | PASS |
| Argumento de rol invalido falla rapido en construccion | invalidRoles.length > 0 -> throw new Error(...), synchronous, at factory-call time | require_role.test.js - 2 fail-fast tests | PASS |
| Catalogo de roles permitidos (ALLOWED_ROLES) | api/utils/rule_catalogs.js - ALLOWED_ROLES = new Set(["admin","viewer"]) | Indirectly via require_role.test.js | PASS |
| Catalogo referenciado por el seed de usuarios (seed_user.mjs --role viewer) | Documented in sql/users.sql and CLAUDE.md | No automated test (script requires live SQL); seed_user.mjs itself does not import/validate against ALLOWED_ROLES (see WARNING-3) | PASS as literally worded (no validation exists to reject viewer, so it succeeds without error) but see WARNING-3 |
| Interceptor distingue 403 de 401 - 403 no desloguea | auth.interceptor.ts explicit branch, re-throws | auth.interceptor.spec.ts - 2 new tests | PASS |
| Interceptor - 401 conserva logout+redirect | Unchanged branch | auth.interceptor.spec.ts - pre-existing tests, re-run and still pass | PASS |
| Navegacion admin oculta para viewer (T-13b/T-13c) | Not implemented | N/A | Out of scope for PR1 (PR4) - not a PR1 defect |

## Design coherence

design.md RBAC section (Technical Approach, Architecture Decisions, Data Flow, File
Changes, error text table) matches the implemented code exactly, including the
2026-07-13 amendment removing the /workflow gate and adding the fail-fast-on-invalid-role
decision row. No deviations found. apply-progress.md "Deviations from design: None" claim
for PR1 is corroborated by direct code inspection.

## Issues

### CRITICAL

None.

### WARNING

1. No automated HTTP-level integration test for the RBAC route mount. The scenarios
   "Usuario admin accede con normalidad" and "Usuario viewer recibe 403 en ruta admin" are
   proven only via (a) unit-testing requireRole in isolation with a fake req/res/next,
   and (b) static reading of routes/index.js confirming the mount line. There is no
   supertest-style test spinning up the real Express app/router and asserting an actual
   GET/POST /api/admin/* returns 403 for a viewer JWT and 200 for an admin JWT end-to-end.
   This matches tasks.md own acceptance criterion for T-03, explicitly scoped as
   "manual/integration check" rather than automated coverage - a conscious planning decision,
   not an oversight - but it is the single largest gap between "the middleware is correct in
   isolation" and "the middleware is correctly wired into the app." Low risk given the
   one-line mount change and thorough unit coverage of the middleware itself, but worth a thin
   supertest-based route-mount test in a follow-up PR for defense-in-depth.

2. No regression test asserting /api/workflow/* is NOT gated. The fix for the
   "Finding 1 (Critical)" code-review regression (incorrectly gating /workflow) was
   confirmed correct by direct code reading (router.use("/workflow", workflowRoutes), no
   requireRole call), but there is no automated test that would catch a future accidental
   re-introduction of that gate (e.g., someone re-adding requireRole("admin") to the
   /workflow mount during a later refactor). Given this was already a real regression once,
   a cheap regression test (e.g., asserting the router stack for /workflow contains no
   requireRoleMiddleware layer, or an app-level supertest hitting /api/workflow/... with a
   non-admin token and asserting non-403) would meaningfully reduce recurrence risk.

3. scripts/seed_user.mjs does not validate --role against ALLOWED_ROLES. The script
   accepts any string for --role and inserts it into dbo.cfg_user.role without importing
   ALLOWED_ROLES/normalizeRole from api/utils/rule_catalogs.js. The spec literal
   scenario ("--role viewer succeeds without validation error") technically passes because
   there is no validation of any kind - but this means a typo (--role admni) would silently
   create a user whose role never matches any requireRole(...) allow-set, yielding 403 on
   every admin request with zero error signal - the same footgun that "Finding 2" fixed for
   requireRole(...) itself, left open on the seed path. The script own doc comment
   promises "1 - validation error" as an exit code, implying validation was intended.
   Suggest: validate normalizeRole(args.role) against ALLOWED_ROLES before insert, exit 1
   with a clear message otherwise.

4. Stale state.yaml line contradicts the corrected spec. open_questions still read
   "Gate de rol tambien sobre /api/workflow/* -- Resuelto: si, incluido" - the exact opposite
   of the final, corrected decision (no gate on /workflow). This predates the 2026-07-13
   code-review amendment and was not updated when proposal.md/design.md/tasks.md were
   corrected. Corrected as part of this verify pass state.yaml update (see below) since it
   is a documentation-accuracy issue directly relevant to recording verify results, not a code
   change.

### SUGGESTION

1. Consider adding the thin supertest-based integration tests from WARNING-1/2 to the PR1
   branch before merge, or explicitly accept the "manual/integration check" scope as final
   and note it as a permanent testing-strategy decision in design.md (currently it reads as
   an acceptance-criterion shortcut rather than a deliberate policy).
2. seed_user.mjs --role validation gap (WARNING-3) is cheap to close (one import, one
   guard clause) and would make the RBAC catalog genuinely load-bearing end-to-end rather than
   enforced only at request time.

## Verdict

PASS WITH WARNINGS. All PR1-scoped tasks (T-01..T-04, T-13a) are implemented, correctly
checked off, and covered by passing tests (7/7 backend require_role.test.js, full backend
suite 268/268 non-skipped tests passing, full frontend suite 136/136 passing - all
independently re-executed in an isolated worktree at the exact PR1 commit, not taken on
faith from apply-progress.md). The previously-identified critical regression
(/api/workflow/* incorrectly gated) is confirmed genuinely fixed in the mounted route code,
not merely documented as fixed. No CRITICAL issues block merging PR1. Four WARNINGs
(two test-coverage gaps at the HTTP-integration level, one validation gap in the seed script,
one stale state-tracking line) are non-blocking and suitable for a fast-follow or PR4 sweep.

---
Verified by: sdd-verify executor, 2026-07-14. Method: source inspection against
specs/admin-rbac/spec.md (current/corrected) + independent test re-execution in an isolated
git worktree pinned to feat/rbac-and-config-safeguards-rbac @ 3acd38c
(local == origin/feat/rbac-and-config-safeguards-rbac, no divergence).
