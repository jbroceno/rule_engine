# Propuesta: `configurable-ui-limits`

> **Estado**: Propuesta para evaluación futura. **No implementar ahora.**
> El alcance toca la aplicación **WF (Workflow)**, que queda fuera del alcance actual.

---

## 1. Intención

Hacer que el conjunto de campos que el motor de reglas expone como `uiLimits` (límites consolidados que la UI muestra al usuario) sea **declarativo y configurable desde la propia acción** de la regla, en lugar de estar fijado en código.

Hoy, agregar un nuevo límite a la UI (por ejemplo `minImporteVivienda` o un nuevo ratio) obliga a tocar `rule_engine.js`, recompilar y desplegar. Queremos que un administrador funcional pueda introducir un nuevo límite creando únicamente la **acción de regla** correspondiente, sin cambios de código.

---

## 2. Alcance

### En alcance (cuando se ejecute la implementación)

- Extender el esquema de **acciones de regla** (`cfg_offer_rule_action`) con un campo opcional `aggregate`.
- Modificar `aggregateUiLimits` en `rule_engine.js` para que descubra dinámicamente qué campos del `dictamen` deben publicarse en `uiLimits` y bajo qué modo de agregación.
- Actualizar el validador (`validateConfigShape` en `rule_engine.js`) para aceptar y validar el nuevo campo.
- Actualizar el **configurador** (`rule_set/web/`) para exponer el nuevo campo en el formulario de acciones.
- Limpieza menor: eliminar el array `LIMIT_FIELDS` de `rule_engine.js` (líneas 659-664), que está declarado pero no es referenciado en ningún punto del repo.

### **Fuera de alcance — bloqueo explícito**

- **Aplicación WF (Workflow)**: el adaptador y los formularios de la app de Workflow tendrían que soportar el nuevo campo `aggregate` en el ciclo de publicación POC→WF y WF→POC. Esta aplicación **no se toca en el alcance actual**, y es la razón por la cual esta propuesta queda diferida.
- No se modifica el conjunto de stages (`INIT` | `PRE` | `FINAL`).
- No se modifica la semántica de `eligibleOffers`, `winner`, ni el patrón de inversión de reglas.

### Supuestos

- Los `uiLimits` los seguirá consumiendo únicamente la UI; ningún componente del motor (matching, scoring, finalize) toma decisiones sobre `uiLimits`.
- La agregación sigue siendo numérica (`Math.min` / `Math.max`). No se prevé soportar agregaciones no numéricas en esta propuesta (sería un cambio mayor aparte).

---

## 3. Motivación

### Problema actual

En `rule_engine.js` (líneas 657-658) los campos publicables en `uiLimits` están hardcodeados:

```javascript
const UI_LIMITS_MIN = ["minHipoteca", "minPlazo", "minPlazoMeses", "minLtvExclusive", "minLtvRatio"];
const UI_LIMITS_MAX = ["maxHipoteca", "maxPlazo", "maxPlazoMeses", "maxLtv", "maxLtvRatio", "edadPlazo"];
```

Para cada campo de `UI_LIMITS_MIN`, `aggregateUiLimits` toma `Math.min(...)` entre todas las ofertas elegibles; para `UI_LIMITS_MAX`, `Math.max(...)`. Sólo se consideran valores numéricos. El resultado se retorna como `uiLimits` desde `initcheck`, `precheck` y `finalize`.

Los valores en sí provienen de **acciones** de regla (`SET` / `ADD` / `APPEND` con `field`, `value` o `value: "PARAM:KEY"`). Las acciones pueden escribir cualquier campo en `dictamen`, pero **sólo los presentes en esos dos arrays aparecen en `uiLimits`**.

### Por qué importa

1. **Extensibilidad cerrada**: agregar un nuevo límite a la UI requiere PR, revisión, deploy del motor.
2. **Acoplamiento entre acción y publicación**: hoy "qué se publica como límite" vive lejos de "qué acción lo setea". El administrador funcional ve la acción pero no puede ver/cambiar si ese campo va a aparecer en `uiLimits`.
3. **Riesgo de drift**: el array `LIMIT_FIELDS` (líneas 659-664) ya está declarado pero no se usa en ningún lado — evidencia de que el patrón actual es frágil y propenso a quedar desincronizado.

---

## 4. Enfoque propuesto — Opción A: agregación declarada en la acción

Extender el esquema de **acción de regla** con un campo opcional `aggregate`:

```json
{
  "action_type": "SET",
  "field": "minHipoteca",
  "value": "PARAM:MIN_HIPOTECA",
  "value_type": "NUMBER",
  "aggregate": "MIN"
}
```

### Valores permitidos

| Valor    | Significado                                                                 |
|----------|-----------------------------------------------------------------------------|
| `MIN`    | El campo se publica en `uiLimits` tomando el mínimo entre ofertas elegibles |
| `MAX`    | El campo se publica en `uiLimits` tomando el máximo entre ofertas elegibles |
| `NONE`   | (Default) El campo se escribe en `dictamen` pero **no se publica** en `uiLimits` |

### Cambio en `aggregateUiLimits`

`aggregateUiLimits` deja de leer los arrays hardcodeados `UI_LIMITS_MIN` / `UI_LIMITS_MAX`. En su lugar:

1. Recorre los `dictamen` de las ofertas elegibles.
2. Para cada campo del dictamen, mira el modo de agregación declarado por la acción que lo seteó (metadato propagado desde la config).
3. Aplica `Math.min` o `Math.max` según corresponda. Ignora `NONE` y campos no numéricos.

