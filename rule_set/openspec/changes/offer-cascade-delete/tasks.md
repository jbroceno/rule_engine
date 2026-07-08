# Tasks: offer-cascade-delete

> Change: `offer-cascade-delete`
> Phase: tasks
> Delivery strategy: ask-on-risk
> TDD mode: STRICT (tests first, same commit as behavior)

---

## Work Units

Each work unit = one commit. Tests ship in the SAME commit as the behavior they verify.

---

### WU-1 — Test file skeleton + integration harness (sequential, no deps)

**Files**
- `test/admin_offer_cascade_delete.test.js` — CREATE

**Tasks**

- [ ] **T-01** Create `test/admin_offer_cascade_delete.test.js` with the full test skeleton.
  - Import `node:test`, `node:assert/strict`, `hasSqlCredentials` from `../api/config/env.js`, `getSqlPool` + `sql` from `../api/db/sql_client.js`.
  - All test cases wrapped in `{ skip: !hasSqlCredentials() }`.
  - Outer fixture: open pool, begin `sql.Transaction`, seed one `cfg_offer_ruleset` row + `cfg_offer_dates` period + rules + conditions + condition_values + actions + params (enabled=1 and enabled=0) across 2 `offer_date_id` periods; rollback in `finally` (no persisted state).
  - Test stubs (bodies `assert.fail('not yet')`) for:
    - `T-01a` cascade deletes all tables across all periods (all 6 tables empty for that offerCode after call)
    - `T-01b` `deletedRules` and `deletedParams` counts match seeded rows
    - `T-01c` params with `enabled=0` are included in deletion and count
    - `T-01d` snapshot row created in `cfg_config_snapshot` before delete (snapshot_id in response)
    - `T-01e` snapshot created before data is gone (verify snapshot exists independently of the offer)
    - `T-01f` 404 returned when offerCode does not exist in `cfg_offer_ruleset`
    - `T-01g` atomicity: simulate mid-cascade failure → offer and rules still exist (rollback verified)
    - `T-01h` offer with zero rules and zero params → `deleted:true`, `deletedRules:0`, `deletedParams:0`
  - `npm test` must pass (all skipped when no SQL creds).
  - **Acceptance**: `npm test` exits 0; all 8 cases report SKIP in absence of SQL credentials.
  - **Spec ref**: FR-cascade-atomicity, FR-cascade-scope, FR-snapshot-before, FR-counts, FR-404, FR-soft-deleted-params.

---

### WU-2 — Backend: rewrite `deleteOffer` in `admin_service.js` (depends on WU-1)

**Files**
- `api/services/admin_service.js` lines 892–922 — MODIFY

**Tasks**

- [ ] **T-02** Rewrite `deleteOffer(offerCode, createdBy)`:
  1. Call `createSnapshot({ comment: \`Auto: antes de borrar oferta ${offerCode}\`, createdBy })` **before** `tx.begin()` (uses pool, captures full state).
  2. Call `getSqlPool()`, open `new sql.Transaction(pool)`, `await tx.begin()`.
  3. Resolve `rulesetId` via `resolveRulesetId(tx, offerCode)` — throws AppError 404 if missing (no need for separate pre-check).
  4. Six ordered DELETEs inside try block, each via `tx.request()` with `@rulesetId` as `sql.Int` input:
     - `condition_values`: DELETE cv JOIN cfg_offer_rule_condition c JOIN cfg_offer_rule r WHERE r.ruleset_id = @rulesetId
     - `conditions`: DELETE cfg_offer_rule_condition c JOIN cfg_offer_rule r WHERE r.ruleset_id = @rulesetId
     - `actions`: DELETE cfg_offer_rule_action a JOIN cfg_offer_rule r WHERE r.ruleset_id = @rulesetId
     - `rules`: DELETE cfg_offer_rule WHERE ruleset_id = @rulesetId → capture `rowsAffected[0]` as `deletedRules`
     - `params`: DELETE cfg_offer_param WHERE ruleset_id = @rulesetId (no enabled filter) → capture as `deletedParams`
     - `ruleset`: DELETE cfg_offer_ruleset WHERE ruleset_id = @rulesetId
  5. `await tx.commit()`.
  6. Return `{ offerCode, deleted: true, snapshot_id: snapshot.snapshot_id, deletedRules, deletedParams }`.
  7. `catch`: `await tx.rollback()`, re-throw AppError as-is, wrap others in AppError 500.
  - Remove the 409 guard (ruleCount check) entirely.
  - Function signature: `export async function deleteOffer(offerCode, createdBy = null)`.
  - **Acceptance**: all WU-1 test cases pass (T-01a through T-01h) with SQL credentials.
  - **Spec ref**: FR-cascade-atomicity, FR-cascade-scope, FR-snapshot-before, FR-counts, FR-404, FR-soft-deleted-params.

---

### WU-3 — Controller: forward `createdBy` + new response shape (depends on WU-2)

**Files**
- `api/controllers/admin_offers_controller.js` — MODIFY (function `removeOffer`)

**Tasks**

- [ ] **T-03** Update `removeOffer`:
  - Read `createdBy` from `req.query.createdBy ?? null`.
  - Call `await deleteOffer(offerCode, createdBy)`.
  - Forward the full service result as-is via `res.status(200).json(result)`.
  - No other changes to the controller.
  - **Acceptance**: `GET /api/admin/offers/:offerCode` with `?createdBy=test` passes `"test"` to service; response body contains `snapshot_id`, `deletedRules`, `deletedParams`.
  - **Spec ref**: FR-response-shape, FR-snapshot-comment-createdBy.

---

### WU-4 — Frontend model: extend `AdminOfferDeleteResponse` (parallel with WU-3, depends on WU-2 for integration awareness)

