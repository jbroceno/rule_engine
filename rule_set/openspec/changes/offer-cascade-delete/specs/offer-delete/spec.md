# Delta — offer-delete

> Cambio: `offer-cascade-delete`
> Dominio: borrado de oferta (endpoint + servicio + frontend)
> Tipo: MODIFIED (comportamiento actual) + ADDED (snapshot, counts, cascada)

---

## MODIFIED Requirements

### Requirement: Borrado de oferta

El sistema MUST eliminar la oferta y TODOS sus recursos asociados en una única transacción atómica cuando se invoca `DELETE /api/admin/offers/:offerCode`.
(Previously: el sistema bloqueaba con 409 si la oferta tenía reglas asociadas.)

Los recursos eliminados abarcan TODAS las entradas en:
- `cfg_offer_rule_condition_value`
- `cfg_offer_rule_condition`
- `cfg_offer_rule_action`
- `cfg_offer_rule` (todos los `offer_date_id`)
- `cfg_offer_param` (todos los `offer_date_id`, sin filtro `enabled`)
- `cfg_offer_ruleset`

El orden de borrado MUST respetar la FK activa (`cfg_offer_param → cfg_offer_ruleset`): params antes que ruleset.

#### Scenario: Borrado exitoso — oferta con reglas y params

- GIVEN una oferta con código `CODE` existe en `cfg_offer_ruleset`
- AND tiene reglas, condiciones, acciones y params en uno o más `offer_date_id`
- WHEN se invoca `DELETE /api/admin/offers/CODE`
- THEN la respuesta es `200` con body `{ offerCode: "CODE", deleted: true, snapshot_id: N, deletedRules: X, deletedParams: Y }`
- AND ninguna fila de las tablas mencionadas persiste para ese `offerCode`

#### Scenario: Borrado exitoso — oferta sin reglas ni params

- GIVEN una oferta con código `EMPTY` existe pero no tiene reglas ni params
- WHEN se invoca `DELETE /api/admin/offers/EMPTY`
- THEN la respuesta es `200` con `{ deleted: true, deletedRules: 0, deletedParams: 0 }`

#### Scenario: Borrado de oferta inexistente

- GIVEN no existe ninguna oferta con código `NOEXIST`
- WHEN se invoca `DELETE /api/admin/offers/NOEXIST`
- THEN la respuesta es `404`

#### Scenario: La respuesta ya no devuelve 409 por reglas existentes

- GIVEN una oferta con código `HAS_RULES` tiene reglas asociadas
- WHEN se invoca `DELETE /api/admin/offers/HAS_RULES`
- THEN la respuesta NO es `409`
- AND la oferta y sus reglas son eliminadas

---

## ADDED Requirements

### Requirement: Snapshot automático previo al borrado

El sistema MUST crear un snapshot del estado completo de la configuración ANTES de ejecutar el borrado en cascada.

El snapshot MUST usar el comment `"Auto: antes de borrar oferta <CODE> (cascada)"` donde `<CODE>` es el código de la oferta. El campo `createdBy` SHOULD tomarse del body de la petición si está presente.

El `snapshot_id` generado MUST incluirse en la respuesta.

#### Scenario: Snapshot creado antes del borrado

- GIVEN una oferta válida `CODE` existe
- WHEN se invoca `DELETE /api/admin/offers/CODE`
- THEN se crea una fila en `cfg_config_snapshot` con comment `"Auto: antes de borrar oferta CODE (cascada)"`
- AND el `snapshot_id` de esa fila aparece en la respuesta

#### Scenario: Fallo en snapshot aborta la operación

- GIVEN la creación del snapshot lanza un error
- WHEN se invoca `DELETE /api/admin/offers/CODE`
- THEN la respuesta es un error (5xx)
- AND la oferta y sus reglas NO son eliminadas

---

### Requirement: Atomicidad de la transacción

El sistema MUST envolver todo el borrado en cascada (condition_values → conditions → actions → rules → params → ruleset) en una única `sql.Transaction`.

Si cualquier sentencia DELETE dentro de la transacción falla, el sistema MUST hacer rollback y MUST NOT dejar filas huérfanas en ninguna tabla.

#### Scenario: Rollback ante error mid-cascada

- GIVEN una oferta `CODE` con reglas y params existe
- AND una de las sentencias DELETE internas falla (simulado con mock de pool)
- WHEN se invoca `DELETE /api/admin/offers/CODE`
- THEN la respuesta es un error
- AND la oferta sigue existiendo en `cfg_offer_ruleset`
- AND todas sus reglas y params siguen existiendo (no hay borrado parcial)

---

### Requirement: Params soft-deleted incluidos en el borrado

El sistema MUST eliminar físicamente TODOS los params del offer, incluyendo los que tienen `enabled = 0`, sin filtrar por estado.

#### Scenario: Params con enabled=0 son eliminados

- GIVEN una oferta `CODE` tiene params con `enabled = 1` y params con `enabled = 0`
- WHEN se invoca `DELETE /api/admin/offers/CODE`
- THEN NINGUNA fila de `cfg_offer_param` subsiste para ese `offerCode` (ni activas ni soft-deleted)
- AND `deletedParams` en la respuesta refleja el total de filas eliminadas (activas + soft-deleted)

---

### Requirement: Borrado abarca todos los períodos

El sistema MUST eliminar reglas y params para TODOS los `offer_date_id` asociados a la oferta, sin acotar a un período concreto.

#### Scenario: Multi-período — todas las filas eliminadas

- GIVEN una oferta `CODE` tiene reglas en `offer_date_id = 1` y en `offer_date_id = 2`
- WHEN se invoca `DELETE /api/admin/offers/CODE`
- THEN no quedan reglas para `CODE` en ninguno de los dos períodos

---

### Requirement: Diálogo de confirmación en frontend

El frontend MUST mostrar un diálogo de confirmación antes de llamar al endpoint con el texto:

> "Se eliminarán la oferta `<CODE>` y TODAS sus reglas y parámetros de todos los períodos. Esta operación no se puede deshacer."

El diálogo MUST NOT pre-consultar conteos al servidor (es solo texto de aviso).

#### Scenario: Diálogo mostrado con texto de aviso

- GIVEN el usuario pulsa "Eliminar" en la oferta `CODE`
- WHEN se abre el diálogo de confirmación
- THEN el texto visible incluye el código `CODE` y la advertencia de irreversibilidad en español

#### Scenario: Éxito muestra counts y referencia al snapshot

- GIVEN el usuario confirma el diálogo
- AND el servidor responde con `{ deleted: true, deletedRules: 5, deletedParams: 3, snapshot_id: 42 }`
- WHEN se procesa la respuesta en el componente
- THEN el usuario ve un mensaje que menciona cuántas reglas y params fueron eliminados

---

### Requirement: Forma de la respuesta

El endpoint MUST devolver `{ offerCode, deleted: true, snapshot_id, deletedRules, deletedParams }` en el cuerpo de la respuesta `200`.

`deletedRules` MUST ser la suma de filas eliminadas en `cfg_offer_rule`.
`deletedParams` MUST ser la suma de filas eliminadas en `cfg_offer_param` (activas + soft-deleted).

#### Scenario: Counts reflejan filas realmente eliminadas

- GIVEN una oferta con 3 reglas en período 1 y 2 reglas en período 2, y 4 params
- WHEN el borrado en cascada concluye
- THEN `deletedRules = 5` y `deletedParams = 4` en la respuesta
