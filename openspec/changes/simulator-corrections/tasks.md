---
change: simulator-corrections
type: tasks
status: completed
date: 2026-05-26
---

# Tareas: simulator-corrections

## Review Workload Forecast

- **Líneas estimadas cambiadas**: ~250
- **Riesgo de presupuesto 400 líneas**: Medium
- **Chained PRs recomendados**: No
- **Decisión necesaria antes de apply**: No
- **Estrategia**: single PR

## Fase 1 — Renombrado `primeraViviendaHabitual`

- [x] Actualizar `rule_set/rules.json`: reglas con nombre `"INIT Rechazo: No es primera vivienda habitual"`, field `primeraViviendaHabitual`, operador `EQ` con `value1: 0`, motivo `NO_PRIMERA_VIVIENDA`.
- [x] Actualizar `rule_set/sql/seed_offers.sql`: condición R4 con `primeraViviendaHabitual EQ 0` y `finalidad NE 1` (antes `NE 15`).
- [x] Actualizar fixtures en `rule_set/test/offer_scenarios.test.js` (caso OK: `primeraViviendaHabitual: 1`; caso rechazo: `primeraViviendaHabitual: 0`).
- [x] Actualizar fixtures en `rule_set/test/rule_engine.test.js`.
- [x] Actualizar `rule_set/test/workflow_adapter.test.js`: remover tests de `tieneOtrasPropiedades`, añadir tests del nuevo mapeo.
- [x] Actualizar `rule_set/api/services/workflow_adapter.js`: mapeo `primeraViviendaHabitual: body.primeraViviendaHabitualFl ? 1 : 0`.
- [x] Actualizar `rule_set/api/services/wf_compare_service.js`: `tienecasaFl: input.primeraViviendaHabitual ? 0 : 1`.
- [x] Actualizar `rule_set/web/src/app/models/api.models.ts`: renombrar campo en interfaces.
- [x] Actualizar `rule_set/docs/offers-settings.md`: documentar condición R4 corregida y nuevo nombre del campo.
- [x] Actualizar `rule_set/offer_rule_engine.js`: fixture demo con el nombre nuevo.
- [x] Ejecutar `npm test` en `rule_set/` y verificar verde.

## Fase 2 — Correcciones del simulador INIT

- [x] Editar `rule_set/web/src/app/pages/init-simulator-page.component.html`: eliminar selector de número de titulares.
- [x] Editar `rule_set/web/src/app/pages/init-simulator-page.component.html`: eliminar fieldset Titular 2 completo.
- [x] Editar `rule_set/web/src/app/pages/init-simulator-page.component.html`: reemplazar checkbox `tieneOtrasPropiedades` por `primeraViviendaHabitual`.
- [x] Editar `rule_set/web/src/app/pages/init-simulator-page.component.html`: actualizar opciones de `<select>` `tipoAlta` a `CAPTACION`, `NOVACION`.
- [x] Editar `rule_set/web/src/app/pages/init-simulator-page.component.ts`: defaults `tipoAlta = "NOVACION"`, `finalidad = 1`.
- [x] Editar `rule_set/web/src/app/pages/init-simulator-page.component.ts`: `submit()` hardcodea `numTitulares: 1` y campos T2 a `0/false`.
- [x] Verificar visualmente que el simulador INIT muestra sólo Titular 1.

## Fase 3 — Campo número de pagas en PRE/FINAL

- [x] Editar `rule_set/web/src/app/pages/pre-simulator-page.component.ts`: añadir `pagasT1` (required, default 14) y `pagasT2` (default 14) al form group.
- [x] Editar `rule_set/web/src/app/pages/pre-simulator-page.component.ts`: normalización en `submit()` (`ingresosT1Norm = ingresosT1 * pagasT1 / 14`, idem T2, `ingresosTotales = sum`).
- [x] Editar `rule_set/web/src/app/pages/pre-simulator-page.component.html`: label "Ingresos T1 (€/mes)", añadir campo "Num. pagas T1" con hint `× pagas / 14 al enviar`.
- [x] Editar `rule_set/web/src/app/pages/pre-simulator-page.component.html`: label "Ingresos T2 (€/mes)", añadir campo "Num. pagas T2".
- [x] Editar `rule_set/web/src/app/pages/final-simulator-page.component.ts`: réplica de cambios de PRE (form group + `submit()`).
- [x] Editar `rule_set/web/src/app/pages/final-simulator-page.component.html`: réplica de cambios de PRE (labels + campos pagas).
- [x] Validar que con `pagas = 14` el comportamiento es idéntico al anterior (sin cambio de cálculo).

## Fase 4 — Fixes seed_offers.sql

- [x] Reordenar bloque de DELETE en `rule_set/sql/seed_offers.sql`: hijas (`cfg_offer_rule_condition_value`, `cfg_offer_rule_condition`, `cfg_offer_rule_action`, `cfg_offer_rule`, `cfg_offer_param`) antes que `cfg_offer_dates` y `cfg_offer_ruleset`.
- [x] Actualizar valor sembrado de `TIPO_ALTA_ADMITIDAS` de `'["CAPTACION","NOVACION"]'`.
- [x] Ejecutar el seed contra la base local y verificar que no hay errores de FK.
- [x] Verificar en la BD que `cfg_offer_param` contiene 5 filas con `TIPO_ALTA_ADMITIDAS` con el nuevo valor.

## Validación final

- [x] `npm test` en `rule_set/` — todos los tests en verde.
- [x] `npm run web:test` en `rule_set/web/` — todos los tests Karma en verde.
- [x] Ejecutar manualmente los tres simuladores (INIT, PRE, FINAL) con un caso OK y uno rechazado, verificar dictámenes.
- [x] Verificar que el simulador INIT no expone Titular 2 ni selector de número de titulares.
- [x] Verificar que PRE/FINAL convierten ingresos correctamente para `pagas = 12` y `pagas = 14`.
