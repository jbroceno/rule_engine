# Motor de Reglas - Documentación de Configuración

## 1. Visión General

El motor de reglas evalúa solicitudes de hipoteca en **tres fases secuenciales**. Cada fase es independiente — recibe su propio input completo y no comparte estado con las demás — pero el simulador aplica un **pipeline en cascada**: si una fase no supera la elegibilidad, las fases posteriores no se ejecutan.

| Fase | Función del motor | Flag de elegibilidad | Ámbito |
|------|-------------------|---------------------|--------|
| **INIT** | `initcheck()` | `dictamen.initEligible === true` | Todas las ofertas evaluadas |
| **PRE** | `precheck()` | `dictamen.preEligible === true` | Todas las ofertas evaluadas |
| **FINAL** | `finalize()` | `dictamen.eligible === true` | Solo ofertas pre-elegibles |

### Lógica de cascada en el simulador

```
Ejecutar INIT
  ├─ Sin elegibles → mostrar Log INIT, detener (no ejecutar PRE ni FINAL)
  └─ Con elegibles → ejecutar PRE
       ├─ Sin elegibles → mostrar Log INIT + Log PRE, detener (no ejecutar FINAL)
       └─ Con elegibles → ejecutar FINAL → mostrar Log INIT + Log PRE + resultado FINAL
```

Las ofertas tienen un `offer_rank` para desempate si hay múltiples elegibles en FINAL (gana la de mayor rank).

---

## 2. Estructura del JSON de Configuración

El motor se alimenta de un JSON con dos secciones principales:

```json
{
  "offers": [...],
  "params": [...]
}
```

---

## 3. Definición de Ofertas

Cada oferta contiene metadata y su conjunto de reglas:

```json
{
  "offerCode": "OFERTA_RESTRICTIVA",
  "offer_rank": 100,
  "oferta_id": 11,
  "enabled": true,
  "rules": [...]
}
```

| Campo | Descripción |
|-------|-------------|
| `offerCode` | Identificador único de la oferta |
| `offer_rank` | Prioridad para desempate en FINAL (mayor = mayor prioridad) |
| `oferta_id` | ID de referencia en sistema externo |
| `enabled` | Si `false`, la oferta se ignora en la evaluación |
| `rules` | Array de reglas a evaluar (las tres fases comparten el mismo array) |

### Ofertas disponibles

| offerCode | offer_rank | Descripción |
|-----------|-----------|-------------|
| `OFERTA_RESTRICTIVA` | 100 | Límites más estrictos; requiere primera vivienda, LTV y renta más bajos |
| `OFERTA_PERMISIVA` | 10 | Límites más amplios; LTV `(0.80, 0.95]`, sin requerimiento de primera vivienda |

---

## 4. Definición de Reglas

```json
{
  "rule_id": 1,
  "name": "INIT Rechazo: tipoAlta no admitido",
  "priority": 1000,
  "enabled": true,
  "stop_processing": false,
  "offer_date_id": null,
  "conditions": [...],
  "actions": [...]
}
```

| Campo | Descripción |
|-------|-------------|
| `rule_id` | Identificador único de la regla |
| `name` | Descripción legible |
| `priority` | **Mayor = se evalúa primero**. Reglas de rechazo suelen tener prioridad 900–1000; reglas de decisión, prioridad baja (10–50). |
| `enabled` | Si `false`, la regla se omite completamente |
| `stop_processing` | Si `true`, al cumplirse la regla se detiene la evaluación de reglas posteriores para esa oferta |
| `offer_date_id` | FK a `cfg_offer_dates` — período de vigencia de la regla (opcional) |
| `conditions` | Array de condiciones en DNF (AND dentro de grupo, OR entre grupos) |
| `actions` | Array de acciones a ejecutar si la regla coincide |

### Guardas de fase (obligatorio)

Toda regla **debe** incluir una condición sobre el campo `stage` que indique para qué fase aplica. Sin esta guarda, la regla se evaluaría en todas las fases.

```json
{ "field": "stage", "operator": "EQ", "value1": "INIT" }
{ "field": "stage", "operator": "EQ", "value1": "PRE" }
{ "field": "stage", "operator": "EQ", "value1": "FINAL" }
```

Los valores válidos son `"INIT"`, `"PRE"` y `"FINAL"` (insensible a mayúsculas).

### Campos exclusivos por fase

