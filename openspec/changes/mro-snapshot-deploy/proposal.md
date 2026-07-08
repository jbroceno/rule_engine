# Propuesta: mro-snapshot-deploy

> **Reemplaza el contrato de despliegue de** `openspec/specs/workflow-deployment`, `archive/2026-05-26-workflow-deployment` y `wf-offer-mapping`. Esos artefactos asumen el modelo ANTIGUO: publicar escribiendo `VIGENCIA_*` inline sobre `MRO_MOTORREGLA`/`MRO_MOTORPARAM`. **Ese mecanismo ya no es válido.** A partir de este cambio la vigencia se gestiona EXCLUSIVAMENTE mediante `MRO_MOTORFECHA` + FK `MOTORFECHA_ID`. Las columnas `VIGENCIA_DESDE_DT`/`VIGENCIA_HASTA_DT` se están eliminando del modelo y **no deben escribirse**.

## Intención

Migrar los flujos de **publicación/despliegue a WF** y de **snapshots** al NUEVO modelo de datos MRO, donde la vigencia de reglas y parámetros se resuelve por la entidad `MRO_MOTORFECHA` (FK `MOTORFECHA_ID`).

El estado actual es una inconsistencia activa: el path de inserción (`admin_workflow_service.js`) escribe solo columnas `VIGENCIA_*` inline y **nunca asigna `MOTORFECHA_ID`**, mientras que la SP de lectura del motor `cfg_get_offers_and_params_json` **ya filtra por `MOTORFECHA_ID`**. Resultado: lo que se publica no se resuelve correctamente al evaluar. Cerrar esa brecha (escritura por `MOTORFECHA_ID`, sin inline), reescribir las SP de lectura para soportar solapamientos por `TIPO_DS`, y exponer en la UI las cuatro capacidades de publicación/despliegue es el objetivo de este cambio.

**Éxito** = los 4 flujos web operan sobre `MOTORFECHA_ID`; ninguna escritura toca `VIGENCIA_*`; el motor resuelve un único periodo aplicable por oferta y tipo de objeto; las simulaciones (INIT/PRE/FINAL) siguen verdes en regresión.

## Alcance

### Dentro de alcance

| # | Capacidad | Estado actual |
|---|-----------|---------------|
| 1 | **Tomar un snapshot de WF** — capturar el estado vivo de WF (vía `cfg_get_workflow_snapshot_json`) en un registro de catálogo | Existe; la SP lee inline `VIGENCIA_*` → debe migrar a `MOTORFECHA_ID` |
| 2 | **Publicar la configuración actual a WF** — exponer en la UI el deploy existente `POST /api/admin/workflow/publicar` | Endpoint existe; falta botón en UI |
| 3 | **Publicar un snapshot registrado en POC a WF** | Por implementar sobre el path MRO migrado |
| 4 | **Desplegar a POC un snapshot de origen WF** — el deploy-a-POC existe pero solo acepta origen POC | Ampliación para aceptar origen WF |

**Workstream SQL transversal (IN SCOPE, riesgo principal):**

| Objeto | Cambio |
|--------|--------|
| `cfg_get_offers_and_params_json` (SP de lectura del **motor**) | Reescribir para resolver vigencia por `TIPO_DS` + most-recent-wins (ver Enfoque, Decisión 2 y 3). |
| `cfg_get_workflow_snapshot_json` (SP de **snapshot WF**) | Migrar de leer inline `VIGENCIA_*` a leer por `MOTORFECHA_ID` JOIN `MRO_MOTORFECHA`. |

### Fuera de alcance (explícito)

- **`MRO_MOTORSNAPSHOT` como catálogo.** El catálogo permanece en `dbo.cfg_config_snapshot` (Decisión 1). `MRO_MOTORSNAPSHOT` no se usa.
- **La feature `BORRAR_VIGENCIA_*`** (ventana de borrado, concepto distinto de la vigencia). Las tablas la traen pero no se aborda aquí.
- **La lógica de evaluación del motor JS** (`rule_engine.js`: DNF, inversión, etapas) más allá de **consumir** la salida ya resuelta de la SP corregida.
- "Copiar snapshot" como duplicación de filas: el usuario aclaró que se refiere a estos 4 flujos publicar/desplegar POC↔WF.

## Enfoque

Tres decisiones rectoras transversales a las cuatro capacidades.

### Decisión 1 — Catálogo en `cfg_config_snapshot`

El listado/paginación/filtrado de snapshots y los campos `created_at`/`created_by`/`entorno_cd` se mantienen sobre `dbo.cfg_config_snapshot`. Solo los flujos de DEPLOY/PUBLISH escriben en las tablas vivas MRO_*. `ENTORNO_CD ∈ {POC, WF}` (solo esos dos valores).

### Decisión 2 — Migración a `MOTORFECHA_ID` (SIN escritura inline)

En cada deploy/publish a WF:

1. **Resolver/crear `MRO_MOTORFECHA`** con clave de upsert `(DESDE_DT, HASTA_DT, TIPO_DS)`.
   - Coincidencia EXACTA de las tres columnas → se **reutiliza** el `MOTORFECHA_ID`, se **borran las filas dependientes** (reglas/params del tipo cubierto) y se **reinsertan**.
   - Si no hay coincidencia exacta → se **crea** un nuevo `MOTORFECHA_ID`.
2. **Asignar la FK `MOTORFECHA_ID`** a las `MRO_MOTORREGLA`/`MRO_MOTORPARAM` insertadas. **NO se escriben** `VIGENCIA_DESDE_DT`/`VIGENCIA_HASTA_DT` (se eliminan del modelo).
3. `deletePeriodFromMRO` deja de borrar por rango inline y pasa a borrar **por JOIN a `MOTORFECHA_ID`**, acotado a los tipos de objeto que cubre el periodo (delete-on-reuse por tipo). No hay borrado por rango general: periodos solapados de distinto tipo/rango **coexisten**.

### Decisión 3 — `TIPO_DS` discrimina + solapamientos + most-recent-wins

`MRO_MOTORFECHA.TIPO_DS ∈ {REGLAS, PARAMS, AMBOS}`. Los periodos **pueden solaparse**. Al evaluar, para un par (fecha, tipo de objeto) el sistema toma el periodo **MÁS RECIENTE** cuyo `TIPO_DS IN (tipo, 'AMBOS')` y cuyo rango cubre la fecha.

Esto aplica a la **reescritura de la SP de lectura del motor** `cfg_get_offers_and_params_json` (hoy filtra solo por fecha en L83-109 → duplicaría filas ante solapamientos):

- **Reglas** de cada oferta ← periodos con `TIPO_DS IN ('REGLAS','AMBOS')`.
- **Params** de cada oferta ← periodos con `TIPO_DS IN ('PARAMS','AMBOS')`.
- Entre los periodos que cubren `@DATE`, se elige el de **mayor `DESDE_DT`** (most-recent-wins) por oferta y tipo de objeto.

**TIPO_DS en el deploy (detalle de diseño):** por defecto `AMBOS` en una publicación completa; permitir `REGLAS`/`PARAMS` si la UI llegara a soportar periodos parciales. Cómo (o si) la UI expone esta elección en los 4 flujos → se marca para diseño.

### Generación de IDs

Todos los ids MRO son **no-identity** → `MAX(id)+1` por tabla.

- **Añadir `MAX(MOTORFECHA_ID)` a `getMaxIds`** (`admin_workflow_service.js`).
- **Capturar el MAX ANTES de borrar** y continuar la numeración desde ese máximo (high-water mark, **sin reutilizar ids**).
- En **reselección de periodo exacto** `(DESDE_DT, HASTA_DT, TIPO_DS)`: reutilizar el `MOTORFECHA_ID` existente, borrar dependientes, reinsertar.

### Capacidad 1 — Tomar un snapshot de WF

| Capa | Cambio |
|------|--------|
| SQL | `cfg_get_workflow_snapshot_json`: dejar de leer inline `VIGENCIA_*` (L34-35, L76-77, L89-90) → leer por `MOTORFECHA_ID` JOIN `MRO_MOTORFECHA`. |
| API | `createWorkflowSnapshot` sigue escribiendo el registro en `cfg_config_snapshot` con `entorno_cd='WF'`. Sin cambio de destino de catálogo. |
| Angular | Reusar la página de snapshots; el snapshot WF aparece en el mismo listado filtrable. |

### Capacidad 2 — Publicar la configuración actual a WF

| Capa | Cambio |
|------|--------|
| SQL | El path de inserción resuelve/crea `MOTORFECHA_ID` (upsert por `(DESDE_DT,HASTA_DT,TIPO_DS)`) **antes** de insertar reglas/params y asigna la FK. |
| API | `getMaxIds` (+`MOTORFECHA_ID`), `insertMRORecords` (quitar `VIGENCIA_*`, poblar `MOTORFECHA_ID`), `deletePeriodFromMRO` (borrar por `MOTORFECHA_ID`), upsert `MOTORFECHA`. Endpoint `POST /api/admin/workflow/publicar` ya existe. |
| Angular | Añadir botón "Publicar a WF" cableado a `admin-api.service.ts`. |

### Capacidad 3 — Publicar un snapshot registrado en POC a WF

| Capa | Cambio |
|------|--------|
| SQL | Igual que capacidad 2: upsert `MOTORFECHA` + insert MRO_* con FK, sin inline. |
| API | Tomar `rules_json`/`params_json` del snapshot POC en `cfg_config_snapshot` y enrutar al mismo path de inserción MRO. |
| Angular | Acción "Publicar a WF" sobre una fila del listado de snapshots (origen POC). |

### Capacidad 4 — Desplegar a POC un snapshot de origen WF

| Capa | Cambio |
|------|--------|
| SQL | El destino POC sigue su path actual (sin cambio de motor en este flujo). |
| API | `restoreSnapshot` / deploy-a-POC (`admin_service.js`, `admin_snapshots_controller.js`): aceptar `entorno_cd='WF'` y transformar el payload (resolver `oferta_id` ↔ código, deduplicar params por clave last-wins, mapear periodos a destino POC). |
| Angular | Habilitar la acción deploy-a-POC para filas de origen WF en `snapshots-page.component.ts`. |

