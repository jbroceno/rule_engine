# Spec: workflow-deployment — MRO model (mro-snapshot-deploy)

> **Supersedes**: inline-VIGENCIA model (archive/2026-05-26-workflow-deployment), wf-offer-mapping
> **Established by**: change `mro-snapshot-deploy`, archived 2026-06-02
> **Engram observation**: #84

---

## Invariantes clave

- `VIGENCIA_DESDE_DT` / `VIGENCIA_HASTA_DT`: NUNCA se escriben en `MRO_MOTORREGLA` / `MRO_MOTORPARAM`
- Toda fila MRO_ DEBE tener `MOTORFECHA_ID` NOT NULL (FK a `MRO_MOTORFECHA`)
- `ENTORNO_CD` ∈ {`POC`, `WF`} únicamente — cualquier otro valor se rechaza con HTTP 400
- `TIPO_DS` ∈ {`REGLAS`, `PARAMS`, `AMBOS`} únicamente
- IDs: `MAX+1` capturado ANTES de borrar (high-water mark, sin reutilizar ids liberados)

---

## RF-MRO-01 — SP de lectura (`cfg_get_offers_and_params_json`)

- Reglas: periodos con `TIPO_DS IN ('REGLAS','AMBOS')` que cubren `@DATE`
- Params: periodos con `TIPO_DS IN ('PARAMS','AMBOS')` que cubren `@DATE`
- Most-recent-wins: entre periodos elegibles, mayor `DESDE_DT` por oferta+tipo (implementado con `ROW_NUMBER()` particionado por `MOTOROFERTA_ID` + tipo, orden `DESDE_DT DESC, MOTORFECHA_ID DESC`)
- Zero duplicados ante solapamientos — invariante garantizado por la CTE ganadora
- NO leer columnas `VIGENCIA_*`
- Archivos SQL: `rule_set/sql/workflow_deploy/wf_sp_cfg_get_offers_and_params_json.sql`

## RF-MRO-02 — Upsert `MRO_MOTORFECHA` (deploy/publish)

- Clave upsert: (`DESDE_DT`, `HASTA_DT`, `TIPO_DS`)
- Coincidencia exacta → reutilizar `MOTORFECHA_ID` existente, borrar dependientes del tipo cubierto, reinsertar
- Sin coincidencia → nuevo `MOTORFECHA_ID = MAX+1`
- Borrado acotado al `TIPO_DS` del periodo:
  - `REGLAS` borra solo `MRO_MOTORREGLA` (y dependientes COND/CONDVAL/ACCION)
  - `PARAMS` borra solo `MRO_MOTORPARAM`
  - `AMBOS` borra ambos
- Periodos de distinto `TIPO_DS` o rango coexisten sin borrado cruzado
- Todo en una transacción; fallo → rollback completo
- Función JS: `upsertMotorFecha(tx, desde, hasta, tipo, maxIdRef)` en `admin_workflow_service.js`

## RF-MRO-03 — IDs (high-water mark)

- `getMaxIds` incluye `MAX(MOTORFECHA_ID)` (además de `MAX` por tabla de reglas/params)
- MAX capturado ANTES de borrar (antes de `deletePeriodFromMRO`)
- Reutilización de `MOTORFECHA_ID` en upsert exacto: los ids de dependientes (REGLA, PARAM, COND…) siguen siendo nuevos desde el high-water mark previo al borrado
- Implementado en `admin_workflow_service.js` → `getMaxIds` + `maxIdRef.val`

---

## 4 Capacidades web

| Cap | Descripción | Endpoint | Estado |
|-----|-------------|----------|--------|
| 1 | Tomar snapshot WF (leer MRO_* live → `cfg_config_snapshot`) | `POST /api/admin/workflow/snapshot` | Implementado |
| 2 | Publicar config actual a WF | `POST /api/admin/workflow/publicar` | Implementado |
| 3 | Publicar snapshot POC a WF | Acción sobre fila `ENTORNO_CD='POC'` en snapshots | Implementado |
| 4 | Desplegar snapshot WF a POC | Acción sobre fila `ENTORNO_CD='WF'` en snapshots | Implementado |