### Beneficio neto

- **Agregar un nuevo `uiLimit` = crear una acción** con `aggregate: "MIN" | "MAX"`. Cero cambios de código en el motor.
- La metadata de "cómo se publica" viaja junto con la acción que lo produce: una única fuente de verdad.
- Patrón consistente con el resto de campos opcionales de acción (`value_type`, etc.).

---

## 5. Alternativas consideradas

### Opción B (descartada) — Tabla global de configuración de límites

Crear una tabla nueva (por ejemplo `cfg_ui_limit_field`) con filas `{ field_name, aggregation_mode }` y que `aggregateUiLimits` la consulte.

**Por qué se prefiere A sobre B**:

- En B, la acción que setea el valor y la regla de publicación quedan en tablas distintas → más riesgo de drift, más superficie de UI para mantener (otro CRUD).
- En A, acción y modo de agregación viajan juntas, lo que es **consistente con el patrón existente**: las acciones ya cargan toda la metadata de qué hacen y cómo (tipo, valor, parámetro). Sumar `aggregate` es una extensión natural del mismo esquema.
- En A, el administrador funcional configura todo en una sola pantalla (formulario de acción) sin saltar entre módulos.

### Opción C (descartada) — Mantener el estado actual y documentar

Dejar los arrays hardcodeados y simplemente documentar que agregar un límite requiere PR al motor.

**Por qué se descarta**: el cambio operativo se repite con frecuencia suficiente como para justificar la inversión inicial. Además, no resuelve el problema del `LIMIT_FIELDS` huérfano, que indica deuda técnica latente en esta zona.

---

## 6. Preguntas abiertas (para resolver en fase de diseño)

### Q1 — Colisión de agregación en el mismo campo

Si dos acciones distintas (en reglas distintas, o incluso en la misma) setean el mismo campo del `dictamen` con valores **distintos** de `aggregate`, ¿cuál gana?

Opciones a evaluar en `sdd-design`:

- **Last-action wins**: la última acción ejecutada (en orden de prioridad y rule_id) define el `aggregate` final. Coherente con la semántica actual de "la última acción gana en el `dictamen`".
- **Strict validation**: `validateConfigShape` rechaza la config si detecta dos acciones con el mismo `field` y `aggregate` distintos (excluyendo `NONE`). Más seguro, pero más rígido en migración.
- **First-action wins**: la primera acción que tocó el campo congela el modo. Predecible pero contraintuitivo respecto al patrón actual.

Esta decisión hay que tomarla **antes** de implementar; afecta tanto al motor como al validador y al UX del configurador.

### Q2 — Compatibilidad hacia atrás

Durante la transición, ¿el motor debe seguir respetando los arrays `UI_LIMITS_MIN` / `UI_LIMITS_MAX` como fallback si una acción no declara `aggregate`? Esto permitiría migrar gradualmente, pero deja dos rutas activas a la vez. A definir en diseño.

### Q3 — Visibilidad en el `trace`

¿El `trace` de ejecución debería incluir el modo de agregación efectivo por campo, para facilitar debugging cuando un `uiLimit` no aparece como se espera?

---

## 7. Riesgos y dependencias

| Riesgo / Dependencia                          | Impacto | Notas |
|-----------------------------------------------|---------|-------|
| **Acoplamiento con WF**                       | Alto    | Bloquea la implementación en este ciclo. WF debe entender el nuevo campo `aggregate` en el flujo de publicación POC↔WF, snapshots, exports. |
| **Migración de esquema SQL**                  | Medio   | Añadir columna `aggregate` a `cfg_offer_rule_action` y propagarla en SP/JSON loaders (`cfg_get_offers_and_params_json`, `cfg_get_rules_json`, `cfg_get_workflow_snapshot_json`). |
| **Validador + tests**                         | Medio   | `validateConfigShape` debe rechazar valores no permitidos. Suite de tests existente (`test/rule_engine.test.js`) debe ampliarse. |
| **UI del configurador**                       | Medio   | Formulario de acciones (`rule_set/web/`) suma un campo nuevo. Mínimo, pero requiere validación cliente y server. |
| **Snapshots existentes**                      | Bajo    | Los snapshots ya creados no tienen el campo; el restore debe asumir `aggregate: NONE` (o mantener el fallback hardcodeado durante un periodo de gracia). |
| **Drift con `LIMIT_FIELDS` muerto**           | Bajo    | Aprovechar la implementación para borrar el array no usado. |

---

## 8. Nota para evaluación futura

**No implementar ahora.**

La razón principal es que el cambio toca la aplicación **WF (Workflow)** — su adaptador, sus formularios y su contrato de publicación/restore — y WF queda explícitamente fuera del alcance actual del equipo. Implementarlo sólo en POC dejaría un esquema inconsistente entre ambos entornos y rompería el ciclo POC↔WF que hoy ya es delicado (ver `dbo.cfg_get_workflow_snapshot_json`, tipado `DATE`, deduplicación de params por vigencia).

Cuando se decida retomar:

1. Resolver primero **Q1** (política de colisión) en `sdd-design`.
2. Coordinar con el equipo de WF para alinear el cambio de contrato.
3. Definir estrategia de migración: ¿big-bang o fallback temporal a los arrays hardcodeados?
4. Recién entonces avanzar a `sdd-spec` y `sdd-tasks`.

Mantener esta propuesta como **referencia de evaluación futura**.
