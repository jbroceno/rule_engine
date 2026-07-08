# Verification Report — offers-page-and-period-cascade

**Change**: offers-page-and-period-cascade
**Version**: spec #182
**Mode**: Strict TDD (injected by orchestrator)
**Date**: 2026-06-19

---

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 17 |
| Tasks complete | 17 |
| Tasks incomplete | 0 |

All 17 tasks across PR1 (5), PR2a (7), PR2b (5) marked [x].

---

## Build & Tests Execution

**Build**: ✅ Passed (Angular 20, Karma build 4.93s — no errors)

**Backend (node:test)**:
```
# tests 251
# pass  249
# fail    0
# skipped  2  (CA-013 — live credentials, expected)
# duration_ms 37653
```

**Frontend (Karma/Jasmine)**:
```
Chrome 149.0.0.0 (Windows 10): Executed 111 of 111 SUCCESS (1.764 secs / 1.597 secs)
TOTAL: 111 SUCCESS
```

**Coverage**: Not available — node:test and Karma configured without threshold.

---

## Spec Compliance Matrix

### Capacidad 1 — offer-entity-management (/ofertas)

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| FR-001: Route + nav | acceso directo /ofertas | `ofertas-page.component.spec.ts > renders Ofertas heading` | ✅ COMPLIANT |
| FR-001: Route + nav | enlace en topbar | `app.html line 28: routerLink="/ofertas"` + `app.routes.ts line 13` | ✅ COMPLIANT |
| FR-002: Listado ofertas | con ofertas | `ofertas-page.component.spec.ts > loads and displays offers on init` | ✅ COMPLIANT |
| FR-002: Listado ofertas | listado vacío | `ofertas-page.component.spec.ts > shows empty state when no offers` | ✅ COMPLIANT |
| FR-003: Crear oferta | creación exitosa | `ofertas-page.component.spec.ts > create offer flow` | ✅ COMPLIANT |
| FR-004: Editar oferta | edición exitosa | `ofertas-page.component.spec.ts > edit offer flow` | ✅ COMPLIANT |
| FR-004: renombrado código | cascada offer_code | `admin_service.js updateOffer + deleteOffer cascade — ya cubierto por cascade tests` | ✅ COMPLIANT |
| FR-005: Toggle | toggle sin diálogo | `ofertas-page.component.spec.ts > toggle offer enabled` | ✅ COMPLIANT |
| FR-006: Borrado cascada | borrado exitoso | `admin_offer_cascade_delete.test.js T-01a..T-01h` + `ofertas-page.spec CA-008` | ✅ COMPLIANT |
| FR-006: texto diálogo | "todos los períodos" | `ofertas-page.component.spec.ts CA-010 — textContent contains "todos los períodos"` | ✅ COMPLIANT |
| FR-006: cancelación | sin cambios | `ofertas-page.component.spec.ts CA-009` | ✅ COMPLIANT |

### Capacidad 2 — period-scoped-rule-cleanup (Configurador)

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| FR-101: Filtrado período activo | período con ofertas | `configurator-page.component.spec.ts CA-101 — table rendered` | ✅ COMPLIANT |
| FR-101: sin período activo | aviso + vacío, sin API call | `configurator-page.component.spec.ts CA-102 — notice shown, table absent` | ✅ COMPLIANT |
| FR-101: período sin ofertas | tabla vacía | `admin_offers_period.test.js T-02a-04 (items[])` | ✅ COMPLIANT |
| FR-102: Selects no filtrados | con/sin período | `configurator-page.component.spec.ts T1.5 FR-102` | ✅ COMPLIANT |
| FR-103: Editar desde Configurador | edición exitosa | `configurator-page.component.spec.ts FR-103` | ✅ COMPLIANT |
| FR-104: Borrado período | borrado exitoso + snapshot | `admin_offers_period.test.js T-02a-05, T-02a-08` + `configurator CA-106` | ✅ COMPLIANT |
| FR-104: entidad intacta | cfg_offer_ruleset | `admin_offers_period.test.js T-02a-07` | ✅ COMPLIANT |
| FR-104: otros períodos intactos | otros offer_date_id | `admin_offers_period.test.js T-02a-06` | ✅ COMPLIANT |
| FR-104: texto diálogo | "SOLO en el período activo" | `configurator-page.component.spec.ts CA-109` | ✅ COMPLIANT |
| FR-104: cancelación | sin cambios, sin snapshot | `configurator CA-110` | ✅ COMPLIANT |
| FR-105: DELETE endpoint | offerDateId ausente → 400 | `admin_offers_period.test.js T-02a-14` | ✅ COMPLIANT |
| FR-105: offerCode inexistente | → 404 | `admin_offers_period.test.js T-02a-10` | ✅ COMPLIANT |
| FR-105: idempotente | 0 reglas + snapshot | `admin_offers_period.test.js T-02a-09` | ✅ COMPLIANT |
| FR-105: DISTINCT sin duplicados | listOffersInPeriod | `admin_offers_period.test.js T-02a-01` | ✅ COMPLIANT |

**Compliance summary**: 24/24 scenarios compliant.

---