| Campo | Solo en fase | Descripción |
|-------|-------------|-------------|
| `initEligible` | INIT | La oferta pasa el filtro inicial |
| `preEligible` | PRE | La oferta pasa el precheck |
| `eligible` | FINAL | La oferta es la seleccionada |
| `rejected` | FINAL | La oferta es rechazada en FINAL |
| `selectedOffer` | FINAL | Código de la oferta ganadora |

Las acciones que intentan establecer `eligible`, `rejected` o `selectedOffer` fuera de la fase FINAL son ignoradas por el motor.

### Orden de evaluación

Las reglas de una oferta se ordenan por `priority` descendente; en caso de empate, por `rule_id` ascendente.

### Patrón: regla de decisión final

Es buena práctica separar las **reglas de rechazo** (prioridad alta) de la **regla de decisión** (prioridad baja), que activa el flag de elegibilidad y establece los límites:

```json
{
  "name": "PRE Decisión: preEligible + límites",
  "priority": 10,
  "stop_processing": true,
  "conditions": [
    { "field": "stage", "operator": "EQ", "value1": "PRE" },
    { "field": "preRejected", "operator": "IS_FALSE", "value_type": "BOOL" }
  ],
  "actions": [
    { "action_type": "SET", "field": "preEligible", "value": "true", "value_type": "BOOL" },
    { "action_type": "SET", "field": "minHipoteca", "value": "PARAM:MIN_HIPOTECA", "value_type": "NUMBER" },
    { "action_type": "SET", "field": "maxHipoteca", "value": "PARAM:MAX_HIPOTECA", "value_type": "NUMBER" }
  ]
}
```

La misma estructura aplica para INIT (activando `initEligible`) y para FINAL (activando `eligible`).

---

## 5. Condiciones

### Estructura

```json
{
  "cond_id": 1,
  "group_id": 0,
  "field": "edadMax",
  "operator": "GT",
  "value_type": "NUMBER",
  "value1": "PARAM:MAX_EDAD",
  "value2": null,
  "in_values": []
}
```

| Campo | Descripción |
|-------|-------------|
| `cond_id` | Identificador de la condición |
| `group_id` | Grupo lógico: condiciones en el mismo `group_id` se evalúan con AND; grupos distintos con OR |
| `field` | Campo del contexto a evaluar. Puede ser `PARAM:<CLAVE>` para comparar dos parámetros |
| `operator` | Operador de comparación |
| `value_type` | Tipo del valor: `NUMBER`, `STRING`, `BOOL`, `DATE` |
| `value1` | Primer valor de comparación (literal o `PARAM:<CLAVE>`) |
| `value2` | Segundo valor (solo para `BETWEEN`) |
| `in_values` | Valores para operadores `IN` / `NOT_IN` (array literal) |

### Operadores soportados

| Operador | Descripción | Comportamiento con null |
|----------|-------------|------------------------|
| `EQ` | Igual | `null === null` → true |
| `NE` | Distinto | |
| `LT` | Menor que | false si algún operando es null |
| `LE` | Menor o igual | false si algún operando es null |
| `GT` | Mayor que | false si algún operando es null |
| `GE` | Mayor o igual | false si algún operando es null |
| `BETWEEN` | Entre value1 y value2 (inclusive) | false si algún operando es null |
| `IN` | Está en lista (`in_values` o `PARAM:`) | false si left es null |
| `NOT_IN` | No está en lista | false si left es null |
| `IS_TRUE` | Es `true` exactamente | false si null |
| `IS_FALSE` | Es `false` o `null` | true si null |

### Valores parametrizados (`PARAM:`)

Tanto el campo izquierdo (`field`) como los valores de comparación (`value1`, `value2`) admiten el prefijo `PARAM:` para leer desde el índice de parámetros en tiempo de evaluación:

```json
{ "field": "edadMax", "operator": "GT", "value1": "PARAM:MAX_EDAD" }
```

```json
{ "field": "PARAM:REQUIERE_PRIMERA_VIVIENDA", "operator": "IS_TRUE", "value_type": "BOOL" }
```

En el segundo caso, el lado izquierdo de la condición se lee desde el parámetro en lugar del contexto de entrada.

### Lógica de grupos (DNF)

El motor solo soporta lógica en **Forma Normal Disyuntiva (DNF)**:

- **Mismo `group_id`**: AND (todas las condiciones del grupo deben cumplirse)
- **Distinto `group_id`**: OR (con que un grupo se cumpla, la regla coincide)

> **Patrón soportado**: `(A AND B) OR (C AND D)`
> **No soportado**: `(A OR B) AND C` — si necesita este patrón, reescríbalo en DNF o use `IN` para simular OR dentro de un campo.

