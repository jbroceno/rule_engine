# Proposal — wf-offer-mapping

## Intent

Allow operators to **override the `oferta_id` per offer** at the moment of publishing a config or restoring a snapshot to Workflow (WF), so that publications from PRO can succeed in PRE (and any other environment whose `dbo.HIPO_OFERTA` catalog uses different IDs).

### Problem

When publishing a config/snapshot to WF, the backend reads `oferta_id` from `cfg_offer_ruleset` and uses it directly in `upsertMotorOferta()`. That value is written to `MRO_MOTOROFERTA.OFERTA_ID`, which has a FK constraint (`FK_MRO_MOTOROFERTA_OFERTA2_ID`) against `dbo.HIPO_OFERTA`.

- In **PRO**, the `oferta_id` stored in `cfg_offer_ruleset` matches `HIPO_OFERTA`. Publication works.
- In **PRE**, `HIPO_OFERTA` is an independent catalog with **different** IDs. Publishing the PRO config to PRE fails with a FK constraint error.

There is currently no way to remap offer IDs at publication time. The only workaround is to manually mutate `cfg_offer_ruleset.oferta_id` before each publish — error-prone and not auditable.

### Why now

- PRE deploys are blocked end-to-end whenever the PRO and PRE `HIPO_OFERTA` IDs diverge.
- Snapshots restored across environments hit the same wall.
- The fix is small, localized (one new field in the payload, one branch in the upsert), and unblocks the testing pipeline immediately.

### Success criteria

1. The configurator's "Publicar a WF" dialog shows a table of all offers with editable `oferta_id` inputs, pre-filled from `GET /api/admin/offers`.
2. The snapshots page's "Publicar snapshot a WF" dialog shows the same table, pre-filled from the snapshot's offers.
3. The publish payload carries an optional `ofertaIdOverrides: Record<offerCode, number>` map.
4. `upsertMotorOferta` uses the overridden ID when the offer's code is present in the map; otherwise it falls back to the DB value (current behaviour).
5. Publishing PRO config to PRE succeeds when the operator types the correct PRE IDs in the dialog.
6. No DB schema change. No persistence of the mapping between publications.

## Scope

### In scope

- **Frontend (Angular 20, `web/src/app/`)**
  - `models/admin.models.ts` — extend `AdminWorkflowPublicarPayload` and the snapshot publish payload with `ofertaIdOverrides?: Record<string, number>`.
  - `pages/configurator-page.component.{ts,html,css}` — add an offer-ID-mapping table to the existing publicar-WF dialog. Pre-fill from the offers signal. New signal for the overrides map.
  - `pages/snapshots-page.component.{ts,html,css}` — add the same table to the snapshot restore-to-WF dialog. Pre-fill from the snapshot's offers (which are available because snapshots store full rules+params; we use the offers exposed by `GET /api/admin/offers` as the source of truth for the dropdown rows).
  - `services/admin-api.service.ts` — pass the new field through to `POST /api/admin/workflow/publish` and `POST /api/admin/workflow/publish-snapshot`.

- **Backend (Node.js Express, `api/`)**
  - `controllers/admin_workflow_controller.js` (or whichever controller currently handles the two routes) — accept and forward `ofertaIdOverrides`.
  - `services/admin_workflow_service.js`
    - `publishCfgToWorkflow(offerDateId, rangoDestino, options)` — accept `ofertaIdOverrides` in options.
    - `publishSnapshotToWorkflow(snapshotRules, snapshotParams, rangoDestino, options)` — same.
    - `upsertMotorOferta(tx, ofertaId, ...)` — receive an additional `effectiveOfertaId` (or have the caller resolve the override before invocation) and use it for both the SELECT existence check and the INSERT.
  - `validators/admin_validator.js` (if a validator exists for this route) — accept the new optional field; each value must be a positive integer.

- **Validation rules**
  - `ofertaIdOverrides` is optional. If present, it is an object whose keys are valid `offerCode` strings (must exist in `cfg_offer_ruleset`) and whose values are positive integers.
  - Empty or missing entries fall back to the DB value (no change in behaviour for un-mapped offers).

### Out of scope

- Persisting offer-ID mappings per environment (e.g. a `cfg_offer_workflow_mapping` table keyed by `environment` + `offerCode`). Operators re-enter the mapping each publication. This is acceptable for the immediate need; a follow-up change can add persistence once the volume of publications justifies it.
- Auto-detecting the target environment and looking up its `HIPO_OFERTA` catalog. Out of scope because the API server does not currently know which environment it is talking to and cross-environment SQL is not configured.
- Bulk import of mappings from a JSON file.
- Mappings for `cfg_offer_param`, rules, or other entities. Only `oferta_id` is in scope — that is the only column with a FK to `HIPO_OFERTA`.
- Audit log of which overrides were used for which publication. Future enhancement; for now the snapshot created automatically before publish already records the original config.

