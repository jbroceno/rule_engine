# Plan de Pruebas Manual — Ofertas Hipotecarias

Este plan se organiza en **módulos → casos → pasos**. Cada **caso** (`CU-NN`) agrupa los pasos de verificación de un escenario funcional; cada **paso** (`CU-NN-n`) es una comprobación atómica con su resultado esperado.

*Evidencias — nomenclatura de archivos.* Evidencia **del caso** (genérica, cubre varios pasos): `CU-NN.<sec>[.descr].<ext>` — ej. `CU-03.1.png`. Evidencia **de un paso** concreto: `CU-NN-n.<sec>[.descr].<ext>` — ej. `CU-03-2.1.scoring.json`. `<sec>` es una secuencia que permite varias evidencias por caso o por paso.

## Datos de referencia

### Parámetros de ofertas

| Oferta | oferta_id | Ranking | MAX_EDAD | MIN_ANT | Plazo (años) | LTV | EDAD_PLAZO | MIN_ING_1T | MIN_ING_2T | MAX_HIPOTECA |
|---|---|---|---|---|---|---|---|---|---|---|
| FIDELIZACION | 12 | 10 | — (sin límite) | 12 m | 3–35 | ≤ 80 % | 75 | — | — | 2.000.000 € |
| PROMOCION | 16 | 60 | 45 | 0 m | 3–35 | (0 %, 80 %] | 75 | 0 € | 0 € | 2.000.000 € |
| PROMOCION_HC | 17 | 70 | 45 | 12 m | 5–35 | (0 %, 80 %] | 75 | 2.500 € | 3.500 € | 2.000.000 € |
| LARGO_PLAZO | 18 | 80 | 40 | 12 m | 36–45 | (0 %, 80 %] | 80 | 2.500 € | 3.500 € | 1.500.000 € |
| ALTO_RIESGO | 15 | 90 | 45 | 12 m | 3–35 | (80 %, 100 %] | 75 | 2.700 € | 3.700 € | 1.500.000 € |
| ULTRA_ALTO_RIESGO | 19 | 100 | 40 | 12 m | 36–40 | (80 %, 90 %] | 75 | 2.700 € | 3.700 € | 1.500.000 € |

> **Actualizado:** `ULTRA_ALTO_RIESGO` mantiene su `MAX_LTV` en **90 %** (fuente: `rule_set/rules.json` + `fixtures/business_scenarios.js`). La oferta `FIDELIZACION` ya devuelve límites financieros propios en el dictamen (`MAX_LTV = 80 %`, `EDAD_PLAZO = 75`, plazo 3–35, `MIN_HIPOTECA = 20.000 €`, `MAX_HIPOTECA = 2.000.000 €`) — no restringe LTV por abajo. `MIN_HIPOTECA = 20.000 €` para FIDELIZACION; `50.000 €` para el resto de ofertas.
>
> Paridad de configuración verificada: los seeds SQL `rule_set/sql/seed_offers.sql` (POC) y `rule_set/sql/workflow_deploy/wf-seed_offers.sql` (WF) están alineados con `rules.json` en `ULTRA_ALTO_RIESGO MAX_LTV = 0.90`.

*Condiciones INIT comunes a todas las ofertas distintas de FIDELIZACION: `finalidad = 1ª vivienda`, `tieneOtrasViviendas = 0`, `tipoAlta ∈ {NOVACION, CAPTACION}`, `importeVivienda ≥ importeVentaCA (CCAA)`.*

*Para 2ª vivienda: límites de sistema → maxPlazo = 25 años, maxLTV = 75 % (independientes de los límites de oferta).*

*Fórmulas: `ingresosTi = ingresosMensuales_i × numPagas_i / 14`. `edadMasPlazo = max(edadT1, edadT2) + plazo`.*

### Perfiles genéricos

| ID | Tit. | edadT1 | edadT2 | Ant.T1 | Ant.T2 | Nóm.dom. | Ing.T1 netos/mes | NumPagasT1 | Ing.T2 netos/mes | NumPagasT2 | Finalidad | tieneOtrasViv |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P1 | 1 | 35 | — | 18 m | — | Sí | 2.800 € | 14 | — | — | 1ª viv. | 0 |
| P2 | 2 | 37 | 33 | 14 m | 8 m | No/No | 2.100 € | 14 | 1.700 € | 14 | 1ª viv. | 0 |
| P3 | 1 | 42 | — | 14 m | — | No | 2.500 € | 14 | — | — | 1ª viv. | 0 |
| P4 | 1 | 46 | — | 14 m | — | No | 3.000 € | 14 | — | — | 1ª viv. | 0 |
| P5 | 1 | 48 | — | 4 m | — | No | 3.000 € | 14 | — | — | 1ª viv. | 0 |
| P6 | 1 | 35 | — | 18 m | — | Sí | 2.500 € | 14 | — | — | 2ª viv. | 0 |

*Salvo indicación contraria: tipoAlta = NOVACION, CCAA = Madrid, importeVivienda supera el mínimo de la CCAA.*

*Ingresos prorateados a 14 meses: P1 → 2.800 €/m; P2 → ingT1 = 2.100 €/m, ingT2 = 1.700 €/m, total = 3.800 €/m; P3 → 2.500 €/m.*

---

## 1. Pantalla de alta de expediente

### CU-01 · Nuevos campos en el formulario

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-01-1 | Alta > Campos | El campo **tipoAlta** aparece en el formulario de alta | Acceder a pantalla de alta | Campo visible con lista de valores admitidos (al menos NOVACION y CAPTACION) |
| CU-01-2 | Alta > Campos | El campo **finalidad** (1ª / 2ª vivienda) aparece en el formulario | Acceder a pantalla de alta | Campo visible con al menos "1ª vivienda" y "2ª vivienda" |
| CU-01-3 | Alta > Campos | El campo **primeraViviendaHabitual** (Sí/No) aparece en el formulario | Acceder a pantalla de alta | Campo visible; valores Sí / No |
| CU-01-4 | Alta > Campos | El campo **tipoVivienda** (nueva / segunda mano) aparece en el formulario | Acceder a pantalla de alta | Campo visible con los valores correspondientes |
| CU-01-5 | Alta > Campos | El campo **comunidadAutonoma** aparece en el formulario | Acceder a pantalla de alta | Campo visible con la lista completa de CCAA |
| CU-01-6 | Alta > Campos | El campo **¿tienes elegida ya la vivienda?** aparece en el formulario | Acceder a pantalla de alta | Campo visible con valores Sí / No |
| CU-01-7 | Alta > Campos | El campo **Importe de la vivienda** aparece en el formulario | Acceder a pantalla de alta | Campo visible con valor numérico |
| CU-01-8 | Alta > Validación | Los nuevos campos son obligatorios; el formulario no avanza si alguno falta | Dejar uno o varios campos sin informar e intentar continuar | Se muestra error de validación e impide avanzar al simulador |

### CU-02 · Integración con datos externos

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-02-1 | Alta > CRS | `edadT1` se obtiene del servicio CRS al informar el número de cliente | Número de cliente válido en CRS | El campo `edadT1` se rellena automáticamente desde la fecha de nacimiento devuelta por CRS |
| CU-02-2 | Alta > Riesgos | `domiciliaNominaT1` se obtiene del fichero de riesgos | Número de cliente con datos en fichero de riesgos | El campo interno `domiciliaNominaT1` queda a 1 o 0 según el fichero |
| CU-02-3 | Alta > Riesgos | `antiguedadT1` se obtiene del fichero de riesgos | Número de cliente con datos en fichero de riesgos | El campo interno `antiguedadT1` queda calculado en meses según la fecha ANTIGUEDAD_DT del fichero |
| CU-02-4 | Alta > CRS | `antiguedadT1` se obtiene por CRS porque cliente no está en fichero | Número de cliente SIN datos en fichero de riesgos | El campo interno `antiguedadT1` se obtiene de CRS calculado en meses según la fecha fecha_Alta |
| CU-02-5 | Alta > CRS | Si CRS no encuentra al cliente, se asumirá que NO es cliente | Número de cliente no encontrado en CRS | Expediente avanza como anónimo |
| CU-02-6 | Alta > Riesgos | Si el cliente no tiene registro en el fichero de riesgos, `domiciliaNominaT1` queda a 0 y el proceso puede continuar | Cliente sin registro en fichero de riesgos | `domiciliaNominaT1 = 0`; se puede avanzar al simulador |

