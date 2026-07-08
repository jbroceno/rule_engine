# Delta Spec — solicitar-datos-intervinientes

> Artifact store: hybrid. Mirror en engram `sdd/solicitar-datos-intervinientes/spec`.
> Phase: SPEC. Status: listo para design + tasks.

---

## Dominio 1 — Motor de reglas (`rule_engine.js` + `rules.json`)

### ADDED — RF-SDI-01: Agregación booleana de `SOLICITAR_DATOS_INTERVINIENTES` en `uiLimits`

El motor MUST mantener una lista estática `UI_LIMITS_BOOL` que contiene el campo `"SOLICITAR_DATOS_INTERVINIENTES"`. Para cada campo de esa lista, el motor MUST agregar los valores booleanos de los dictámenes de las ofertas elegibles usando la semántica de OR lógico: `ui[field] = values.some(Boolean)`, filtrando únicamente los valores de tipo `boolean`. El resultado MUST incluirse en el objeto `uiLimits` devuelto por `initcheck()`, `precheck()` y `finalize()`.

> **Conjunto de "ofertas elegibles" por etapa (precisión).** El conjunto que alimenta la agregación es el mismo que cada etapa usa para construir el resto de `uiLimits`, no un conjunto distinto para este campo:
> - `initcheck()` → ofertas con `dictamen.initEligible === true`.
> - `precheck()` → la **unión** de las ofertas init-elegibles y pre-elegibles (`[...initEligibleFull, ...preEligibleFull]`), tal como ya hace `aggregateUiLimits()` hoy para MIN/MAX (ver design, ADR-2).
> - `finalize()` → ofertas pre-elegibles que llegan a FINAL.
>
> Es decir, `SOLICITAR_DATOS_INTERVINIENTES` reutiliza el mismo conjunto de entrada que los límites numéricos existentes en cada etapa; no introduce un criterio de elegibilidad propio.

Si ninguna oferta elegible tiene el campo en su dictamen, el campo MUST estar ausente de `uiLimits` (no se emite `false` por defecto).

#### Escenario A — Solo oferta FIDELIZACION elegible → `false`

- GIVEN `rules.json` con 6 ofertas; solo FIDELIZACION es elegible en la fase evaluada
- AND FIDELIZACION tiene la acción `SET|SOLICITAR_DATOS_INTERVINIENTES|false|BOOL`
- WHEN se invoca la función de evaluación correspondiente
- THEN `uiLimits.SOLICITAR_DATOS_INTERVINIENTES === false`

#### Escenario B — Al menos una oferta distinta a FINALIZACION elegible → `true`

- GIVEN una o más ofertas son elegibles junto con FIDELIZACION
- AND todas las ofertas salvo FIDELIZACION tienen la acción `SET|SOLICITAR_DATOS_INTERVINIENTES|true|BOOL`
- WHEN se invoca la función de evaluación
- THEN `uiLimits.SOLICITAR_DATOS_INTERVINIENTES === true`

#### Escenario C — Sin ofertas elegibles → campo ausente

- GIVEN ninguna oferta supera las condiciones de la fase evaluada
- WHEN `aggregateUiLimits([])` es invocado con lista vacía
- THEN `uiLimits` no contiene la clave `SOLICITAR_DATOS_INTERVINIENTES`

#### Escenario D — OR semántico con valores mixtos

- GIVEN tres ofertas elegibles con `SOLICITAR_DATOS_INTERVINIENTES`: `true`, `false`, `true`
- WHEN se agregan los valores
- THEN `uiLimits.SOLICITAR_DATOS_INTERVINIENTES === true`

#### Escenario E — All false → `false`

- GIVEN dos ofertas elegibles, ambas con `SOLICITAR_DATOS_INTERVINIENTES = false`
- WHEN se agregan los valores
- THEN `uiLimits.SOLICITAR_DATOS_INTERVINIENTES === false`

---

### ADDED — RF-SDI-02: Acción `SET|SOLICITAR_DATOS_INTERVINIENTES` en `rules.json` para las 6 ofertas

Las ofertas distintas a FINALIZACION MUST tener la acción `SET|SOLICITAR_DATOS_INTERVINIENTES|true|BOOL` en sus reglas de decisión para INIT, PRE y FINAL. La oferta FIDELIZACION MUST tener `SET|SOLICITAR_DATOS_INTERVINIENTES|false|BOOL` en las mismas etapas. Esto MUST reflejarse en `rules.json` antes de regenerar el golden.