## Approach

### High-level

1. **Add an optional override map to the publish API.** The map is `Record<offerCode, number>`. Backend resolves the effective `oferta_id` per offer as `overrides[offerCode] ?? offerRow.oferta_id`.
2. **Surface the map in both dialogs as a table.** Pre-fill with the current DB IDs so the common case (publishing to an environment with matching IDs) is a no-op for the user — they just confirm. For PRE, they edit the rows that need to change.
3. **Keep the change ephemeral.** No new tables, no new endpoints. The mapping lives only in the request payload.

### Rationale

| Decision | Why |
|---|---|
| **Ephemeral override (no persistence)** | Smallest change that unblocks PRE publishing. Persisting per-environment mappings requires deciding what "environment" means at the API layer, which currently has no concept of target environment. Defer until needed. |
| **Pre-fill from current DB values** | The override table is non-disruptive for PRO publications — operators just click confirm. Reduces cognitive load and the risk of accidental null/zero values. |
| **Override per `offerCode`, not per `ruleset_id`** | `offerCode` is the human-readable key the operator already uses in the configurator. It is stable across snapshots and matches the column shown in the offers table. |
| **Resolve overrides in the service layer, not the controller** | Keeps the controller thin per project standards. The service already owns the WF publication flow and the `upsertMotorOferta` call. |
| **Both routes (config + snapshot) get the same change** | They hit the same `upsertMotorOferta` and the user pain is identical for both. Doing them together avoids a half-fixed feature. |
| **No new endpoint to fetch "WF offer IDs"** | We don't have credentials/topology for cross-DB reads. The operator brings the target IDs from outside the tool (DBA, env config, etc.). |

### Affected modules

**Frontend**
- `web/src/app/models/admin.models.ts` — payload interface extended.
- `web/src/app/services/admin-api.service.ts` — `publishToWorkflow` and the snapshot publish call forward the new field.
- `web/src/app/pages/configurator-page.component.ts` + `.html` + `.css` — new signal (`publicarOfertaIdOverrides`), new dialog section.
- `web/src/app/pages/snapshots-page.component.ts` + `.html` + `.css` — same pattern.

**Backend**
- `api/services/admin_workflow_service.js`
  - `publishCfgToWorkflow` — accepts `ofertaIdOverrides`.
  - `publishSnapshotToWorkflow` — accepts `ofertaIdOverrides`.
  - `upsertMotorOferta` — uses the effective ID.
- `api/controllers/admin_workflow_controller.js` (or equivalent route handler) — accepts the optional field from `req.body` and passes it down.
- `api/validators/admin_validator.js` (if applicable) — validates the field shape.

**No changes**
- SQL schema. No DDL.
- `cfg_offer_ruleset`, `cfg_offer_param`, snapshots table. Read-only in this change.
- Rule engine (`rule_engine.js`). Unrelated to WF publication.

### Risks

- **Operator typo → wrong `MRO_MOTOROFERTA.OFERTA_ID` written.** Mitigation: pre-fill with the DB value so doing nothing yields the current behaviour; require positive integers; the auto-snapshot taken before publish still allows recovery.
- **`HIPO_OFERTA` row missing in target.** Override doesn't help if the target ID is also absent. The FK error will still surface, but now it points at an operator-supplied value, making the diagnosis obvious ("the ID you typed doesn't exist in HIPO_OFERTA").
- **Two dialogs to keep in sync.** Mitigation: extract the offer-mapping table into a shared component if duplication grows in a follow-up. For this change, copy-paste is acceptable given the two dialogs already share structure.

## Rollback plan

The change is additive and ephemeral:

1. **API**: `ofertaIdOverrides` is an optional field. Reverting the backend to ignore it (or removing the field entirely) restores prior behaviour — old clients never sent it, so no break.
2. **Frontend**: Removing the override table from the dialogs and the `ofertaIdOverrides` from the payload restores the previous UX. No persisted state needs cleanup.
3. **Database**: No DDL, no data migrations. Nothing to roll back at the SQL layer.
4. **Snapshots**: Untouched. Existing snapshots remain restorable exactly as before.

Procedure if a regression is detected post-deploy:
- Frontend-only regression → revert the frontend commit; backend keeps accepting the field harmlessly.
- Backend regression in `upsertMotorOferta` → revert the service file; the frontend will keep sending the field, which the reverted backend will ignore. No errors.

## Open questions

1. Should the dialog warn when an overridden ID equals the DB value (no-op)? Likely no — confusing. Defer.
2. Should we expose a "reset to DB values" button in the table? Nice-to-have, not required for v1.
3. Should `ofertaIdOverrides` be logged into the auto-snapshot's `comment` for traceability? Worth doing if cheap; will confirm during spec/design.
