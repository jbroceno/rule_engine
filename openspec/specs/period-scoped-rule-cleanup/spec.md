# Capacidad 2: period-scoped-rule-cleanup — Limpieza de Reglas por Período en el Configurador

## Propósito
El panel de ofertas del Configurador muestra SOLO ofertas con reglas en el período activo. "Borrar" elimina reglas+params de esa oferta SOLO en el período activo. "Editar" edita la entidad (reutiliza `updateOffer`).

## Requisitos

### FR-101: Filtrado por período activo
El sistema DEBE mostrar SOLO ofertas con reglas en el `offer_date_id` activo. Sin período activo: aviso "Seleccioná un período activo" + tabla vacía (sin fallback). Endpoint: `GET /admin/offers?offerDateId=N`.

#### Escenario: período activo con ofertas
- DADO que hay período activo `offer_date_id = N` con ofertas con reglas
- CUANDO el Configurador carga el panel
- ENTONCES se muestran SOLO las ofertas con reglas en ese período

#### Escenario: período activo sin ofertas con reglas
- DADO que hay período activo pero ninguna oferta tiene reglas en él
- CUANDO carga el panel
- ENTONCES tabla vacía con mensaje informativo

#### Escenario: sin período activo
- DADO que no hay período activo
- CUANDO carga el panel
- ENTONCES aviso "Seleccioná un período activo", tabla vacía, sin llamada a API de offers

### FR-102: Selects de offerCode no filtrados
El sistema DEBE usar `GET /admin/offers` sin `offerDateId` para los `<select>` en formularios de reglas y params, independientemente del período activo.

#### Escenario: selects con o sin período activo
- DADO cualquier estado de período activo
- CUANDO el usuario abre formulario de regla o param
- ENTONCES el `<select>` offerCode lista TODAS las ofertas existentes

### FR-103: Editar oferta desde el Configurador
El sistema DEBE permitir editar la entidad oferta (código, nombre, rank, oferta_id, habilitado) desde el Configurador, reutilizando `updateOffer` y `PUT /admin/offers/:offerCode`.

#### Escenario: edición exitosa
- DADO que el usuario pulsa "Editar" en el panel del Configurador
- CUANDO modifica y confirma
- ENTONCES la entidad se actualiza y cambios visibles también en `/ofertas`

### FR-104: Borrado de reglas y params por período
El sistema DEBE permitir eliminar todas las reglas y params de una oferta en el período activo vía `DELETE /admin/offers/:offerCode/rules?offerDateId=N`. Antes del borrado DEBE crear un snapshot automático. El diálogo DEBE indicar: "Se eliminarán las reglas y parámetros de esta oferta SOLO en el período activo."

#### Escenario: borrado exitoso
- DADO que el usuario pulsa "Borrar" con período activo `offer_date_id = N` y confirma
- ENTONCES se crea snapshot previo
- Y se eliminan reglas de la oferta en `offer_date_id = N`
- Y se eliminan params de la oferta en `offer_date_id = N`
- Y `cfg_offer_ruleset` permanece intacta
- Y reglas en otros períodos no se ven afectadas

#### Escenario: oferta desaparece del panel tras borrado
- DADO que el borrado se completó
- CUANDO el panel se refresca
- ENTONCES la oferta no aparece (sin reglas en el período)

#### Escenario: snapshot creado antes del borrado
- DADO que el usuario confirma el borrado
- CUANDO el endpoint procesa
- ENTONCES se crea registro en `cfg_config_snapshot` antes de borrar

#### Escenario: cancelación
- DADO que el usuario abre el diálogo de borrado por período
- CUANDO pulsa "Cancelar"
- ENTONCES sin cambios, sin snapshot

### FR-105: Nuevo endpoint DELETE /admin/offers/:offerCode/rules
El sistema DEBE exponer `DELETE /admin/offers/:offerCode/rules?offerDateId=N`. `offerDateId` DEBE ser requerido; si se omite DEBE responder `400`. Si `offerCode` no existe, DEBE responder `404`. Sin reglas en el período DEBE ser idempotente (`200 OK`, `deletedRules: 0`) y crear snapshot igualmente.

#### Escenario: offerDateId ausente
- DADO llamada sin `offerDateId`
- ENTONCES `400 Bad Request`

#### Escenario: offerCode inexistente
- DADO llamada con código inexistente
- ENTONCES `404 Not Found`

#### Escenario: oferta sin reglas en período (idempotente)
- DADO que la oferta existe pero sin reglas en el período
- CUANDO se ejecuta el borrado
- ENTONCES `200 OK`, `deletedRules: 0, deletedParams: 0`, snapshot creado

## Criterios de aceptación
| ID | Área | Condición | Resultado esperado |
|----|------|-----------|-------------------|
| CA-101 | Filtrado | Período activo con ofertas | Solo ofertas con reglas en ese período |
| CA-102 | Filtrado | Sin período activo | Aviso, tabla vacía, sin API call |
| CA-103 | Filtrado | Período sin ofertas con reglas | Tabla vacía, mensaje informativo |
| CA-104 | Selects | Con o sin período | `<select>` lista TODAS las ofertas |
| CA-105 | Editar | Edición desde Configurador | Entidad actualizada, visible en `/ofertas` |
| CA-106 | Borrar período | Confirmar | Snapshot + reglas+params del período eliminados |
| CA-107 | Borrar período | Entidad intacta | `cfg_offer_ruleset` no modificada |
| CA-108 | Borrar período | Otros períodos | Reglas de otros `offer_date_id` intactas |
| CA-109 | Borrar período | Texto confirmación | "SOLO en el período activo" explícito |
| CA-110 | Borrar período | Cancelar | Sin cambios, sin snapshot |
| CA-111 | Endpoint | `offerDateId` ausente | `400 Bad Request` |
| CA-112 | Endpoint | `offerCode` inexistente | `404 Not Found` |
| CA-113 | Endpoint | Sin reglas en período | `200 OK`, idempotente, snapshot creado |