### CU-03 · Evaluación INIT y navegación

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-03-1 | Alta > INIT | Con perfil elegible solo para **FIDELIZACION**, el motor devuelve FIDELIZACION como elegible y no requiere panel económico | P4: edad 46, ant. 14 m (>12), nómina no dom. | Se navega al simulador; sin panel de datos económicos; se amplicarán los límites financieros de la oferta **FIDELIZACION** |
| CU-03-2 | Alta > INIT | Con perfil elegible para ofertas distintas de FIDELIZACION, el motor marca en INIT que se deben solicitar datos de intervinientes | P1: edad 35, ant. 18 m, NOVACION, 1ª viv. | Se navega al simulador con `uiLimits.SOLICITAR_DATOS_INTERVINIENTES = true` (al menos una oferta distinta de FIDELIZACION elegible) |
| CU-03-3 | Alta > INIT | Sin ninguna oferta elegible en INIT, no se mostrará ninguna oferta elegible | P5: edad 48, ant. 4 m, nómina no dom. | Se muestra tabla de ofertas sin entradas |
| CU-03-4 | Alta > INIT | Los límites financieros devueltos en INIT (minHipoteca, maxHipoteca, minPlazo, maxPlazo, minLtvExclusive, maxLtv, edadPlazo) se trasladan al simulador | P1: oferta esperada ULTRA_ALTO_RIESGO entre las elegibles | El simulador aplica los límites de la oferta de mayor ranking devuelta en INIT |
| CU-03-5 | Alta > INIT | `tipoAlta = SUBROGACION\|FINANCIACION_ALQUILER` excluye todas las ofertas distintas de FIDELIZACION | tipoAlta = SUBROGACION\|FINANCIACION_ALQUILER, resto de condiciones OK para P1 | Solo FIDELIZACION puede quedar elegible si cumple antigüedad mínima (12 m) |
| CU-03-6 | Alta > INIT | `tieneOtrasViviendas = 1` excluye todas las ofertas distintas de FIDELIZACION | P1 con tieneOtrasViviendas = 1 | Solo FIDELIZACION puede quedar elegible |
| CU-03-7 | Alta > INIT | `importeVivienda < importeVentaCA` excluye todas las ofertas distintas de FIDELIZACION | P1 con importe de vivienda por debajo del mínimo de CCAA | Solo FIDELIZACION puede quedar elegible |
| CU-03-8 | Alta > INIT | El **importe de la vivienda** se captura como dato de Fase 1 y viaja en el payload de la llamada INIT al motor | P1 con importe de vivienda informado en el alta | El payload INIT incluye `importeVivienda`; el motor lo usa en la regla `importeVivienda < importeVentaCA` para resolver la elegibilidad INIT |

---

## 2. Simulador de alta

### CU-04 · Bloques de datos y pop-ups de edición

El simulador muestra dos bloques de solo lectura: **Datos de vivienda** e **Intervinientes**. Cada bloque tiene un botón que abre un pop-up de edición. Al guardar el pop-up, el motor se re-evalúa.

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-04-1 | Simulador > Bloque vivienda | El bloque **Datos de vivienda** muestra correctamente los valores procedentes del alta | P1, todos los campos informados en alta | Se muestran tipoAlta, finalidad, primeraViviendaHabitual, tipoVivienda, comunidadAutonoma y Fecha Nacimiento T1 con los valores del alta |
| CU-04-2 | Simulador > Bloque vivienda | El bloque es de **solo lectura**: los campos no son editables directamente | P1, intentar editar cualquier campo del bloque | Los campos no son modificables inline; no se puede escribir sobre ellos |
| CU-04-3 | Simulador > Bloque vivienda | El bloque tiene un **botón de edición** visible | Acceder al simulador con cualquier perfil | El botón de edición aparece en el bloque de datos de vivienda |
| CU-04-4 | Simulador > Bloque vivienda | Pulsar el botón abre un **pop-up** con todos los campos de vivienda editables | Pulsar el botón de edición del bloque vivienda | El pop-up se abre con los valores actuales precargados y permite modificarlos |
| CU-04-5 | Simulador > Bloque vivienda | Al guardar el pop-up de vivienda, el **motor se re-evalúa** con los nuevos datos | P1: cambiar comunidadAutonoma en el pop-up y guardar | Se lanza nueva llamada al motor; las ofertas elegibles y límites se actualizan |
| CU-04-6 | Simulador > Bloque vivienda | Los **cambios guardados** en el pop-up quedan reflejados en el bloque | P1: cambiar finalidad de 1ª a 2ª vivienda en el pop-up y guardar | El bloque muestra el nuevo valor de finalidad |
| CU-04-7 | Simulador > Bloque vivienda | Cambios en el pop-up que afectan la elegibilidad **actualizan** la tabla de ofertas y los límites | P1: cambiar `tieneOtrasViviendas` a 1 en el pop-up y guardar | Las ofertas distintas de FIDELIZACION desaparecen de la tabla; solo FIDELIZACION puede quedar elegible; los límites aplicados cambian |
| CU-04-8 | Simulador > Bloque intervinientes | El bloque **Intervinientes** se muestra con los datos económicos cuando `uiLimits.SOLICITAR_DATOS_INTERVINIENTES = true` | P1 (al menos una oferta distinta de FIDELIZACION elegible → flag = true) | Bloque visible con Fecha Nacimiento, edad calculada, Ingresos netos mensuales y Número de pagas por cada titular |
| CU-04-9 | Simulador > Bloque intervinientes | El bloque de intervinientes **no se muestra** cuando `uiLimits.SOLICITAR_DATOS_INTERVINIENTES = false` | P4 (solo FIDELIZACION elegible → flag = false) | El bloque no aparece; se puede introducir importe y plazo directamente; los límites de FIDELIZACION devueltos por el motor se aplican |
| CU-04-10 | Simulador > Bloque intervinientes | El bloque de intervinientes tiene un **botón de edición** que abre un pop-up | P1: pulsar el botón de edición del bloque de intervinientes | El pop-up se abre con los valores actuales (fecha nacimiento, ingresos, pagas) precargados y editables por titular |
| CU-04-11 | Simulador > Bloque intervinientes | Al guardar el pop-up de intervinientes, el **motor PRE se re-evalúa** | P2: cambiar ingresosT2 de 1.700 a 2.100 € en el pop-up y guardar | Se lanza nueva llamada al motor en fase PRE; las ofertas elegibles y límites se actualizan en pantalla |
| CU-04-12 | Simulador > Bloque intervinientes | La **edad calculada** se actualiza en el bloque al editar la fecha de nacimiento en el pop-up | P1: cambiar fecha de nacimiento de T1 en el pop-up | Al guardar, el bloque muestra la edad recalculada correctamente |

