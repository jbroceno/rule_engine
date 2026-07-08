---
change: simulator-corrections
type: design
date: 2026-05-26
---

# Diseño técnico: simulator-corrections

## Resumen

Este documento captura las decisiones de arquitectura asociadas a las correcciones del simulador. Todas son decisiones tipo ADR (Architecture Decision Record) con su contexto, alternativas evaluadas y justificación.

---

## ADR-001 — `primeraViviendaHabitual` como `NUMBER` (0/1), no `BOOLEAN`

### Contexto

El motor de reglas (`rule_engine.js`) expresa sus condiciones con `value_type` y operadores tipados (`EQ`, `NE`, `LT`, etc.). El tipo `BOOLEAN` existe pero su uso es marginal: la mayoría de campos numéricos discretos (banderas 0/1, finalidades, productos) ya se modelan como `NUMBER`. La condición R4 ya histórica del seed comparaba `finalidad NE 15` con `value_type: NUMBER`.

### Decisión

`primeraViviendaHabitual` se modela como `NUMBER` con dominio `{0, 1}`. La regla de rechazo se expresa como:

```json
{
  "field": "primeraViviendaHabitual",
  "operator": "EQ",
  "value1": 0,
  "value_type": "NUMBER"
}
```

### Alternativas rechazadas

- **BOOLEAN puro**: obligaría a introducir un operador específico (`IS_FALSE`) o a duplicar conversiones en el adaptador. El motor ya tolera `NUMBER 0/1` y los tests cubren ese caso.
- **String `"SI"/"NO"`**: legible pero rompe la homogeneidad con el resto de flags numéricos y obliga a normalizar en el motor.

### Consecuencias

- El adaptador del workflow convierte el booleano del payload externo a número antes de entregar el input al motor:
  ```js
  primeraViviendaHabitual: body.primeraViviendaHabitualFl ? 1 : 0
  ```
- El servicio de comparación (`wf_compare_service.js`) hace el camino inverso al construir el payload comparable con el sistema existente:
  ```js
  tienecasaFl: input.primeraViviendaHabitual ? 0 : 1
  ```
  (la semántica de `tienecasaFl` es la inversa de `primeraViviendaHabitual`).

---

## ADR-002 — Normalización de ingresos por pagas en el frontend, no en el backend

### Contexto

Los ingresos brutos mensuales del solicitante dependen del número de pagas anuales de su contrato (12, 14, 15…). El motor compara ingresos contra umbrales declarados en parámetros, asumiendo una base de 14 pagas. Hay dos lugares posibles donde aplicar la normalización:

- **Frontend (`submit()` del simulador)**: el formulario hace la conversión y envía al motor un valor ya normalizado.
- **Backend (servicio o adaptador)**: el motor o un middleware reciben ingresos + pagas y normalizan antes de evaluar.

### Decisión

La normalización vive en el frontend. El contrato del endpoint `POST /simulate/*` sigue recibiendo `ingresosT1` e `ingresosT2` como números ya normalizados a 14 pagas. El número de pagas es metadato local del formulario, no se envía al motor.

### Alternativas rechazadas

- **Normalizar en el backend**: requeriría ampliar el contrato del API y propagar `pagasT1/T2` por toda la cadena (adaptador, motor, comparador). Aumenta superficie de cambio sin beneficio, dado que el motor ya razona en base "ingreso normalizado".
- **Pasar ingresos brutos + pagas y normalizar dentro del motor**: rompe la separación "el motor no hace I/O ni conversiones de unidades". `rule_engine.js` se mantiene puro.

### Consecuencias

- El backend y el motor no cambian su contrato.
- Cualquier cliente que llame al endpoint directamente (sin pasar por el formulario) debe enviar ingresos ya normalizados. Esto queda documentado en `offers-settings.md`.
- El campo "Num. pagas" del formulario incluye un hint `× pagas / 14 al enviar` para que el operador entienda la conversión.

