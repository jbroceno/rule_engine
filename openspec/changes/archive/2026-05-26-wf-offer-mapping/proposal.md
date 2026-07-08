# Proposal: wf-offer-mapping

**Change**: wf-offer-mapping  
**Status**: Implementation Complete  
**Date**: 2026-05-26  

---

## What

Add an editable, ephemeral `ofertaIdOverrides: Record<offerCode, number>` map to the WF publish flow (both config and snapshot routes) so PRO config can be published to PRE where `dbo.HIPO_OFERTA` IDs differ.

---

## Why

`upsertMotorOferta()` writes `cfg_offer_ruleset.oferta_id` into `MRO_MOTOROFERTA.OFERTA_ID`, which has FK to `dbo.HIPO_OFERTA`. PRE has different IDs, so cross-env publishing fails with FK constraint error. No remapping mechanism today.

---

## Where

**Frontend**: `web/src/app/models/admin.models.ts`, `web/src/app/services/admin-api.service.ts`, `web/src/app/pages/configurator-page.component.{ts,html,css}`, `web/src/app/pages/snapshots-page.component.{ts,html,css}`.

**Backend**: `api/services/admin_workflow_service.js` (`publishCfgToWorkflow`, `publishSnapshotToWorkflow`, `upsertMotorOferta`), `api/controllers/admin_workflow_controller.js`, `api/validators/admin_validator.js` if present.

**No SQL/DDL changes.**

---

## Approach

1. Add optional `ofertaIdOverrides` to the publish payload (both routes).
2. Both Angular dialogs show an editable table of offers pre-filled from `GET /api/admin/offers`.
3. Service resolves effective ID as `overrides[offerCode] ?? offerRow.oferta_id` before calling `upsertMotorOferta`.
4. Ephemeral — no new tables, mapping not persisted between publications.

---

## Out of Scope

- Persisting per-env mappings
- Auto-detecting target env
- Bulk import
- Mappings for params/rules
- Dedicated audit log for overrides

---

## Rollback

Fully additive — revert frontend and/or backend commits; field is optional so old clients keep working. No DDL to undo.

---

## Learned

Two dialogs (configurator + snapshots) share the pattern; if the duplication grows, extract a shared offer-mapping table component in a follow-up.
