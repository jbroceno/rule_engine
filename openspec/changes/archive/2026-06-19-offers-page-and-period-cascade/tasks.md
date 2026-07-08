# Tasks — offers-page-and-period-cascade

**Delivery**: 3 chained PRs. PR1 y PR2a pueden desarrollarse en paralelo; PR2b depende de PR2a mergeado.

## Review Workload Forecast

| Slice | Líneas estimadas | Budget risk |
|-------|-----------------|-------------|
| PR1   | ~280-350 | Medium |
| PR2a  | ~250-320 | Medium |
| PR2b  | ~220-280 | Medium |

Chained PRs recommended: Yes | 400-line budget risk: High (total ~750-950) | Decision needed before apply: No (sub-split ya acordado).

---

## PR1 — Página /ofertas (frontend) — 5 tareas

- [x] T1.1 [TEST] Spec de OfertasPageComponent (test-first, archivo nuevo)
- [x] T1.2 Crear OfertasPageComponent — extracción mecánica de panel-offers del Configurador
- [x] T1.3 Registrar ruta /ofertas + enlace en nav (app.routes.ts, app.ts/app.html)
- [x] T1.4 Eliminar panel-offers del Configurador (conservar getOffers() sin filtro para selects)
- [x] T1.5 [TEST] Actualizar spec del Configurador (eliminar assertions panel-offers, verificar selects)

Orden: T1.1 → T1.2 → T1.3 (paralelo con T1.4 → T1.5)

---

## PR2a — Backend (admin_service + controller + ruta) — 7 tareas

- [x] T2a.1 [TEST] Tests node:test listOffersInPeriod (DISTINCT, excluye sin reglas, orden)
- [x] T2a.2 Implementar listOffersInPeriod(offerDateId) en admin_service.js
- [x] T2a.3 [TEST] Tests node:test deleteRulesForOfferInPeriod
- [x] T2a.4 Implementar deleteRulesForOfferInPeriod(offerCode, offerDateId, createdBy)
- [x] T2a.5 [TEST] Tests controller: routing por offerDateId y nuevo handler removeOfferRulesInPeriod
- [x] T2a.6 Actualizar getOffers controller (routing offerDateId) + añadir removeOfferRulesInPeriod handler
- [x] T2a.7 Registrar DELETE /offers/:offerCode/rules en admin_routes.js ANTES de DELETE /offers/:offerCode

Orden: T2a.1→T2a.2→T2a.3→T2a.4 (paralelo con T2a.2→T2a.5→T2a.6→T2a.7)

---

## PR2b — Frontend configurador period-scoped — 5 tareas (depende de PR2a mergeado)

- [x] T2b.1 [TEST] Spec AdminApiService: getOffers(offerDateId?) y deleteOfferRulesInPeriod()
- [x] T2b.2 Añadir tipo AdminOfferRulesDeleteResponse en admin.models.ts
- [x] T2b.3 Actualizar AdminApiService: ampliar getOffers(offerDateId?), añadir deleteOfferRulesInPeriod()
- [x] T2b.4 [TEST] Spec Configurador: panel período (sin período → aviso, con período → filtrado, selects sin filtro, editar, borrar confirm/cancel)
- [x] T2b.5 Implementar panel "Ofertas en este período" en ConfiguradorPageComponent (periodOffers signal, loadPeriodOffers, confirmDialog variante offer-period, executeOfferPeriodDelete)

Orden: T2b.1→T2b.2→T2b.3 (paralelo con T2b.1→T2b.4→T2b.5); T2b.5 depende de T2b.3 y T2b.4.

---

## Archivos nuevos
- web/src/app/pages/ofertas-page.component.ts (PR1)
- web/src/app/pages/ofertas-page.component.html (PR1)
- web/src/app/pages/ofertas-page.component.spec.ts (PR1)
- test/admin_offers.test.js si no existe (PR2a)

## Notas críticas para apply
1. Ruta Express: DELETE /offers/:offerCode/rules ANTES de DELETE /offers/:offerCode.
2. Snapshot fuera de tx (ADR-3) — patrón idéntico a deleteOffer.
3. No eliminar getOffers() sin filtro del Configurador — lo usan los selects (FR-102).
4. Sin período activo: aviso + vacío, NO fallback a getOffers() sin filtro (FR-101).
5. Texto confirm diferente: /ofertas=\"todos los períodos\" vs Configurador=\"SOLO en el período activo\".
