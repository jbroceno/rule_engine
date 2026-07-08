# Exploration — solicitar-datos-intervinientes

> Artifact store: hybrid. Mirror of engram `sdd/solicitar-datos-intervinientes/explore`.

## Goal

Añadir una acción de regla que produzca, como resultado, si la UI debe solicitar los
datos de los titulares/intervinientes. El mecanismo replica el comportamiento de `uiLimits`:
una acción de decisión asigna `SOLICITAR_DATOS_INTERVINIENTES` (boolean) por oferta, y el
motor lo **agrega** a `uiLimits` con OR lógico (si alguna oferta elegible lo pone `true`,
`uiLimits.SOLICITAR_DATOS_INTERVINIENTES = true`).

Además, el usuario pide dar visibilidad en los simuladores a las propiedades asignadas por
acciones por oferta, más allá de los `uiLimits`.

## Estado actual

### uiLimits y agregación (`rule_set/rule_engine.js`, ~657–678)

```js
const UI_LIMITS_MIN = ["MIN_HIPOTECA", "MIN_PLAZO", "MIN_PLAZO_MESES", "MIN_LTV_EXCLUSIVE", "MIN_LTV_RATIO"];
const UI_LIMITS_MAX = ["MAX_HIPOTECA", "MAX_PLAZO", "MAX_PLAZO_MESES", "MAX_LTV", "MAX_LTV_RATIO", "EDAD_PLAZO"];
```

MIN → `Math.min()`, MAX → `Math.max()`. No existe ruta de agregación booleana.
`aggregateUiLimits()` se invoca en `initcheck()` (~701), `precheck()` (~759) y `finalize()` (~816).

### Acciones

`applyActions()` ya maneja `SET` con `value_type: BOOL` vía `coerce()`. No requiere cambios
de dispatch. El campo NO está en `FINAL_ONLY_ACTION_FIELDS`, así que reglas INIT pueden setearlo.

### Doc (`rule_set/docs/offers-settings.md`)

`SOLICITAR_DATOS_INTERVINIENTES` ya documentado en "Acciones de decisión":
- Oferta FIDELIZACION: `SET|SOLICITAR_DATOS_INTERVINIENTES|false` en su regla INIT.
- Otras Ofertas : `SET|SOLICITAR_DATOS_INTERVINIENTES|true` en la regla de decisión INIT.
NO existe aún en `rules.json` (grep = 0 coincidencias).

### Frontend

`web/src/app/models/api.models.ts` (151, 246, 252): `uiLimits` tipado como
`Record<string, number | undefined>`. Los tres simuladores (init/pre/final) renderizan
`uiLimits` en una tarjeta resumen. No muestran propiedades por oferta más allá de uiLimits.

### Tests / evidencias

`fixtures/business_scenarios*.js/json`, `test/offer_scenarios.test.js`. El golden se
regenera con `node scripts/freeze_scenarios.mjs`. Al añadir campo a uiLimits cambian TODOS
los goldens de escenario (>35).

### SQL / admin

No requiere DDL. `coerce()` ya soporta BOOL. Revisar si `rule_catalogs.js` /
`admin_validator.js` restringen campos de acción permitidos (a confirmar en spec).

## Enfoque recomendado

- **Motor:** añadir `UI_LIMITS_BOOL = ["SOLICITAR_DATOS_INTERVINIENTES"]` y agregación
  `values.some(Boolean)` en `aggregateUiLimits()`. Espejo del patrón MIN/MAX existente.
- **rules.json:** añadir las acciones `SET|SOLICITAR_DATOS_INTERVINIENTES` por oferta.
- **Frontend:** ensanchar el tipo de uiLimits a `number | boolean | undefined`; pintar el
  booleano en la tarjeta resumen; auditar que ningún cálculo aritmético itere sobre uiLimits.
- **Visibilidad por oferta (concern separado del usuario):** mostrar en cada oferta las
  propiedades asignadas por acciones (no solo uiLimits) — requiere modelo + plantilla.
- **Tests:** test unitario de agregación OR + escenarios frontera (solo FIDELIZACION → false).

## Riesgos

1. Regeneración de golden afecta a TODOS los escenarios — revisión humana obligatoria.
2. `wf_compare_service.js` podría mostrar diffs espurios si WF no devuelve el booleano.
3. Ensanchar el tipo TS exige auditar aritmética sobre uiLimits (riesgo NaN en LTV).
4. Escenario solo-FIDELIZACION → `false`; cubrir explícitamente.

## Preguntas abiertas

1. ¿`SOLICITAR_DATOS_INTERVINIENTES` solo en INIT, o también PRE/FINAL? (doc = INIT)
2. ¿WF devuelve el booleano en sus límites? (afecta wf_compare_service)
3. La visibilidad por oferta (propiedades de acciones) — el usuario la pidió explícitamente,
   así que entra en ESTE cambio (confirmar alcance del display).