### CU-05 · Evaluación PRE

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-05-1 | Simulador > Préstamo | Los campos de préstamo (importe, plazo) se validan contra los límites de la oferta elegible de mayor ranking | P1, ULTRA_ALTO_RIESGO elegible: maxPlazo 40, maxLTV 90 % | El sistema permite plazo hasta 40 años e importe hasta LTV ≤ 90 % |
| CU-05-2 | Simulador > PRE | Con 1 titular e ingresos prorateados ≥ 2.700 €/m, todas las ofertas con restricción de ingresos (ALTO_RIESGO/ULTRA_ALTO_RIESGO ≥ 2.700; LARGO_PLAZO/PROMOCION_HC ≥ 2.500) son preEligibles | P1: 2.800 €/m × 14p / 14 = 2.800 €/m | ALTO_RIESGO, LARGO_PLAZO, ULTRA_ALTO_RIESGO, PROMOCION_HC marcadas preEligibles; PROMOCION también (MIN=0) |
| CU-05-3 | Simulador > PRE | Con 1 titular e ingresos prorateados entre 2.500 y 2.700 €/m, LARGO_PLAZO/PROMOCION_HC son preEligibles pero ALTO_RIESGO/ULTRA_ALTO_RIESGO no | 1 titular, 2.600 €/m × 14p / 14 = 2.600 €/m | LARGO_PLAZO, PROMOCION_HC y PROMOCION (MIN=0) preEligibles; ALTO_RIESGO y ULTRA_ALTO_RIESGO no elegibles (2.600 < 2.700) |
| CU-05-4 | Simulador > PRE | Con 2 titulares e ingresos totales prorateados ≥ 3.700 €/m, todas las ofertas con restricción de ingresos (ALTO_RIESGO/ULTRA_ALTO_RIESGO ≥ 3.700; LARGO_PLAZO/PROMOCION_HC ≥ 3.500) son preEligibles | P2: ingT1 = 2.100 + ingT2 = 1.700 = 3.800 €/m | ALTO_RIESGO, LARGO_PLAZO, ULTRA_ALTO_RIESGO, PROMOCION_HC marcadas preEligibles; PROMOCION también (MIN=0) |
| CU-05-5 | Simulador > PRE | Con 2 titulares e ingresos totales < 3.500 €/m, todas las ofertas con restricción de ingresos resultan no elegibles | 2 titulares, ingT1 = 1.500 + ingT2 = 1.500 = 3.000 €/m | PROMOCION sigue elegible (MIN=0); resto de ofertas (umbrales 3.500/3.700) no elegibles |
| CU-05-6 | Simulador > PRE | El motor PRE devuelve límites actualizados que se aplican en pantalla | P1, PRE retorna maxLTV = 90 %, maxPlazo = 40 (ULTRA_ALTO_RIESGO) | El importe hipoteca se valida con maxLTV = 90 %; el selector de plazo limita a 40 años |
| CU-05-7 | Simulador > PRE | El payload enviado al motor PRE incluye todos los campos del panel económico | P2, todos los campos informados | El payload incluye edadT1, edadT2, ingresosT1, ingresosT2, numPagasT1, numPagasT2 |

### CU-06 · Flag SOLICITAR_DATOS_INTERVINIENTES

El motor agrega el campo booleano `SOLICITAR_DATOS_INTERVINIENTES` en `uiLimits` con semántica **OR lógico** sobre las ofertas elegibles: `true` si alguna oferta distinta de FIDELIZACION es elegible, `false` si solo FIDELIZACION, y **ausente** si no hay ninguna oferta elegible. Esas ofertas lo emiten a `true`; FIDELIZACION a `false`. Aplica en INIT, PRE y FINAL. Reemplaza al antiguo flag informal de "solicitar datos económicos".

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-06-1 | Motor > uiLimits | OR lógico — solo FIDELIZACION elegible → flag `false` | P4 (solo FIDELIZACION elegible en la fase evaluada) | `uiLimits.SOLICITAR_DATOS_INTERVINIENTES = false` |
| CU-06-2 | Motor > uiLimits | OR lógico — al menos una oferta distinta de FIDELIZACION elegible → flag `true` | P1 (una o más ofertas distintas de FIDELIZACION elegibles, con o sin FIDELIZACION) | `uiLimits.SOLICITAR_DATOS_INTERVINIENTES = true` |
| CU-06-3 | Motor > uiLimits | Sin ofertas elegibles → el campo **no aparece** en uiLimits | P5: edad 48, ant. 4 m (ninguna oferta elegible) | `uiLimits` no contiene la clave `SOLICITAR_DATOS_INTERVINIENTES` (no se emite `false` por defecto) |
| CU-06-4 | Motor > propagación | El flag se propaga en las tres fases (INIT, PRE, FINAL) de forma independiente | P1 evaluado en INIT, PRE y FINAL | El flag aparece en `dictamen` de la oferta y en `uiLimits` de cada fase |
| CU-06-5 | Simulador > Tarjeta resumen | Los 3 simuladores muestran el flag en la tarjeta de resumen de `uiLimits` como "Sí" cuando es `true` | P1 (oferta distinta de FIDELIZACION elegible) en simulador INIT/PRE/FINAL | Se muestra la fila "Solicitar datos intervinientes: Sí" |
| CU-06-6 | Simulador > Tarjeta resumen | El flag se muestra como "No" cuando es `false` | P4 (solo FIDELIZACION) en cualquier simulador | Se muestra "Solicitar datos intervinientes: No" |
| CU-06-7 | Simulador > Tarjeta resumen | Cuando el flag está ausente, **no se muestra la fila** | P5 (sin ofertas elegibles) | No aparece ninguna fila para SOLICITAR_DATOS_INTERVINIENTES en la tarjeta |
| CU-06-8 | Simulador > Panel por oferta | El panel expandible de propiedades adicionales de cada oferta muestra `SOLICITAR_DATOS_INTERVINIENTES` con su valor | Expandir el panel de una oferta distinta de FIDELIZACION elegible | El panel muestra la entrada `SOLICITAR_DATOS_INTERVINIENTES: true` (clave y valor) |
| CU-06-9 | Simulador > Panel por oferta | El panel genérico ignora los límites numéricos y flags internos conocidos (no los duplica) | Oferta con dictamen completo de límites | El panel solo lista propiedades fuera del set conocido (MIN/MAX_HIPOTECA, plazos, LTV, EDAD_PLAZO, initEligible, preEligible, eligible, rejected, selectedOffer, offerCode…); sin duplicados |



