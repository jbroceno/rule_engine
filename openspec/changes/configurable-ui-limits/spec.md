# Spec: `configurable-ui-limits`

> **Estado**: Spec de planificación futura. Implementación diferida por dependencia con la aplicación WF.

---

## Resumen

Este cambio hace declarativo el conjunto de campos que el motor de reglas publica en `uiLimits`. Hoy esos campos están hardcodeados en dos arrays (`UI_LIMITS_MIN`, `UI_LIMITS_MAX`) dentro de `rule_engine.js`; la propuesta los elimina y permite que cada acción de regla declare, mediante un campo opcional `aggregate`, si su campo debe publicarse y bajo qué política de agregación (`MIN` | `MAX` | `NONE`). El resultado es que agregar un nuevo límite a la UI no requiere cambios en el motor — basta con configurar la acción correctamente.

---

## Requisitos funcionales (FR)

**FR-001**: El sistema DEBERÁ extender el esquema de acción de regla con un campo opcional `aggregate` que acepte exactamente los valores `"MIN"`, `"MAX"` o `"NONE"`. La ausencia del campo DEBERÁ tratarse como `"NONE"`.

**FR-002**: El validador `validateConfigShape` DEBERÁ rechazar con un error descriptivo cualquier acción cuyo campo `aggregate` contenga un valor distinto de `"MIN"`, `"MAX"`, `"NONE"` o `null`/`undefined`.

**FR-003**: El validador DEBERÁ emitir una advertencia (no un error bloqueante) cuando una acción declara `aggregate: "MIN"` o `aggregate: "MAX"` y su `value_type` no es `"NUMBER"`. Sólo valores numéricos tienen sentido semántico en la agregación.

**FR-004**: La función `aggregateUiLimits` DEBERÁ descubrir dinámicamente qué campos publicar en `uiLimits` leyendo el metadato `aggregate` propagado desde la configuración de las acciones, en lugar de consultar los arrays hardcodeados `UI_LIMITS_MIN` y `UI_LIMITS_MAX`.

**FR-005**: Para un campo con `aggregate: "MIN"`, el sistema DEBERÁ calcular `Math.min(...)` sobre los valores numéricos de ese campo en los `dictamen` de las ofertas elegibles y publicar el resultado en `uiLimits`. Valores no numéricos DEBERÁN ignorarse silenciosamente.

**FR-006**: Para un campo con `aggregate: "MAX"`, el sistema DEBERÁ aplicar `Math.max(...)` con la misma semántica que FR-005.

**FR-007**: Un campo con `aggregate: "NONE"` (o sin `aggregate`) NO DEBERÁ aparecer en `uiLimits`, aunque exista en el `dictamen` de las ofertas elegibles.

**FR-008**: Los arrays `UI_LIMITS_MIN`, `UI_LIMITS_MAX` y `LIMIT_FIELDS` de `rule_engine.js` (líneas 657-664) DEBERÁN eliminarse. `LIMIT_FIELDS` está declarado pero no es referenciado en ningún punto del repositorio y constituye deuda técnica activa.

**FR-009**: La columna `aggregate` DEBERÁ persistirse en la tabla `cfg_offer_rule_action` y propagarse íntegramente en los stored procedures de carga de configuración (`cfg_get_offers_and_params_json`, `cfg_get_rules_json`, `cfg_get_workflow_snapshot_json`) y en las operaciones de export, snapshot y restore.

**FR-010**: El formulario de acciones del configurador Angular (`rule_set/web/`) DEBERÁ exponer el campo `aggregate` como un selector con las opciones `MIN`, `MAX` y `NONE` (o vacío como equivalente a `NONE`), con validación en cliente y en servidor.

**FR-011** _(alcance diferido — WF)_: El adaptador de la aplicación WF DEBERÁ propagar el campo `aggregate` en el ciclo de publicación POC↔WF. Este requisito existe como contrato pero su implementación queda bloqueada hasta que WF entre en alcance.

---

## Reglas de negocio (BR)

**BR-001**: Sólo valores cuyo `typeof === "number"` participan en la agregación `MIN`/`MAX`. Strings, booleanos, nulos y valores ausentes se ignoran sin lanzar error.

