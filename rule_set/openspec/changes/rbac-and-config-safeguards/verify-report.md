# Verify Report -- rbac-and-config-safeguards (CHANGE-LEVEL, all 4 PRs)

> Change: rbac-and-config-safeguards
> Scope: FULL change-level verify -- PR1 (rbac) + PR2 (apply-safeguard) + PR3
> (snapshot-integrity) + PR4 (frontend-polish), all merged to main (verified at
> commit 3699ca8, main up to date with origin/main).
> Supersedes: verify-report-pr1.md (PR1-only, narrower scope, PASS WITH WARNINGS).
> Verdict: PASS WITH WARNINGS

## Environment note

Verified directly on main at 3699ca8 (merge of PR #4, frontend-polish). git log
--oneline -15 confirms all 4 merge commits present in main history in the
expected order: PR1 (rbac, 05a556a), PR3 (snapshot-integrity, 92bb8ad -- merged
as GitHub PR #2), PR2 (apply-safeguard, bd8b9f3 -- merged as GitHub PR #3), PR4
(frontend-polish, 3699ca8 -- GitHub PR #4). git status and git diff --stat show no
uncommitted changes under rule_set/ relevant to this change (only unrelated
top-level doc/README changes pre-existing in the working tree, out of scope).

Stray artifact found: rule_set/openspec/changes/rbac-and-config-safeguards/design_utf8.md
is an untracked, 1-line leftover file (not part of the artifact set, not referenced by
state.yaml). Flagged as SUGGESTION cleanup below -- harmless, not a defect.

## Completeness -- tasks vs code (all 15 tasks)

| Task | Description | tasks.md | Code confirmed |
|------|-------------|----------|-----------------|
| T-01 | RED tests for requireRole | [x] | test/require_role.test.js |
| T-02 | requireRole factory plus ALLOWED_ROLES/normalizeRole | [x] | api/middleware/require_role.js, api/utils/rule_catalogs.js -- match design exactly |
| T-03 | Mount gate on /admin only, /workflow ungated | [x] | api/routes/index.js -- confirmed by direct reading, comment matches Amendment |
| T-04 | Docs: ALLOWED_ROLES plus seed_user.mjs --role viewer | [x] | sql/users.sql, root CLAUDE.md -- both updated |
| T-05 | RED tests for apply safeguard | [x] | test/admin_apply_safeguard.test.js |
| T-06 | confirmReplaceAll gate plus preview endpoint plus computeApplyImpact | [x] | api/controllers/admin_apply_controller.js, api/services/admin_service.js, api/routes/admin_routes.js -- confirmed, including Bug A/B/Fix-1 corrections |
| T-07 | Frontend types plus previewApply() | [x] | web/src/app/models/admin.models.ts, admin-api.service.ts |
| T-08 | Grabar dialog requires preview plus confirm | [x] | configurator-page.component.ts/.html -- incl. stale-response guard (Fix 3) |
| T-09 | RED tests for snapshot integrity | [x] | test/snapshot_integrity.test.js |
| T-10 | SQL migration (idempotent) | [x] | sql/snapshots_checksum.sql |
| T-11 | HMAC util plus createSnapshot/restoreSnapshot wiring | [x] | api/utils/snapshot_integrity.js, admin_service.js -- confirmed incl. WF-origin checksum fix |
| T-12 | Frontend integrity verdict | [x] | snapshots-page.component.ts/.html, admin.models.ts |
| T-13a | Interceptor distinguishes 403/401 | [x] | web/src/app/interceptors/auth.interceptor.ts |
| T-13b | auth.service.ts role/isAdmin decode | [x] | confirmed, incl. casing-normalization fix |
| T-13c | Nav hiding for viewer | [x] | app.html -- 3 admin-only links wrapped in the isAdmin conditional block |

All 15/15 tasks are checked [x] and independently confirmed against the actual code
(not taken on faith from apply-progress.md).

## Test execution evidence (run by this verify pass)

Backend (npm test from rule_set/, this session, no live SQL Server available):

tests 333
pass 295
fail 36
skip 2

All 36 failures were independently listed and confirmed to be exactly the pre-existing
SQL/WF-connectivity integration tests (AppError: connection failures to SQL Server or
the Workflow server) documented incrementally across every PR section of
apply-progress.md -- e.g. T-01a..h, T-02a-01..10, resetToSeed(), CA-005, CA-COD-001,
the DB-integration cases in admin_apply_safeguard.test.js and
snapshot_integrity.test.js, T-WF-checksum-e, CA-VDT-004/004b, WF-01. None touch
require_role.js, rule_catalogs.js, routes/index.js, admin_apply_controller.js,
computeApplyImpact/applyConfig/deriveApplyScope/dedupeParamsByKey, or
snapshot_integrity.js logic incorrectly -- this is an environment limitation (.env
present but no reachable SQL Server), not a code defect. All logic-only (non-DB)
tests pass, including every unit test for the three OWASP mechanisms.

Frontend (ng test --watch=false --browsers=ChromeHeadless from rule_set/web/, this
session, using the locally installed Chrome binary):

Executed 159 of 159 SUCCESS

This matches the PR4 end-state count recorded in apply-progress.md exactly (158 plus
1 casing-fix test).

## OWASP-01 -- RBAC -- spec/design/tests compliance

| Requirement/Scenario | Implementation | Test | Status |
|---|---|---|---|
| Admin accede con normalidad | router.use admin mount with requireRole(admin) then adminRoutes | require_role.test.js (role=admin leads to next()) | PASS |
| Viewer recibe 403 en ruta admin | Same middleware, 403 AppError, chain halts before controller | require_role.test.js | PASS |
| Viewer NO recibe 403 en /workflow (fuera de alcance) | router.use for /workflow with no requireRole call, confirmed by reading index.js | No dedicated HTTP-level regression test (WARNING-1, carried over from PR1) | PASS (code-verified) |
| Sin token sigue 401, no 403 | authMiddleware (app.js) returns 401 before requireRole runs; own defensive 401 branch is backstop | auth_middleware.test.js plus require_role.test.js | PASS |
| Rutas no administrativas no exigen rol | /config, /simulate/*, /workflow independent of the requireRole mount | Code-verified | PASS |
| requireRole factory 403/401 | api/middleware/require_role.js | require_role.test.js | PASS |
| Rol permitido en lista de varios roles | requireRole with multiple roles builds allow-Set | require_role.test.js | PASS |
| Rol no reconocido leads to 403, no 5xx | allow-set check leads to AppError 403 | require_role.test.js | PASS |
| Argumento de rol invalido falla rapido en construccion | throws a plain Error synchronously at factory-call time | require_role.test.js (2 fail-fast tests) | PASS |
| Catalogo ALLOWED_ROLES | rule_catalogs.js | Indirect | PASS |
| Catalogo referenciado por seed | sql/users.sql plus CLAUDE.md document the viewer seed flag | No automated test (seed script does not validate the role flag against ALLOWED_ROLES -- WARNING-2, carried over from PR1, still open) | PASS as literally worded |
| Interceptor 403 no desloguea | auth.interceptor.ts explicit branch, re-throws | auth.interceptor.spec.ts | PASS |
| Interceptor 401 conserva logout plus redirect | Unchanged branch | auth.interceptor.spec.ts | PASS |
| Navegacion admin oculta para viewer | app.html -- 3 links wrapped in isAdmin conditional | app.spec.ts (2 new tests) | PASS |
| Admin ve navegacion completa | Same conditional, isAdmin true | app.spec.ts | PASS |

Design fidelity: exact match -- mount point, error codes/messages, fail-fast
construction-time validation, and the /workflow Amendment are all implemented as
documented, confirmed by direct code reading (not just apply-progress claims).

## OWASP-02 -- Apply safeguard -- spec/design/tests compliance

| Requirement/Scenario | Implementation | Test | Status |
|---|---|---|---|
| Apply sin confirmReplaceAll leads to 400, sin efectos | validateApplyPayload checks confirmReplaceAll true before comment, before any DB/snapshot write | admin_apply_safeguard.test.js | PASS |
| Apply con confirmReplaceAll true procede | postAdminApply unchanged happy path | admin_apply_safeguard.test.js (DB-integration, fails on connectivity, logic confirmed by code reading) | PASS (code-verified) |
| Validaciones existentes (comment) siguen aplicando | validateApplyPayload checks comment after confirmReplaceAll | admin_apply_safeguard.test.js | PASS |
| Preview devuelve resumen sin escribir | computeApplyImpact -- SELECT COUNT, no transaction, never called by applyConfig | admin_apply_safeguard.test.js | PASS |
| Preview rechaza payload invalido igual que apply | validatePreviewPayload shares validateRulesShape | admin_apply_safeguard.test.js | PASS |
| Preview idempotente/repetible | Read-only, no mutation | admin_apply_safeguard.test.js (DB-integration) | PASS (code-verified) |
| Dialogo exige previsualizacion antes de confirmar | configurator-page.component.ts -- confirm disabled until preview resolves | configurator-page.component.spec.ts | PASS |
| Confirmacion explicita envia confirmReplaceAll true | executeApplyConfig() | configurator-page.component.spec.ts | PASS |

Bug fixes independently re-verified in code (not just documented as fixed):
- deriveApplyScope(payload, options) -- single shared scope-derivation helper, called
  by both applyConfig and computeApplyImpact (admin_service.js line 1584). Confirmed:
  Bug A (hasParams guard) and Bug B (union of offerCodes and paramOfferCodes) both
  present in computeApplyImpact (admin_service.js lines 1846-1949).
- Fix 1 (resolver divergence): computeApplyImpact resolves codes in offerCodes via
  findRulesetIdByOfferCode and codes only in paramOfferCodes via resolveRulesetId
  -- confirmed matching the resolution paths applyConfig itself uses, line-for-line
  (admin_service.js lines 1896-1898).
- dedupeParamsByKey(paramValues) -- confirmed as the single shared dedup helper used
  by both the insert loop in applyConfig (admin_service.js line 1768) and the count
  loop in computeApplyImpact (admin_service.js line 1876).

Design fidelity: exact match, including the applyImpactRequestId stale-response
guard in configurator-page.component.ts (Fix 3, PR2 round-2 review).

## OWASP-10 -- Snapshot integrity -- spec/design/tests compliance

| Requirement/Scenario | Implementation | Test | Status |
|---|---|---|---|
| Snapshot nuevo incluye checksum | createSnapshot computes HMAC over the exact rulesJson/paramsJson strings passed to INSERT | snapshot_integrity.test.js (unit) plus DB-integration (code-verified) | PASS |
| Mismo contenido leads to mismo checksum, distinto contenido leads to distinto checksum | computeSnapshotChecksum deterministic HMAC-SHA256 | snapshot_integrity.test.js | PASS |
| Restore verifica checksum ANTES de transformar/aplicar | restoreSnapshot -- verify runs immediately after SELECT, before JSON.parse, transformWfToPoc, applyConfig | snapshot_integrity.test.js (DB-integration, code-verified) | PASS |
| Checksum no coincide leads to 409, sin mutacion | throws AppError 409 before any write | snapshot_integrity.test.js | PASS |
| Checksum NULL (legado) leads to procede con aviso | console.warn plus continue, integrity status legacy | snapshot_integrity.test.js | PASS |
| Columna checksum NVARCHAR(64) NULL | sql/snapshots_checksum.sql -- idempotent IF NOT EXISTS | N/A (SQL, code-verified) | PASS |
| Secreto HMAC con fallback | env.snapshot.hmacSecret falls back from SNAPSHOT_HMAC_SECRET to JWT_SECRET to empty string, NOT required by assertAuthConfig() | Code-verified (env.js) | PASS |
| Veredicto de integridad propagado al frontend | RestoreIntegrity type, snapshots-page.component.ts shows verified/legacy/409-integrity distinct from generic error | snapshots-page.component.spec.ts, admin-api.service.spec.ts | PASS |

WF-origin checksum fix independently re-verified in code: assembleWfSnapshotPayload
(admin_workflow_service.js line 590) now computes checksum via the same
computeSnapshotChecksum, over the exact rulesJson/paramsJson it returns;
createWorkflowSnapshot passes env.snapshot.hmacSecret and includes checksum in
the INSERT (admin_workflow_service.js lines 633, 642-649) -- confirmed this was a
real gap (all WF-origin snapshots were permanently legacy before this fix) and is
now closed.

Design fidelity: exact match, including the crypto.timingSafeEqual length-guard,
the NUL separator, the 409 message secret-rotation caveat (Fix 4), and
checksumPresent derived from a legacy-check on verify.status (Fix 3).

## Design coherence (full design.md, all Amendments)

design.md was read in full, including every Amendment accumulated across PR1-PR4
(PR1: /workflow revert plus fail-fast role validation; PR2 round 1: deriveApplyScope
extraction fixing Bug A/B, stale-preview-response guard; PR2 round 2: resolver
divergence fix (Fix 1), dedupeParamsByKey extraction (Fix 2), root CLAUDE.md docs
(Fix 3); PR3: WF-origin checksum fix (Fix 1), HTTP-status-based 409 detection (Fix 2),
checksumPresent derivation simplification (Fix 3), secret-rotation warning (Fix 4)).
Every amendment was traced to a corresponding code change and cross-checked against
the actual current files -- no deviations were found between the current state of
design.md and the implemented code.

## Open Questions from design.md -- classified

- JWT_SECRET rotation ambiguity (design.md Open Questions, item 3): a real
  SNAPSHOT_HMAC_SECRET/JWT_SECRET rotation without migration would make
  verifySnapshotChecksum return failed for legitimate old snapshots,
  indistinguishable from real tampering. This is an accepted, documented limitation
  -- mitigated (not resolved) by the 409 message explicit mention of rotation as an
  alternative cause, and by an ops comment in env.js. Classified as a known,
  accepted tradeoff, not a defect -- matches the explicit scope decision in the
  proposal to use HMAC plus fallback-secret rather than a dedicated/versioned-secret
  scheme.
- WF publish path integrity field (design.md Open Questions, item 1): resolved --
  confirmed restoreSnapshot includes integrity in both the POC and WF-destino
  return paths (admin_service.js lines 1489-1499).

## Carry-forward from verify-report-pr1.md (PR1-only pass)

| PR1 finding | Addressed by PR2-4? | Status now |
|---|---|---|
| WARNING-1: no HTTP-level (supertest) integration test for the /admin route mount | No | Still open -- carried forward below as WARNING |
| WARNING-2: no regression test asserting /workflow stays ungated | No | Still open -- carried forward below as WARNING |
| WARNING-3: seed_user.mjs does not validate the role flag against ALLOWED_ROLES | No -- confirmed unchanged in scripts/seed_user.mjs (still inserts any string for the role flag with no normalizeRole/ALLOWED_ROLES check) | Still open -- carried forward below as WARNING |
| WARNING-4: stale state.yaml open_questions line contradicting the /workflow correction | Yes -- state.yaml open_questions now reads as resolved, reflecting the revert during the PR1 code review | Resolved |
| SUGGESTION-1: add supertest coverage or formalize manual/integration check as policy | No | Still open (SUGGESTION) |
| SUGGESTION-2: close the seed_user.mjs validation gap | No | Still open (SUGGESTION), same underlying gap as WARNING-3 |

## Issues

### CRITICAL

None.

### WARNING

1. No automated HTTP-level integration test for the RBAC route mount (carried
   forward from PR1, still open after PR2-4). The scenarios admin accede con
   normalidad and viewer recibe 403 are proven at the unit level
   (require_role.test.js with fake req/res/next) plus direct static reading of
   routes/index.js, but no supertest-style test spins up the real Express
   app/router and asserts an actual GET/POST to an admin path returns 403/200
   end-to-end. Matches the T-03 acceptance criterion in tasks.md, worded as a manual
   or integration check -- a conscious scope decision, not an oversight. Low risk
   (one-line mount, thorough unit coverage of the middleware itself).

2. No regression test asserting /api/workflow/* stays ungated (carried forward
   from PR1, still open). The corrected behavior is confirmed by direct code reading
   (the /workflow mount has no requireRole call), but nothing would automatically
   catch a future accidental re-introduction of the gate -- and this was already a
   real regression once (PR1 own code review). A cheap test (app-level supertest
   hitting a workflow path with a non-admin token and asserting non-403, or
   inspecting the router stack for the absence of a requireRoleMiddleware layer)
   would meaningfully reduce recurrence risk.

3. scripts/seed_user.mjs still does not validate the role flag against
   ALLOWED_ROLES (carried forward from PR1, confirmed unchanged in this pass --
   read the file in full). A typo in the role argument silently creates a user
   whose role never matches any requireRole allow-set, yielding 403 on every admin
   request with zero error signal -- the same footgun class that PR1 Finding 2 fixed
   for requireRole itself, left open on the seed path. Low risk (operational
   script, not a request-time attack surface) but cheap to close: validate the
   normalized role against ALLOWED_ROLES before insert, exit 1 otherwise.

### SUGGESTION

1. Consider adding the thin supertest-based integration tests from WARNING-1/2, or
   explicitly document the manual/integration check as a permanent testing-strategy
   policy in design.md rather than leaving it read as an acceptance-criterion
   shortcut.
2. Close the seed_user.mjs role validation gap (WARNING-3) -- one import, one guard
   clause -- to make ALLOWED_ROLES genuinely load-bearing end-to-end, not just at
   request time.
3. Delete the stray untracked file design_utf8.md under this change folder (1-line
   leftover, not part of the artifact set, not referenced anywhere) before archiving
   this change.

## Verdict

PASS WITH WARNINGS. All 15 tasks (T-01 through T-13c) across all 4 merged PRs are
implemented, correctly checked off in tasks.md, and match the actual current code --
independently re-verified by direct source inspection in this pass, not taken on
faith from apply-progress.md. All three OWASP findings in scope are genuinely closed:

- OWASP-01 (RBAC): admin routes require the admin role (403 for insufficient role,
  401 for no session); the workflow routes are intentionally, correctly ungated
  (documented, deliberate scope correction from PR1 own code review, not a gap);
  requireRole fails fast on unrecognized role arguments at construction time.
- OWASP-02 (apply safeguard): the confirmReplaceAll gate plus dry-run preview
  endpoint are both implemented and correct, including two rounds of real bugs
  found and fixed during code review (scope-derivation divergence, resolver
  divergence, dedup duplication) -- all confirmed fixed in the current code, not
  just documented.
- OWASP-10 (snapshot integrity): an HMAC-SHA256 checksum is computed at creation
  and verified before restore, for BOTH snapshot-creation paths (createSnapshot and
  the WF-origin createWorkflowSnapshot, the latter a real gap found and fixed
  during PR3 code review) -- confirmed closed, not just documented.

Backend test suite: 295 pass, 36 fail, 2 skip -- all 36 failures are pre-existing
SQL/WF-connectivity environment limitations (no reachable SQL Server in this
sandbox), none touching this change logic. Frontend test suite: 159 of 159 SUCCESS.
No CRITICAL issues block archiving. Three WARNINGs (all carried forward,
unaddressed, from the PR1-only verify pass -- two test-coverage gaps at the
HTTP-integration level for RBAC, one validation gap in the seed script) and three
SUGGESTIONs are non-blocking and suitable for a fast-follow, not for this change
archive gate. The one open design tradeoff (JWT_SECRET rotation ambiguity) is an
accepted, documented limitation per design.md Open Questions, not a defect.

---
Verified by: sdd-verify executor, 2026-07-14 (change-level pass, all 4 PRs). Method:
full re-read of proposal.md, specs, design.md, tasks.md, apply-progress.md, and
state.yaml, direct source inspection of every file named in the verify scope against
the current main branch, plus independent re-execution of both the backend (npm
test) and frontend (ng test) full suites in this session.