```json
"conditions": [
  { "group_id": 1, "field": "stage", "operator": "EQ",  "value1": "FINAL" },
  { "group_id": 1, "field": "ltv",   "operator": "LE",  "value1": "PARAM:MIN_LTV" },
  { "group_id": 2, "field": "stage", "operator": "EQ",  "value1": "FINAL" },
  { "group_id": 2, "field": "ltv",   "operator": "GT",  "value1": "PARAM:MAX_LTV" }
]
```
> La regla coincide si `(stage=FINAL AND ltv<=MIN_LTV)` OR `(stage=FINAL AND ltv>MAX_LTV)`.

### Patrón de inversión (las reglas se disparan en fallo)

Las reglas actúan como **detectores de rechazo**: se disparan cuando se cumple su condición y ejecutan acciones como `SET preRejected = true`. Esto significa que las condiciones de elegibilidad (lógica positiva) deben expresarse como su negado antes de codificarse como regla.

**Regla de transformación (leyes de De Morgan):**

| Condición de elegibilidad | Condición de rechazo (negado) | Efecto en DNF |
|---------------------------|-------------------------------|---------------|
| `NOT (A AND B)` | `(NOT A) OR (NOT B)` | 2 grupos, cada uno con una condición negada |
| `NOT (A OR B)` | `(NOT A) AND (NOT B)` | 1 grupo con ambas condiciones negadas |

> **Clave**: negar una conjunción (AND) expande el número de grupos; negar una disyunción (OR) los colapsa en uno solo.

#### Ejemplo 1 — condición con AND anidado

**Especificación funcional** (elegibilidad):
```
(NumIntervinientes=1 AND EdadT1 < PARAM:MAXEDAD)
OR
(NumIntervinientes=2 AND EdadT1 < PARAM:MAXEDAD AND EdadT2 < PARAM:MAXEDAD)
```

**Negado** (cuándo rechazar):
```
(NumIntervinientes=1 AND EdadT1 >= PARAM:MAXEDAD)        ← grupo 1
OR
(NumIntervinientes=2 AND EdadT1 >= PARAM:MAXEDAD)        ← grupo 2
OR
(NumIntervinientes=2 AND EdadT2 >= PARAM:MAXEDAD)        ← grupo 3
OR
(NumIntervinientes NOT IN {1,2})                         ← grupo 4 (caso no previsto)
```

> La condición original (DNF con 2 grupos) se convierte en un rechazo con 4 grupos. La guarda `stage=INIT` se repite en cada grupo.

```json
"conditions": [
  { "group_id": 1, "field": "stage",               "operator": "EQ",     "value1": "INIT" },
  { "group_id": 1, "field": "NumIntervinientes",   "operator": "EQ",     "value1": "1", "value_type": "NUMBER" },
  { "group_id": 1, "field": "EdadT1",              "operator": "GE",     "value1": "PARAM:MAXEDAD", "value_type": "NUMBER" },

  { "group_id": 2, "field": "stage",               "operator": "EQ",     "value1": "INIT" },
  { "group_id": 2, "field": "NumIntervinientes",   "operator": "EQ",     "value1": "2", "value_type": "NUMBER" },
  { "group_id": 2, "field": "EdadT1",              "operator": "GE",     "value1": "PARAM:MAXEDAD", "value_type": "NUMBER" },

  { "group_id": 3, "field": "stage",               "operator": "EQ",     "value1": "INIT" },
  { "group_id": 3, "field": "NumIntervinientes",   "operator": "EQ",     "value1": "2", "value_type": "NUMBER" },
  { "group_id": 3, "field": "EdadT2",              "operator": "GE",     "value1": "PARAM:MAXEDAD", "value_type": "NUMBER" }
]
```

#### Ejemplo 2 — condición con OR entre criterios alternativos

**Especificación funcional** (elegibilidad — basta cumplir uno):
```
AntiguedadT1 > PARAM:ANTIGUEDAD
OR AntiguedadT2 > PARAM:ANTIGUEDAD
OR DomiciliaT1 = TRUE
OR DomiciliaT2 = TRUE
```

**Negado** (cuándo rechazar — ninguno se cumple):
```
AntiguedadT1 <= PARAM:ANTIGUEDAD
AND AntiguedadT2 <= PARAM:ANTIGUEDAD
AND DomiciliaT1 = FALSE
AND DomiciliaT2 = FALSE
```

> Al negar una disyunción, todos los términos se colapsan en **un único grupo AND**. El negado es más compacto que la condición original.