---

## ADR-003 — INIT no expone Titular 2

### Contexto

La fase INIT del pipeline `INIT → PRE → FINAL` es la pre-cualificación inicial. Funcionalmente, sólo evalúa al solicitante principal (edad, antigüedad laboral, ingresos básicos, primera vivienda habitual). Los datos del cotitular se piden recién en PRE/FINAL cuando ya se han descartado las ofertas obviamente incompatibles.

El formulario INIT venía exponiendo selector de "número de titulares" y fieldset Titular 2, lo cual:

1. Confundía al operador: los campos T2 no influyen en el dictamen INIT.
2. Permitía introducir datos contradictorios entre INIT y PRE para el mismo expediente.

### Decisión

El formulario INIT no muestra controles para Titular 2. `submit()` hardcodea:

```ts
numTitulares: 1,
edadT2: 0,
ingresosT2: 0,
antiguedadLaboralT2: 0,
domiciliaT2: false,
// resto de campos T2 con valores neutros
```

### Alternativas rechazadas

- **Mantener T2 oculto pero editable vía flag**: complica el formulario sin aportar valor — un operador que necesita evaluar dos titulares ya pasa por PRE/FINAL.
- **Eliminar `numTitulares` y campos T2 del DTO del endpoint**: rompería compatibilidad con PRE/FINAL que comparten el shape del DTO. Mejor mantener el DTO único y rellenar con valores neutros.

### Consecuencias

- El simulador INIT es más simple y refleja exactamente lo que el motor evalúa en esa fase.
- Cualquier campo T2 que el motor INIT consultase quedaría con 0/false; las reglas INIT actuales no leen campos T2.

---

## ADR-004 — Inversión De Morgan de la regla de primera vivienda

### Contexto

El motor de reglas usa el **patrón de inversión**: las reglas detectan rechazos, no elegibilidades. El requisito funcional positivo es:

> "El solicitante es elegible si la vivienda es su primera vivienda habitual."

Formalmente: `eligible ⇐ primeraViviendaHabitual = 1`.

### Decisión

Aplicar De Morgan para expresar la regla como detección de rechazo:

```
elegible      ⇐ primeraViviendaHabitual = 1
rechazado     ⇐ NOT (primeraViviendaHabitual = 1)
              ⇐ primeraViviendaHabitual ≠ 1
              ⇐ primeraViviendaHabitual = 0      (dominio = {0, 1})
```

La regla resultante:

```json
{
  "name": "INIT Rechazo: No es primera vivienda habitual",
  "stage": "INIT",
  "stop_processing": false,
  "conditions": [
    { "field": "primeraViviendaHabitual", "operator": "EQ", "value1": 0, "value_type": "NUMBER" }
  ],
  "actions": [
    { "op": "SET", "target": "dictamen.preRejected", "value": true },
    { "op": "APPEND", "target": "dictamen.motivos", "value": "NO_PRIMERA_VIVIENDA" }
  ]
}
```

### Alternativas rechazadas

- **`operator: NE, value1: 1`**: equivalente lógicamente, pero el dominio `{0,1}` es totalmente cerrado y la comparación directa `EQ 0` es más legible.
- **Mantener la lógica positiva con un operador `SET_ELIGIBLE`**: rompería la convención del motor (las reglas no afirman elegibilidad, sólo la pueden quitar).

### Consecuencias

- El nombre de la regla documenta explícitamente el requisito positivo subyacente (`No es primera vivienda habitual`), siguiendo la convención de prefijos `neg.:` ya descrita en `CONFIGURACION_REGLAS.md`.
- El motivo `NO_PRIMERA_VIVIENDA` queda como motivo único para este rechazo, sin solapamiento con otras causas.

---

## ADR-005 — Orden de DELETE en el seed SQL

### Contexto

`seed_offers.sql` ejecuta una limpieza completa antes de re-sembrar datos. Las FK entre tablas son:

- `cfg_offer_rule.ruleset_id` → `cfg_offer_ruleset.ruleset_id`
- `cfg_offer_param.offer_code` → `cfg_offer_ruleset.code` (lógica) y referencias por `offer_dates_id`
- `cfg_offer_rule.offer_dates_id` → `cfg_offer_dates.offer_dates_id`
- `cfg_offer_param.offer_dates_id` → `cfg_offer_dates.offer_dates_id`
- `cfg_offer_rule_condition.rule_id` → `cfg_offer_rule.rule_id`
- `cfg_offer_rule_condition_value.condition_id` → `cfg_offer_rule_condition.condition_id`
- `cfg_offer_rule_action.rule_id` → `cfg_offer_rule.rule_id`

El orden anterior intentaba borrar `cfg_offer_dates` antes que `cfg_offer_rule` y `cfg_offer_param`, fallando por FK.

### Decisión

Orden correcto de DELETE (de hijas a padres):

```
1. cfg_offer_rule_condition_value
2. cfg_offer_rule_condition
3. cfg_offer_rule_action
4. cfg_offer_rule
5. cfg_offer_param
6. cfg_offer_dates
7. cfg_offer_ruleset
```

### Alternativas rechazadas

- **Deshabilitar FK temporalmente con `ALTER TABLE … NOCHECK CONSTRAINT ALL`**: oculta el bug en lugar de arreglarlo y deja la BD en estado inseguro si el script falla a mitad.
- **`DELETE` con `ON DELETE CASCADE`**: requeriría rediseño del esquema; no es objetivo de este cambio.

### Consecuencias

- El seed es idempotente y re-ejecutable.
- Si en el futuro se añaden nuevas tablas con FK a `cfg_offer_dates` o `cfg_offer_ruleset`, deben insertarse en el orden de DELETE antes de las padres.

---

## Resumen de boundaries

| Componente | Responsabilidad | Cambia en este SDD |
|------------|----------------|--------------------|
| `rule_engine.js` | Evaluar reglas. Puro, sin I/O. | No |
| `rules.json` / `seed_offers.sql` | Datos de configuración (reglas + parámetros) | Sí (renombrados de campo, condición R4, TIPO_ALTA_ADMITIDAS, orden DELETE) |
| `api/services/workflow_adapter.js` | Mapear payload externo → input del motor | Sí (mapeo `primeraViviendaHabitual`) |
| `api/services/wf_compare_service.js` | Construir payload comparable con sistema legado | Sí (inversión `tienecasaFl`) |
| `web/.../init-simulator-page.component.*` | Formulario INIT | Sí (quita T2, defaults nuevos, checkbox renombrado) |
| `web/.../pre-simulator-page.component.*` | Formulario PRE | Sí (campos `pagasT1/T2`, normalización en `submit()`) |
| `web/.../final-simulator-page.component.*` | Formulario FINAL | Sí (campos `pagasT1/T2`, normalización en `submit()`) |
| `web/.../models/api.models.ts` | Tipos compartidos frontend | Sí (campo renombrado) |
| `tests/*` | Unit + scenarios | Sí (fixtures con nuevo nombre) |
| `docs/offers-settings.md` | Documentación funcional | Sí (condición R4 actualizada) |

## Riesgos arquitectónicos

- **Acoplamiento frontend ↔ motor sobre normalización de ingresos**: el conocimiento "ingresos en base 14 pagas" vive en el frontend. Si en el futuro otro cliente consume el endpoint sin pasar por el formulario, deberá implementar la misma normalización. Mitigación: documentado explícitamente en `offers-settings.md`.
- **Doble mapeo `primeraViviendaHabitual` ↔ `tienecasaFl`**: el servicio de comparación invierte la semántica para alinearse con el sistema legado. Hay riesgo de confusión a futuro. Mitigación: comentario inline en `wf_compare_service.js` que documenta la inversión.