**BR-002 (PENDIENTE — resolver en diseño)**: La política de colisión cuando dos acciones distintas setean el mismo campo del `dictamen` con valores de `aggregate` diferentes (p.ej. una con `MIN` y otra con `MAX`) queda **sin definir en este spec**. Es una pregunta abierta que DEBE resolverse en `sdd-design` antes de implementar. Ver Q1 en la propuesta.

**BR-003**: Al restaurar un snapshot que no incluye el campo `aggregate` (snapshots creados antes de la migración), el sistema DEBERÁ asumir `aggregate: null` (equivalente a `NONE`) para todas las acciones del snapshot. La política de fallback temporal a los arrays hardcodeados es una alternativa de compatibilidad que DEBE evaluarse en diseño (ver Q2).

---

## Escenarios / Casos de uso

### Escenario A — Campo con `aggregate: "MIN"` aparece en `uiLimits`

- **Dado** que existe una acción con `field: "minHipoteca"`, `value_type: "NUMBER"` y `aggregate: "MIN"`
- **Cuando** `aggregateUiLimits` procesa las ofertas elegibles
- **Entonces** `uiLimits.minHipoteca` contiene el mínimo numérico del campo `dictamen.minHipoteca` entre todas las ofertas elegibles
- **Y** el campo no aparece duplicado ni en otra clave de `uiLimits`

### Escenario B — Campo con `aggregate: "MAX"` aparece en `uiLimits`

- **Dado** que existe una acción con `field: "maxHipoteca"`, `value_type: "NUMBER"` y `aggregate: "MAX"`
- **Cuando** `aggregateUiLimits` procesa las ofertas elegibles
- **Entonces** `uiLimits.maxHipoteca` contiene el máximo numérico del campo entre las ofertas elegibles

### Escenario C — Campo sin `aggregate` (o `NONE`) NO aparece en `uiLimits`

- **Dado** que existe una acción con `field: "requierePrimeraVivienda"` y `aggregate` ausente (o `"NONE"`)
- **Cuando** `aggregateUiLimits` procesa las ofertas
- **Entonces** `uiLimits` no contiene la clave `requierePrimeraVivienda`
- **Y** el campo sigue existiendo normalmente en `dictamen`

### Escenario D — Nuevo campo se publica sin cambios de código

- **Dado** que un administrador crea una acción nueva con `field: "minImporteVivienda"`, `value_type: "NUMBER"` y `aggregate: "MIN"` sin modificar `rule_engine.js`
- **Cuando** se ejecuta `initcheck` / `precheck` / `finalize`
- **Entonces** `uiLimits.minImporteVivienda` aparece con el mínimo calculado entre las ofertas elegibles

### Escenario E — Valor no numérico en campo con `aggregate: "MIN"` se ignora

- **Dado** que una oferta tiene `dictamen.minHipoteca = "N/A"` (string) y otra tiene `dictamen.minHipoteca = 50000` (número)
- **Cuando** `aggregateUiLimits` agrega el campo con política `MIN`
- **Entonces** `uiLimits.minHipoteca === 50000` (sólo el valor numérico participa)
- **Y** no se lanza ningún error ni excepción

### Escenario F — Validador rechaza valor inválido en `aggregate`

- **Dado** que una acción contiene `aggregate: "FOO"`
- **Cuando** se invoca `validateConfigShape` con esa configuración
- **Entonces** la validación falla con un error que identifica claramente el campo afectado y los valores permitidos (`MIN`, `MAX`, `NONE`)
- **Y** el motor no procesa la configuración inválida

---

## Requisitos de información (datos)

### Columna nueva en `cfg_offer_rule_action`

| Columna | Tipo | Nulable | Default | Valores válidos | Notas |
|---------|------|---------|---------|-----------------|-------|
| `aggregate` | `VARCHAR(8)` | Sí (`NULL`) | `NULL` | `'MIN'`, `'MAX'`, `'NONE'` | `NULL` equivale a `'NONE'` en tiempo de ejecución |

### Propagación en stored procedures