**Files**
- `web/src/app/models/admin.models.ts` — MODIFY (interface `AdminOfferDeleteResponse`)

**Tasks**

- [ ] **T-04** Extend the interface:
  ```ts
  export interface AdminOfferDeleteResponse {
    offerCode: string;
    deleted: boolean;
    snapshot_id: number;
    deletedRules: number;
    deletedParams: number;
  }
  ```
  - **Acceptance**: TypeScript compiles without errors; existing usages that only use `deleted` remain valid.
  - **Spec ref**: FR-response-shape.

---

### WU-5 — Frontend service: add `createdBy` query param to `deleteOffer` (depends on WU-4)

**Files**
- `web/src/app/services/admin-api.service.ts` — MODIFY (method `deleteOffer`)

**Tasks**

- [ ] **T-05** Update `deleteOffer` signature and HTTP call:
  - New signature: `deleteOffer(offerCode: string, createdBy?: string): Observable<AdminOfferDeleteResponse>`
  - If `createdBy` is provided and non-empty, append `?createdBy=<value>` to the URL.
  - Return type stays `Observable<AdminOfferDeleteResponse>` (now with the extended fields).
  - **Acceptance**: method compiles; `createdBy` is appended to URL when provided; omitted when not.
  - **Spec ref**: FR-response-shape, FR-snapshot-comment-createdBy.

---

### WU-6 — Frontend component: cascade warning + success message with counts (depends on WU-4, WU-5)

**Files**
- `web/src/app/pages/configurator-page.component.ts` — MODIFY (methods `deleteOffer` ~line 496 and `executeOfferDelete` ~line 1354)

**Tasks**

- [ ] **T-06a** Update `deleteOffer` dialog message (line ~500):
  - Replace current message with:
    ```
    Se eliminarán la oferta "${offer.offerCode}" y TODAS sus reglas y parámetros de todos los períodos. Esta operación no se puede deshacer.
    ```
  - Dialog title stays "Eliminar oferta".
  - No pre-query to server.
  - **Acceptance**: dialog text visible to user matches spec exactly, including `offerCode` interpolated.

- [ ] **T-06b** Update `executeOfferDelete` success handler (line ~1361):
  - Change `next` callback parameter type from `() =>` to `(result: AdminOfferDeleteResponse) =>`.
  - Build success message:
    ```
    Oferta ${offerCode} eliminada. Se han borrado ${result.deletedRules} regla(s) y ${result.deletedParams} parámetro(s). Snapshot de seguridad: #${result.snapshot_id}.
    ```
  - **Acceptance**: success message displays counts and snapshot_id from server response.
  - **Spec ref**: FR-dialog-warning, FR-success-counts.

---

### WU-7 — Frontend spec: update component test stub for new response shape (depends on WU-6)

**Files**
- `web/src/app/pages/configurator-page.component.spec.ts` — MODIFY (mock `deleteOffer`)

**Tasks**

- [ ] **T-07** Update the `deleteOffer` mock to return the full response shape:
  ```ts
  deleteOffer: () => of({ deleted: true, offerCode: 'TEST', snapshot_id: 1, deletedRules: 0, deletedParams: 0 }),
  ```
  - Run `npm run web:test` — must pass without type errors.
  - **Acceptance**: `npm run web:test` exits 0.
  - **Spec ref**: FR-response-shape (test coverage).

---

## Dependency Graph

```
WU-1 (test skeleton)
  └── WU-2 (service rewrite)  ← sequential
        └── WU-3 (controller) ─┐
        └── WU-4 (TS model)   ─┤─ parallel
              └── WU-5 (service TS)
                    └── WU-6 (component)
                          └── WU-7 (component spec)
```

WU-3 and WU-4 can be committed in parallel once WU-2 is green.
WU-5 depends on WU-4 (needs extended type).
WU-6 depends on WU-4 + WU-5 (uses both type and service method).
WU-7 depends on WU-6 (mocks updated method).

---

## Task → Spec Requirement Traceability

| Task | Spec Requirement |
|------|-----------------|
| T-01 | All (skeleton covers all scenarios) |
| T-02 | FR-cascade-atomicity, FR-cascade-scope, FR-snapshot-before, FR-counts, FR-404, FR-soft-deleted-params, FR-multi-period |
| T-03 | FR-response-shape, FR-snapshot-comment-createdBy |
| T-04 | FR-response-shape |
| T-05 | FR-response-shape, FR-snapshot-comment-createdBy |
| T-06a | FR-dialog-warning |
| T-06b | FR-success-counts, FR-response-shape |
| T-07 | FR-response-shape (regression guard) |

---

## Review Workload Forecast

| Metric | Estimate |
|--------|----------|
| `admin_service.js` — deleteOffer rewrite | ~55 lines changed (remove ~30, add ~85) |
| `admin_offers_controller.js` — removeOffer | ~5 lines changed |
| `admin.models.ts` — interface extension | ~3 lines changed |
| `admin-api.service.ts` — method update | ~6 lines changed |
| `configurator-page.component.ts` — 2 methods | ~15 lines changed |
| `configurator-page.component.spec.ts` — mock | ~3 lines changed |
| `test/admin_offer_cascade_delete.test.js` — new file | ~180 lines added |
| **Total estimated changed/added lines** | **~267 lines** |

- **Chained PRs recommended**: No
- **400-line budget risk**: Low (~267 lines, well under 400)
- **Decision needed before apply**: No — single PR is safe at this scope

> All changes are confined to 7 files. The largest single unit is the new integration test file (~180 lines). Backend rewrite is contained in one function (~85 lines net-new). Frontend changes are mechanical type/message updates across 4 files (~27 lines total).
