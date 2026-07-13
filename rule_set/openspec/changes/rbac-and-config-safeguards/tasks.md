# Tasks: rbac-and-config-safeguards

> Change: `rbac-and-config-safeguards`
> Phase: tasks
> Delivery strategy: ask-on-risk
> TDD mode: STRICT (tests before implementation, per design.md § Testing Strategy)

---

## Review Workload Forecast

| Group | Files touched | Estimated changed lines |
|-------|--------------|--------------------------|
| RBAC (OWASP-01) | `require_role.js` (new), `rule_catalogs.js`, `routes/index.js`, `users.sql`, `CLAUDE.md`, `require_role.test.js` (new) | ~130 |
| Apply safeguard (OWASP-02) | `admin_apply_controller.js`, `admin_service.js`, `admin_routes.js`, `admin_apply_safeguard.test.js` (new), `admin.models.ts`, `admin-api.service.ts`, `configurator-page.component.ts/.html` | ~373 |
| Snapshot integrity (OWASP-10) | `snapshots_checksum.sql` (new), `snapshot_integrity.js` (new), `env.js`, `admin_service.js`, `snapshot_integrity.test.js` (new), `admin.models.ts`, `snapshots-page.component.ts/.html` | ~283 |
| Frontend cross-cutting polish | `auth.interceptor.ts`, `auth.service.ts`, `app.ts`, `app.html` | ~85 |
| **Total** | 4 logical groups, ~20 files | **~871** |

```text
Decision needed before apply: Resolved
Chained PRs recommended: Yes
Chain strategy: stacked-to-main (confirmed by user 2026-07-11)
400-line budget risk: High
```

**Justification**: three OWASP-independent security surfaces (RBAC middleware, apply confirmation+preview, snapshot HMAC integrity) plus one SQL migration and five Angular files, touching backend controllers/services/routes, a new SQL column, and multiple frontend components. Even the largest single group (apply safeguard) alone approaches the 400-line budget on its own. The design explicitly decouples the three OWASP axes so they can ship as independent PRs.

### Suggested Work Units (PR split)

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| WU-1..WU-4 | RBAC: `requireRole` middleware + catalog + mount + docs | PR 1 | Independent; ~130 lines; Low risk alone |
| WU-5..WU-8 | Apply safeguard: `confirmReplaceAll` + preview endpoint + frontend dialog | PR 2 | Independent of PR1/PR3; ~373 lines; borderline — largest slice |
| WU-9..WU-12 | Snapshot integrity: SQL migration + HMAC util + create/restore + frontend verdict | PR 3 | Independent; SQL must land before API deploy per design § Migration/Rollout; ~283 lines |
| WU-13 | Frontend polish: interceptor 403 handling, `auth.service` role decode, nav hiding | PR 4 | Small; can also ride with PR1 or ship last; ~85 lines |

**Resuelto**: `stacked-to-main` — PR1→PR4 se mergean a main en orden, cada uno de forma independiente.

---

## Work Units

Each work unit = one commit. Per Strict TDD, RED (failing test) commits precede GREEN (implementation) commits within the same PR.

---

### WU-1 — RBAC tests (RED, no deps)

**Files**: `test/require_role.test.js` — CREATE

- [x] **T-01** Write failing tests for `requireRole(...roles)`:
  - 403 with fake `req.user.role = "viewer"` against `requireRole("admin")`.
  - `next()` called (no error) with `req.user.role = "admin"`.
  - 401 (defensive) when `req.user` is absent.
  - Multi-role list: `requireRole("admin","viewer")` passes a `viewer`.
  - Unrecognized role (not in `ALLOWED_ROLES`) still yields 403, not 5xx.
  - **Spec ref**: admin-rbac scenarios "Usuario viewer recibe 403", "Sin token sigue siendo 401", "Rol permitido en lista de varios roles", "Rol no reconocido en el catálogo".

---

### WU-2 — RBAC implementation (GREEN, depends on WU-1)

**Files**: `api/middleware/require_role.js` — CREATE; `api/utils/rule_catalogs.js` — MODIFY

- [x] **T-02** Create `requireRole(...roles)` factory (pattern: `createAuthMiddleware`): 403 `AppError` if `req.user.role` ∉ `roles`; 401 `AppError` if `!req.user`. Add `ALLOWED_ROLES = ["admin","viewer"]` + `normalizeRole(v)` in `rule_catalogs.js`.
  - **Acceptance**: WU-1 tests pass.
  - **Spec ref**: admin-rbac "Middleware factory `requireRole`", "Catálogo de roles permitidos".

---

### WU-3 — Mount RBAC gate (depends on WU-2)

**Files**: `api/routes/index.js` — MODIFY

- [x] **T-03** `router.use("/admin", requireRole("admin"), adminRoutes)` and `router.use("/workflow", requireRole("admin"), workflowRoutes)`. No change to `/simulate/*`, `/config`, `/health`, `/auth/login`.
  - **Acceptance**: manual/integration check — `/api/simulate/*` and `GET /api/config` unaffected; `/api/admin/*` and `/api/workflow/*` now 403 for non-admin.
  - **Spec ref**: admin-rbac "Usuario admin accede con normalidad", "Rutas no administrativas no exigen rol".