| SP / operación | Acción requerida |
|----------------|-----------------|
| `cfg_get_offers_and_params_json` | Incluir columna `aggregate` en el JSON de acciones |
| `cfg_get_rules_json` | Ídem |
| `cfg_get_workflow_snapshot_json` | Ídem |
| Export JSON (`GET /admin/export`) | Incluir `aggregate` en cada item de acción |
| Snapshot (`cfg_config_snapshot.rules_json`) | El JSON serializado incluye `aggregate` |
| Restore (apply desde snapshot) | Leer y persistir `aggregate`; asumir `null` si ausente |

---

## Criterios de aceptación

| ID | Área | Descripción | Condiciones | Resultado esperado |
|----|------|-------------|-------------|--------------------|
| AC-001 | Motor | Agregación dinámica `MIN` | Una acción declara `aggregate: "MIN"` para el campo `minPlazo` | `uiLimits.minPlazo` contiene el mínimo entre ofertas elegibles; los arrays hardcodeados no existen en el código |
| AC-002 | Motor | Campo `NONE` excluido de `uiLimits` | Una acción no declara `aggregate` (o lo declara `"NONE"`) | El campo correspondiente no aparece en `uiLimits`; sí aparece en `dictamen` |
| AC-003 | Validador | Rechazo de valor inválido | Payload de acción con `aggregate: "INVALID"` enviado a `POST /admin/validate` | Respuesta con error 400 identificando el campo y los valores permitidos |
| AC-004 | Persistencia | Columna `aggregate` round-trip | Se crea una acción con `aggregate: "MAX"`, se exporta y se re-importa | El valor `"MAX"` está presente en el JSON exportado y se restaura correctamente en DB |
| AC-005 | Snapshot / Restore | Compatibilidad hacia atrás | Se restaura un snapshot antiguo (sin campo `aggregate`) | Todas las acciones del snapshot se restauran con `aggregate: null`; el motor las trata como `NONE`; no se lanza error |
| AC-006 | UI Configurador | Campo visible en formulario | El usuario abre el formulario de edición de una acción en el configurador Angular | El selector `aggregate` muestra las opciones `MIN`, `MAX`, `NONE`; el valor guardado persiste en BD |
| AC-007 | Motor — limpieza | `LIMIT_FIELDS` eliminado | Búsqueda de `LIMIT_FIELDS` en el repositorio | Zero referencias; `UI_LIMITS_MIN` y `UI_LIMITS_MAX` tampoco existen |
| AC-008 | WF (diferido) | Propagación en ciclo POC↔WF | El adaptador WF serializa/deserializa `aggregate` en el payload de publicación | El campo viaja sin pérdida en ambas direcciones del ciclo |

---

## Cuestiones abiertas

Las siguientes preguntas se trasladan al spec sin resolver — son responsabilidad de `sdd-design`:

- **Q1 — Colisión de agregación**: ¿Qué ocurre cuando dos acciones setean el mismo campo con `aggregate` distintos? ¿Last-action wins, strict validation, o first-action wins? Ver propuesta §6-Q1.
- **Q2 — Compatibilidad hacia atrás**: ¿El motor debe mantener temporalmente el fallback a `UI_LIMITS_MIN`/`UI_LIMITS_MAX` para acciones sin `aggregate`? ¿O migración big-bang? Ver propuesta §6-Q2.
- **Q3 — Visibilidad en el `trace`**: ¿El trace de ejecución debe registrar el modo de agregación efectivo por campo para facilitar debugging? Ver propuesta §6-Q3.

---

## Fuera de alcance de este spec

La implementación completa queda **diferida** por dependencia explícita con la aplicación WF (Workflow). Los requisitos FR-011 y AC-008 existen como contratos para que el equipo de WF pueda planificar el cambio de su lado, pero no se ejecutarán hasta que WF entre en alcance del equipo actual.

No están en alcance de ninguna fase de este cambio:
- Modificación del conjunto de stages (`INIT` | `PRE` | `FINAL`).
- Cambios en la semántica de `eligibleOffers`, `winner` o el patrón de inversión de reglas.
- Agregaciones no numéricas (strings, fechas, booleanos).
- Agregaciones con aridad distinta de MIN/MAX (suma, promedio, etc.).
