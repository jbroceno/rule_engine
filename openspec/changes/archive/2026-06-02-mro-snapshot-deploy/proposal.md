# Propuesta: mro-snapshot-deploy (v3 — corrige v1, SIN escritura dual)

> Reemplaza el contrato de despliegue anterior (publicar escribiendo VIGENCIA_* inline). Ese mecanismo YA NO ES VÁLIDO. La vigencia se gestiona EXCLUSIVAMENTE por MRO_MOTORFECHA + FK MOTORFECHA_ID. VIGENCIA_DESDE_DT/VIGENCIA_HASTA_DT se eliminan del modelo y NO deben escribirse.

> Engram observation: #80

## Intención

Migrar publicación/despliegue a WF y snapshots al nuevo modelo MRO (vigencia por MRO_MOTORFECHA / MOTORFECHA_ID). Hoy el insert (admin_workflow_service.js) escribe solo VIGENCIA_* inline y nunca asigna MOTORFECHA_ID, mientras cfg_get_offers_and_params_json YA filtra por MOTORFECHA_ID → inconsistencia activa.

Éxito: 4 flujos web sobre MOTORFECHA_ID; cero escrituras a VIGENCIA_*; el motor resuelve un único periodo aplicable por oferta y tipo; simulaciones INIT/PRE/FINAL verdes en regresión.

## Alcance — dentro

1. Tomar snapshot de WF (cfg_get_workflow_snapshot_json → cfg_config_snapshot). La SP lee inline → migrar a MOTORFECHA_ID.
2. Publicar config actual a WF (exponer POST /api/admin/workflow/publicar en UI; falta botón).
3. Publicar snapshot POC a WF.
4. Desplegar snapshot origen-WF a POC (ampliar deploy-a-POC que hoy solo acepta origen POC).

Workstream SQL transversal (IN SCOPE, riesgo principal):
- cfg_get_offers_and_params_json (SP lectura del motor): reescribir con TIPO_DS + most-recent-wins.
- cfg_get_workflow_snapshot_json (SP snapshot WF): migrar de inline VIGENCIA_* a MOTORFECHA_ID.

## Alcance — fuera

- MRO_MOTORSNAPSHOT como catálogo (queda en cfg_config_snapshot — Decisión 1).
- Feature BORRAR_VIGENCIA_*.
- Lógica de evaluación del motor JS (rule_engine.js) más allá de consumir la SP corregida.
- "Copiar snapshot" como duplicación de filas.

## Decisiones de arquitectura

### Decisión 1 — Catálogo en cfg_config_snapshot
Solo deploy/publish escribe MRO_* live. ENTORNO_CD ∈ {POC, WF}.

### Decisión 2 — Migración a MOTORFECHA_ID, SIN inline
1. Upsert MRO_MOTORFECHA por clave (DESDE_DT, HASTA_DT, TIPO_DS). Match exacto → reutiliza MOTORFECHA_ID, borra dependientes del tipo cubierto, reinserta. Sin match → nuevo id.
2. Asigna FK MOTORFECHA_ID a MOTORREGLA/MOTORPARAM. NO escribe VIGENCIA_*.
3. deletePeriodFromMRO borra por JOIN a MOTORFECHA_ID, acotado a los tipos cubiertos. Sin borrado por rango general; periodos solapados de distinto tipo/rango coexisten.

### Decisión 3 — TIPO_DS + solapamientos + most-recent-wins
TIPO_DS ∈ {REGLAS, PARAMS, AMBOS}. Periodos pueden solaparse. Para (fecha, tipo) se toma el MÁS RECIENTE con TIPO_DS IN (tipo,'AMBOS') que cubre la fecha.

### Generación de IDs
Ids MRO no-identity → MAX(id)+1 por tabla. Añadir MAX(MOTORFECHA_ID) a getMaxIds. Capturar MAX ANTES de borrar y continuar desde el high-water mark (sin reutilizar).

## Riesgos y rollback

- CRÍTICO: reescritura de cfg_get_offers_and_params_json toca evaluación de TODAS las simulaciones → regresión obligatoria node --test.
- ALTO: MRO_MOTORFECHA sin path de inserción hoy; MAX+1 colisiona bajo concurrencia → upsert con UPDLOCK.
- ALTO: migración de cfg_get_workflow_snapshot_json a MOTORFECHA_ID.
- MEDIO: transformación WF→POC (códigos divergentes, dedupe params).

Rollback: snapshot automático previo; scripts SQL idempotentes; UI aditiva y desactivable. NO hay escritura dual.

## Módulos afectados

SQL: wf_sp_cfg_get_offers_and_params_json.sql, workflow_snapshot.sql, wf_data_model.sql.
API: admin_workflow_service.js, admin_service.js, admin_snapshots_controller.js, admin_routes.js.
Angular: snapshots-page.component.*, admin-api.service.ts, admin.models.ts.
