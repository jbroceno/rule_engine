# Delta — config-apply-safeguard

> Cambio: `rbac-and-config-safeguards`
> Dominio: salvaguarda de `POST /admin/config/apply` (confirmación explícita + previsualización)
> Tipo: MODIFIED (validación actual del apply) + ADDED (endpoint de previsualización, UI)

---

## MODIFIED Requirements

### Requirement: Validación del payload de `POST /admin/config/apply`

El sistema MUST rechazar con `400` una petición `POST /admin/config/apply` que no incluya
`confirmReplaceAll: true` en el body, además de las validaciones ya existentes (`rules` array no
vacío, `comment` no vacío, `params` array u ausente, forma de cada regla).
(Previously: la única confirmación exigida era un `comment` no vacío; no existía ningún campo de
confirmación explícita del reemplazo total.)

La validación de `confirmReplaceAll` MUST ejecutarse ANTES de crear el snapshot y ANTES de tocar
la base de datos.

#### Scenario: Apply sin confirmReplaceAll es rechazado

- GIVEN un payload con `rules` válido y `comment` no vacío, pero SIN `confirmReplaceAll` (o con
  `confirmReplaceAll: false`)
- WHEN se invoca `POST /admin/config/apply`
- THEN la respuesta es `400`
- AND el mensaje indica que debe confirmarse el reemplazo total
- AND NO se crea ningún snapshot ni se modifica la BD

#### Scenario: Apply con confirmReplaceAll=true procede

- GIVEN un payload válido con `rules`, `comment` y `confirmReplaceAll: true`
- WHEN se invoca `POST /admin/config/apply`
- THEN la respuesta es `200` con el resultado del reemplazo y `snapshot_id`
- AND el comportamiento del reemplazo en sí (snapshot previo + `deleteAllPeriods: true`) no cambia

#### Scenario: Validaciones existentes siguen aplicando

- GIVEN un payload con `confirmReplaceAll: true` pero sin `comment` (o `comment` vacío)
- WHEN se invoca `POST /admin/config/apply`
- THEN la respuesta sigue siendo `400` (comportamiento inalterado de la validación de `comment`)

---

## ADDED Requirements

### Requirement: Endpoint de previsualización de impacto

El sistema MUST exponer `POST /api/admin/config/apply/preview`, que recibe el mismo shape de
payload que `POST /admin/config/apply` (`rules`, `params` opcional) SIN requerir `comment` ni
`confirmReplaceAll`, y MUST devolver un resumen de impacto SIN escribir en la base de datos y SIN
crear ningún snapshot.

El resumen de impacto MUST incluir, por cada offer code afectado: número de reglas a eliminar
(`rulesToDelete`), params a eliminar (`paramsToDelete`), reglas a insertar (`rulesToInsert`) y
params a insertar (`paramsToInsert`).

#### Scenario: Preview devuelve el resumen sin escribir

- GIVEN un payload válido de `rules` (y `params` opcional) que afecta a los offer codes `A` y `B`
- WHEN se invoca `POST /api/admin/config/apply/preview`
- THEN la respuesta es `200` con un resumen por offer code (`A`, `B`) con los cuatro conteos
- AND NO se crea ninguna fila en `cfg_config_snapshot`
- AND NINGUNA fila de `cfg_offer_rule` / `cfg_offer_param` cambia en la BD

#### Scenario: Preview con payload inválido es rechazado igual que apply

- GIVEN un payload sin `rules` (o `rules` no es array)
- WHEN se invoca `POST /api/admin/config/apply/preview`
- THEN la respuesta es `400` (misma validación de forma que `postAdminApply`, salvo `comment`/`confirmReplaceAll`)

#### Scenario: Preview es idempotente y repetible

- GIVEN el mismo payload se envía dos veces seguidas a `POST /api/admin/config/apply/preview`
- WHEN se comparan ambas respuestas
- THEN los conteos son idénticos (el estado de la BD no cambió entre llamadas)

---

### Requirement: Diálogo de "Grabar configuración" exige previsualización y confirmación

El frontend MUST invocar el endpoint de previsualización y mostrar su resultado (offer codes
afectados y los cuatro conteos) dentro del diálogo de confirmación de "Grabar configuración",
ANTES de habilitar el botón que invoca `POST /admin/config/apply`. El envío final MUST incluir
`confirmReplaceAll: true` únicamente tras la confirmación explícita del usuario.

#### Scenario: Confirmación deshabilitada hasta ver la previsualización

- GIVEN el usuario abre el diálogo de "Grabar configuración" tras importar un JSON
- WHEN el diálogo se abre
- THEN se muestra el resumen de previsualización (offer codes, conteos) antes de que el botón de
  confirmar esté habilitado

#### Scenario: Confirmación explícita dispara el apply con el flag

- GIVEN el usuario ve la previsualización y pulsa "Confirmar"
- WHEN se invoca la llamada de grabación
- THEN el body enviado a `POST /admin/config/apply` incluye `confirmReplaceAll: true`