### CU-07 · Evaluación FINAL y visualización de ofertas

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-07-1 | Simulador > FINAL | El botón **Calcular** lanza la evaluación FINAL | P1, importeHipoteca = 200.000 €, importeVivienda = 250.000 € (LTV 80 %), plazo 30 años | Se llama al motor en fase FINAL; se muestra resultado |
| CU-07-2 | Simulador > FINAL | La **oferta ganadora** queda resaltada visualmente en la tabla | P1, LTV 85 %, plazo 30 → ganadora esperada ALTO_RIESGO (rank 90) | ALTO_RIESGO aparece en la tabla con indicación visual de ganadora |
| CU-07-3 | Simulador > FINAL | Con LTV 85 % y plazo 38 años la ganadora es **ULTRA_ALTO_RIESGO** (rank 100) | P1, importeVivienda = 250.000 €, importeHipoteca = 212.500 € (LTV 85 %), plazo 38, edadMasPlazo = 35+38 = 73 ≤ 75 | Tabla muestra ULTRA_ALTO_RIESGO como ganadora (rank 100); resto de ofertas fuera de rango de plazo o LTV |
| CU-07-4 | Simulador > FINAL | Con LTV 75 % y plazo 25 años, edad 42, la ganadora es **PROMOCION_HC** (rank 70) | P3: edad 42, ant. 14 m (≥12), ing. 2.500 €, LTV 75 %, plazo 25, edadMasPlazo = 42+25 = 67 ≤ 80 | Ganadora PROMOCION_HC; PROMOCION también elegible (rank 60) |
| CU-07-5 | Simulador > FINAL | Con solo **FIDELIZACION** elegible, se muestra indicación correspondiente en pantalla | P4: edad 46, ant. 8 m; solo FIDELIZACION pasa INIT y FINAL | *[Confirmar con equipo: ¿se muestra tabla con FIDELIZACION o simplemente mensaje de "oferta disponible"?]* |
| CU-07-6 | Simulador > FINAL | Sin ninguna oferta elegible en FINAL, no se muestra tabla y se informa al usuario | LTV 97 % (supera MAX_LTV de todas las ofertas) | No aparece tabla de ofertas; se muestra mensaje informativo |
| CU-07-7 | Simulador > FINAL | Las **ofertas sin precio configurado** en el sistema no se presentan al motor ni aparecen en resultados | Deshabilitar precio de ULTRA_ALTO_RIESGO en el sistema | ULTRA_ALTO_RIESGO no aparece en la tabla aunque técnicamente hubiera sido elegible |
| CU-07-8 | Simulador > FINAL | El campo **plazo fijo** se muestra cuando el producto es OpenVariable o OpenMixta | Producto = OpenVariable | Se muestra campo "plazo fijo" en el formulario de préstamo y se incluye en la llamada al motor |
| CU-07-9 | Simulador > FINAL | **Límite superior LTV de ULTRA_ALTO_RIESGO inclusivo en 90 %**: con LTV = 90 % exacto y plazo 38 la oferta es elegible y ganadora | P1, importeVivienda = 250.000 €, importeHipoteca = 225.000 € (LTV 90 %), plazo 38, edadMasPlazo = 73 ≤ 75 | ULTRA_ALTO_RIESGO elegible y ganadora (rank 100); `MAX_LTV = 0.90` no dispara con GT en el límite exacto |
| CU-07-10 | Simulador > FINAL | **Regresión MAX_LTV histórico → 0,90**: con LTV = 92 % ULTRA_ALTO_RIESGO queda rechazada | P1, importeVivienda = 250.000 €, importeHipoteca = 230.000 € (LTV 92 %), plazo 38 | ULTRA_ALTO_RIESGO NO elegible (92 % > 90 %); ninguna oferta distinta de FIDELIZACION admite 92 % a ese plazo → gana FIDELIZACION |

### CU-08 · Ajuste automático de importes y plazos

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-08-1 | Simulador > Ajuste | Reducción del maxLTV disponible → **importeHipoteca se ajusta automáticamente** | Inicial: ULTRA_ALTO_RIESGO elegible (maxLTV 90 %), importeHipoteca = 212.500 € (85 % de 250.000 €). Cambio: reducir ingresos hasta que solo PROMOCION sea elegible (maxLTV 80 %) | importeHipoteca se reduce automáticamente a 200.000 € (80 % de 250.000 €) |
| CU-08-2 | Simulador > Ajuste | Reducción del maxPlazo disponible → **plazo se ajusta automáticamente** | Inicial: ULTRA_ALTO_RIESGO elegible (maxPlazo 40), plazo = 38. Cambio: reducir ingresos → solo PROMOCION elegible (maxPlazo 35) | Plazo se reduce automáticamente a 35 años |
| CU-08-3 | Simulador > Ajuste | Si el importe actual **ya cumple** el nuevo límite de LTV, no se modifica | Inicial: importeHipoteca = 180.000 € (72 % de 250.000 €). Cambio de oferta: nuevo maxLTV = 80 % | importeHipoteca no varía (72 % < 80 %) |
| CU-08-4 | Simulador > Ajuste | Cambiar **finalidad a 2ª vivienda** aplica límites de sistema (maxPlazo = 25, maxLTV = 75 %) cuando se superan | Plazo actual = 30, LTV actual = 85 %. Cambiar finalidad de 1ª a 2ª vivienda | Plazo se ajusta a 25 años; importeHipoteca se reduce para que LTV ≤ 75 % |
| CU-08-5 | Simulador > Ajuste | **2ª vivienda**: si plazo y LTV ya cumplen los límites de sistema, no se ajustan | Plazo = 20, LTV = 70 %. Cambiar finalidad a 2ª vivienda | Plazo y LTV no se modifican |
| CU-08-6 | Simulador > Ajuste | El ajuste aplica también en evaluaciones FINAL sucesivas | FINAL #1: ULTRA_ALTO_RIESGO ganadora, plazo 38. FINAL #2 con los mismos datos pero ULTRA_ALTO_RIESGO inelegible → solo PROMOCION (maxPlazo 35) | Plazo ajustado automáticamente a 35 tras FINAL #2 |

---

## 3. Pantalla de pre-aprobación

### CU-09 · Pantalla de pre-aprobación

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-09-1 | Pre-aprob. > Campos | El campo **Número de pagas** aparece para cada interviniente en la pantalla de pre-aprobación | Expediente con 1 titular | Campo "Número de pagas" visible para T1 |
| CU-09-2 | Pre-aprob. > Campos | El campo **Número de pagas** aparece para T1 y T2 en expedientes con 2 titulares | Expediente con 2 titulares | Campo "Número de pagas" visible para T1 y T2 por separado |
| CU-09-3 | Pre-aprob. > Motor | Antes de evaluar la pre-aprobación se llama al motor de reglas con los datos actuales del expediente | Abrir pantalla de pre-aprobación con datos completos | Se realiza llamada al motor (verificar en trazas/logs) y se obtiene respuesta antes de continuar |
| CU-09-4 | Pre-aprob. > Motor | Si la oferta pre-seleccionada **sigue siendo válida**, el flujo de pre-aprobación continúa normalmente | Expediente cuya oferta sigue siendo elegible con los parámetros actuales | No se muestra alerta; se continúa con la evaluación de pre-aprobación habitual |
| CU-09-5 | Pre-aprob. > Motor | Si la oferta pre-seleccionada **ya no es válida**, se informa al usuario y se redirige al simulador | Expediente cuya oferta ya no es elegible (parámetros cambiados desde la selección original) | Se muestra mensaje informativo; el usuario es redirigido a la pantalla de simulación |
| CU-09-6 | Pre-aprob. > Motor | En la redirección al simulador se muestran las nuevas ofertas elegibles con la nueva cuota | Continuación de PREA-05 | El simulador muestra la tabla de ofertas actualizada con la nueva ganadora resaltada |
| CU-09-7 | Pre-aprob. > Guardado | El campo **Número de pagas** se guarda correctamente por titular | Introducir numPagas T1 = 12, T2 = 14; guardar | Los valores quedan persistidos y se recuperan al reabrir el expediente |

---

## 4. Pantalla de datos del expediente

### CU-10 · Pantalla de datos del expediente

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-10-1 | Datos exp. | El campo **primeraViviendaHabitual** aparece en la pantalla de datos del expediente | Abrir datos del expediente de una hipoteca con oferta Joven | El campo aparece con el valor introducido en el alta |
| CU-10-2 | Datos exp. | El valor coincide con lo introducido en el alta | Expediente creado con primeraViviendaHabitual = Sí | El campo muestra "Sí" |
| CU-10-3 | Datos exp. | El campo se muestra también en expedientes sin oferta Joven (vacío o N/A, sin error) | Abrir datos de un expediente sin oferta Joven | El campo aparece; no genera error de pantalla |

---

## 5. Pantalla datos de Pre-aprobación
### CU-11 · Pantalla datos de Pre-aprobación

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-11-1 | Datos pre-apr. | El campo **cuota** se calcula con el TIN de la oferta asignada al expediente | Abrir datos de pre-aprobación del expediente de una hipoteca con Oferta Joven | La cuota aparece calculada con el TIN de la oferta Joven asignada |
| CU-11-2 | Datos pre-apr. | El campo **cuota** se calcula con el TIN de la oferta asignada al expediente aunque esté fuera del rango LTV | Abrir datos de pre-aprobación del expediente de una hipoteca con Oferta Joven Better Price con LTV=85% (margen de tolerancia del gestor) | La cuota aparece calculada con el TIN de la oferta Better Price |