```json
"conditions": [
  { "group_id": 0, "field": "stage",         "operator": "EQ",       "value1": "INIT" },
  { "group_id": 0, "field": "AntiguedadT1",  "operator": "LE",       "value1": "PARAM:ANTIGUEDAD", "value_type": "NUMBER" },
  { "group_id": 0, "field": "AntiguedadT2",  "operator": "LE",       "value1": "PARAM:ANTIGUEDAD", "value_type": "NUMBER" },
  { "group_id": 0, "field": "DomiciliaT1",   "operator": "IS_FALSE", "value_type": "BOOL" },
  { "group_id": 0, "field": "DomiciliaT2",   "operator": "IS_FALSE", "value_type": "BOOL" }
]
```

#### Flujo de trabajo recomendado

Al trasladar una condición funcional a reglas:

1. Escribe la condición de elegibilidad en lógica positiva (`A AND B OR C...`).
2. Aplica De Morgan para obtener el negado (condición de rechazo).
3. Expande a DNF si el negado contiene ANDs anidados.
4. Documenta la condición original en el campo `name` de la regla para que el mantenedor pueda rastrearla, por ejemplo: `"INIT Rechazo: edad fuera de límite (neg. de: EdadTx < MAXEDAD por número de intervinientes)"`.

> **Consejo**: si el nombre de la regla no deja claro cuál era la condición positiva de partida, añade un comentario en el campo `name` con el prefijo `neg.:` seguido de la expresión funcional original.

---

## 6. Acciones

### Estructura

```json
{
  "action_id": 1,
  "action_type": "SET",
  "field": "preRejected",
  "value": "true",
  "value_type": "BOOL"
}
```

| Campo | Descripción |
|-------|-------------|
| `action_id` | Identificador de la acción |
| `action_type` | Tipo de operación: `SET`, `ADD`, `APPEND` |
| `field` | Campo del dictamen a modificar |
| `value` | Valor a asignar (literal o `PARAM:<CLAVE>`) |
| `value_type` | Tipo del valor: `NUMBER`, `BOOL`, `STRING`, `JSON` |

### Tipos de acción

| Tipo | Operación | Uso típico |
|------|-----------|-----------|
| `SET` | Asigna el valor al campo (sobreescribe) | Flags de elegibilidad, límites, valores únicos |
| `ADD` | Suma el valor al campo numérico actual (inicia en 0 si no existía) | Puntuación acumulativa |
| `APPEND` | Añade el valor a un array (crea el array si no existía) | `motivos`, listas de notas |

### Restricción: campos exclusivos de FINAL

Los campos `eligible`, `rejected` y `selectedOffer` **solo pueden establecerse en reglas de fase FINAL**. El motor ignora acciones que intenten escribir estos campos en otras fases.

### Ejemplos

**SET — flag de elegibilidad:**
```json
{ "action_type": "SET", "field": "initEligible", "value": "true", "value_type": "BOOL" }
{ "action_type": "SET", "field": "preEligible",  "value": "true", "value_type": "BOOL" }
{ "action_type": "SET", "field": "eligible",     "value": "true", "value_type": "BOOL" }
```

**SET — límite desde parámetro:**
```json
{ "action_type": "SET", "field": "maxHipoteca", "value": "PARAM:MAX_HIPOTECA", "value_type": "NUMBER" }
```

**APPEND — añadir motivo de rechazo:**
```json
{ "action_type": "APPEND", "field": "motivos", "value": "{\"code\":\"EDAD\"}", "value_type": "JSON" }
```

**ADD — puntuación acumulativa:**
```json
{ "action_type": "ADD", "field": "puntuacion", "value": "10", "value_type": "NUMBER" }
```

---

## 7. Parámetros

Los parámetros externalizan valores configurables por oferta. Son de **ámbito de oferta** — no tienen diferenciación por fase: el mismo valor está disponible en INIT, PRE y FINAL para esa oferta.

### Estructura en JSON de configuración

```json
{
  "offerCode": "OFERTA_RESTRICTIVA",
  "paramValues": [
    { "key": "MAX_EDAD",                 "value_type": "NUMBER", "value": "35" },
    { "key": "MIN_HIPOTECA",             "value_type": "NUMBER", "value": "50000" },
    { "key": "MAX_HIPOTECA",             "value_type": "NUMBER", "value": "250000" },
    { "key": "MAX_LTV",                  "value_type": "NUMBER", "value": "0.80" },
    { "key": "REQUIERE_PRIMERA_VIVIENDA","value_type": "BOOL",   "value": "true" },
    { "key": "TIPO_ALTA_ADMITIDAS",      "value_type": "JSON",   "value": "[\"NUEVA\",\"NOVACION\"]" }
  ]
}
```

