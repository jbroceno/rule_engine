# Tasks: Despliegue en Workflow

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 900–1300 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Base |
|------|------|-----------|------|
| 1 | MOTOR_FECHAS: SQL + migración + API CRUD | PR 1 | main |
| 2 | Snapshots WF + Publicación Workflow (ETL backend) | PR 2 | main (tras merge PR 1) |
| 3 | Endpoint adaptador + tests | PR 3 | main (tras merge PR 2) |
| 4 | Angular UI (todas las pantallas) | PR 4 | main (tras merge PR 1) |

---

## Phase 1: Base de datos

- [x] 1.1 Añadir tabla `dbo.MOTOR_FECHAS` a `sql/data_model.sql` (id PK, valid_from, valid_to, descripcion, tipo_cd, alta_usr, alta_dt).
- [x] 1.2 Script de migración: añadir `motor_fechas_id` FK en `cfg_offer_rule` y `cfg_offer_param`; eliminar `valid_from`/`valid_to` de ambas.
- [x] 1.3 Actualizar SP `dbo.cfg_get_offers_and_params_json` (`sql/sp_rules_params.sql`): JOIN a `MOTOR_FECHAS` para filtrado de fechas.
- [x] 1.4 Añadir columna `entorno_cd` VARCHAR(5) DEFAULT 'POC' a `dbo.cfg_config_snapshot` (`sql/snapshots.sql`).
- [x] 1.5 Crear SP `dbo.cfg_get_workflow_snapshot_json` en `sql/workflow_snapshot.sql`: exporta tablas MRO_ a JSON.

## Phase 2: API — MOTOR_FECHAS

- [x] 2.1 Crear `api/services/admin_fechas_service.js`: CRUD con validación de solapamiento y bloqueo de delete si hay referencias.
- [x] 2.2 Crear `api/controllers/admin_fechas_controller.js` + rutas `GET|POST|PUT|DELETE /admin/fechas` en `api/routes/admin_routes.js`.
- [x] 2.3 Actualizar `api/validators/admin_validator.js`: `tipo_cd` ∈ {REGLAS, PARAMS, AMBOS}; `motor_fechas_id` requerido en reglas y parámetros.
- [x] 2.4 Actualizar `api/services/admin_service.js`: create/update de reglas y parámetros usan `motor_fechas_id` (eliminar `valid_from`/`valid_to`).

## Phase 3: API — Snapshots y publicación Workflow

- [x] 3.1 Crear `api/services/admin_workflow_service.js`: ETL cfg_ → MRO_ (delete período destino + insert con MAX(id)+1 en transacción).
- [x] 3.2 Actualizar `api/services/admin_service.js` (restore): aceptar `destino` y `rangoDestino`; delegar a `admin_workflow_service` si destino=WF.
- [x] 3.3 Actualizar `api/controllers/admin_snapshots_controller.js`: restore con nuevos campos; añadir `POST /admin/workflow/snapshot` y `POST /admin/workflow/publicar`.

## Phase 4: API — Endpoint adaptador Workflow

- [x] 4.1 Crear `api/services/workflow_adapter.js`: mapeo Workflow → motor (ingresos×pagas/14, edadMax, antiguedad en meses, domiciliaNomina→T1+T2, tipoAltaCd→tipoAlta).
- [x] 4.2 Crear `api/controllers/workflow_controller.js`: despacha a `initcheck`/`precheck`/`finalize` según `faseCd`; responde `{RESULTADO:{LIMITES,OFERTAS_ELEGIBLES,OFERTA_GANADORA}}`.
- [x] 4.3 Crear `api/routes/workflow_routes.js` con `POST /api/workflow/condiciones-hipotecas`; registrar en `api/app.js`.

## Phase 5: Angular UI

- [x] 5.1 Crear `web/src/app/pages/motor-fechas-page.component.*`: tabla CRUD de períodos (Desde, Hasta, Tipo, Descripción), ordenada por valid_from DESC.
- [x] 5.2 Añadir métodos MOTOR_FECHAS a `admin-api.service.ts` + modelos a `admin.models.ts`; registrar ruta `/motor-fechas` en `app.routes.ts`.
- [x] 5.3 Actualizar `configurator-page.component`: selectores `<select>` de MOTOR_FECHAS en formularios de regla y parámetro (filtrados por tipo_cd).
- [x] 5.4 Actualizar `snapshots-page.component`: filtro entorno POC|WF; diálogo restaurar con selector destino + campos rango si WF.
- [x] 5.5 Añadir "Publicar en Workflow" en `configurator-page.component`: diálogo con período origen y rango destino.

## Phase 6: Tests

- [x] 6.1 Crear `rule_set/test/motor_fechas.test.js`: validar CRUD, solapamiento (CA-002), bloqueo delete (CA-003), SP fecha (CA-005).
- [x] 6.2 Crear `rule_set/test/workflow_adapter.test.js`: cada transformación de campo del mapeo; fases INIT/PRE/FINAL (CA-010, CA-011).
- [x] 6.3 Crear `rule_set/test/workflow_service.test.js`: fixtures sin red (CA-012); tests live con skip si WF_TOKEN ausente (CA-013).
