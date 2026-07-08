# Especificación delta — mro-snapshot-deploy

> SUPERSEDES: openspec/specs/workflow-deployment/spec.md (inline-VIGENCIA model), archive/2026-05-26-workflow-deployment, wf-offer-mapping
> Engram observation: #84

## Invariantes clave

- VIGENCIA_DESDE_DT / VIGENCIA_HASTA_DT: NUNCA se escriben en MRO_MOTORREGLA / MRO_MOTORPARAM
- Toda fila MRO_ DEBE tener MOTORFECHA_ID NOT NULL (FK a MRO_MOTORFECHA)
- ENTORNO_CD ∈ {POC, WF} únicamente
- TIPO_DS ∈ {REGLAS, PARAMS, AMBOS} únicamente
- IDs: MAX+1 capturado ANTES de borrar (high-water mark, sin reutilizar)

## RF-MRO-01 — SP de lectura (cfg_get_offers_and_params_json)

- Reglas: periodos TIPO_DS IN ('REGLAS','AMBOS') que cubren @DATE
- Params: periodos TIPO_DS IN ('PARAMS','AMBOS') que cubren @DATE
- Most-recent-wins: entre periodos elegibles, mayor DESDE_DT por oferta+tipo
- Zero duplicados ante solapamientos
- NO leer VIGENCIA_* columns

## RF-MRO-02 — Upsert MRO_MOTORFECHA (deploy/publish)

- Clave upsert: (DESDE_DT, HASTA_DT, TIPO_DS)
- Coincidencia exacta → reutilizar MOTORFECHA_ID, borrar dependientes del tipo, reinsertar
- Sin coincidencia → nuevo MOTORFECHA_ID = MAX+1
- Borrado acotado al TIPO_DS del periodo (REGLAS borra solo MOTORREGLA, PARAMS solo MOTORPARAM, AMBOS borra ambos)
- Periodos distintos coexisten sin borrado cruzado
- Todo en una transacción; fallo → rollback completo

## RF-MRO-03 — IDs

- getMaxIds incluye MAX(MOTORFECHA_ID)
- MAX capturado ANTES de borrar
- Re-uso de MOTORFECHA_ID: ids dependientes nuevos desde MAX_previo+1

## 4 Capacidades web

1. Snapshot WF: SP lee por MOTORFECHA_ID JOIN, escribe cfg_config_snapshot ENTORNO_CD='WF'
2. Publicar config actual a WF: botón UI → POST /admin/workflow/publicar → path MRO; snapshot seguridad automático previo
3. Publicar snapshot POC a WF: acción sobre fila ENTORNO_CD='POC' → mismo path MRO
4. Desplegar snapshot WF a POC: acepta ENTORNO_CD='WF', transforma (oferta_id↔code, dedupe params last-wins)

## 15 escenarios Given/When/Then

- 01: most-recent-wins AMBOS + PARAMS posterior → params del más reciente, reglas del AMBOS
- 02: único AMBOS → ambos tipos del mismo periodo
- 03: sin periodo → 0 reglas/params, sin error
- 04: deploy periodo nuevo → crea MOTORFECHA_ID, no escribe VIGENCIA_*
- 05: deploy periodo exacto → reutiliza MOTORFECHA_ID=42, ids dependientes desde MAX previo
- 06: re-pub periodo X no afecta periodo Y de distinto rango/tipo
- 07: TIPO_DS=PARAMS no borra MOTORREGLA
- 08: high-water mark → IDs 101+ aunque 96-100 estén libres
- 09: snapshot WF incluye DESDE_DT/HASTA_DT/TIPO_DS, no VIGENCIA_*
- 10: snapshot seguridad automático antes de deploy; snapshot_id en respuesta
- 11: pub snapshot POC a WF = resultado idéntico a pub directa
- 12: dedupe params WF→POC last-wins por DESDE_DT
- 13: ENTORNO_CD='PRE' rechazado con 4xx
- 14: filtro por ENTORNO_CD funciona correctamente
- 15: regresión npm test verde tras reescritura SP; zero duplicados

## Archivo spec

openspec/changes/mro-snapshot-deploy/specs/workflow-deployment/spec.md