#### Escenario A — INIT: el motor recibe el flag desde reglas INIT

- GIVEN `rules.json` actualizado con las acciones SET para las 6 ofertas en INIT
- WHEN se ejecuta `initcheck()` con un input que supera las condiciones INIT de una oferta salvo FIDELIZACION
- THEN `offer.dictamen.SOLICITAR_DATOS_INTERVINIENTES === true` para esa oferta
- AND `uiLimits.SOLICITAR_DATOS_INTERVINIENTES === true`

#### Escenario B — PRE y FINAL: el flag también se propaga

- GIVEN `rules.json` con acciones SET en PRE y en FINAL
- WHEN se ejecutan `precheck()` y `finalize()` con inputs que superan las condiciones respectivas
- THEN el flag aparece en `dictamen` y en `uiLimits` de cada etapa independientemente

---

### ADDED — RF-SDI-03: Tests unitarios de OR booleano y escenarios de frontera

El fichero `test/rule_engine.test.js` MUST contener al menos un test unitario que verifique la tabla de verdad del OR lógico (true/false/mixed/vacío). El fichero `fixtures/business_scenarios.js` MUST incluir al menos un escenario de frontera en el que solo FIDELIZACION sea elegible, con `expectedUiLimits.SOLICITAR_DATOS_INTERVINIENTES === false` como condición de contrato. El golden (`fixtures/business_scenarios.golden.json`) MUST regenerarse tras añadir la acción en `rules.json` y MUST ser revisado manualmente contra la matriz de decisión antes de hacer commit.

#### Escenario A — Escenario de frontera: solo FIDELIZACION elegible

- GIVEN `fixtures/business_scenarios.js` incluye el escenario `SDI-ONLY-FIDELIZACION`
- AND el input no cumple las condiciones de ninguna oferta salvo las de FIDELIZACION
- WHEN se ejecuta `node scripts/freeze_scenarios.mjs`
- THEN el script termina sin error
- AND el golden refleja `uiLimits.SOLICITAR_DATOS_INTERVINIENTES === false` para ese escenario

---

## Dominio 2 — Frontend Angular (modelos + simuladores)

### ADDED — RF-SDI-04: Ampliación de tipo TypeScript de `uiLimits`

Las interfaces `InitSimulationResponse`, `PreSimulationResponse` y `FinalSimulationResponse` en `api.models.ts` MUST declarar `uiLimits` como `Record<string, number | boolean | undefined>`. Ningún componente que opere aritméticamente sobre valores de `uiLimits` (por ejemplo, comparaciones LTV) MUST romper con este cambio; el helper `limitFromOffer()` ya filtra por `typeof === "number"` y MUST mantenerse sin cambios.

#### Escenario A — Sin regresión aritmética

- GIVEN el tipo `uiLimits` es widened a `number | boolean | undefined`
- WHEN un componente llama a `limitFromOffer(offer, 'MAX_LTV')`
- THEN el resultado sigue siendo `number | null` (sin NaN)

---

### ADDED — RF-SDI-05: Visualización del flag en la tarjeta de resumen `uiLimits`

Los tres simuladores (INIT, PRE, FINAL) MUST mostrar el campo `SOLICITAR_DATOS_INTERVINIENTES` de `uiLimits` en su tarjeta de resumen existente. El valor `true` MUST mostrarse como texto legible ("Sí" o equivalente), `false` como "No". Si el campo está ausente en `uiLimits`, no se MUST mostrar la fila.

#### Escenario A — Flag presente y true

- GIVEN la respuesta de simulación incluye `uiLimits.SOLICITAR_DATOS_INTERVINIENTES = true`
- WHEN el simulador renderiza la tarjeta de resumen uiLimits
- THEN se muestra la fila "Solicitar datos intervinientes: Sí"

#### Escenario B — Flag presente y false

- GIVEN `uiLimits.SOLICITAR_DATOS_INTERVINIENTES = false`
- WHEN el simulador renderiza la tarjeta de resumen
- THEN se muestra "No"

#### Escenario C — Flag ausente

- GIVEN `uiLimits` no contiene `SOLICITAR_DATOS_INTERVINIENTES`
- WHEN el simulador renderiza la tarjeta
- THEN no aparece ninguna fila para ese campo

