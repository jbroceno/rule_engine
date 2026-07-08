# Diseño técnico: `cfg-offer-dates-rename`

## Resumen ejecutivo

Renombrar `MOTOR_FECHAS` a `cfg_offer_dates` y `motor_fechas_id` a `offer_date_id` aplicando una estrategia de **reemplazo masivo controlado** (`replace_all` por archivo) sobre el código fuente, y usando **`sp_rename` en SQL Server** para preservar datos y constraints en instancias ya desplegadas. El cambio es puramente nominal: no introduce nueva lógica, no altera contratos externos de la API y no requiere migración de datos.

## Enfoque arquitectónico

### Principio rector

Aplicar el cambio **capa por capa, manteniendo coherencia transversal** entre SQL, backend y frontend. La regla de oro: si una capa habla de `offer_date_id`, todas las capas deben hablar de `offer_date_id` después del cambio. No se permite estado mixto en el repositorio (ni temporalmente).

### Componentes y orden de propagación

```
SQL (fuente de verdad de los nombres)
   |
   v
Backend Node.js (services -> validators -> controllers)
   |
   v
Frontend Angular (models -> services -> components -> templates)
   |
   v
Docs + Tests
```

El orden no es estrictamente obligatorio (es un refactor sincronizado, no progresivo), pero comenzar por SQL elimina ambigüedad sobre cuál es el nombre canónico.

## Decisiones técnicas (ADR-style)

### ADR-001: Usar `sp_rename` en SQL Server para la migración de instancias existentes

**Contexto.** Hay entornos pre-productivos con datos reales en `MOTOR_FECHAS`. Necesitamos una forma de propagar el rename sin perder datos ni romper FKs.

**Decisión.** Usar `sp_rename` en un script idempotente (`migration_rename_cfg_offer_dates.sql`) que verifica con `OBJECT_ID()` y `COL_LENGTH()` antes de cada operación.

**Alternativas consideradas y rechazadas.**

- **`DROP TABLE` + `CREATE TABLE` nueva + reinsertar datos.** Rechazada: implica calcular y reinsertar PKs, perder identity seed, dropear/recrear FKs, riesgo alto de error operativo. `sp_rename` es atómico y preserva todo.
- **Crear tabla nueva, migrar datos con `INSERT INTO ... SELECT FROM`, dropear la vieja.** Rechazada por la misma razón: complejidad innecesaria para una operación que SQL Server resuelve nativamente.
- **No proveer script y rehacer el seed en cada entorno.** Rechazada: imposible si hay datos no provenientes del seed (parámetros editados en producción vía UI).

**Consecuencias.**

- Pro: cero pérdida de datos, operación atómica, idempotente.
- Pro: las FK existentes siguen siendo válidas (apuntan al `object_id`, no al nombre).
- Contra: `sp_rename` puede emitir un mensaje informativo sobre objetos procedurales que cachean nombres; mitigado porque los SPs que usan la tabla (`cfg_get_rules_json` y derivados) se re-despliegan con `sp_rules_params.sql` actualizado en el mismo release.

### ADR-002: Aplicar `replace_all` por archivo en lugar de edición manual

**Contexto.** Hay ~90+ ocurrencias de las cadenas `MOTOR_FECHAS` y `motor_fechas_id` (en sus variantes) distribuidas en 17 archivos.

**Decisión.** Usar reemplazo global por archivo (`Edit` con `replace_all: true`) sobre las cadenas exactas `MOTOR_FECHAS` → `cfg_offer_dates`, `motor_fechas_id` → `offer_date_id`, `motorFechasId` → `offerDateId` (camelCase en TS/JS).

**Alternativas consideradas y rechazadas.**

- **Edición manual ocurrencia por ocurrencia.** Rechazada: lenta, propensa a omisiones, no aporta valor porque cada ocurrencia tiene exactamente la misma semántica.
- **Script externo (sed / sd).** Viable pero introduce riesgo de tocar archivos no deseados (binarios, node_modules); el editor controlado por archivo nos da auditoría línea por línea.

**Consecuencias.**

- Pro: refactor rápido y consistente.
- Pro: el reemplazo es semánticamente seguro porque los identificadores son únicos y específicos del dominio (no colisionan con palabras genéricas).
- Contra: requiere una pasada de revisión visual posterior para validar que ningún reemplazo dañó strings de UI (resuelto al renombrar también labels como "Período (MOTOR_FECHAS)" → "Período de vigencia").

### ADR-003: Renombrar también el label de UI a "Período de vigencia"

**Contexto.** El label original en el configurador era `"Período (MOTOR_FECHAS)"`, mezclando texto de negocio con nomenclatura técnica.

**Decisión.** Reemplazar por `"Período de vigencia"` — descriptivo, en español, sin filtrar nombres técnicos al usuario.

**Alternativas consideradas y rechazadas.**

- **`"Período (cfg_offer_dates)"`** Rechazada: filtra detalle de implementación al usuario, no aporta valor.
- **`"Período"` a secas.** Rechazada: ambiguo; el sistema maneja distintos conceptos temporales (fecha de alta de registros, valid_from de reglas) y "de vigencia" desambigua.

**Consecuencias.** UI más limpia y profesional; alineada con el principio de no exponer nombres de tablas al usuario final.

### ADR-004: No cambiar el nombre del archivo del componente Angular `motor-fechas-page.component.*`

**Contexto.** Existe un componente Angular `motor-fechas-page.component.ts/html` cuyo nombre de archivo replica el nombre legado.

**Decisión.** Mantener el nombre del archivo y de la clase del componente sin renombrar (`MotorFechasPageComponent`). Solo se actualizan strings internos, bindings y referencias a campos de modelos.