### Tipos de valor

| Type | Descripción | Ejemplo |
|------|-------------|---------|
| `NUMBER` | Numérico (entero o decimal) | `"0.80"` → 0.8 |
| `STRING` | Texto | `"NUEVA"` |
| `BOOL` | Booleano (`true`/`false`/`1`/`0`/`yes`/`no`) | `"true"` → true |
| `JSON` | Objeto o array JSON serializado | `"[\"A\",\"B\"]"` → `["A","B"]` |

### Acceso en condiciones y acciones

El prefijo `PARAM:` resuelve el parámetro en tiempo de evaluación:

```
PARAM:<CLAVE>   →   paramsIndex[offerCode][CLAVE]
```

Si la clave no existe en el índice, la comparación produce `null` (y la condición falla). Las referencias a parámetros inexistentes se registran en `trace.missingParams`.

### Tabla SQL: `cfg_offer_param`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `param_id` | INT | PK |
| `offer_code` | NVARCHAR(50) | Código de la oferta |
| `param_key` | NVARCHAR(100) | Clave del parámetro |
| `value_type` | NVARCHAR(10) | NUMBER / BOOL / STRING / JSON |
| `value` | NVARCHAR(200) | Valor del parámetro |
| `offer_date_id` | INT | FK a `cfg_offer_dates` (opcional) |
| `enabled` | BIT | Borrado lógico (0 = inactivo) |

> **Nota**: La columna `stage` existió en versiones anteriores pero ya no se utiliza. Los parámetros son de ámbito de oferta y están disponibles en las tres fases.

---

## 8. Flujo de Ejecución

### Campos derivados (`computeDerived`)

Antes de la evaluación FINAL, el motor calcula automáticamente:

| Campo | Fórmula | Descripción |
|-------|---------|-------------|
| `baseGarantia` | `min(importeCompraventa, importeTasacion)` | Base de garantía hipotecaria |
| `ltv` | `importeHipoteca / baseGarantia` (null si baseGarantia = 0) | Loan-to-Value ratio |

Estos campos se añaden al contexto de entrada para las reglas FINAL y pueden usarse directamente en condiciones.

### INIT — `initcheck(inputBase, offers, paramsIndex)`

1. Inyecta `stage: "INIT"` en el contexto de entrada.
2. Evalúa todas las ofertas habilitadas.
3. Las reglas con guarda `stage=INIT` determinan si el cliente es `initEligible`.
4. Retorna `{ eligibleOffers, uiLimits, all }`:
   - `eligibleOffers`: ofertas donde `dictamen.initEligible === true`, ordenadas por `offer_rank` desc. Cada elemento es el objeto completo de oferta evaluada (mismo shape que `all`, filtrado por elegibilidad).
   - `uiLimits`: límites consolidados entre todas las ofertas init-elegibles (mínimo de los mínimos, máximo de los máximos).
   - `all`: resultado completo de todas las ofertas (usado para el log de trazabilidad).

**Si `eligibleOffers` está vacío, el simulador detiene el pipeline** — no se ejecutan PRE ni FINAL.

### PRE — `precheck(inputBase, offers, paramsIndex)`

1. Inyecta `stage: "PRE"` en el contexto.
2. Evalúa todas las ofertas habilitadas (independientemente del resultado INIT).
3. Las reglas `stage=PRE` determinan si el cliente es `preEligible` y establecen límites de la oferta.
4. Retorna `{ eligibleOffers, uiLimits, all }`:
   - `eligibleOffers`: ofertas donde `dictamen.preEligible === true`. Cada elemento es el objeto completo de oferta evaluada (mismo shape que `all`, filtrado por elegibilidad).
   - `uiLimits`: límites consolidados entre todas las ofertas pre-elegibles (mínimo de los mínimos, máximo de los máximos). Si se ejecuta de forma encadaneda se considerarán los límites tando de elegibles por INIT como por PRE
   - `all`: resultado completo para log.

**Si `eligibleOffers` está vacío, el simulador detiene el pipeline** — no se ejecuta FINAL.

### FINAL — `finalize(inputFull, offers, paramsIndex, preResult)`

