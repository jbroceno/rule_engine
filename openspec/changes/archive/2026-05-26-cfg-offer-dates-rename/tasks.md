# Tareas: `cfg-offer-dates-rename`

> Estado: todas las tareas completadas. Cambio implementado el 2026-05-26.

## Review Workload Forecast

- **Líneas tocadas (estimado)**: ~300
- **Riesgo**: Medium (cambio amplio en superficie pero mecánico, sin alteración de comportamiento)
- **Estrategia de entrega**: single PR
- **Chained PRs recommended**: No
- **400-line budget risk**: Low
- **Decision needed before apply**: No

---

## Phase 1 — SQL

- [x] **1.1** Renombrar en `rule_set/sql/data_model.sql`:
  - [x] Tabla `dbo.MOTOR_FECHAS` → `dbo.cfg_offer_dates`
  - [x] Columna PK `motor_fechas_id` → `offer_date_id`
  - [x] Constraint default `DF_MOTOR_FECHAS_alta_dt` → `DF_cfg_offer_dates_alta_dt`
- [x] **1.2** Actualizar `rule_set/sql/sp_rules_params.sql`:
  - [x] Reemplazar los 6 JOINs que referenciaban `MOTOR_FECHAS` / `motor_fechas_id` por `cfg_offer_dates` / `offer_date_id`
  - [x] Validar que el SP `cfg_get_rules_json` y los SPs derivados (`cfg_get_offers_and_params_json`) compilan
- [x] **1.3** Actualizar `rule_set/sql/seed_offers.sql`:
  - [x] FK `offer_date_id` en INSERTs de reglas
  - [x] FK `offer_date_id` en INSERTs de parámetros
- [x] **1.4** Crear `rule_set/sql/migration_rename_cfg_offer_dates.sql`:
  - [x] Script idempotente con `OBJECT_ID('dbo.MOTOR_FECHAS', 'U')` como guard
  - [x] `sp_rename` para tabla (`MOTOR_FECHAS` → `cfg_offer_dates`)
  - [x] `sp_rename` para columna (`motor_fechas_id` → `offer_date_id`)
  - [x] `sp_rename` para constraint default
  - [x] Validar idempotencia: segunda ejecución no falla

## Phase 2 — Backend Node.js

- [x] **2.1** `rule_set/api/services/admin_fechas_service.js`:
  - [x] 6 reemplazos de `MOTOR_FECHAS` → `cfg_offer_dates`
  - [x] 15 reemplazos de `motor_fechas_id` → `offer_date_id`
- [x] **2.2** `rule_set/api/services/admin_service.js`:
  - [x] 19 reemplazos de `MOTOR_FECHAS` → `cfg_offer_dates`
  - [x] 18 reemplazos de `motor_fechas_id` → `offer_date_id`
- [x] **2.3** `rule_set/api/services/admin_workflow_service.js`:
  - [x] 1 reemplazo de `MOTOR_FECHAS` → `cfg_offer_dates`
  - [x] 4 reemplazos de `motor_fechas_id` → `offer_date_id`
  - [x] 5 reemplazos en variables locales (`motorFechasId` → `offerDateId`)
- [x] **2.4** `rule_set/api/validators/admin_validator.js`:
  - [x] 4 reemplazos de `motor_fechas_id` → `offer_date_id`
  - [x] 4 reemplazos en mensajes de validación
- [x] **2.5** `rule_set/api/controllers/admin_snapshots_controller.js`:
  - [x] Variable local `motorFechasId` → `offerDateId`
- [x] **2.6** Verificar que ningún archivo en `rule_set/api/` contiene `motor_fechas` (búsqueda case-insensitive)

## Phase 3 — Angular (frontend)

- [x] **3.1** `rule_set/web/src/app/models/admin.models.ts`:
  - [x] 8 interfaces actualizadas (campos `motor_fechas_id` → `offer_date_id`)
  - [x] Identificadores camelCase `motorFechasId` → `offerDateId`
  - [x] Comentario de bloque `// MOTOR_FECHAS` → `// cfg_offer_dates`
- [x] **3.2** `rule_set/web/src/app/services/admin-api.service.ts`:
  - [x] Query param `motor_fechas_id` en `getRules`
  - [x] Query param `motor_fechas_id` en `getParams`
- [x] **3.3** `rule_set/web/src/app/app.html`:
  - [x] 2 bindings de template actualizados
- [x] **3.4** `rule_set/web/src/app/pages/configurator-page.component.html`:
  - [x] 9 ocurrencias actualizadas
  - [x] Label `"Período (MOTOR_FECHAS)"` → `"Período de vigencia"`
  - [x] Form controls renombrados
  - [x] Bindings de template renombrados
- [x] **3.5** `rule_set/web/src/app/pages/configurator-page.component.ts`:
  - [x] ~20 ocurrencias actualizadas (propiedades, signals, métodos)
- [x] **3.6** `rule_set/web/src/app/pages/motor-fechas-page.component.html`:
  - [x] 12 ocurrencias actualizadas
- [x] **3.7** `rule_set/web/src/app/pages/motor-fechas-page.component.ts`:
  - [x] 5 ocurrencias actualizadas
- [x] **3.8** Verificar que ningún archivo en `rule_set/web/src/` contiene `motor_fechas_id` (búsqueda case-insensitive)
- [x] **3.9** [DEFERIDO] Renombrar archivos `motor-fechas-page.component.*` → `offer-dates-page.component.*` (ver ADR-004 en `design.md`; queda como follow-up)

## Phase 4 — Documentación y tests

- [x] **4.1** `rule_set/docs/CONFIGURACION_REGLAS.md`:
  - [x] Sección 4 actualizada (modelo de datos)
  - [x] Sección 9 actualizada (catálogo de tablas)
  - [x] Añadida fila `dbo.cfg_offer_dates` en la tabla de la sección 9
  - [x] Sustituidos `valid_from`/`valid_to` por `offer_date_id` FK en el schema documentado de reglas y parámetros
- [x] **4.2** `rule_set/test/motor_fechas.test.js`:
  - [x] Nombre del test CA-005 actualizado para reflejar `cfg_offer_dates`
- [x] **4.3** Ejecutar `npm test` y validar que todos los tests pasan

## Phase 5 — Verificación cruzada

- [x] **5.1** Búsqueda global en el repositorio: `rg 'MOTOR_FECHAS'` excluyendo `migration_rename_cfg_offer_dates.sql` → sin resultados
- [x] **5.2** Búsqueda global: `rg 'motor_fechas_id'` excluyendo el script de migración → sin resultados
- [x] **5.3** Búsqueda global: `rg 'motorFechasId'` → sin resultados
- [x] **5.4** Despliegue de prueba sobre instancia con datos: ejecutar `migration_rename_cfg_offer_dates.sql`, luego correr la API y validar simulación INIT/PRE/FINAL → OK
- [x] **5.5** Smoke test UI: abrir `/configurador`, `/snapshots`, `/simulador-init/pre/final` → todas las pantallas cargan datos correctamente