---

### ADDED — RF-SDI-06: Panel genérico de propiedades de dictamen por oferta

Los tres simuladores MUST mostrar, por cada oferta en su panel de resultados, un panel expandible que liste todas las propiedades asignadas por acciones SET en el `dictamen` de esa oferta que NO formen parte del conjunto de límites numéricos conocidos. El panel MUST ser genérico: iterar las claves de `offer.dictamen` y renderizar las que no pertenecen al set `{MIN_HIPOTECA, MAX_HIPOTECA, MIN_PLAZO, MAX_PLAZO, MIN_PLAZO_MESES, MIN_LTV_EXCLUSIVE, MIN_LTV_RATIO, MAX_LTV, MAX_LTV_RATIO, EDAD_PLAZO, initEligible, preEligible, eligible, rejected, selectedOffer}`. El panel MUST mostrar clave y valor para cada propiedad extra.

#### Escenario A — SOLICITAR_DATOS_INTERVINIENTES visible en panel por oferta

- GIVEN la oferta JOVEN_A tiene `dictamen.SOLICITAR_DATOS_INTERVINIENTES = true`
- WHEN el usuario expande el panel de propiedades adicionales de esa oferta
- THEN ve la entrada `SOLICITAR_DATOS_INTERVINIENTES: true`

#### Escenario B — Oferta sin propiedades extra no muestra el panel

- GIVEN una oferta no tiene ninguna clave en `dictamen` fuera del set conocido
- WHEN el componente renderiza esa oferta
- THEN el panel expandible no aparece (o aparece vacío, sin filas)

#### Escenario C — Nueva propiedad futura aparece sin cambio de código

- GIVEN en el futuro se añade `SET|OTRO_FLAG|true|BOOL` en una regla
- WHEN el motor devuelve `dictamen.OTRO_FLAG = true` para una oferta
- THEN el panel genérico lo muestra automáticamente sin modificar código Angular

---

## Dominio 3 — Comparación Workflow (`wf_compare_service.js`)

### ADDED — RF-SDI-07: Inclusión de `SOLICITAR_DATOS_INTERVINIENTES` en la comparación WF

El servicio `wf_compare_service.js` MUST incluir el campo `SOLICITAR_DATOS_INTERVINIENTES` en la comparación de `uiLimits` entre la respuesta del motor POC y la respuesta del servicio Workflow. La ausencia del campo en la respuesta WF MUST tratarse como `false` (equivalente semántico de "no solicitar datos"), de modo que la coincidencia con el valor POC se evalúe con esa equivalencia y NO genere un diff espurio.

#### Escenario A — Ambos lados tienen el mismo valor

- GIVEN el motor POC devuelve `uiLimits.SOLICITAR_DATOS_INTERVINIENTES = true`
- AND el servicio WF devuelve `LIMITES.SOLICITAR_DATOS_INTERVINIENTES = true`
- WHEN se ejecuta la comparación
- THEN no se registra ninguna diferencia para este campo

#### Escenario B — Campo ausente en WF equivale a `false`

- GIVEN el motor POC devuelve `uiLimits.SOLICITAR_DATOS_INTERVINIENTES = false`
- AND el servicio WF no incluye `SOLICITAR_DATOS_INTERVINIENTES` en `LIMITES`
- WHEN se ejecuta la comparación
- THEN no se registra ninguna diferencia (ausencia ≡ false)

#### Escenario C — Discrepancia real

- GIVEN el motor POC devuelve `true` y el WF devuelve `false` (o lo omite)
- WHEN se ejecuta la comparación
- THEN se registra una diferencia de `SOLICITAR_DATOS_INTERVINIENTES`: POC=true, WF=false/absent

---

## Criterios de aceptación

