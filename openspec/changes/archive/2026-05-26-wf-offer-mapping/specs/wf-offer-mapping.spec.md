# wf-offer-mapping Specification

## Purpose

New-capability spec. No existing specs to delta against.

The change adds an optional, ephemeral `ofertaIdOverrides` map to both WF publish flows (config publish and snapshot publish) so operators can remap offer IDs at publication time — primarily to unblock publishing PRO configs to PRE environments where `dbo.HIPO_OFERTA` IDs differ.

---

## Requirements

### WF-01 — Offer ID Override Table in Config Publish Dialog

The configurator's "Publicar a WF" dialog MUST display a table listing every enabled offer with its `offerCode` and `oferta_id`. Each `oferta_id` cell MUST be an editable input, pre-filled with the value returned by `GET /api/admin/offers` at the time the dialog is opened. Unchanged values MUST be sent with their original pre-filled values.

**Scenarios**: Dialog opens with pre-filled values | No overrides — publish proceeds unchanged | User overrides one or more IDs

### WF-02 — Offer ID Override Table in Snapshot Publish Dialog

Same table as WF-01 in the "Publicar snapshot a WF" dialog. Rows sourced from `GET /api/admin/offers` (current DB state).

**Scenarios**: Dialog opens for snapshot publish | Snapshot publish with overrides

### WF-03 — Payload Structure

Frontend MUST include `ofertaIdOverrides: Record<string, number>` in both publish request bodies. Backend MUST accept it as optional. Override value takes precedence over DB value; absent key falls back to DB value. Omitting the field entirely restores pre-change behaviour.

**Scenarios**: Backend uses override value | Backend falls back for unmapped offers | Payload without the field

### WF-04 — Input Validation

`oferta_id` inputs MUST only accept positive integers (≥ 1). Frontend MUST show per-row validation error and MUST NOT enable confirm while any input is invalid. Backend MUST return HTTP 422 when any `ofertaIdOverrides` value is not a positive integer.

**Scenarios**: Invalid value blocks submission | Valid value re-enables submission | Backend rejects invalid override values

### WF-05 — No Schema or State Persistence

Override mapping MUST NOT be persisted between publications. No new SQL tables, columns, or stored procedures SHALL be introduced.

**Scenarios**: Second publication does not retain previous overrides

### WF-06 — Existing Error Handling Preserved

Existing error display behaviour (error banner/toast) MUST remain unchanged. The override feature MUST NOT suppress or alter error messages.

**Scenarios**: FK error with wrong override value

---

**Artifact file**: `openspec/changes/wf-offer-mapping/specs/wf-offer-mapping.spec.md`