---

## 6. Modificación del préstamo (post-alta)

### CU-12 · Modificación del préstamo (post-alta)

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-12-1 | Modificación | Al modificar el préstamo se reutiliza la misma pantalla del simulador del alta | Acceder a la pantalla de modificación del préstamo | La UI es idéntica a la del simulador de alta |
| CU-12-2 | Modificación | Las mismas reglas de límites y ajuste automático aplican en la modificación | Cambiar importe/plazo superando un límite | El sistema aplica el mismo ajuste automático que en el alta |
| CU-12-3 | Modificación > LTV | Un **gestor** puede superar el límite de LTV de la oferta hasta el límite superior configurado | Oferta con maxLTV = 80 %; introducir importe con LTV = 83 % (dentro del límite superior de gestor) | El sistema permite el valor; no lo ajusta ni bloquea |
| CU-12-4 | Modificación > LTV | El gestor **no puede superar el límite superior** de LTV configurado para la excepción | Intentar LTV = 97 % cuando el límite superior del gestor es 95 % | El sistema muestra error y bloquea el importe |
| CU-12-5 | Modificación > LTV | El exceso de LTV por gestor solo aplica a **ofertas con LTV limitado** | Oferta sin restricción adicional de LTV | No hay diferencia de comportamiento respecto al alta |

---

## 7. Pantalla de intervinientes

### CU-13 · Pantalla de intervinientes

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-13-1 | Intervinientes > BIZUM | La tabla de intervinientes incluye una columna **BIZUM** | Abrir pantalla de intervinientes de cualquier expediente | Columna "BIZUM" visible en la tabla |
| CU-13-2 | Intervinientes > BIZUM | La columna muestra **"S"** cuando `CTO_BIZUM = S` | Interviniente con CTO_BIZUM = S en fichero de riesgos | Columna muestra "(S) Vigente" |
| CU-13-3 | Intervinientes > BIZUM | La columna muestra **"A"** cuando `CTO_BIZUM = A` | Interviniente con CTO_BIZUM = A | Columna muestra "(A) Con movimientos en los últimos 30 días" |
| CU-13-4 | Intervinientes > BIZUM | La columna muestra **"N"** cuando `CTO_BIZUM = N` | Interviniente con CTO_BIZUM = N | Columna muestra "(N) No contratado" |
| CU-13-5 | Intervinientes > BIZUM | El campo `CTO_BIZUM` se recibe y almacena correctamente del fichero de riesgos | Fichero de riesgos con el nuevo campo para el cliente | El valor de `CTO_BIZUM` queda almacenado en el registro del interviniente |
| CU-13-6 | Intervinientes > Pagas | El campo **Número de pagas** se muestra en la ficha de cada interviniente | Abrir ficha del interviniente | Campo "Número de pagas" visible |
| CU-13-7 | Intervinientes > Pagas | El campo **Número de pagas** puede editarse y guardarse | Editar a 12 pagas; guardar | El valor se persiste y se recupera al reabrir |

---

## 8. Revisión de diferencia de ingresos

### CU-14 · Revisión de diferencia de ingresos

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-14-1 | Ingresos > Cálculo | **Cuenta ajena, 1 titular, 1 pagador**: los meses de junio y diciembre se excluyen del cálculo | Nóminas: ene–may, jul–nov = 2.300 €; jun = 4.600 € (paga extra); dic = 4.600 € | INGRESOS_OBS_MENSUALES = 2.300 € (media de los 10 meses válidos) |
| CU-14-2 | Ingresos > Cálculo | **Cuenta ajena, 1 titular, 2 pagadores**: se agrupan importes por mes antes de calcular la media | Ene: 2.300 + 800 = 3.100 €; Feb: 2.300 + 700 = 3.000 € (solo 2 meses de datos, sin meses excluidos) | INGRESOS_OBS_MENSUALES = (3.100 + 3.000) / 2 = 3.050 € |
| CU-14-3 | Ingresos > Cálculo | **Cuenta ajena, 2 titulares**: INGRESOS_OBS_MENSUALES es la suma de las medias individuales | Media T1 = 2.300 €, media T2 = 1.500 € | INGRESOS_OBS_MENSUALES = 3.800 € |
| CU-14-4 | Ingresos > Cálculo | **Autónomo / pensionista / rentista**: cálculo = BASE_IMPONIBLE / 14 por interviniente | T1 BASE_IMPONIBLE = 32.200 €/año | INGRESOS_OBS_MENSUALES = 32.200 / 14 = 2.300 € |
| CU-14-5 | Ingresos > Cálculo | **Autónomo, 2 titulares**: suma de BASE_IMPONIBLE/14 de cada titular | T1 = 32.200 €, T2 = 19.600 € | INGRESOS_OBS_MENSUALES = (32.200 + 19.600) / 14 = 3.700 € |
| CU-14-6 | Ingresos > Tarea BPM | La tarea BPM **se crea** tras la validación conjunta cuando INGRESOS_OBS < PARAM:MINIMO_INGRESOS (con margen configurable) | INGRESOS_OBS_MENSUALES = 1.800 €, MINIMO_INGRESOS = 2.300 € | Se crea tarea en BPM y se envía mail al gestor del expediente |
| CU-14-7 | Ingresos > Tarea BPM | La tarea BPM **no se crea** cuando INGRESOS_OBS ≥ PARAM:MINIMO_INGRESOS (con margen) | INGRESOS_OBS_MENSUALES = 2.500 €, MINIMO_INGRESOS = 2.300 € | No se crea tarea BPM |
| CU-14-8 | Ingresos > Tarea BPM | La tarea muestra correctamente: ingresos observados por titular, total, mínimos necesarios para 1T y 2T, y nuevo precio | Abrir la tarea creada en ING-06 | La tarea presenta todos los datos especificados sin errores |
| CU-14-9 | Ingresos > Tarea BPM | La decisión **"Avanzar"** aplica la oferta correspondiente y avanza el flujo con llamada al motor de scoring | Ejecutar "Avanzar" en la tarea | El expediente avanza; la llamada al motor de scoring queda registrada en trazas |
| CU-14-10 | Ingresos > Tarea BPM | La tarea **no se crea** si el expediente ya pasó por PROC@FIRMA | Expediente con PROC@FIRMA ejecutada; INGRESOS_OBS < MINIMO | No se genera tarea BPM |
| CU-14-11 | Ingresos > Aviso | Se crea un **aviso para el gestor** con los valores declarado y observado | Condiciones de ING-06 | Aviso generado con título "PDTE DEFINIR"; cuerpo contiene ingresos declarados e INGRESOS_OBS_MENSUALES |
| CU-14-12 | Ingresos > Pantalla interv. | En la ficha del interviniente se muestra "media de ingresos observados de los últimos X meses" | Abrir ficha del interviniente tras el cálculo | El campo aparece a la derecha de los ingresos declarados con el valor correcto |

---

## 9. Llamadas al motor de scoring

### CU-15 · Llamadas al motor de scoring

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-15-1 | Scoring | **PRIMERA_VIVIENDA_HABITUAL_FL** se incluye en la llamada | Expediente con primeraViviendaHabitual = Sí | El fichero de llamada contiene `PRIMERA_VIVIENDA_HABITUAL_FL = 1` |
| CU-15-2 | Scoring | **IngNetAnDec** = ingresos mensuales × num pagas | T1: 2.000 €/mes × 14 pagas | IngNetAnDec = 28.000 en la llamada |
| CU-15-3 | Scoring | **IngNetAnActLabDec** = ingresos mensuales × num pagas (mismo cálculo) | T1: 2.000 €/mes × 14 pagas | IngNetAnActLabDec = 28.000 en la llamada |
| CU-15-4 | Scoring | **NumPagas** se envía correctamente cuando está informado | T1 numPagas = 12 | NumPagas = 12 en la llamada |
| CU-15-5 | Scoring | Cuando **NumPagas no está informado** (expediente sin oferta Joven), se usa el valor 14 | Expediente sin oferta Joven, campo num. pagas no capturado | NumPagas = 14 en la llamada |
| CU-15-6 | Scoring | **vidaLaboralObs** = `total_anyo_trabajado_nm × 12 + total_meses_trabajado_nm` | T1: 10 años + 6 meses trabajados | vidaLaboralObs = 126 en el fichero RiesgosScoringLlamadas |
| CU-15-7 | Scoring | Los campos **preexistentes** de la llamada no se ven alterados | Llamada al motor de scoring estándar | El resto de campos mantiene sus valores; no aparecen duplicados ni modificados |

