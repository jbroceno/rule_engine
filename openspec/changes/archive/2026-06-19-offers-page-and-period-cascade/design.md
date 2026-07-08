# Design — offers-page-and-period-cascade

## Enfoque
Separar gestión de ENTIDAD oferta (nueva página /ofertas) del mantenimiento de reglas/params por PERÍODO (Configurador). /ofertas = extracción mecánica del panel-offers actual. Configurador pasa a scoped por offer_date_id.

## ADRs
- ADR-1: Listar ofertas del período via query param `offerDateId` opcional sobre GET /admin/offers (NO ruta nueva), por simetría con rules/params que ya aceptan offerDateId (admin_service.js:169-173, :623-625). Misma respuesta {items: AdminOffer[]}.
- ADR-2: Borrado por período = endpoint nuevo DELETE /admin/offers/:offerCode/rules?offerDateId=N → deleteRulesForOfferInPeriod. NO reutilizar applyConfig (abuso semántico + deleteAllPeriods borraría todos los períodos). NO toca cfg_offer_ruleset.
- ADR-3: Snapshot previo reutiliza patrón deleteOffer (createSnapshot fuera de tx, devuelve snapshot_id). Trade-off: snapshot grande (todo exportConfig), aceptable.
- ADR-4: Ofertas del período = SELECT DISTINCT desde cfg_offer_rule (las que TIENEN reglas), no desde cfg_offer_ruleset. Excluye ofertas sin reglas/deshabilitadas.
- ADR-5: Frontera transaccional = igual que deleteOffer: snapshot fuera de tx; dentro, DELETE FK-ordenados (condition_values→conditions→actions→rules→params) + AND offer_date_id=@offerDateId, sin el DELETE del ruleset.
- ADR-6: /ofertas = Opción A extracción mecánica, sin OffersStateService (YAGNI). Configurador mantiene getOffers() sin filtro para selects de offerCode.

## Funciones nuevas (api/services/admin_service.js)
- listOffersInPeriod(offerDateId): SELECT DISTINCT rs.ruleset_id, rs.code AS offerCode, rs.name, rs.offer_rank, rs.enabled, rs.oferta_id FROM cfg_offer_rule r JOIN cfg_offer_ruleset rs ON rs.ruleset_id=r.ruleset_id WHERE r.offer_date_id=@offerDateId ORDER BY rs.offer_rank DESC, rs.code ASC. Devuelve {items}.
- deleteRulesForOfferInPeriod(offerCode, offerDateId, createdBy=null): snapshot previo + tx con resolveRulesetId + 5 DELETE (cv/cond/act/rule/param) keyed por ruleset_id AND offer_date_id, sin ruleset. Devuelve {offerCode, offerDateId, deleted, snapshot_id, deletedRules, deletedParams}. Borra reglas Y params (Open Question 2 resuelta: sí).

## Controller/ruta
- getOffers lee req.query.offerDateId; >0 → listOffersInPeriod, else listOffers.
- Nuevo handler removeOfferRulesInPeriod (offerDateId obligatorio → 400 si falta).
- Rutas: DELETE /offers/:offerCode/rules ANTES de DELETE /offers/:offerCode.

## Frontend
- admin-api.service.ts: getOffers(offerDateId?) amplía firma; deleteOfferRulesInPeriod(offerCode, offerDateId, createdBy?). Nuevo tipo AdminOfferRulesDeleteResponse.
- OfertasPageComponent (NEW): recibe offers signals + offerForm + editOffer/saveOffer/deleteOffer/toggleOffer/loadOffers/executeOfferDelete + confirmDialog "offer" (mueve panel-offers HTML config:157-278, TS :179-181,:426-521,:1337-1373). Ruta /ofertas + nav en app.html.
- Configurador: QUEDA offers()+offerCodes para selects. NUEVO panel "Ofertas en este período": periodOffers signal, loadPeriodOffers() lee activePeriodRules().offer_date_id (sin período → aviso+tabla vacía, NO fallback). confirmDialog variante "offer-period" + executeOfferPeriodDelete.

## Test plan (Strict TDD)
- Backend node:test (suite admin_service): listOffersInPeriod (DISTINCT, excluye sin reglas, no duplica, orden); deleteRulesForOfferInPeriod (scope período, otros períodos intactos, params borrados, ruleset sobrevive, snapshot creado, 404 offerCode inexistente, cero reglas → 0+snapshot, rollback). Controller: ?offerDateId routing, DELETE sin offerDateId → 400.
- Frontend Karma: ofertas-page.component.spec.ts (NEW); configurator spec (con/sin período activo, deleteOfferRulesInPeriod, selects poblados); admin-api.service.spec.

## Delivery
- PR1 /ofertas frontend: riesgo 400 MEDIO-ALTO; si excede, PR1a (tabla+ruta+nav) / PR1b (form+spec).
- PR2 backend+frontend: EXCEDE 400 → sub-split PR2a (backend: 2 fns + getOffers + ruta + tests, ~250-320) / PR2b (frontend service+modelos+Configurador+specs, ~200-280, depende de PR2a).
- Chained PRs: Sí. 400-budget risk: Alto en PR2. Decision needed before apply: Sí.

## Riesgos
Snapshot grande (aceptable); sin período activo (aviso+vacío); selects (mantener getOffers sin filtro); ambigüedad entidad vs período (textos confirm distintos + variantes confirmDialog); colisión rutas Express (declarar /rules antes); PR2>400 (sub-split).

## Where
openspec/changes/offers-page-and-period-cascade/design.md + engram. Código real: /rule_set/api/services/admin_service.js (deleteOffer :892-974, resolveRulesetId :33-44, listOffers :815-823, listRules offerDateId :169-173), admin_offers_controller.js, admin_routes.js :21-25, web configurator-page.component.ts :179-521,:1337-1373 + .html :157-278, admin-api.service.ts :59-90, app.routes.ts, app.html :26-54.