---

### WU-4 — RBAC docs (depends on WU-2)

**Files**: `sql/users.sql` — MODIFY; `rule_set/CLAUDE.md` — MODIFY

- [x] **T-04** Document `ALLOWED_ROLES` catalog and `node scripts/seed_user.mjs --role viewer` usage.
  - **Spec ref**: admin-rbac "Catálogo referenciado por el seed de usuarios".

---

### WU-5 — Apply safeguard tests (RED, no deps)

**Files**: `test/admin_apply_safeguard.test.js` — CREATE

- [ ] **T-05** Write failing tests:
  - 400 when `confirmReplaceAll` missing/false (comment+rules otherwise valid); no snapshot/DB write occurs.
  - 400 still fires for missing/empty `comment` even with `confirmReplaceAll:true` (existing validation unchanged).
  - 200 + `snapshot_id` when `confirmReplaceAll:true` and valid payload.
  - Preview (`computeApplyImpact`): correct per-offer counts (`rulesToDelete/paramsToDelete/rulesToInsert/paramsToInsert`); called twice with the same payload → identical counts (idempotent, skip w/o SQL); no rows change and no snapshot created.
  - Preview rejects malformed `rules` with 400 (no `comment`/`confirmReplaceAll` required).
  - **Spec ref**: config-apply-safeguard all scenarios.

---

### WU-6 — Apply safeguard backend (GREEN, depends on WU-5)

**Files**: `api/controllers/admin_apply_controller.js` — MODIFY; `api/services/admin_service.js` — MODIFY; `api/routes/admin_routes.js` — MODIFY

- [ ] **T-06** `validateApplyPayload`: require `confirmReplaceAll === true` (400, exact Spanish message from design § Códigos y textos), checked before snapshot/DB. New `postAdminApplyPreview` calling `computeApplyImpact`. New `computeApplyImpact(payload, options)` in `admin_service.js` — read-only `SELECT COUNT` mirroring `applyConfig`'s scope clauses (no transaction). Mount `adminRouter.post("/config/apply/preview", postAdminApplyPreview)`.
  - **Acceptance**: WU-5 tests pass.
  - **Spec ref**: config-apply-safeguard "Validación del payload...", "Endpoint de previsualización de impacto".

---

### WU-7 — Apply safeguard frontend types + service (depends on WU-6)

**Files**: `web/src/app/models/admin.models.ts` — MODIFY; `web/src/app/services/admin-api.service.ts` — MODIFY

- [ ] **T-07** `ApplyImpact` interface (offerCodes, 4 counts, `perOffer[]`); add `confirmReplaceAll: boolean` to the apply request model. `previewApply(payload): Observable<ApplyImpact>`; `applyConfig` sends `confirmReplaceAll`.
  - **Spec ref**: config-apply-safeguard "Endpoint de previsualización de impacto".

---

### WU-8 — Apply safeguard frontend UI (depends on WU-7)

**Files**: `web/src/app/pages/configurator-page.component.ts` — MODIFY; `web/src/app/pages/configurator-page.component.html` — MODIFY

- [ ] **T-08** "Grabar configuración" dialog: call `previewApply` on open, render impact summary, keep confirm button disabled until preview resolves, send `confirmReplaceAll: true` only on explicit confirm.
  - **Acceptance**: confirm disabled before preview resolves; final apply body includes `confirmReplaceAll: true`.
  - **Spec ref**: config-apply-safeguard "Diálogo de 'Grabar configuración' exige previsualización y confirmación".

---

### WU-9 — Snapshot integrity tests (RED, no deps)

**Files**: `test/snapshot_integrity.test.js` — CREATE

- [ ] **T-09** Write failing tests:
  - Unit (no DB): `computeSnapshotChecksum` deterministic (same input → same hex64); different content → different hex.
  - Unit: `verifySnapshotChecksum` → `"verified"` on match, `"failed"` on 1-byte alteration, `"legacy"` on `storedChecksum == null`.
  - Integration (skip w/o SQL): create snapshot → `checksum` populated; alter `rules_json` in DB post-creation → `restoreSnapshot` throws `AppError 409`, no DB mutation, no pre-restore snapshot created.
  - Integration (skip w/o SQL): snapshot with `checksum = NULL` → restore proceeds, `integrity.status === "legacy"`, warning logged.
  - **Spec ref**: snapshot-integrity all scenarios.

---

### WU-10 — SQL migration (no deps, can run in parallel with WU-9)

**Files**: `sql/snapshots_checksum.sql` — CREATE

- [ ] **T-10** Idempotent `IF NOT EXISTS (...) ALTER TABLE dbo.cfg_config_snapshot ADD checksum NVARCHAR(64) NULL`.
  - **Acceptance**: running twice is a no-op; existing rows get `checksum = NULL`.
  - **Spec ref**: snapshot-integrity "Columna `checksum` en `cfg_config_snapshot`".

---

### WU-11 — Snapshot integrity backend (GREEN, depends on WU-9, WU-10)