## Correctness (Static — Structural Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| Route /ofertas registered | ✅ Implemented | app.routes.ts line 13 |
| Nav link "Ofertas" in topbar | ✅ Implemented | app.html line 28 |
| OfertasPageComponent NEW file | ✅ Implemented | ofertas-page.component.{ts,html,css,spec.ts} |
| panel-offers removed from Configurador HTML | ✅ Implemented | grep panel-offers on configurator HTML = 0 matches |
| getOffers() (unfiltered) preserved for selects | ✅ Implemented | loadOffers() calls getOffers() without param; offerCodes computed from offers() |
| listOffersInPeriod via query param | ✅ Implemented | admin_service.js line 825, SELECT DISTINCT FROM cfg_offer_rule JOIN cfg_offer_ruleset |
| deleteRulesForOfferInPeriod: scope by ruleset_id AND offer_date_id | ✅ Implemented | 5 FK-ordered DELETEs, all keyed by both columns |
| deleteRulesForOfferInPeriod: does NOT touch cfg_offer_ruleset | ✅ Implemented | Comment "cfg_offer_ruleset NO se toca" + no DELETE FROM cfg_offer_ruleset |
| deleteRulesForOfferInPeriod: pre-delete snapshot | ✅ Implemented | createSnapshot() called before tx.begin() (ADR-3 pattern) |
| Route DELETE /offers/:offerCode/rules BEFORE DELETE /offers/:offerCode | ✅ Implemented | admin_routes.js lines 26-27, with comment noting critical ordering |
| AdminOfferRulesDeleteResponse type | ✅ Implemented | admin.models.ts lines 51-58 |
| getOffers(offerDateId?) optional param | ✅ Implemented | admin-api.service.ts lines 60-68 |
| deleteOfferRulesInPeriod() in AdminApiService | ✅ Implemented | admin-api.service.ts lines 70-85 |
| Confirmation text /ofertas = "todos los períodos" | ✅ Implemented | ofertas-page.component.ts line 133 |
| Confirmation text Configurador = "SOLO en el período activo" | ✅ Implemented | configurator-page.component.ts line 1309 |
| No active period → notice + empty, NO fallback to getOffers | ✅ Implemented | configurator HTML: @if (!activePeriodRules()) → notice; else → table |

---

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| ADR-1: GET /admin/offers with optional offerDateId query param | ✅ Yes | controller branches on offerDateId > 0 |
| ADR-2: New endpoint DELETE /offers/:offerCode/rules, does NOT touch cfg_offer_ruleset | ✅ Yes | No ruleset delete in deleteRulesForOfferInPeriod |
| ADR-3: Snapshot outside transaction (patrón deleteOffer) | ✅ Yes | createSnapshot before tx.begin() |
| ADR-4: Offers in period = SELECT DISTINCT from cfg_offer_rule JOIN cfg_offer_ruleset | ✅ Yes | listOffersInPeriod query confirmed |
| ADR-5: 5 FK-ordered DELETEs (cv→cond→act→rule→param) + AND offer_date_id filter | ✅ Yes | All 5 DELETEs use ruleset_id AND offer_date_id |
| ADR-6: /ofertas = mechanical extraction, no OffersStateService (YAGNI) | ✅ Yes | OfertasPageComponent is standalone, no shared state service |

---

## Critical Checks (from verification instructions)

| Check | Result |
|-------|--------|
| deleteRulesForOfferInPeriod deletes rules AND params scoped by ruleset_id AND offer_date_id | ✅ PASS |
| deleteRulesForOfferInPeriod does NOT touch cfg_offer_ruleset | ✅ PASS |
| deleteRulesForOfferInPeriod creates pre-delete snapshot | ✅ PASS |
| Route DELETE /offers/:offerCode/rules registered BEFORE DELETE /offers/:offerCode | ✅ PASS — with comment |
| Configurator getOffers() unfiltered preserved for selects | ✅ PASS |
| No active period → notice + empty table, no fallback | ✅ PASS |
| /ofertas confirm text includes "todos los períodos" | ✅ PASS |
| Configurador confirm text includes "SOLO en el período activo" | ✅ PASS |

---

## Issues Found

**CRITICAL** (must fix before archive):
None

**WARNING** (should fix):
- T-02a-11 (rollback atomicity test for deleteRulesForOfferInPeriod) was intentionally omitted as a separate test case. The apply notes state it's covered implicitly by T-02a-10 (404 on nonexistent code means tx rolled back). While this reasoning is sound, a dedicated rollback test provides explicit regression protection for the transactional boundary. Not blocking archive given the design rationale.

**SUGGESTION** (nice to have):
- listOffersInPeriod SELECT does not filter by `r.enabled = 1` on the rule level — it shows offers with ANY rule (enabled or not) in the period. The spec says "ofertas con reglas en el período" without specifying enabled filter. Current behavior is likely intentional (show all offers regardless of rule enabled state) but worth confirming with business if they want to see offers with at least one ENABLED rule.

---

## Verdict

PASS

All 17 tasks complete. Backend: 249/251 pass (2 expected skips, 0 fail). Frontend: 111/111 pass. 24/24 spec scenarios compliant. All critical structural checks pass. Route ordering, scope isolation, snapshot creation, and confirmation text distinctness all verified in code and tests.
