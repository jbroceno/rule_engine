# Apply Progress — wf-offer-mapping

## Mode: Standard (not Strict TDD)

## Completed Tasks

### Phase 1: Foundation — Types & Backend Signatures
- [x] 1.1 Added `code` column to SELECT in `publishCfgToWorkflow` inside `admin_workflow_service.js`
- [x] 1.2 Added `options = {}` param + `ofertaIdOverrides` destructure + `effectiveOfertaId` resolution in `publishCfgToWorkflow`
- [x] 1.3 Added `options = {}` param + `ofertaIdOverrides` destructure + `effectiveOfertaId` resolution in `publishSnapshotToWorkflow`
- [x] 1.4 Extended `restoreSnapshot` in `admin_service.js` to accept and forward `ofertaIdOverrides`
- [x] 1.5 Added `ofertaIdOverrides?: Record<string, number>` to `AdminWorkflowPublicarPayload`; added `AdminSnapshotRestoreWfOptions` interface in `admin.models.ts`

### Phase 2: Core Implementation — Controller & Service Wiring
- [x] 2.1 Added `parseOfertaIdOverrides` validator helper in `admin_snapshots_controller.js`; updated `postWorkflowPublicar` to validate and forward
- [x] 2.2 Updated `postSnapshotRestore` to validate and forward `ofertaIdOverrides` when `destino === "WF"`
- [x] 2.3 Updated `admin-api.service.ts` `restoreSnapshot()` to accept and forward `ofertaIdOverrides`

### Phase 3: Integration — Configurator UI
- [x] 3.1 Added `publicarOfertaIdOverrides` signal, `publicarOverridesValid` computed, `setPublicarOfertaId()` helper, seeding in `openPublicarDialog()`, and override payload in `executePublicarWf()` in `configurator-page.component.ts`
- [x] 3.2 Added offer-mapping `<table>` with per-row `<input type="number" min="1">` and validation error spans inside the "publicar-wf" dialog in `configurator-page.component.html`; `[disabled]` binding updated to include `!publicarOverridesValid()`
- [x] 3.3 Added `.oferta-mapping-section`, `.oferta-mapping-table`, `.oferta-id-input`, `.field-error` styles in `configurator-page.component.css`

### Phase 4: Integration — Snapshots UI
- [x] 4.1 Added `wfOffers`, `restoreOfertaIdOverrides` signals, `restoreOverridesValid` computed, `loadOffersForWfMapping()`, `onRestoreDestinoChange()`, `setRestoreOfertaId()`, and updated `executeRestore()` in `snapshots-page.component.ts`
- [x] 4.2 Added offer-mapping table inside restore dialog (shown only when `restoreDestino() === 'WF'` and offers loaded); updated destino select to call `onRestoreDestinoChange`; confirm button disabled when `!restoreOverridesValid()` and `destino === 'WF'` in `snapshots-page.component.html`
- [x] 4.3 Added same table styles plus `.wf-range-fields` and `.required-mark` in `snapshots-page.component.css`

### Phase 5: Testing
- [x] 5.1 `test/workflow_publish.test.js` — `resolveOfertaId` with override present uses override value
- [x] 5.2 `test/workflow_publish.test.js` — `resolveOfertaId` for unmapped offer falls back to DB value
- [x] 5.3 `test/workflow_publish.test.js` — `resolveOfertaId` with undefined/null overrides uses DB value
- [x] 5.4 `test/workflow_publish.test.js` — `parseOfertaIdOverrides` rejects -1, 0, float, string, array; accepts 1+
- [ ] 5.5 Manual smoke test — configurator dialog (pending operator)
- [ ] 5.6 Manual smoke test — snapshots dialog (pending operator)

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `api/services/admin_workflow_service.js` | Modified | Added `code` to SELECT; added `options` param + `effectiveOfertaId` resolution in both publish functions |
| `api/services/admin_service.js` | Modified | `restoreSnapshot` now accepts and forwards `ofertaIdOverrides` |
| `api/controllers/admin_snapshots_controller.js` | Modified | Added `parseOfertaIdOverrides` validator; both publish/restore controllers now validate and forward the field |
| `web/src/app/models/admin.models.ts` | Modified | `AdminWorkflowPublicarPayload` extended; `AdminSnapshotRestoreWfOptions` added |
| `web/src/app/services/admin-api.service.ts` | Modified | `restoreSnapshot` options type extended to include `ofertaIdOverrides` |
| `web/src/app/pages/configurator-page.component.ts` | Modified | New signals, computed, helper method, dialog seeding, payload assembly |
| `web/src/app/pages/configurator-page.component.html` | Modified | Offer-mapping table in publicar-wf dialog; confirm button disabled guard updated |
| `web/src/app/pages/configurator-page.component.css` | Modified | Offer-mapping table styles added |
| `web/src/app/pages/snapshots-page.component.ts` | Modified | New signals, computed, helper methods, `executeRestore` override support |
| `web/src/app/pages/snapshots-page.component.html` | Modified | Offer-mapping table in restore dialog; destino select now calls `onRestoreDestinoChange` |
| `web/src/app/pages/snapshots-page.component.css` | Modified | Offer-mapping table styles + wf-range-fields + required-mark added |
| `test/workflow_publish.test.js` | Created | Pure unit tests for override resolution logic and controller validator |

## Deviations from Design

- Task 4.1 mentions `adminApiService.listOffers()` but the actual method in the service is `getOffers()`. Used `getOffers()` to match the existing codebase.
- `parseOfertaIdOverrides` validation returns HTTP 400 as specified (throws `AppError` with status 400). The spec says HTTP 422 in WF-04 but the design.md says 400 and the controller uses `AppError` with 400 throughout. Kept consistent with the codebase pattern (400).
- Unit tests in Phase 5 test the pure override resolution logic extracted into a helper rather than mocking `mssql` for the full service functions — this is the only viable approach without a DB mock infrastructure. The validation logic is identical to what the controller uses.

## Status

17/19 tasks complete (5.5 and 5.6 are manual smoke tests). Ready for `sdd-verify`.