## Riesgos y rollback

| Severidad | Riesgo | Mitigación |
|-----------|--------|------------|
| **CRÍTICO** | **Reescritura de `cfg_get_offers_and_params_json`** (SP de lectura del motor). Toca el path de evaluación de **TODAS las simulaciones** (INIT/PRE/FINAL). Un error en la resolución most-recent-wins / `TIPO_DS` cambia dictámenes silenciosamente. | Regresión obligatoria del motor (`node --test`) sobre fixtures con periodos solapados y por tipo. No fusionar sin verde. Validar duplicados=0 ante solapamiento. |
| ALTO | `MRO_MOTORFECHA` no tiene path de inserción hoy; `MAX(MOTORFECHA_ID)+1` puede colisionar bajo concurrencia. | Upsert por `(DESDE_DT,HASTA_DT,TIPO_DS)` con `UPDLOCK` dentro de la transacción del deploy; capturar MAX antes de borrar (high-water mark, sin reutilizar). |
| ALTO | Migración de `cfg_get_workflow_snapshot_json` a `MOTORFECHA_ID`: si la captura de snapshot WF lee mal el periodo, los snapshots quedarían incompletos. | Migrar la SP en el mismo cambio que el path de escritura; test de ida y vuelta publish→snapshot. |
| MEDIO | Transformación snapshot origen-WF → POC: códigos de oferta WF y POC pueden diferir; params de varios periodos deben deduplicarse. | Resolución por `oferta_id` + dedupe last-wins; cubrir con tests. |

**Plan de rollback:**

1. Cada deploy/publish destructivo crea un snapshot automático del estado previo en `cfg_config_snapshot` (mecanismo existente) → restaurable.
2. Cambios SQL entregados como scripts idempotentes; el alta/baja de columnas y la reescritura de SP se versiona.
3. Los cambios de UI son aditivos (botones nuevos) y desactivables sin tocar el backend.

> Nota: al eliminar `VIGENCIA_*` ya **no hay** escritura dual como red de seguridad. La compatibilidad de lectura se garantiza migrando **a la vez** las dos SP (motor + snapshot WF) al modelo `MOTORFECHA_ID`.

## Módulos afectados

### SQL
- `rule_set/sql/workflow_deploy/wf_sp_cfg_get_offers_and_params_json.sql` — **reescritura** (TIPO_DS + most-recent-wins). IN SCOPE.
- `rule_set/sql/workflow_snapshot.sql` — SP de snapshot WF: migrar de inline `VIGENCIA_*` a `MOTORFECHA_ID`.
- `rule_set/sql/workflow_deploy/wf_data_model.sql` — esquema MRO objetivo (`MRO_MOTORFECHA` con `TIPO_DS`; sin `VIGENCIA_*` en regla/param). Referencia.
- `rule_set/sql/workflow_deploy/wf-seed_offers.sql` — seed aún escribe `VIGENCIA_*` sin `MOTORFECHA_ID`; alinear al nuevo modelo.

### API
- `rule_set/api/services/admin_workflow_service.js` — `getMaxIds` (+`MOTORFECHA_ID`), `insertMRORecords` (drop `VIGENCIA_*`, set `MOTORFECHA_ID`), `deletePeriodFromMRO` (por `MOTORFECHA_ID`), upsert `MOTORFECHA`, `createWorkflowSnapshot`.
- `rule_set/api/services/admin_service.js` — `restoreSnapshot` (aceptar origen WF), `createSnapshot`, `listSnapshots`.
- `rule_set/api/controllers/admin_snapshots_controller.js` — endpoints de snapshot/deploy.
- `rule_set/api/routes/admin_routes.js` — rutas.

### Angular
- `rule_set/web/src/app/pages/snapshots-page.component.*` — acciones publicar-a-WF y deploy-a-POC (origen WF).
- `rule_set/web/src/app/services/admin-api.service.ts` — cliente HTTP de los nuevos flujos.
- `rule_set/web/src/app/models/admin.models.ts` — tipos TypeScript.

## Preguntas abiertas restantes (para diseño)

1. **Forma SQL exacta del most-recent-wins** en `cfg_get_offers_and_params_json`: `ROW_NUMBER() OVER (PARTITION BY oferta, tipo ORDER BY DESDE_DT DESC)` vs subconsulta correlacionada — evaluar rendimiento sobre el volumen real.
2. **¿Necesita cambio el motor JS** (`rule_engine.js`) si la SP ya devuelve un único periodo resuelto por oferta y tipo? (Hipótesis: no, solo consume; confirmar en diseño.)
3. **¿Cómo expone la UI la elección de `TIPO_DS`** (si lo hace) en los 4 flujos? Por defecto `AMBOS`; periodos parciales `REGLAS`/`PARAMS` solo si la UI los soporta más adelante.