---

## 10. Alta/Actualización expedientes en Gestoría

### CU-16 · Alta/Actualización expedientes en Gestoría

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-16-1 | Integración gestoría | El campo TIN y DIFERENCIAL se entrega con los valores de TIN/DIFERENCIAL de la oferta aplicada al expediente - el descuento del precio personalizado. LTV en rango | Expediente Mixta con oferta Joven Better Price, 25 años 100.000EUR, AñosFijo=5, Plazo=25, LTV<=80 | Se envía con el TIN 2,3 y DIFERENCIAL 0,6 |
| CU-16-2 | Integración gestoría | El campo TIN y DIFERENCIAL se entrega con los valores de TIN/DIFERENCIAL de la oferta aplicada al expediente - el descuento del precio personalizado. LTV fuera de  rango | Expediente Mixta con oferta Joven Better Price, 25 años 100.000EUR, AñosFijo=5, Plazo=25, LTV>80, Dto TIN 0.1, Dto DIFF 0.2 | Se envía con el TIN 2,2 y DIFERENCIAL 0,5 |

---

## 11. Servicios WF (Expone WF)

### CU-17 · Servicios WF (Expone WF)

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-17-1 | WF > AltaHipoteca | El servicio **AltaHipoteca** acepta el nuevo campo `primeraViviendaHabitualFl` | Llamar con `primeraViviendaHabitualFl = 1` | El campo se procesa sin error y se persiste en el expediente. El expediente devuelve el código de oferta asignado |
| CU-17-2 | WF > GetDatosEntradaPrestamo | El servicio devuelve `primeraViviendaHabitualFl` en la respuesta | Expediente con primeraViviendaHabitual informado | La respuesta contiene el campo con el valor correcto |
| CU-17-3 | WF > GetDatosAdicionalesPreAprob | El servicio devuelve `primeraViviendaHabitualFl` en la respuesta | Expediente con primeraViviendaHabitual informado | La respuesta contiene el campo con el valor correcto |
| CU-17-4 | WF > GuardarDatosAdicionalesPreAprob | El servicio acepta y persiste `primeraViviendaHabitualFl` | Llamar con `primeraViviendaHabitualFl = 0` | El valor se guarda; una llamada posterior al Get devuelve el valor guardado |
| CU-17-5 | WF > GetOfertasHipotecas | El **nuevo servicio GetOfertasHipotecas** devuelve las ofertas elegibles y sus límites | Llamar con datos de un expediente elegible para ULTRA_ALTO_RIESGO | La respuesta incluye la lista de ofertas con los límites financieros (minHipoteca, maxHipoteca, minPlazo, maxPlazo, minLtvExclusive, maxLtv, edadPlazo) |
| CU-17-6 | WF > GetOfertasHipotecas | **GetOfertasHipotecas** devuelve lista vacía cuando no hay ofertas elegibles | Llamar con datos sin ninguna oferta elegible | La respuesta contiene lista vacía; sin error de sistema |
| CU-17-7 | WF > GetOfertasHipotecas | El servicio WF incluye `SOLICITAR_DATOS_INTERVINIENTES` en los límites devueltos, coherente con el motor POC | Expediente con oferta distinta de FIDELIZACION elegible (POC = true) | La respuesta WF devuelve el flag = true; la comparación POC↔WF no marca diferencia. **Nota:** ausencia del campo en WF se interpreta como `false` (equivalente a "no solicitar") y no genera diff espurio |

---

## 12. Exportaciones

### CU-18 · Exportación ExpedientesProducto

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-18-1 | Export. ExpProd | El fichero diario incluye la columna **INGRESOS_DECLARADOS_T1** | Generar exportación | La columna aparece con el importe mensual declarado del T1 |
| CU-18-2 | Export. ExpProd | El fichero incluye **INGRESOS_DECLARADOS_T2** | Expediente con 2 titulares; generar exportación | La columna aparece con el importe del T2 (nulo para expedientes con 1 titular) |
| CU-18-3 | Export. ExpProd | El fichero incluye **INGRESOS_OBSERVADOS_T1** e **INGRESOS_OBSERVADOS_T2** | Generar exportación | Las columnas aparecen con los valores calculados de INGRESOS_OBS por titular |
| CU-18-4 | Export. ExpProd | El fichero incluye **NUM_PAGAS_T1** y **NUM_PAGAS_T2** | Generar exportación | Las columnas aparecen con el número de pagas informado para cada titular |
| CU-18-5 | Export. ExpProd | El fichero incluye la **edad del titular mayor** | Generar exportación | La columna aparece con la edad del titular de mayor edad |
| CU-18-6 | Export. ExpProd | El fichero incluye **TIN** y **DIFERENCIAL reales** (con precio personalizado cuando aplica) | Expediente con precio personalizado; generar exportación | TIN y DIFERENCIAL reflejan el precio real, no el de tarifa |
| CU-18-7 | Export. ExpProd | El fichero incluye **TIN_CATALOGO** y **DIFERENCIAL_CATALOGO** (con precio estándar) | Expediente con precio personalizado; generar exportación | TIN_CATALOGO y DIFERENCIAL_CATALOGO reflejan el precio del catálogo, no el personalizado |
| CU-18-8 | Export. ExpProd | El fichero incluye **PRIMERA_VIVIENDA_HABITUAL_FL** | Generar exportación | La columna aparece con el valor del expediente (0 / 1) |

### CU-19 · Exportación RiesgoScoringLlamadas

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-19-1 | Export. Riesgos | El fichero incluye **vidaLaboralObs** para cada interviniente | Expediente con años/meses trabajados informados; generar exportación | La columna aparece con el valor calculado (años × 12 + meses) por interviniente |
| CU-19-2 | Export. Riesgos | El fichero incluye **PRIMERA_VIVIENDA_HABITUAL_FL** | Generar exportación | La columna aparece con el valor correcto del expediente |
| CU-19-3 | Export. Riesgos | Los campos preexistentes del fichero no se ven alterados | Comparar columnas del fichero antes y después del despliegue | Todos los campos previos siguen presentes con los mismos valores |

---

## 13. Generación de documentos

### CU-20 · Servicio Generar-Documento (objeto cabecera)

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-20-1 | Documento > Cabecera | La cabecera incluye el nuevo campo **edadMaxima** con el valor del parámetro de la oferta | Expediente con ALTO_RIESGO (MAX_EDAD = 45); generar documento | `edadMaxima` = "45" en la cabecera |
| CU-20-2 | Documento > Cabecera | La cabecera incluye el nuevo campo **edadMasPlazo** con el valor del parámetro EDAD_PLAZO de la oferta | Expediente con ULTRA_ALTO_RIESGO (EDAD_PLAZO = 75); generar documento | `edadMasPlazo` = "75" en la cabecera |
| CU-20-3 | Documento > Cabecera | Si el parámetro EDAD_PLAZO no existe para la oferta, **edadMasPlazo** usa la constante del sistema según finalidad | Oferta sin parámetro EDAD_PLAZO; finalidad 1ª vivienda | `edadMasPlazo` = valor de constante `EdadMaxPrimeraVivienda`; el campo no aparece vacío |
| CU-20-4 | Documento > Cabecera | La cabecera incluye **importeMinimoCcaa** con formato: separador de miles "." y decimal "," con 2 decimales | CCAA con importe mínimo = 150.000 € | `importeMinimoCcaa` = "150.000,00" en la cabecera |
| CU-20-5 | Documento > Cabecera | El formato de **importeMinimoCcaa** es correcto para un importe con decimales | Importe mínimo = 123.456,78 € | `importeMinimoCcaa` = "123.456,78" |