**Alternativas consideradas y rechazadas.**

- **Renombrar a `offer-dates-page.component.*`.** Rechazada en este cambio para acotar el alcance y reducir el ruido del diff. Renombrar archivos Angular implica actualizar imports, rutas, lazy-loading config, tests asociados y, en algunos casos, el routing module. Queda como deuda técnica documentada para un cambio posterior (`offer-dates-page-rename`), siguiendo el principio de un cambio = un objetivo.

**Consecuencias.**

- Pro: PR más acotado y revisable.
- Contra: queda inconsistencia temporal entre nombre de archivo (`motor-fechas-page`) y nomenclatura de dominio (`cfg_offer_dates`). Documentado en `tasks.md` como follow-up.

### ADR-005: Mantener rutas HTTP y nombres de operaciones del backend

**Contexto.** Existen endpoints como `/api/admin/...` que internamente operan sobre la tabla.

**Decisión.** No modificar paths HTTP ni nombres de operaciones expuestas. Solo cambian los nombres de campos en payloads JSON donde aparecía `motor_fechas_id` → ahora `offer_date_id`.

**Alternativas consideradas y rechazadas.**

- **Renombrar también las rutas para reflejar el nuevo nombre.** Rechazada: rompería compatibilidad con cualquier consumidor externo y aporta poco valor — las rutas ya están abstraídas semánticamente de la tabla concreta.

**Consecuencias.** Compatibilidad de rutas preservada; los únicos consumidores afectados son los del propio frontend Angular del proyecto, que se actualiza en el mismo cambio.

## Mapa de impacto

### Capa SQL

| Archivo | Cambio |
|---------|--------|
| `data_model.sql` | DDL de la tabla y su PK; nombre de constraint default |
| `sp_rules_params.sql` | 6 JOINs en SPs que componen el JSON de reglas + parámetros |
| `seed_offers.sql` | FK en INSERTs de seed de reglas y parámetros |
| `migration_rename_cfg_offer_dates.sql` (nuevo) | Script idempotente para entornos existentes |

### Capa Backend (Node.js / Express)

| Archivo | Cambio aproximado |
|---------|-------------------|
| `services/admin_fechas_service.js` | 6 + 15 reemplazos |
| `services/admin_service.js` | 19 + 18 reemplazos |
| `services/admin_workflow_service.js` | 1 + 4 + 5 reemplazos |
| `validators/admin_validator.js` | 4 + 4 reemplazos |
| `controllers/admin_snapshots_controller.js` | Variable local `motorFechasId` → `offerDateId` |

### Capa Frontend (Angular)

| Archivo | Cambio |
|---------|--------|
| `models/admin.models.ts` | 8 interfaces actualizadas; comentario de bloque renombrado |
| `services/admin-api.service.ts` | Query params en `getRules` y `getParams` |
| `app.html` | 2 bindings de template |
| `pages/configurator-page.component.html` | 9 ocurrencias incluyendo label "Período (MOTOR_FECHAS)" → "Período de vigencia" |
| `pages/configurator-page.component.ts` | ~20 ocurrencias |
| `pages/motor-fechas-page.component.html` | 12 ocurrencias |
| `pages/motor-fechas-page.component.ts` | 5 ocurrencias |

### Documentación y tests

| Archivo | Cambio |
|---------|--------|
| `docs/CONFIGURACION_REGLAS.md` | Secciones 4 y 9 reescritas; nueva tabla `cfg_offer_dates` en sección 9; `valid_from`/`valid_to` reemplazados por `offer_date_id` FK |
| `test/motor_fechas.test.js` | Nombre de test CA-005 actualizado |

## Qué NO cambia (riesgos mitigados por exclusión)

- **Datos almacenados**: cero filas migradas, cero recálculos.
- **Lógica del motor de reglas** (`rule_engine.js`): no se toca; sigue operando sobre el config normalizado que recibe del servicio.
- **Rutas HTTP**: paths inalterados.
- **Algoritmo de elegibilidad** (INIT / PRE / FINAL): inalterado.
- **Stored procedures llamados desde el código** (nombres como `cfg_get_offers_and_params_json`): solo cambia su contenido interno (JOINs), no su firma.
- **Política de snapshots**: el formato de snapshot persistido en `cfg_config_snapshot.rules_json` y `params_json` se actualiza naturalmente porque el backend serializa con los nuevos nombres de campo. Snapshots viejos siguen siendo legibles para auditoría pero su restore quedaría desincronizado; ver "Riesgos" abajo.

## Riesgos y supuestos

| Riesgo | Mitigación |
|--------|------------|
| Snapshots creados con esquema viejo (`motor_fechas_id` en JSON) restaurados sobre esquema nuevo. | El servicio de restore deserializa por nombre; al normalizar el JSON antes del restore, mapear `motor_fechas_id` → `offer_date_id` si se detecta. Si no se hace, el restore de snapshots históricos queda como limitación conocida. **Decisión asumida**: aceptar la limitación; los snapshots históricos quedan como referencia inmutable y, si se requiere restore, se hace manualmente. |
| Algún archivo no incluido en el inventario sigue conteniendo el nombre viejo. | Búsqueda global posterior al cambio (`rg 'MOTOR_FECHAS\|motor_fechas_id'`) excluyendo `migration_rename_cfg_offer_dates.sql`. |
| Entornos no migran el SQL antes de desplegar el nuevo backend. | El script de migración es idempotente y debe ejecutarse como paso pre-deploy documentado en el runbook. |
| Consumidores externos de la API (si existen) usaban `motor_fechas_id`. | Hasta donde indica el inventario, no hay consumidores externos: el frontend Angular es el único cliente. Si aparece uno, requerirá coordinación; queda como supuesto. |