| ID | Área | Descripción | Condiciones | Resultado esperado |
|----|------|-------------|-------------|-------------------|
| CA-SDI-01 | Motor | OR booleano — solo FIDELIZACION | Solo FIDELIZACION elegible con `false` | `uiLimits.SOLICITAR_DATOS_INTERVINIENTES === false` |
| CA-SDI-02 | Motor | OR booleano — al menos una oferta distinta a FIDELIZACION presente | Una o más distintas a FINALIZACION elegibles | `uiLimits.SOLICITAR_DATOS_INTERVINIENTES === true` |
| CA-SDI-03 | Motor | OR booleano — vacío | Ninguna oferta elegible | Campo ausente en `uiLimits` |
| CA-SDI-04 | Motor | INIT propaga el flag | Input supera INIT de diferentes a FIDELIZACION | `dictamen.SOLICITAR_DATOS_INTERVINIENTES === true` en la oferta |
| CA-SDI-05 | Motor | PRE y FINAL propagan el flag | Input supera PRE/FINAL de cualquier oferta | Flag presente en `uiLimits` de cada etapa |
| CA-SDI-06 | Golden | Freeze pasa sin errores | Ejecutar `freeze_scenarios.mjs` con `rules.json` actualizado | Script termina 0; golden contiene el campo en todos los escenarios |
| CA-SDI-07 | Test | Escenario SDI-ONLY-FIDELIZACION | Solo FIDELIZACION elegible | Test de escenario pasa; `uiLimits.SOLICITAR_DATOS_INTERVINIENTES === false` en golden |
| CA-SDI-08 | Frontend | Tipo TS widened | Compilación Angular con `uiLimits: Record<string, number\|boolean\|undefined>` | Build sin errores TypeScript |
| CA-SDI-09 | Frontend | Flag en tarjeta resumen (true) | Simulación con distinta a FIDELIZACION elegible | Tarjeta muestra "Sí" en la fila correspondiente |
| CA-SDI-10 | Frontend | Flag en tarjeta resumen (false) | Solo FIDELIZACION elegible | Tarjeta muestra "No" |
| CA-SDI-11 | Frontend | Flag ausente no muestra fila | No hay ofertas elegibles | No aparece la fila en la tarjeta |
| CA-SDI-12 | Frontend | Panel genérico por oferta | Oferta distinta a FIDELIZACION con `SOLICITAR_DATOS_INTERVINIENTES = true` | Panel expandible muestra la clave y el valor |
| CA-SDI-13 | Frontend | Panel genérico no regresiona | Oferta sin props extra | Panel vacío o ausente; límites numéricos no aparecen duplicados |
| CA-SDI-14 | WF Compare | Campo incluido, mismos valores | POC=true, WF=true | Sin diferencia registrada |
| CA-SDI-15 | WF Compare | Ausencia WF = false | POC=false, WF ausente | Sin diferencia registrada |
| CA-SDI-16 | WF Compare | Discrepancia real detectada | POC=true, WF=false | Diferencia registrada con valores de cada lado |
| CA-SDI-17 | Regresión | Suite completa verde | `npm test` tras todos los cambios | 0 fallos; 2 SKIP esperados (CA-013 live) |

---

## Escenarios de frontera para `fixtures/business_scenarios.js`

Los siguientes escenarios MUST añadirse al fichero de escenarios de negocio:

| Clave escenario | Descripción | `expectedWinner` | `expectedUiLimits.SOLICITAR_DATOS_INTERVINIENTES` |
|-----------------|-------------|------------------|--------------------------------------------------|
| `SDI-ONLY-FIDELIZACION` | Input diseñado para que solo FIDELIZACION sea elegible (no cumple condición salvo de FIDELIZACION) | `FIDELIZACION` | `false` |
| `SDI-JOVEN-WINS` | Input donde la oferta distinta a FIDELIZACION es elegible | la oferta de mayor rango | `true` |
| `SDI-MIXED` | Input cualquier oferta es elegible simultáneamente | la de mayor rango | `true` |

---

## Preguntas abiertas

| ID | Pregunta | Impacto |
|----|----------|---------|
| OQ-01 | ¿El servicio Workflow real (`GetOfertasHipotecas`) puede devolver `SOLICITAR_DATOS_INTERVINIENTES` en `LIMITES`? Si nunca lo devuelve, la regla "ausencia = false" cubre el 100% de los casos comparativos y no hay riesgo de diff espurio. Si puede devolverlo, el comparador también debe manejar `true` de WF. | Bajo — la regla de equivalencia cubre ambos casos. Confirmación opcional. |
| OQ-02 | ¿El panel genérico de propiedades debe filtrar también las flags de dictamen estándar (`initEligible`, `preEligible`, `eligible`, `rejected`, `selectedOffer`)? La spec asume que sí se filtran. Confirmar si alguna de ellas debe mostrarse en el panel. | Bajo — impacto solo en el set de exclusión del filtro. |