### CU-21 · Servicio carta de Pre-Aprobación

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-21-1 | Carta Pre-Aprob. | La raíz del objeto incluye **edadMasPlazo** con el valor del parámetro EDAD_PLAZO | Expediente con LARGO_PLAZO (EDAD_PLAZO = 75); generar carta | `edadMasPlazo` = "75" en la raíz del objeto |
| CU-21-2 | Carta Pre-Aprob. | La raíz del objeto incluye **edadMaxima** con el valor del parámetro MAX_EDAD | Expediente con ALTO_RIESGO (MAX_EDAD = 45); generar carta | `edadMaxima` = "45" en la raíz del objeto |

---

## 14. Desactivación de ofertas

Las ofertas disponen de dos nuevos campos: `Activa_fl` y `Mantener_oferta_fl`. El expediente dispone del flag `MANTIENE_OFERTA_FL`. Reglas de negocio:

- Ofertas con `Activa_fl = 0` **no se ofrecen a expedientes nuevos**.
- Los expedientes existentes con oferta asignada no se ven afectados por la desactivación.
- Al resimular un expediente con `MANTIENE_OFERTA_FL = 1` se evalúan las ofertas activas **más** las desactivadas con `Mantener_oferta_fl = 1`.
- Si el ganador de la resimulación tiene `Mantener_oferta_fl = 0`, el expediente pierde `MANTIENE_OFERTA_FL`.
- Si cambia `fecha_aplicacion_precios` y hay cambio de tarifas, la oferta asignada se anula y se recalcula con FINAL.

### CU-22 · Desactivación y visibilidad de ofertas

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-22-1 | Desactivación > Nuevo exp. | Una oferta con `Activa_fl = 0` **no aparece** en el simulador para expedientes nuevos | ULTRA_ALTO_RIESGO desactivada; nuevo expediente con P1 (cumple todas las condiciones para ULTRA_ALTO_RIESGO) | ULTRA_ALTO_RIESGO no aparece en la tabla de ofertas; el motor no la recibe como candidata |
| CU-22-2 | Desactivación > Nuevo exp. | Al reactivar una oferta (`Activa_fl = 0 → 1`), vuelve a aparecer en nuevos expedientes | ULTRA_ALTO_RIESGO desactivada; reactivarla; nuevo expediente con P1 | ULTRA_ALTO_RIESGO aparece de nuevo en la tabla de ofertas |
| CU-22-3 | Desactivación > Exp. existente | Desactivar una oferta **no afecta** a expedientes que ya la tienen asignada | Expediente con ULTRA_ALTO_RIESGO asignada; desactivar la oferta | El expediente conserva ULTRA_ALTO_RIESGO como oferta asignada sin ningún cambio |
| CU-22-4 | Desactivación > Nuevo exp. | Con todas las ofertas distintas de FIDELIZACION desactivadas, el simulador solo muestra FIDELIZACION para nuevos expedientes (si aplica) | Todas las ofertas distintas de FIDELIZACION con `Activa_fl = 0`; P4 (ant. 14 m > 12, cumple FIDELIZACION) | Solo FIDELIZACION aparece en resultados |

### CU-23 · Flag MANTIENE_OFERTA_FL en el expediente

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-23-1 | Desactivación > Flag | Al ganar una oferta con `Mantener_oferta_fl = 1`, el expediente queda marcado con `MANTIENE_OFERTA_FL = 1` | ULTRA_ALTO_RIESGO con `Mantener_oferta_fl = 1`; expediente P1 que la obtiene como ganadora | El expediente tiene `MANTIENE_OFERTA_FL = 1` tras la asignación |
| CU-23-2 | Desactivación > Flag | Al ganar una oferta con `Mantener_oferta_fl = 0`, el expediente **no** queda marcado | ALTO_RIESGO con `Mantener_oferta_fl = 0`; expediente que la obtiene como ganadora | El expediente tiene `MANTIENE_OFERTA_FL = 0` |

### CU-24 · Resimulación con MANTIENE_OFERTA_FL = 1

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-24-1 | Desactivación > Resim. | Al resimular con `MANTIENE_OFERTA_FL = 1`, se evalúan las ofertas activas **y** las desactivadas con `Mantener_oferta_fl = 1` | Expediente con `MANTIENE_OFERTA_FL = 1`; ULTRA_ALTO_RIESGO desactivada con `Mantener_oferta_fl = 1`; ALTO_RIESGO activa | La resimulación incluye ambas ofertas como candidatas |
| CU-24-2 | Desactivación > Resim. | La oferta desactivada mantenida puede resultar ganadora si tiene el mayor ranking elegible | Continuación de DESACT-07 donde ULTRA_ALTO_RIESGO (rank 100) sigue siendo la mejor opción elegible | ULTRA_ALTO_RIESGO resulta ganadora pese a estar desactivada |
| CU-24-3 | Desactivación > Resim. | Si tras resimular gana una oferta con `Mantener_oferta_fl = 0`, el expediente **pierde** `MANTIENE_OFERTA_FL` | Expediente con `MANTIENE_OFERTA_FL = 1`; condiciones cambian y gana ALTO_RIESGO (`Mantener_oferta_fl = 0`) | El expediente queda con `MANTIENE_OFERTA_FL = 0` |
| CU-24-4 | Desactivación > Resim. | Si tras resimular gana una oferta activa con `Mantener_oferta_fl = 1`, el expediente **conserva** `MANTIENE_OFERTA_FL` | Expediente con `MANTIENE_OFERTA_FL = 1`; gana PROMOCION (activa, `Mantener_oferta_fl = 1`) | El expediente conserva `MANTIENE_OFERTA_FL = 1` |
| CU-24-5 | Desactivación > Resim. | Al resimular un expediente **sin** `MANTIENE_OFERTA_FL`, las ofertas desactivadas no se consideran aunque tengan `Mantener_oferta_fl = 1` | Expediente con `MANTIENE_OFERTA_FL = 0`; ULTRA_ALTO_RIESGO desactivada con `Mantener_oferta_fl = 1` | ULTRA_ALTO_RIESGO no se incluye en la resimulación |
| CU-24-6 | Desactivación > Resim. | Una oferta desactivada con `Mantener_oferta_fl = 0` **nunca** se considera en resimulaciones, ni siquiera con el flag del expediente activo | Expediente con `MANTIENE_OFERTA_FL = 1`; oferta desactivada con `Mantener_oferta_fl = 0` | La oferta no se incluye en la resimulación |

### CU-25 · Cambio de fecha de aplicación de precios

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-25-1 | Desactivación > Fecha | Si cambia `fecha_aplicacion_precios` y las tarifas difieren, la oferta asignada se **anula** | Expediente con ULTRA_ALTO_RIESGO asignada; cambiar `fecha_aplicacion_precios` a una fecha con tarifas distintas | La oferta asignada queda anulada |
| CU-25-2 | Desactivación > Fecha | Tras anular la oferta por cambio de `fecha_aplicacion_precios`, se **recalcula automáticamente** con el motor FINAL | Continuación de DESACT-13 | El motor FINAL se ejecuta; el expediente obtiene la nueva oferta ganadora según las tarifas de la nueva fecha |
| CU-25-3 | Desactivación > Fecha | Si el cambio de `fecha_aplicacion_precios` **no produce cambio de tarifas**, la oferta asignada se mantiene | Cambiar `fecha_aplicacion_precios` a una fecha con las mismas tarifas | La oferta asignada no se modifica; no se lanza recálculo |

