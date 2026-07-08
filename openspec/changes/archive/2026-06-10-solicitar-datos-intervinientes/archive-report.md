# Archive Report — solicitar-datos-intervinientes

**Date**: 2026-06-10 · **Status**: ARCHIVED · **Verification**: PASS (0 CRITICAL, 0 WARNING)

## Objetivo

Añadir el flag booleano `SOLICITAR_DATOS_INTERVINIENTES` a la salida `uiLimits` de los
simuladores de hipoteca para indicar si la UI debe solicitar los datos de todos los
titulares/intervinientes. Agregación OR: si alguna oferta elegible lo pone `true`, `uiLimits` es `true`.

## Entrega — 4 slices encadenados

| PR | Alcance | Ficheros clave |
|----|---------|----------------|
| PR-1 | Motor + reglas + tests + golden | `rule_engine.js` (`UI_LIMITS_BOOL` + OR), `rules.json` (18 acciones SET), `test/rule_engine.test.js`, `fixtures/business_scenarios*.js/json` |
| PR-2 | Tipos FE + tarjeta resumen + WF compare | `web/.../models/api.models.ts`, 3 simuladores `.html`, `api/services/wf_compare_service.js` (ausencia≡false) |
| PR-3 | Panel genérico por oferta | `web/.../util/dictamen-extra.ts` (NUEVO), 3 simuladores `.html/.ts` |
| PR-4 | Paridad de seed SQL (POC + WF) | `sql/seed_offers.sql`, `sql/workflow_deploy/wf-seed_offers.sql` |

## Cumplimiento de requisitos

| RF | Resultado |
|----|-----------|
| RF-SDI-01 (agregación OR) | SATISFECHO — tabla true/false/mixto/vacío verificada |
| RF-SDI-02 (18 acciones SET) | SATISFECHO — INIT/PRE/FINAL × 6 ofertas |
| RF-SDI-03 (tests + golden) | SATISFECHO — `freeze_scenarios.mjs` exit 0, 49 escenarios, 0 ganadores cambiados |
| RF-SDI-04 (tipo TS) | SATISFECHO — `uiLimits` widened, `limitFromOffer()` intacto, sin NaN |
| RF-SDI-05 (flag en tarjeta) | SATISFECHO — Sí/No, ausente→no se pinta, 3 simuladores |
| RF-SDI-06 (panel genérico) | SATISFECHO — denylist 18 claves, forward-compatible (corrección S-03) |
| RF-SDI-07 (WF compare) | SATISFECHO — tri-estado, ausencia≡false, lookup tolerante (bare + `_FL`) |
| RF-SDI-08 (paridad seed SQL) | SATISFECHO — POC y WF sembrados, BD ≡ rules.json |

Tests: 87/87 dirigidos (motor+escenarios), suite completa 210 PASS / 0 FAIL / 2 SKIP (CA-013 WF en vivo,
esperados). Los 5 FAIL observados en una corrida fueron transitorios de conexión BD (migración
`vigencia-datetime`), no de este cambio.

## Correcciones aplicadas en la sincronización de specs

- **S-03**: `STANDARD_DICTAMEN_KEYS` documentado con 18 claves (no 15) — se añaden
  `initRejected`, `preRejected`, `offerCode` (flags internos legítimos). Spec principal RF-SDI-06 actualizada.
- **RF-SDI-08 (cierre de gap de planificación)**: nuevo requisito documentando que ambos seeds
  (`seed_offers.sql` POC y `wf-seed_offers.sql` WF) DEBEN contener las acciones
  `SET|SOLICITAR_DATOS_INTERVINIENTES` para que la config cargada desde BD coincida con `rules.json`.

## Gap de planificación detectado y cerrado

La fase de **exploración afirmó "no hacen falta cambios SQL" — y se equivocó**. El motor lee de
`rules.json` en tests/demo, pero el sistema desplegado carga la config desde SQL Server (tablas
sembradas por `seed_offers.sql` / `wf-seed_offers.sql` vía SP). El gap NO fue detectado en
explore/design/tasks; lo detectó el usuario antes de archivar. Se cerró con PR-4 (paridad de seed,
POC + WF) y se verificó: encadenado `,`/`;` correcto en POC, contadores `@actnId` correctos en WF,
6 filas físicas por seed = 18 lógicas en runtime = 18 en `rules.json`.

**Lección para futuros ciclos SDD**: cuando un cambio añade una acción de motor
(`SET|...|...`), la fase SPEC debe verificar explícitamente la capa de persistencia —
fixture `rules.json` + seeds SQL (POC + WF) + invalidación de caché — y marcar en DESIGN si
el SQL queda fuera de alcance, con justificación.

## Punto abierto (OQ-01)

El nombre real del campo en la respuesta WF no está confirmado. El lookup tolerante de
`readWfSolicitarDatos` cubre `SOLICITAR_DATOS_INTERVINIENTES` (desnudo), `_FL`, camelCase y nivel
`RESULTADO`. Si el equipo WF aplica convención estricta `_FL`, no rompe la comparación.

## Trazabilidad (engram, project app-workflow)

| Artefacto | ID | Topic key |
|-----------|----|-----------|
| Exploración | #145 | sdd/solicitar-datos-intervinientes/explore |
| Propuesta | #146 | sdd/solicitar-datos-intervinientes/proposal |
| Spec (delta) | #147 | sdd/solicitar-datos-intervinientes/spec |
| Diseño | #148 | sdd/solicitar-datos-intervinientes/design |
| Tasks | #149 | sdd/solicitar-datos-intervinientes/tasks |
| Apply progress (PR-1..4) | #150 | sdd/solicitar-datos-intervinientes/apply-progress |
| Verify report | #152 | sdd/solicitar-datos-intervinientes/verify-report |
| Refinamiento S-01 + conflicto WF | #153 | decision/... |
| Archive report | #154 | sdd/solicitar-datos-intervinientes/archive-report |

## Spec principal sincronizada

`openspec/specs/hipoteca-joven/solicitar-datos-intervinientes.spec.md` — RF-SDI-01..08, CA-SDI-01..20.
