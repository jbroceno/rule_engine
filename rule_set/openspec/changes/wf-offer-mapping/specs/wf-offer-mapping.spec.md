# wf-offer-mapping Specification

## Purpose

This is a new-capability spec. There are no existing specs to delta against. It covers the full observable behaviour introduced by `wf-offer-mapping`.

The change adds an optional, ephemeral `ofertaIdOverrides` map to both WF publish flows (config publish and snapshot publish) so operators can remap offer IDs at publication time — primarily to unblock publishing PRO configs to PRE environments where `dbo.HIPO_OFERTA` IDs differ.

---

## Requirements

### Requirement: WF-01 — Offer ID Override Table in Config Publish Dialog

The configurator's "Publicar a WF" dialog MUST display a table listing every enabled offer with its `offerCode` and `oferta_id`. Each `oferta_id` cell MUST be an editable input, pre-filled with the value returned by `GET /api/admin/offers` at the time the dialog is opened. The user MAY change any value before confirming. Unchanged values MUST be sent with their original pre-filled values.

#### Scenario: Dialog opens with pre-filled values

- GIVEN the user opens the "Publicar a WF" dialog in the configurator
- WHEN the dialog renders
- THEN a table appears with one row per enabled offer
- AND each row shows the `offerCode` and the `oferta_id` from the current DB (`cfg_offer_ruleset`)
- AND each `oferta_id` cell is an editable input

#### Scenario: No overrides — publish proceeds unchanged

- GIVEN the dialog is open with pre-filled values
- WHEN the user confirms without editing any `oferta_id`
- THEN the publish request is sent with `ofertaIdOverrides` containing all original DB values
- AND the publication succeeds identically to the pre-change behaviour

#### Scenario: User overrides one or more IDs

- GIVEN the dialog is open with pre-filled values
- WHEN the user edits one or more `oferta_id` inputs and confirms
- THEN the publish request carries `ofertaIdOverrides` with the user-supplied values for edited rows
- AND the backend uses those override values instead of the DB values for the affected offers

---

### Requirement: WF-02 — Offer ID Override Table in Snapshot Publish Dialog

The snapshots page's "Publicar snapshot a WF" dialog MUST display the same offer-ID table as WF-01. The rows MUST be sourced from `GET /api/admin/offers` (current DB state, not the snapshot's internal offer data). All editability and pre-fill rules from WF-01 apply.

#### Scenario: Dialog opens for snapshot publish

- GIVEN the user opens the "Publicar snapshot a WF" dialog on the snapshots page
- WHEN the dialog renders
- THEN a table appears with one row per enabled offer, pre-filled from `GET /api/admin/offers`
- AND each `oferta_id` cell is editable

#### Scenario: Snapshot publish with overrides

- GIVEN the snapshot publish dialog is open
- WHEN the user overrides one or more `oferta_id` values and confirms
- THEN the snapshot publish request carries `ofertaIdOverrides` with the overridden values
- AND the backend applies those overrides in `upsertMotorOferta` for the snapshot restore

---

### Requirement: WF-03 — Payload Structure

The frontend MUST include `ofertaIdOverrides: Record<string, number>` in the body of both publish requests. The backend MUST accept this field as optional. When a key matching an offer's `offerCode` is present, the backend MUST use that value as the effective `oferta_id`; when absent, it MUST fall back to the value stored in `cfg_offer_ruleset`.

#### Scenario: Backend uses override value

- GIVEN a publish request includes `ofertaIdOverrides: { "OFERTA_RESTRICTIVA": 42 }`
- WHEN the backend processes the request for offer `OFERTA_RESTRICTIVA`
- THEN `upsertMotorOferta` uses `oferta_id = 42`
- AND the DB value for that offer is not used

#### Scenario: Backend falls back for unmapped offers

- GIVEN a publish request includes `ofertaIdOverrides: { "OFERTA_RESTRICTIVA": 42 }`
- WHEN the backend processes offer `OFERTA_PERMISIVA` (not in the map)
- THEN `upsertMotorOferta` uses the `oferta_id` from `cfg_offer_ruleset`

#### Scenario: Payload without the field (older client or rollback)

- GIVEN a publish request that omits `ofertaIdOverrides`
- WHEN the backend processes the request
- THEN all offers use their DB `oferta_id` values (unchanged behaviour)

---

### Requirement: WF-04 — Input Validation

The `oferta_id` inputs in both dialogs MUST only accept positive integers (≥ 1). The frontend MUST show a per-row validation error and MUST NOT enable the confirm button while any input contains a non-positive-integer value. The backend validator MUST reject requests where any value in `ofertaIdOverrides` is not a positive integer, returning HTTP 422.

#### Scenario: Invalid value blocks submission

- GIVEN the publish dialog is open
- WHEN the user types `0`, a negative number, or a non-numeric string in an `oferta_id` input
- THEN a validation error is shown on that row
- AND the confirm button is disabled

#### Scenario: Valid value re-enables submission

- GIVEN a row shows a validation error
- WHEN the user corrects the input to a positive integer
- THEN the row error clears
- AND the confirm button becomes enabled (assuming no other errors)

#### Scenario: Backend rejects invalid override values

- GIVEN a publish request body contains `ofertaIdOverrides: { "OFERTA_RESTRICTIVA": -1 }`
- WHEN the backend validates the payload
- THEN it returns HTTP 422 with a descriptive error
- AND no write to Workflow occurs

---

### Requirement: WF-05 — No Schema or State Persistence

The override mapping MUST NOT be persisted between publications. No new SQL tables, columns, or stored procedures SHALL be introduced. The mapping exists only in the request payload.

#### Scenario: Second publication does not retain previous overrides

- GIVEN the user published with an override of `OFERTA_RESTRICTIVA → 42`
- WHEN the user opens the publish dialog again
- THEN the `oferta_id` inputs are pre-filled from the current DB values, not from the previous override

---

### Requirement: WF-06 — Existing Error Handling Preserved

If `upsertMotorOferta` returns a FK constraint error or any other WF API error, the existing error display behaviour (error banner / toast in the dialog) MUST remain unchanged. The override feature MUST NOT suppress or alter error messages.

#### Scenario: FK error with wrong override value

- GIVEN the user supplies an `oferta_id` that does not exist in `dbo.HIPO_OFERTA` on the target environment
- WHEN the publish request is processed
- THEN the WF API returns a FK constraint error
- AND the dialog displays the error message as it does today
- AND the dialog remains open so the user can correct the value
