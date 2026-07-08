# Tasks: wf-offer-mapping

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~200–250 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | All backend + frontend changes | PR 1 (main) | Single coherent PR; ~200–250 lines total |

---

## Phase 1: Foundation — Types & Backend Signatures

- [x] 1.1 `api/services/admin_workflow_service.js` — Add `code` column to the `SELECT` from `cfg_offer_ruleset` inside `publishCfgToWorkflow`. Verify the column is available in the existing query's result set. (Satisfies: WF-03, critical note from design §7)
- [x] 1.2 `api/services/admin_workflow_service.js` — Change `publishCfgToWorkflow(offerDateId, rangoDestino, options = {})` to destructure `options.ofertaIdOverrides`; compute `effectiveOfertaId = options.ofertaIdOverrides?.[offer.code] ?? offer.oferta_id` per offer before calling `upsertMotorOferta`. (Satisfies: WF-03)
- [x] 1.3 `api/services/admin_workflow_service.js` — Apply the same `ofertaIdOverrides` pattern to `publishSnapshotToWorkflow(snapshotRules, snapshotParams, rangoDestino, options = {})`. (Satisfies: WF-03)
- [x] 1.4 `api/services/admin_service.js` — Extend `restoreSnapshot` to accept and forward `ofertaIdOverrides` to `publishSnapshotToWorkflow` when `destino === "WF"`. (Satisfies: WF-02, WF-03)
- [x] 1.5 `web/src/app/models/admin.models.ts` — Add `ofertaIdOverrides?: Record<string, number>` to `AdminWorkflowPublicarPayload`. Add or extend `AdminSnapshotRestoreWfOptions` with the same field. (Satisfies: WF-03)

## Phase 2: Core Implementation — Controller & Service Wiring

- [x] 2.1 `api/controllers/admin_snapshots_controller.js` — In `postWorkflowPublicar`: parse `ofertaIdOverrides` from `req.body`; validate it is a plain object with string keys and integer-≥1 values; reject with HTTP 400 and message `"ofertaIdOverrides debe ser un objeto de {offerCode: oferta_id} con enteros positivos."` if invalid; forward to `publishCfgToWorkflow`. (Satisfies: WF-04)
- [x] 2.2 `api/controllers/admin_snapshots_controller.js` — In `postSnapshotRestore`: apply the same parse + validate logic for `ofertaIdOverrides` (only when `destino === "WF"`); forward to `restoreSnapshot`. (Satisfies: WF-04)
- [x] 2.3 `web/src/app/services/admin-api.service.ts` — Update `publishToWorkflow()` to include `ofertaIdOverrides` from the payload. Update `restoreSnapshot()` to accept and forward `ofertaIdOverrides` when `destino === "WF"`. (Satisfies: WF-03)

## Phase 3: Integration — Configurator UI

- [x] 3.1 `web/src/app/pages/configurator-page.component.ts` — Add signal `publicarOfertaIdOverrides = signal<Record<string, number | null>>({})`. In the method that opens the Publicar WF dialog, seed it from `offers()`: `offers().reduce((acc, o) => ({ ...acc, [o.offerCode]: o.oferta_id ?? null }), {})`. Add computed `publicarOverridesValid = computed(() => Object.values(publicarOfertaIdOverrides()).every(v => v !== null && Number.isInteger(v) && v >= 1))`. Pass `ofertaIdOverrides: publicarOfertaIdOverrides()` in `executePublicarWf` payload. (Satisfies: WF-01, WF-04)
- [x] 3.2 `web/src/app/pages/configurator-page.component.html` — Inside the "publicar-wf" dialog: add a `<table>` iterating `offers()`. Each row: read-only `offerCode` cell + `<input type="number" min="1" required>` bound to `publicarOfertaIdOverrides()[offer.offerCode]` (two-way via `(input)` event). Show per-row validation error when value is empty or `< 1`. Bind `[disabled]="!publicarOverridesValid()"` on the confirm button. (Satisfies: WF-01, WF-04)
- [x] 3.3 `web/src/app/pages/configurator-page.component.css` — Add minimal table styles for the offer-mapping table (re-use existing dialog table classes where available). (Satisfies: WF-01)

## Phase 4: Integration — Snapshots UI

- [x] 4.1 `web/src/app/pages/snapshots-page.component.ts` — Add signals `wfOffers = signal<AdminOffer[]>([])` and `restoreOfertaIdOverrides = signal<Record<string, number | null>>({})`. Add computed `restoreOverridesValid` (same logic as 3.1). Add method `loadOffersForWfMapping()` that calls `adminApiService.listOffers()` and seeds both signals. Call this method when the restore dialog's `destino` changes to `"WF"`. Pass `ofertaIdOverrides: restoreOfertaIdOverrides()` in `executeRestore` when `destino === "WF"`. (Satisfies: WF-02, WF-04)
- [x] 4.2 `web/src/app/pages/snapshots-page.component.html` — Inside the restore dialog, conditionally render the mapping table (`*ngIf="restoreDestino() === 'WF'"`) with the same structure as task 3.2, iterating `wfOffers()` and binding to `restoreOfertaIdOverrides`. Bind confirm button `[disabled]` to `restoreOverridesValid()`. (Satisfies: WF-02, WF-04)
- [x] 4.3 `web/src/app/pages/snapshots-page.component.css` — Same styling additions as task 3.3. (Satisfies: WF-02)

## Phase 5: Testing

- [x] 5.1 `rule_set/test/rule_engine.test.js` (or new `test/workflow_publish.test.js`) — Unit test `publishCfgToWorkflow` with `ofertaIdOverrides` present: assert `upsertMotorOferta` is called with the overridden `oferta_id` for mapped offers. (Satisfies: WF-03 scenario "Backend uses override value")
- [x] 5.2 Same test file — Unit test fallback: omit an offer from `ofertaIdOverrides`; assert `upsertMotorOferta` is called with the DB `oferta_id` for that offer. (Satisfies: WF-03 scenario "Backend falls back for unmapped offers")
- [x] 5.3 Same test file — Unit test: omit `ofertaIdOverrides` entirely; assert behaviour is unchanged (all DB values used). (Satisfies: WF-03 scenario "Payload without the field")
- [x] 5.4 Controller validation test — send `ofertaIdOverrides: { "OFERTA_RESTRICTIVA": -1 }` to `POST /api/admin/workflow/publicar`; assert HTTP 400 with descriptive message. (Satisfies: WF-04 scenario "Backend rejects invalid override values")
- [ ] 5.5 Manual smoke test — Open configurator Publicar WF dialog; verify table shows correct pre-filled values from `GET /admin/offers`; submit without changes; confirm publication succeeds. (Satisfies: WF-01 scenarios "Dialog opens", "No overrides")
- [ ] 5.6 Manual smoke test — Open snapshots Publicar snapshot a WF dialog; verify table appears when `destino === "WF"` and is absent otherwise. (Satisfies: WF-02, WF-05)