**Files**: `api/utils/snapshot_integrity.js` — CREATE; `api/config/env.js` — MODIFY; `api/services/admin_service.js` — MODIFY

- [ ] **T-11** `computeSnapshotChecksum(rulesJson, paramsJson, secret)` (HMAC-SHA256 hex64 over `rulesJson + "\0" + paramsJson`) and `verifySnapshotChecksum({...})` (returns `verified|legacy|failed`, uses `crypto.timingSafeEqual` with length guard) — single canonicalization source. `env.snapshot.hmacSecret = SNAPSHOT_HMAC_SECRET || JWT_SECRET || ""`. `createSnapshot`: compute+persist checksum using the exact same `rulesJson`/`paramsJson` variables passed to the INSERT (no re-stringify). `restoreSnapshot`: `SELECT` includes `checksum`; verify BEFORE `transformWfToPoc`/`applyConfig`; 409 on `failed`; `console.warn` + continue on `legacy`; response includes `integrity: {status, checksumPresent}`.
  - **Acceptance**: WU-9 tests pass.
  - **Spec ref**: snapshot-integrity "Creación de snapshot calcula checksum...", "Restauración de snapshot verifica el checksum...", "Secreto HMAC con fallback".

---

### WU-12 — Snapshot integrity frontend (depends on WU-11)

**Files**: `web/src/app/models/admin.models.ts` — MODIFY; `web/src/app/pages/snapshots-page.component.ts` — MODIFY; `web/src/app/pages/snapshots-page.component.html` — MODIFY

- [ ] **T-12** `RestoreIntegrity` type (`status: "verified"|"legacy"`, `checksumPresent`). On restore success, show verdict ("verificado" / "legado / no verificable"); on 409, show a specific integrity-failure message distinct from generic server errors.
  - **Spec ref**: snapshot-integrity "Veredicto de integridad propagado al frontend".

---

### WU-13 — Frontend cross-cutting polish (no hard dep — can ship with PR1 or standalone)

**Files**: `web/src/app/interceptors/auth.interceptor.ts` — MODIFY; `web/src/app/services/auth.service.ts` — MODIFY; `web/src/app/app.ts` — MODIFY; `web/src/app/app.html` — MODIFY

- [ ] **T-13a** Interceptor: branch `err.status === 403` → show "sin permisos" notice, no `logout()`, no redirect; `401` behavior unchanged.
  - **Spec ref**: admin-rbac "403 no desloguea al usuario", "401 conserva el comportamiento de logout".
- [ ] **T-13b** `auth.service.ts`: decode JWT payload client-side (base64url) to expose `role` and `isAdmin` computed signal (UI defense only, no signature check needed client-side).
- [ ] **T-13c** `app.ts`/`app.html`: hide `/configurador`, `/snapshots`, `/offer-dates` nav links when `!authService.isAdmin()`.
  - **Spec ref**: admin-rbac "Viewer no ve enlaces de administración", "Admin ve la navegación completa".

---

## Dependency Graph

```
WU-1 (RBAC test, RED)
  └── WU-2 (RBAC impl, GREEN)
        ├── WU-3 (mount gate)
        └── WU-4 (docs)

WU-5 (apply test, RED)
  └── WU-6 (apply backend, GREEN)
        └── WU-7 (apply FE types+service)
              └── WU-8 (apply FE dialog)

WU-9 (snapshot test, RED)  ─┐
WU-10 (SQL migration)      ─┴── WU-11 (snapshot backend, GREEN)
                                   └── WU-12 (snapshot FE verdict)

WU-13 (interceptor + role decode + nav) — independent, no hard dependency
```

RBAC (WU-1→4), Apply safeguard (WU-5→8), and Snapshot integrity (WU-9→12) are mutually independent chains — this is the basis for the PR split. WU-13 has no hard dependency and can ship in any PR.

---

## Task → Spec Requirement Traceability

| Task | Spec Requirement |
|------|-------------------|
| T-01, T-02 | admin-rbac: `requireRole` factory, catálogo de roles |
| T-03 | admin-rbac: acceso a rutas administrativas/workflow |
| T-04 | admin-rbac: catálogo referenciado por el seed |
| T-05, T-06 | config-apply-safeguard: validación payload, endpoint de previsualización |
| T-07, T-08 | config-apply-safeguard: diálogo de confirmación |
| T-09, T-11 | snapshot-integrity: creación con checksum, verificación en restore, secreto con fallback |
| T-10 | snapshot-integrity: columna `checksum` |
| T-12 | snapshot-integrity: veredicto propagado al frontend |
| T-13a | admin-rbac: interceptor distingue 403 de 401 |
| T-13c | admin-rbac: navegación admin oculta para viewer |

---

## Migration / Rollout Order (from design.md)

1. Apply `sql/snapshots_checksum.sql` (WU-10) BEFORE deploying API code that reads/writes `checksum` (WU-11).
2. Verify at least one `role="admin"` user exists in `dbo.cfg_user` BEFORE the RBAC gate (WU-3) goes live — mitigates lockout risk noted in proposal.md § Risks.
