# Propuesta: Página /ofertas y borrado de reglas por oferta+período en el Configurador

## Intent
Separar la gestión de la entidad oferta (nueva página /ofertas) del mantenimiento de reglas/params por período (Configurador), para que un usuario pueda limpiar reglas+params de una oferta en UN período sin destruir la oferta ni tocar otros períodos. Hoy ambas responsabilidades viven mezcladas en el panel `panel-offers` del Configurador.

## Scope
### In Scope
- Sub-feature 1 — Página /ofertas: extracción del panel `panel-offers` actual a componente+ruta propios. CRUD entidad completo + borrado total en cascada ya existente.
- Sub-feature 2 — Configurador scoped al período: el panel lista SOLO ofertas con reglas en el período activo. Dos acciones: Editar (entidad, reusa updateOffer) y Borrar (reglas+params de esa oferta SOLO en el período activo, NO la entidad).
- Backend nuevo: listOffersInPeriod(offerDateId) y deleteRulesForOfferInPeriod(offerCode, offerDateId) con snapshot previo. Endpoints: GET /admin/offers?offerDateId=N y DELETE /admin/offers/:offerCode/rules?offerDateId=N.
- Sin período activo: aviso "Seleccioná un período activo" + tabla vacía (NO fallback a todas).

### Out of Scope
- Borrado total en cascada de la entidad (deleteOffer / DELETE /admin/offers/:offerCode) — YA existe (commit f40d687); solo se MUEVE a /ofertas, no se reimplementa.
- OffersStateService compartido (descartado).
- Recuento de reglas por oferta en el panel (futuro).

### Assumptions
- El Configurador sigue necesitando GET /admin/offers SIN filtrar para los selects de offerCode en forms de reglas/params.
- El borrado por período elimina reglas Y params del offerCode en ese offer_date_id (evita params huérfanos) — confirmado por negocio.

## Capabilities
### New
- offer-entity-management: página /ofertas con CRUD completo + borrado total en cascada.
- period-scoped-rule-cleanup: borrado de reglas+params de una oferta acotado a offer_date_id.
### Modified
- None.

## Approach
- Sub-feature 1 (Opción A, extracción mecánica): mover bloque HTML+lógica offers* a OfertasPageComponent (/ofertas) + enlace topbar. Backend sin cambios.
- Sub-feature 2 (Opción A, endpoint nuevo): listOffersInPeriod vía SELECT DISTINCT rs.* FROM cfg_offer_rule r JOIN cfg_offer_ruleset rs WHERE r.offer_date_id=@offerDateId. deleteRulesForOfferInPeriod replica patrón deleteOffer (snapshot + DELETE FK-ordenado condition_values→conditions→actions→rules→params) acotado por offer_date_id y SIN tocar cfg_offer_ruleset. Configurador consume GET /admin/offers?offerDateId=N para la tabla; mantiene GET /admin/offers (sin filtro) para selects.

## Affected Areas
- api/services/admin_service.js (+listOffersInPeriod, +deleteRulesForOfferInPeriod)
- api/controllers/admin_offers_controller.js (+handler delete-by-period; offerDateId opcional en getOffers)
- api/routes/admin_routes.js (+ruta DELETE /offers/:offerCode/rules)
- web app.routes.ts + app.html (+ruta y enlace /ofertas)
- web pages/ofertas-page.component.{ts,html,css,spec.ts} (NEW)
- web pages/configurator-page.component.{ts,html} (panel período + nuevo borrado)
- web services/admin-api.service.ts (+listOffersInPeriod, +deleteRulesForOfferInPeriod)

## Delivery
Dos slices/PRs:
- PR1 — /ofertas (solo frontend): extracción + ruta + enlace + spec. Sin backend. Riesgo 400 líneas: Medio (mover ~250-300 líneas; si excede, dividir tabla/form en commits).
- PR2 — Panel período + endpoint backend: listOffersInPeriod + deleteRulesForOfferInPeriod + endpoint + Configurador + tests. Riesgo: Medio. Si excede, separar backend (PR2a) de frontend (PR2b).

## Risks
- Snapshot de deleteRulesForOfferInPeriod captura todo exportConfig (grandes) → Med; aceptable para auditoría.
- Sin período activo → aviso + tabla vacía (NO fallback).
- Configurador pierde selects → mantener GET /admin/offers sin filtro.
- Ambigüedad UI entidad vs período → textos de confirmación claramente distintos: /ofertas = "oferta y TODAS sus reglas y parámetros de todos los períodos"; Configurador = "reglas y parámetros de esta oferta SOLO en el período activo".

## Rollback
- PR1: revertir commit, panel vuelve al Configurador (sin cambios de datos).
- PR2: revertir commit; cada borrado por período crea snapshot previo → restaurable desde /snapshots. Sin migración de BD.

## Dependencies
- ActivePeriodService (signal período activo en localStorage) — existe.
- cfg_offer_rule.offer_date_id y filtro offerDateId en listRules/listParams — existen.

## Success Criteria
- /ofertas: crear, editar, habilitar/deshabilitar, borrar (cascada total).
- Configurador con período activo lista solo ofertas con reglas en ese período.
- "Borrar" elimina reglas+params solo en período activo (otros intactos) + snapshot.
- "Editar" modifica la entidad (reusa updateOffer).
- Sin período activo: aviso + tabla vacía.
- Selects de offerCode siguen poblados.