1. Filtra las ofertas a solo las pre-elegibles del resultado PRE.
2. Calcula `ltv` y `baseGarantia` mediante `computeDerived`.
3. Inyecta `stage: "FINAL"` en el contexto.
4. Evalúa las reglas `stage=FINAL`.
5. Las reglas determinan si la oferta es `eligible` o `rejected`.
6. Si hay múltiples elegibles, gana la de mayor `offer_rank`.
7. Retorna `{ winner, eligibleOffers, uiLimits, all }`:
   - `winner`: la oferta ganadora (o `null` si ninguna es eligible).
   - `eligibleOffers`: ofertas donde `dictamen.eligible === true`. Cada elemento es el objeto completo de oferta evaluada (mismo shape que `all`, filtrado por elegibilidad).
   - `uiLimits`: límites consolidados entre todas las ofertas pre-elegibles (mínimo de los mínimos, máximo de los máximos). Si se ejecuta de forma encadaneda se considerarán los límites tando de elegibles por INIT por PRE y por FINAL
   - `all`: resultado completo para log.
---

## 9. Estructura de Tablas SQL Server

### `dbo.cfg_offer_ruleset` — Ofertas

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `ruleset_id` | INT | PK (FK desde `cfg_offer_rule`) |
| `oferta_id` | INT | ID de referencia externa |
| `offer_rank` | INT | Prioridad de desempate |
| `code` | NVARCHAR(50) | Código único de la oferta |
| `name` | NVARCHAR(200) | Nombre descriptivo |
| `enabled` | BIT | Habilitada |

> Al renombrar el `code` de una oferta, `cfg_offer_param.offer_code` se actualiza en cascada automáticamente (columna de texto, no FK).

### `dbo.cfg_offer_rule` — Reglas

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `rule_id` | INT | PK |
| `ruleset_id` | INT | FK a `cfg_offer_ruleset` |
| `name` | NVARCHAR(200) | Descripción |
| `priority` | INT | Prioridad (mayor = primero) |
| `enabled` | BIT | Habilitada |
| `offer_date_id` | INT | FK a `cfg_offer_dates` (opcional) |
| `stop_processing` | BIT | Detener evaluación al coincidir |

### `dbo.cfg_offer_rule_condition` — Condiciones

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `cond_id` | INT | PK |
| `rule_id` | INT | FK a `cfg_offer_rule` |
| `group_id` | INT | Grupo lógico (AND intra-grupo, OR inter-grupo) |
| `field` | NVARCHAR(100) | Campo o `PARAM:<CLAVE>` |
| `operator` | NVARCHAR(20) | Operador de comparación |
| `value_type` | NVARCHAR(20) | Tipo de valor |
| `value1` | NVARCHAR(200) | Valor principal (literal o `PARAM:<CLAVE>`) |
| `value2` | NVARCHAR(200) | Segundo valor (solo `BETWEEN`) |

### `dbo.cfg_offer_rule_condition_value` — Listas IN/NOT_IN

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `val_id` | INT | PK |
| `cond_id` | INT | FK a `cfg_offer_rule_condition` |
| `val` | NVARCHAR(200) | Valor de la lista |

### `dbo.cfg_offer_rule_action` — Acciones

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `action_id` | INT | PK |
| `rule_id` | INT | FK a `cfg_offer_rule` |
| `action_type` | NVARCHAR(20) | SET / ADD / APPEND |
| `field` | NVARCHAR(100) | Campo destino |
| `value` | NVARCHAR(4000) | Valor (literal o `PARAM:<CLAVE>`) |
| `value_type` | NVARCHAR(20) | Tipo de valor |

### `dbo.cfg_offer_param` — Parámetros

Ver sección 7.

### `dbo.cfg_offer_dates` — Períodos de vigencia

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `offer_date_id` | INT IDENTITY | PK |
| `valid_from` | DATE | Inicio del período |
| `valid_to` | DATE NULL | Fin del período (NULL = sin fecha de vencimiento) |
| `descripcion` | NVARCHAR(200) | Descripción del período |
| `tipo_cd` | NVARCHAR(10) | `REGLAS` / `PARAMS` / `AMBOS` |
| `alta_usr` | NVARCHAR(100) NULL | Usuario que creó el registro |
| `alta_dt` | DATE | Fecha de alta (default: `GETDATE()`) |

> Las reglas y parámetros referencian un período mediante la FK `offer_date_id`. El SP `cfg_get_offers_and_params_json` filtra por fecha de vigencia usando esta tabla.

### `dbo.cfg_config_snapshot` — Snapshots de configuración

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `snapshot_id` | INT IDENTITY | PK |
| `snapshot_name` | NVARCHAR(200) | Nombre auto-generado (`"Grabacion YYYY-MM-DD HH:mm"`) |
| `comment` | NVARCHAR(1000) | Motivo del cambio o descripción auto-generada |
| `created_by` | NVARCHAR(100) | Identificador del usuario (opcional) |
| `created_at` | DATETIME2(0) | Timestamp de creación |
| `rules_json` | NVARCHAR(MAX) | JSON de todas las reglas en el momento del snapshot |
| `params_json` | NVARCHAR(MAX) | JSON de todos los parámetros en el momento del snapshot |

