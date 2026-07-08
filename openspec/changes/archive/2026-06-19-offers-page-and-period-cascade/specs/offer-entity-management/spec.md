# Capacidad 1: offer-entity-management — Página /ofertas

## Propósito
Nueva página dedicada a la gestión completa del ciclo de vida de la entidad `cfg_offer_ruleset`: crear, editar, habilitar/deshabilitar y eliminar (borrado total en cascada). Extrae esta responsabilidad del panel `panel-offers` del Configurador.

## Requisitos

### FR-001: Ruta y navegación
El sistema DEBE exponer la ruta `/ofertas` y DEBE mostrar un enlace de navegación accesible desde cualquier página.

#### Escenario: acceso directo por URL
- DADO que el usuario navega a `/ofertas`
- CUANDO la ruta carga
- ENTONCES se muestra la tabla de ofertas completa

#### Escenario: enlace en topbar
- DADO que el usuario está en cualquier página
- CUANDO visualiza la barra de navegación principal
- ENTONCES aparece el enlace "Ofertas" que navega a `/ofertas`

### FR-002: Listado de ofertas
El sistema DEBE mostrar todas las ofertas existentes (código, nombre, rank, oferta_id, estado). Origen: `GET /admin/offers` sin filtro de período.

#### Escenario: listado con ofertas existentes
- DADO que existen ofertas en la base de datos
- CUANDO se carga `/ofertas`
- ENTONCES la tabla muestra una fila por oferta con todos sus campos

#### Escenario: listado vacío
- DADO que no existen ofertas
- CUANDO se carga `/ofertas`
- ENTONCES se muestra mensaje "Sin ofertas" y el botón crear está habilitado

### FR-003: Crear oferta
El sistema DEBE permitir crear una nueva oferta (código, nombre, rank, oferta_id) mediante formulario inline.

#### Escenario: creación exitosa
- DADO que el usuario completa el formulario de nueva oferta
- CUANDO confirma
- ENTONCES la oferta se crea en `cfg_offer_ruleset` y aparece en la tabla

#### Escenario: código duplicado
- DADO que el usuario intenta crear con un código ya existente
- CUANDO envía el formulario
- ENTONCES error de validación, sin creación

### FR-004: Editar oferta
El sistema DEBE permitir editar campos (código, nombre, rank, oferta_id, habilitado). El renombrado de código DEBE propagar a `cfg_offer_param.offer_code`.

#### Escenario: edición exitosa
- DADO que el usuario selecciona "Editar"
- CUANDO modifica campos y confirma
- ENTONCES la entidad se actualiza y los cambios aparecen en la tabla

#### Escenario: renombrado de código
- DADO que el usuario cambia el `offerCode` de una oferta con params
- CUANDO confirma la edición
- ENTONCES `cfg_offer_param.offer_code` se actualiza al nuevo código

### FR-005: Habilitar / Deshabilitar oferta
El sistema DEBE permitir alternar `enabled` sin confirmación de diálogo.

#### Escenario: toggle
- DADO que el usuario pulsa el botón de toggle
- CUANDO lo activa
- ENTONCES el estado `enabled` cambia y el botón lo refleja inmediatamente

### FR-006: Borrado total en cascada de entidad
El sistema DEBE permitir eliminar una oferta con TODAS sus reglas y params de TODOS los períodos, previa confirmación. Reutiliza `DELETE /admin/offers/:offerCode`. El diálogo DEBE indicar: "Se eliminará la oferta y TODAS sus reglas y parámetros de todos los períodos."

#### Escenario: borrado exitoso
- DADO que el usuario pulsa "Eliminar" en `/ofertas` y confirma el diálogo
- CUANDO se procesa
- ENTONCES la oferta se elimina de `cfg_offer_ruleset` junto con todas sus reglas y params en todos los períodos

#### Escenario: cancelación de diálogo
- DADO que el usuario abre el diálogo de confirmación
- CUANDO pulsa "Cancelar"
- ENTONCES no se realiza ningún cambio

## Criterios de aceptación
| ID | Área | Condición | Resultado esperado |
|----|------|-----------|-------------------|
| CA-001 | Navegación | Usuario navega a `/ofertas` | Tabla de ofertas visible |
| CA-002 | Navegación | Enlace en topbar | Navega a `/ofertas` |
| CA-003 | Listado | Sin período activo | Tabla muestra TODAS las ofertas (sin filtro) |
| CA-004 | Crear | Formulario válido | Oferta creada y visible en tabla |
| CA-005 | Crear | Código duplicado | Error de validación, sin creación |
| CA-006 | Editar | Cambio de offerCode | `cfg_offer_param.offer_code` propagado |
| CA-007 | Toggle | Pulsar toggle | Estado `enabled` cambia sin diálogo |
| CA-008 | Borrar | Confirmar diálogo | Oferta + todas sus reglas + params eliminados |
| CA-009 | Borrar | Cancelar diálogo | Sin cambios en base de datos |
| CA-010 | Borrar | Texto de confirmación | Incluye "todos los períodos" explícitamente |