### Capacidad 1 — Snapshot WF

- SP `cfg_get_workflow_snapshot_json` lee por `MOTORFECHA_ID JOIN MRO_MOTORFECHA` (no por inline `VIGENCIA_*`)
- Escribe en `cfg_config_snapshot` con `ENTORNO_CD='WF'`, `VIGENCIA_DESDE_DT`/`VIGENCIA_HASTA_DT` tomados de `MRO_MOTORFECHA.DESDE_DT/HASTA_DT`
- JSON fields expuestos: `VIGENCIA_DESDE_DT`, `VIGENCIA_HASTA_DT`, `TIPO_DS` (aliases estables para compatibilidad con `restoreSnapshot`)
- Angular: `AdminWorkflowSnapshotPayload` tiene `vigDesde`/`vigHasta`/`createdBy` (NO `motorFechaId`)

### Capacidad 2 — Publicar config actual a WF

- Snapshot de seguridad automático ANTES de publicar (`createWorkflowSnapshot` → `prePublishSnapshotId` en respuesta)
- Campo opcional `tipoDs` (default `AMBOS`) en `AdminWorkflowPublicarPayload`
- Angular: dialog en configurador con selector `TIPO_DS` (default `AMBOS`)

### Capacidad 3 — Publicar snapshot POC a WF

- Toma `rules_json`/`params_json` del snapshot origen y enruta al path MRO (mismo `publishSnapshotToWorkflow`)
- `tipoDs` hardcodeado `AMBOS` en snapshots-page
- Angular: botón de acción en filas `ENTORNO_CD='POC'`

### Capacidad 4 — Desplegar snapshot WF a POC

- `admin_service.restoreSnapshot` acepta `entorno_cd='WF'`
- Transformación: `oferta_id ↔ código` (resolución por FK), dedupe params last-wins, mapeo periodos a POC (`pocFechaDesde`)
- Angular: botón deploy habilitado para filas `ENTORNO_CD='WF'` (antes solo POC)

---

## 15 Escenarios de prueba (Given/When/Then)

| # | Escenario | Estado CI |
|---|-----------|-----------|
| 01 | most-recent-wins: AMBOS + PARAMS posterior → params del más reciente, reglas del AMBOS | CI-compliant (T1.1a-b) |
| 02 | Único AMBOS → ambos tipos del mismo periodo | CI-compliant (T1.1c) |
| 03 | Sin periodo → 0 reglas/params, sin error | CI-compliant (T1.1d-e) |
| 04 | Deploy periodo nuevo → crea `MOTORFECHA_ID`, no escribe `VIGENCIA_*` | LIVE-DB-PENDING |
| 05 | Deploy periodo exacto → reutiliza `MOTORFECHA_ID=42`, ids dependientes desde MAX previo | LIVE-DB-PENDING |
| 06 | Re-pub periodo X no afecta periodo Y de distinto rango/tipo | LIVE-DB-PENDING |
| 07 | `TIPO_DS=PARAMS` no borra `MOTORREGLA` | CI-compliant (T2.1b+T2.2e) |
| 08 | High-water mark → IDs 101+ aunque 96-100 estén libres | LIVE-DB-PENDING |
| 09 | Snapshot WF incluye `DESDE_DT`/`HASTA_DT`/`TIPO_DS`, no `VIGENCIA_*` inline | CI-compliant (T2.4a-e) |
| 10 | Snapshot seguridad automático antes de deploy; `snapshot_id` en respuesta | CI-compliant (W-2a/b/c) |
| 11 | Pub snapshot POC a WF = resultado idéntico a pub directa | LIVE-DB-PENDING |
| 12 | Dedupe params WF→POC last-wins por `DESDE_DT` | LIVE-DB-PENDING |
| 13 | `ENTORNO_CD='PRE'` rechazado con 4xx | CI-compliant (validateEntornoCd wired en controller) |
| 14 | Filtro por `ENTORNO_CD` funciona correctamente | CI-compliant (T3.1c) |
| 15 | Regresión `npm test` verde tras reescritura SP; zero duplicados | CI-compliant (156/163) |

### LIVE-DB-PENDING — checklists en archivos SQL

