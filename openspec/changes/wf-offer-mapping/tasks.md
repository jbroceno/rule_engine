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

**Decision needed before apply**: No  
**Chained PRs recommended**: No  
**Chain strategy**: stacked-to-main  
**400-line budget risk**: Low

---

## Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | All backend + frontend changes | PR 1 (main) | Single coherent PR; ~200–250 lines total |

---

## Phase 1: Foundation — Types & Backend Signatures

- [ ] 1.1 `api/services/admin_workflow_service.js` — Add `code` column to the SELECT from `cfg_offer_ruleset` inside `publishCfgToWorkflow`.
- [ ] 1.2 `api/services/admin_workflow_service.js` — Destructure `options.ofertaIdOverrides`; resolve `effectiveOfertaId = options.ofertaIdOverrides?.[offer.code] ?? offer.oferta_id` per offer before `upsertMotorOferta`.
- [ ] 1.3 `api/services/admin_workflow_service.js` — Same override pattern in `publishSnapshotToWorkflow`.
- [ ] 1.4 `api/services/admin_service.js` — `restoreSnapshot` accepts and forwards `ofertaIdOverrides` to `publishSnapshotToWorkflow` when `destino === "WF"`.
- [ ] 1.5 `web/src/app/models/admin.models.ts` — Add `ofertaIdOverrides?: Record<string, number>` to `AdminWorkflowPublicarPayload` and snapshot restore options.

## Phase 2: Core Implementation — Controller & Service Wiring

- [ ] 2.1 `api/controllers/admin_snapshots_controller.js` — `postWorkflowPublicar`: parse + validate `ofertaIdOverrides`; reject HTTP 400 if invalid; forward to service.
- [ ] 2.2 `api/controllers/admin_snapshots_controller.js` — `postSnapshotRestore`: same validation (only when `destino === "WF"`); forward to `restoreSnapshot`.
- [ ] 2.3 `web/src/app/services/admin-api.service.ts` — Update `publishToWorkflow()` and `restoreSnapshot()` to forward `ofertaIdOverrides`.

## Phase 3: Integration — Configurator UI

- [ ] 3.1 `configurator-page.component.ts` — Signal `publicarOfertaIdOverrides`, seed on dialog open, computed validity, include in payload.
- [ ] 3.2 `configurator-page.component.html` — Offer mapping table in Publicar WF dialog, per-row validation, confirm button disabled guard.
- [ ] 3.3 `configurator-page.component.css` — Table styles.

## Phase 4: Integration — Snapshots UI

- [ ] 4.1 `snapshots-page.component.ts` — Signals `wfOffers` + `restoreOfertaIdOverrides`; `loadOffersForWfMapping()` on `destino → "WF"`; forward in `executeRestore`.
- [ ] 4.2 `snapshots-page.component.html` — Conditional mapping table (`*ngIf="restoreDestino() === 'WF'"`), same structure as configurator.
- [ ] 4.3 `snapshots-page.component.css` — Same table styles.

## Phase 5: Testing

- [ ] 5.1 Unit test: `publishCfgToWorkflow` with overrides → `upsertMotorOferta` called with overridden ID.
- [ ] 5.2 Unit test: fallback — unmapped offer uses DB `oferta_id`.
- [ ] 5.3 Unit test: missing `ofertaIdOverrides` → unchanged behaviour.
- [ ] 5.4 Controller test: `ofertaIdOverrides: { OFERTA_RESTRICTIVA: -1 }` → HTTP 400.
- [ ] 5.5 Manual smoke: configurator dialog pre-fill + publish without changes succeeds.
- [ ] 5.6 Manual smoke: snapshots dialog table appears only when `destino === "WF"`.
