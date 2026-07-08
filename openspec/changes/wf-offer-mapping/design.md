# Design: wf-offer-mapping

**What**: Technical design for `wf-offer-mapping` — adds an optional, ephemeral `ofertaIdOverrides: Record<offerCode, number>` map to both Workflow publication paths (config publish + snapshot restore-to-WF). The mapping table is rendered inline in each dialog, pre-filled from `GET /admin/offers`, and the backend service resolves `effectiveOfertaId = overrides[offerCode] ?? offerRow.oferta_id` before calling the existing `upsertMotorOferta` (signature unchanged).

**Why**: Publishing the PRO config to PRE currently fails on the `FK_MRO_MOTOROFERTA_OFERTA2_ID` constraint because `dbo.HIPO_OFERTA` is an independent catalog in PRE with different IDs. Operators need a way to remap `oferta_id` per publication without mutating `cfg_offer_ruleset` or adding a persistence layer.

---

## Where

- `openspec/changes/wf-offer-mapping/design.md` — full design document
- Frontend: `web/src/app/models/admin.models.ts`, `web/src/app/services/admin-api.service.ts`, `web/src/app/pages/configurator-page.component.{ts,html,css}`, `web/src/app/pages/snapshots-page.component.{ts,html,css}`
- Backend: `api/controllers/admin_snapshots_controller.js` (hosts `postWorkflowPublicar` + `postSnapshotRestore`), `api/services/admin_workflow_service.js` (`publishCfgToWorkflow`, `publishSnapshotToWorkflow`), `api/services/admin_service.js` (`restoreSnapshot`)

---

## ADRs

### ADR-001 Offers source
Re-use configurator's existing `offers` signal; in snapshots page, load via `GET /admin/offers` only when destino=WF (no permanent signal).

### ADR-002 Payload format
Send the FULL table (overridden + unchanged); backend uses `??` fallback. Simplest backend logic, resilient to missing keys.

### ADR-003 Form validation
HTML5 `type="number" min="1"` + computed signal `publicarOverridesValid()`. No FormGroup — keep signal-only paradigm.

### ADR-004 Shared component
Do NOT extract yet (only 2 call sites). Extract when a 3rd caller appears.

### ADR-005 Resolution layer
Resolve overrides in service, not controller. `upsertMotorOferta` signature stays the same; caller passes effective ID.

---

## Implementation Notes

- `publishCfgToWorkflow` currently SELECTs `ruleset_id, oferta_id, offer_rank, published_version` but NOT `code` — must add `code` to enable per-offerCode override lookup. `publishSnapshotToWorkflow` already SELECTs `code`.
- Snapshot publish goes through `admin_service.restoreSnapshot(snapshotId, { destino: "WF", ... })` which delegates to `publishSnapshotToWorkflow`. The override map must flow through `restoreSnapshot` options.
- Routes live in `admin_routes.js`: `POST /admin/workflow/publicar` and `POST /admin/snapshots/:id/restore` (with `destino: "WF"`). Both handled by `admin_snapshots_controller.js`.
- No DB / DDL changes. Pure additive payload field with default behaviour preserved when omitted.