---

## 10. Procedimiento Almacenado

El SP `dbo.cfg_get_offers_and_params_json` genera el JSON de configuración:

```sql
EXEC dbo.cfg_get_offers_and_params_json
  @offer_codes = 'OFERTA_RESTRICTIVA,OFERTA_PERMISIVA',  -- NULL para todas
  @date        = '2026-02-12'
```

Retorna dos columnas:
- `offers_json`: array de ofertas con sus reglas, condiciones y acciones.
- `params_json`: array de parámetros organizados por oferta.

Si el SP no está disponible, el sistema hace fallback a `dbo.cfg_get_rules_json`.

---

## 11. API Admin CRUD

La API REST expuesta en `/api/admin` permite gestionar la configuración sin acceso directo a la base de datos.

### Gestión de ofertas

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/admin/offers` | Listar todas las ofertas |
| POST | `/admin/offers` | Crear oferta |
| PUT | `/admin/offers/:offerCode` | Actualizar oferta (code, name, rank, enabled, oferta_id) |
| DELETE | `/admin/offers/:offerCode` | Eliminar oferta (error 409 si tiene reglas asociadas) |
| PATCH | `/admin/offers/:offerCode/enabled` | Activar/desactivar oferta |

### Gestión de reglas

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/admin/rules` | Listar reglas (paginado; filtros: `offerCode`, `stage`, `q`) |
| POST | `/admin/rules` | Crear regla |
| PUT | `/admin/rules/:ruleId` | Actualizar regla |
| DELETE | `/admin/rules/:ruleId` | Eliminar regla |
| PATCH | `/admin/rules/:ruleId/enabled` | Activar/desactivar regla |
| PATCH | `/admin/rules/reorder` | Reordenar prioridades |

### Gestión de parámetros

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/admin/params` | Listar parámetros (filtros: `offerCode`) |
| POST | `/admin/params` | Crear parámetro |
| PUT | `/admin/params/:paramId` | Actualizar parámetro |
| DELETE | `/admin/params/:paramId` | Borrado lógico (pone `enabled=0`) |

### Validación

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/admin/validate` | Validar un payload de regla sin persistirlo |

---

## 12. Operaciones de Configuración Masiva

### Exportar configuración

`GET /api/admin/export`

Descarga un JSON con el estado completo de reglas y parámetros en la base de datos:

```json
{
  "exportedAt": "2026-03-16T14:30:00.000Z",
  "rules": [ ...],
  "params": [ ...]
}
```

### Importar y grabar configuración

`POST /api/admin/config/apply`

Reemplaza todas las reglas (y opcionalmente los parámetros) en la base de datos. **Antes de aplicar**, crea automáticamente un snapshot del estado previo.

**Payload:**
```json
{
  "rules":     [ ...AdminRuleItem[] ],
  "params":    [ ...AdminParamsItem[] ],  // opcional — si se omite, los params actuales no se tocan
  "comment":   "Motivo del cambio",       // requerido
  "createdBy": "nombre.usuario"           // opcional
}
```

**Respuesta:** incluye `snapshot_id` del snapshot creado antes de aplicar.

### Flujo de trabajo en el configurador (UI)

1. **Exportar** → descarga `config_export_YYYY-MM-DD.json`.
2. **Importar** → abre selector de archivo. El JSON debe tener al menos un array `rules`; `params` es opcional. Tras importar, las tablas muestran los datos importados y un banner amarillo indica "pendiente de grabar".
3. **Grabar** → abre diálogo de confirmación que solicita:
   - **Motivo** (requerido) — se almacena en el snapshot.
   - **Usuario** (opcional).

   Llama a `POST /admin/config/apply` y crea el snapshot previo de forma automática.

---

## 13. Sistema de Snapshots

Cada operación destructiva sobre la configuración crea automáticamente un snapshot del estado anterior:

| Operación | Snapshot automático |
|-----------|---------------------|
| Grabar configuración importada | `"Grabacion YYYY-MM-DD HH:mm"` con el motivo indicado |
| Restaurar un snapshot | `"Auto: antes de restaurar snapshot #N (…)"` |

