# Design: mro-snapshot-deploy

> Encodes decisions v4 (#79) + proposal v3 (#80). Validity is MOTORFECHA_ID only; VIGENCIA_* removed, never written.
> Engram observation: #85

## Grounding discovery (load-bearing)

Schema/code mismatch ALREADY exists: MRO_MOTORREGLA and MRO_MOTORPARAM have NO VIGENCIA_DESDE_DT/VIGENCIA_HASTA_DT columns (only BORRAR_VIGENCIA_* + MOTORFECHA_ID), yet insertMRORecords INSERTs VIGENCIA_* and deletePeriodFromMRO filters by them → current publish path is invalid against the real schema and never assigns MOTORFECHA_ID. The engine read SP already JOINs MOTORFECHA_ID but filters by date only (no TIPO_DS, no most-recent-wins). This change closes the gap end to end.

## Q1 — SQL shape of most-recent-wins: ROW_NUMBER() partitioned per offer + object type

Chosen over correlated subquery and CROSS APPLY TOP 1. Two INDEPENDENT winner CTEs:
- `mf_rules_win`: TIPO_DS IN ('REGLAS','AMBOS'), covering @DATE, rn=1 by DESDE_DT DESC, MOTORFECHA_ID DESC.
- `mf_params_win`: TIPO_DS IN ('PARAMS','AMBOS'), same recency rule, independent.

A single offer can take rules from one MOTORFECHA and params from another. rules/params CTEs JOIN to their winner CTE on (MOTOROFERTA_ID, MOTORFECHA_ID) → exactly one period per offer/type → duplicates=0 by construction.

## Q2 — rule_engine.js needs NO change

config_service.loadNormalizedConfig EXECs SP → parses OFERTAS_JSON/PARAMETROS_JSON → normalizeConfig. Engine is a pure consumer. If SP returns one period/offer/type, engine is correct unedited.

## Q3 — TIPO_DS: default AMBOS; selector only where cheap

Cap2 publish-current: optional tipoDs field, default AMBOS. Cap3 publish-snapshot: AMBOS. Cap4 WF→POC: N/A. Cap1 take-snapshot: N/A read-only.

## Components

- `upsertMotorFecha(tx, desde, hasta, tipo, maxIdRef)`: key (DESDE_DT,HASTA_DT,TIPO_DS) with UPDLOCK; exact match → reuse id; else newId=++maxIdRef.val + INSERT MRO_MOTORFECHA.
- `getMaxIds`: add `ISNULL(MAX(MOTORFECHA_ID),0) AS maxFecha` (UPDLOCK). Captured BEFORE deletes.
- `deletePeriodFromMRO(tx, motorFechaId, tipo)`: keyed by MOTORFECHA_ID, scoped by tipo. No range delete.
- `insertMRORecords`: drop VIGENCIA_* params → single motorFechaId; INSERT lists drop VIGENCIA_*, add MOTORFECHA_ID.
- TX order: getMaxIds → upsertMotorFecha(tipo) → deletePeriodFromMRO(fid,tipo) → upsertMotorOferta loop → insertMRORecords(fid) → commit.
- `cfg_get_workflow_snapshot_json`: replaces inline reads with JOIN MRO_MOTORFECHA on MOTORFECHA_ID; KEEP JSON field names VIGENCIA_DESDE_DT/HASTA_DT (sourced from MOTORFECHA) for restoreSnapshot compatibility.
- Cap4 WF→POC: admin_service.restoreSnapshot already implements transform (detect entorno_cd=WF, oferta_id FK resolution, pocFechaDesde period create/reuse, param dedupe last-wins).
- Angular: admin.models adds tipoDs to AdminWorkflowPublicarPayload; snapshots-page enables WF-row deploy + POC-row WF-publish.

## TDD plan

- rule_engine.test.js: most-recent-wins overlapping AMBOS; zero-duplicate invariant; per-type split recency.
- workflow_publish.test.js: deletePeriodFromMRO table scope by tipo; tipoDs validation via getDeleteScope.
- workflow_snapshot_roundtrip.test.js: assembleWfSnapshotPayload shape (DESDE_DT/HASTA_DT/TIPO_DS, no VIGENCIA_*).
- Angular spec: publishToWorkflow tipoDs default AMBOS; WF row deploy action; POC row publish action.

NOTE: mro_resolution.test.js (pure-JS mirror of SQL winner CTE) was planned but REMOVED — anti-mirror rule.

## Risks

CRITICAL: SP rewrite touches all simulations; winner-CTE makes duplicates impossible; gate on green node --test.
HIGH: MOTORFECHA MAX+1 concurrency → UPDLOCK in TX + capture-before-delete.
HIGH: current insert/delete already invalid vs schema → land SQL+service together.
MEDIUM: WF-snapshot SP must keep JSON field names stable.

## Files

- rule_set/sql/workflow_deploy/wf_sp_cfg_get_offers_and_params_json.sql
- rule_set/sql/workflow_snapshot.sql
- rule_set/api/services/admin_workflow_service.js
- rule_set/api/services/admin_service.js
- rule_set/web/src/app/models/admin.models.ts
- rule_set/web/src/app/services/admin-api.service.ts
- rule_set/web/src/app/pages/snapshots-page.*
- rule_set/web/src/app/pages/configurator-page.*