Los escenarios 04, 05, 06, 08, 11, 12 requieren SQL Server. Los checklists de verificación están embebidos en los headers de:

- `rule_set/sql/workflow_deploy/wf_sp_cfg_get_offers_and_params_json.sql` — 5 casos: most-recent-wins, zero-duplicate en solapamiento
- `rule_set/sql/workflow_snapshot.sql` — 7 casos: migración MOTORFECHA, aliases JSON estables

**Write-path checklist** (verificar vs SQL Server antes de producción):
- [ ] No se escribe `VIGENCIA_*` en ninguna tabla `MRO_`
- [ ] `MOTORFECHA_ID` asignado en cada fila insertada
- [ ] Periodo exacto → reutiliza `MOTORFECHA_ID`, dependientes con ids nuevos
- [ ] Periodos de distinto `TIPO_DS` coexisten sin borrado cruzado
- [ ] IDs no se reutilizan (high-water mark respetado)

---

## Archivos afectados

| Capa | Archivo | Cambio |
|------|---------|--------|
| SQL | `rule_set/sql/workflow_deploy/wf_sp_cfg_get_offers_and_params_json.sql` | Reescritura con CTEs `mf_rules_win`/`mf_params_win` (ROW_NUMBER most-recent-wins + TIPO_DS) |
| SQL | `rule_set/sql/workflow_snapshot.sql` | Migración `cfg_get_workflow_snapshot_json` a `MOTORFECHA_ID JOIN` |
| API | `rule_set/api/services/admin_workflow_service.js` | `getMaxIds+maxFecha`, `upsertMotorFecha`, `deletePeriodFromMRO` por FK, `insertMRORecords` sin `VIGENCIA_*`, `assembleWfSnapshotPayload`, `buildWfSafetySnapshotComment` |
| API | `rule_set/api/services/admin_service.js` | `restoreSnapshot` acepta `ENTORNO_CD='WF'` (ya implementado); `validateEntornoCd` wired |
| API | `rule_set/api/controllers/admin_snapshots_controller.js` | `parseOfertaIdOverrides`, `validateEntornoCd` (400 en destino fuera de POC/WF), safety snapshot en `postWorkflowPublicar` |
| API | `rule_set/api/validators/admin_validator.js` | `validateEntornoCd` exportado |
| Angular | `rule_set/web/src/app/models/admin.models.ts` | `tipoDs` en `AdminWorkflowPublicarPayload`; `AdminWorkflowPublicarSnapshotPayload`; `AdminWorkflowSnapshotPayload` → `vigDesde/vigHasta` |
| Angular | `rule_set/web/src/app/services/admin-api.service.ts` | `publishSnapshotToWorkflow`; `createWorkflowSnapshot` con `vigDesde/vigHasta` |
| Angular | `rule_set/web/src/app/pages/snapshots-page.component.*` | Cap-3 (pub POC→WF), Cap-4 (deploy WF→POC), WF snapshot dialog con date range |
| Angular | `rule_set/web/src/app/pages/configurator-page.component.*` | `publicarTipoDs` signal, selector `TIPO_DS` en dialog (Cap-2) |
| Tests | `rule_set/test/rule_engine.test.js` | Fixtures most-recent-wins, zero-duplicate (T1.1a-e) |
| Tests | `rule_set/test/workflow_publish.test.js` | `deletePeriodFromMRO` scope-by-tipo (T2.1a-d), `getDeleteScope` (T2.2e) |
| Tests | `rule_set/test/workflow_snapshot_roundtrip.test.js` | `assembleWfSnapshotPayload` shape (T2.4a-e) |
| Tests | `rule_set/web/src/app/services/admin-api.service.spec.ts` | T3.1a-e + T3.cap1a-b (C-2 fix) |

---

## Notas de calidad

- `rule_engine.js` sin cambios — es consumidor puro de lo que devuelve la SP
- Anti-patrón mirror/tautología eliminado 3× durante apply (ver engram #88 `app-workflow/feedback/no-sql-mirror-tests`)
- Suite final contiene solo tests sobre código JS real de producción; la lógica SQL se verifica con checklists live-DB