### API de snapshots

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/admin/snapshots` | Listar snapshots (paginado; filtros: `dateFrom`, `dateTo`, `q`) |
| POST | `/admin/snapshots/:snapshotId/restore` | Restaurar snapshot (crea snapshot de seguridad previo) |

### Página de snapshots (UI)

- Tabla con: ID · Fecha/hora · Nombre · Usuario · Motivo · Botón restaurar.
- Búsqueda por rango de fechas y texto libre (nombre, usuario, motivo).
- Restaurar abre diálogo de confirmación; al confirmar, las reglas y parámetros del snapshot reemplazan la configuración activa en la base de datos.

---

## 14. Ejemplos Completos

### Regla INIT — filtro de tipo de alta

```json
{
  "rule_id": 20,
  "name": "INIT Rechazo: tipoAlta no admitido",
  "priority": 1000,
  "stop_processing": false,
  "conditions": [
    { "cond_id": 40, "group_id": 0, "field": "stage",    "operator": "EQ",      "value_type": "STRING", "value1": "INIT" },
    { "cond_id": 41, "group_id": 0, "field": "tipoAlta", "operator": "NOT_IN",   "value_type": "STRING", "value1": "PARAM:TIPO_ALTA_ADMITIDAS" }
  ],
  "actions": [
    { "action_id": 50, "action_type": "SET",    "field": "initRejected", "value": "true",              "value_type": "BOOL" },
    { "action_id": 51, "action_type": "APPEND", "field": "motivos",      "value": "{\"code\":\"TIPO_ALTA\"}", "value_type": "JSON" }
  ]
}
```

```json
{
  "rule_id": 21,
  "name": "INIT Decisión: initEligible",
  "priority": 10,
  "stop_processing": true,
  "conditions": [
    { "cond_id": 42, "group_id": 0, "field": "stage",       "operator": "EQ",      "value_type": "STRING", "value1": "INIT" },
    { "cond_id": 43, "group_id": 0, "field": "initRejected","operator": "IS_FALSE", "value_type": "BOOL"   }
  ],
  "actions": [
    { "action_id": 52, "action_type": "SET", "field": "initEligible", "value": "true", "value_type": "BOOL" }
  ]
}
```

### Regla PRE — rechazo por edad

```json
{
  "rule_id": 3,
  "name": "PRE Rechazo: EdadMax > MAX_EDAD",
  "priority": 950,
  "stop_processing": false,
  "conditions": [
    { "cond_id": 6, "group_id": 0, "field": "stage",  "operator": "EQ", "value_type": "STRING", "value1": "PRE" },
    { "cond_id": 7, "group_id": 0, "field": "edadMax","operator": "GT", "value_type": "NUMBER", "value1": "PARAM:MAX_EDAD" }
  ],
  "actions": [
    { "action_id": 5, "action_type": "SET",    "field": "preRejected", "value": "true",           "value_type": "BOOL" },
    { "action_id": 6, "action_type": "APPEND", "field": "motivos",     "value": "{\"code\":\"EDAD\"}", "value_type": "JSON" }
  ]
}
```

### Regla FINAL — validación LTV

```json
{
  "rule_id": 7,
  "name": "FINAL Rechazo: LTV > MAX_LTV",
  "priority": 1000,
  "stop_processing": false,
  "conditions": [
    { "cond_id": 16, "group_id": 0, "field": "stage", "operator": "EQ", "value_type": "STRING", "value1": "FINAL" },
    { "cond_id": 17, "group_id": 0, "field": "ltv",   "operator": "GT", "value_type": "NUMBER", "value1": "PARAM:MAX_LTV" }
  ],
  "actions": [
    { "action_id": 19, "action_type": "SET",    "field": "rejected", "value": "true",          "value_type": "BOOL" },
    { "action_id": 20, "action_type": "APPEND", "field": "motivos",  "value": "{\"code\":\"LTV\"}", "value_type": "JSON" }
  ]
}
```

---

## 15. Navegación Angular (Simulador y Configurador)

| Ruta | Componente | Descripción |
|------|-----------|-------------|
| `/simulador-init` | InitSimulatorPageComponent | Formulario de simulación INIT |
| `/simulador-pre` | PreSimulatorPageComponent | Formulario de simulación PRE (incluye log INIT) |
| `/simulador-final` | FinalSimulatorPageComponent | Formulario de simulación FINAL (incluye log INIT + PRE) |
| `/configurador` | ConfiguratorPageComponent | CRUD de ofertas, reglas y parámetros; exportar/importar/grabar |
| `/configuracion` | ConfigPageComponent | Vista de solo lectura de la configuración activa |
| `/snapshots` | SnapshotsPageComponent | Historial de snapshots y restauración |