---

## 15. Vigencia de parámetros y fecha de aplicación de la oferta

Cuando se asigna una oferta a un expediente se fija el campo **FECHA_APLICACION_OFERTA** (la fecha de aplicación de precios con la que se evaluó). Se añade el parámetro configurable **«Meses validez parámetros»**. Al **resimular** un expediente, el motor decide qué versión de reglas/parámetros consultar según esa fecha:

- **Ventana de validez** = `HOY() − «Meses validez parámetros»`.
- Si `FECHA_APLICACION_OFERTA` es **posterior** a la ventana (aún vigente) → se reutilizan las reglas/parámetros **históricos** de `FECHA_APLICACION_OFERTA`; el campo **no** se modifica.
- Si `FECHA_APLICACION_OFERTA` ha **caducado** (≤ ventana) → se usan las reglas/parámetros **vigentes** y se **reasigna** `FECHA_APLICACION_OFERTA` a la fecha vigente.

> *Datos de referencia para esta sección:* `HOY() = 2026-06-15`, `«Meses validez parámetros» = 3` (parámetro configurable; valor de ejemplo) → ventana = **2026-03-15**. La condición es estricta: una fecha **igual** a la ventana se considera **caducada** (no es «posterior»).

### CU-27 · Asignación de FECHA_APLICACION_OFERTA y parámetro de validez

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-27-1 | Vigencia > Asignación | Al asignar una oferta ganadora (FINAL), el expediente queda con `FECHA_APLICACION_OFERTA` igual a la fecha de aplicación de precios usada en la evaluación | P1, FINAL con oferta ganadora; fecha de aplicación de precios = 2026-04-01 | El expediente queda con `FECHA_APLICACION_OFERTA = 2026-04-01` |
| CU-27-2 | Vigencia > Parámetro | El parámetro **«Meses validez parámetros»** existe, es configurable y se aplica al resimular | Consultar/editar el parámetro en la configuración | El parámetro es visible y editable; su valor se usa para calcular la ventana de validez en la resimulación |
| CU-27-3 | Vigencia > Asignación | En el alta inicial (sin oferta previa) `FECHA_APLICACION_OFERTA` se informa con la fecha de aplicación vigente | Alta nueva de expediente P1; HOY = 2026-06-15 | `FECHA_APLICACION_OFERTA` queda informada con la fecha de aplicación vigente |

### CU-28 · Resimulación con FECHA_APLICACION_OFERTA vigente (dentro de ventana)

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-28-1 | Vigencia > Resim. | Con `FECHA_APLICACION_OFERTA` posterior a la ventana, la resimulación usa las reglas/parámetros **históricos** de esa fecha, no los vigentes | Expediente con `FECHA_APLICACION_OFERTA = 2026-04-01` (> 2026-03-15); existe una versión histórica de parámetros vigente en 2026-04-01 distinta de la actual | El motor consulta la configuración de 2026-04-01; el resultado refleja los valores históricos |
| CU-28-2 | Vigencia > Resim. | Tras resimular dentro de la ventana, `FECHA_APLICACION_OFERTA` **no se modifica** | Continuación de CU-28-1 | El expediente conserva `FECHA_APLICACION_OFERTA = 2026-04-01` |
| CU-28-3 | Vigencia > Resim. | Un cambio en los parámetros **vigentes no afecta** a la resimulación mientras la fecha siga dentro de la ventana | Cambiar un parámetro vigente (p. ej. `MAX_LTV` de una oferta) tras la asignación; resimular con `FECHA_APLICACION_OFERTA = 2026-04-01` aún vigente | El resultado usa el valor histórico; el cambio vigente no se aplica |

### CU-29 · Resimulación con FECHA_APLICACION_OFERTA caducada

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-29-1 | Vigencia > Resim. | Con `FECHA_APLICACION_OFERTA` caducada (≤ ventana), la resimulación usa las reglas/parámetros **vigentes** | Expediente con `FECHA_APLICACION_OFERTA = 2026-02-01` (< 2026-03-15); resimular | El motor consulta la configuración vigente (no la de 2026-02-01); el resultado refleja los valores actuales |
| CU-29-2 | Vigencia > Resim. | Tras resimular con fecha caducada, se **reasigna** `FECHA_APLICACION_OFERTA` a la fecha vigente | Continuación de CU-29-1 | El expediente queda con `FECHA_APLICACION_OFERTA` = fecha de aplicación vigente (≈ HOY 2026-06-15) |
| CU-29-3 | Vigencia > Límite | **Límite estricto**: `FECHA_APLICACION_OFERTA` exactamente igual a la ventana se considera **caducada** | `FECHA_APLICACION_OFERTA = 2026-03-15` (= HOY − 3 meses); resimular | Se trata como caducada: se usan parámetros vigentes y se reasigna la fecha |
| CU-29-4 | Vigencia > Límite | **Límite estricto**: `FECHA_APLICACION_OFERTA` un día posterior a la ventana sigue **vigente** | `FECHA_APLICACION_OFERTA = 2026-03-16` (= ventana + 1 día); resimular | Se usan los parámetros históricos de 2026-03-16; la fecha **no** se reasigna |

---

## 16. Regresión

### CU-26 · Regresión

| Paso | Área | Descripción | Condiciones / Datos | Resultado esperado |
|---|---|---|---|---|
| CU-26-1 | Regresión | El flujo de alta de expediente **sin oferta Joven** funciona igual que antes del despliegue | tipoAlta = SUBROGACION, cliente sin antigüedad suficiente para FIDELIZACION | No se genera error; el flujo continúa por las pantallas habituales |
| CU-26-2 | Regresión | Los expedientes **en curso** al momento del despliegue se abren y operan sin errores | Abrir y editar un expediente creado antes del despliegue | Los datos existentes cargan sin error; ningún campo previo se altera |
| CU-26-3 | Regresión | La pantalla de simulación para expedientes **sin oferta Joven** no muestra el panel económico ni la tabla de ofertas Joven | Acceder al simulador de un expediente sin oferta Joven | La UI muestra solo los campos habituales sin cambios visibles |
| CU-26-4 | Regresión | Las **llamadas al motor de scoring** para expedientes sin oferta Joven usan NumPagas = 14 y no incluyen campos Joven con valores incorrectos | Expediente sin oferta Joven; ejecutar llamada al motor de scoring | NumPagas = 14; el resto de campos preexistentes no varían |
| CU-26-5 | Regresión | Los ficheros de exportación del día del despliegue incluyen los expedientes previos con los nuevos campos a nulo | Ejecutar exportaciones el día del despliegue | Los expedientes previos aparecen en los ficheros; las nuevas columnas quedan en nulo o vacío |
| CU-26-6 | Regresión | La **generación de documentos** para hipotecas sin oferta Joven no genera errores aunque falten los nuevos campos | Generar documento para expediente sin oferta Joven | El documento se genera correctamente; los nuevos campos (`edadMaxima`, `edadMasPlazo`, `importeMinimoCcaa`) quedan vacíos o se omiten sin error |
| CU-26-7 | Regresión | El servicio **AltaHipoteca** funciona correctamente cuando `primeraViviendaHabitualFl` no se envía | Llamar a AltaHipoteca sin el nuevo campo | El servicio responde sin error |
| CU-26-8 | Regresión | La pantalla de **datos del expediente** carga sin errores para expedientes creados antes del despliegue | Abrir datos de un expediente antiguo | La pantalla carga; el campo `primeraViviendaHabitualFl` aparece vacío o N/A sin provocar error |
