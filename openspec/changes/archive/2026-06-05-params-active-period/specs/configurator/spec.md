# Especificación: Configurador (params-active-period)

**Cambio:** params-active-period
**Fecha:** 2026-06-05
**Alcance:** Frontend-only (Angular). Sin cambios en API, SQL ni backend.
**Paneles afectados:** Reglas Y Params del configurador (`configurator-page.component`).

---

## 1. Resumen

Después de aplicado este cambio, el configurador deja de mostrar selectores manuales de período de vigencia en los formularios de creación de reglas y de params. El período activo de `ActivePeriodService` se inyecta automáticamente. Cuando no existe período activo aplicable, el botón "Crear" del panel correspondiente queda desactivado y un banner guía al usuario a `/offer-dates`. En modo edición, el período del registro es inmutable (texto de solo lectura). La lista de registros permanece visible mientras el editor está abierto. El formulario de params queda compactado en un grid 2×2.

---

## 2. Requisitos funcionales

### 2.1 Autoinyección del período activo en creación

**FR-001** — Al invocar `openCreateRuleEditor()`, el campo `offer_date_id` del formulario de reglas se establece automáticamente con el valor de `activePeriodService.activePeriodRules()?.offer_date_id`. El usuario no realiza ninguna acción para asignar el período.

**FR-002** — Al invocar `openCreateParamEditor()`, el campo `offer_date_id` del formulario de params se establece automáticamente con el valor de `activePeriodService.activePeriodParams()?.offer_date_id`. El usuario no realiza ninguna acción para asignar el período.

**FR-003** — El `<select>` "Período de vigencia" queda eliminado del formulario de creación de reglas. No existe ningún control de período editable en ese modo.

**FR-004** — El `<select>` "Período de vigencia" queda eliminado del formulario de creación de params. No existe ningún control de período editable en ese modo.

**FR-005** — El payload generado por `buildRulePayloadFromForm()` en creación contiene siempre un `offer_date_id` entero positivo (nunca `null`). Condición necesaria: `activePeriodService.activePeriodRules()` no es `null` en el momento de abrir el editor.

**FR-006** — El payload generado por `saveParam()` en creación contiene siempre un `offer_date_id` entero positivo (nunca `null`). Condición necesaria: `activePeriodService.activePeriodParams()` no es `null` en el momento de abrir el editor.

### 2.2 Desactivación del botón "Crear" sin período activo

**FR-007** — El botón "Crear" del panel de reglas tiene el atributo `disabled` activo cuando `activePeriodService.activePeriodRules()` es `null`. Cuando el signal pasa a un valor no nulo, el botón se habilita sin recarga de página.

**FR-008** — El botón "Crear" del panel de params tiene el atributo `disabled` activo cuando `activePeriodService.activePeriodParams()` es `null`. Cuando el signal pasa a un valor no nulo, el botón se habilita sin recarga de página.

**FR-009** — Mientras el botón "Crear" de reglas esté desactivado, se muestra un banner (o mensaje de guía) visible en el área del panel con el texto que indica al usuario que debe activar un período de vigencia de reglas, incluyendo un enlace navegable a la ruta `/offer-dates`.

**FR-010** — Mientras el botón "Crear" de params esté desactivado, se muestra un banner (o mensaje de guía) visible en el área del panel con el texto que indica al usuario que debe activar un período de vigencia de params, incluyendo un enlace navegable a la ruta `/offer-dates`.

> **Pregunta abierta QA-01:** redacción exacta del banner (por ejemplo: _"Activá un período de vigencia en la página Fechas de oferta para poder crear."_). La phase de design define el texto literal y si el banner usa clase de alerta o texto inline.

### 2.3 Inmutabilidad del período en modo edición

**FR-011** — Al invocar `openEditRuleEditor(rule)`, el campo `offer_date_id` del formulario se inicializa con el `offer_date_id` del registro existente y no puede ser modificado por el usuario. El período se presenta como texto de solo lectura, no como `<select>` ni `<input>` editable.

**FR-012** — Al invocar `openEditParamEditor(param)`, el campo `offer_date_id` del formulario se inicializa con el `offer_date_id` del registro existente y no puede ser modificado por el usuario. El período se presenta como texto de solo lectura.

**FR-013** — El payload de actualización de una regla existente incluye el mismo `offer_date_id` que tenía el registro al abrirse el editor. La interacción del usuario con el formulario de edición no puede alterar ese valor.

**FR-014** — El payload de actualización de un param existente incluye el mismo `offer_date_id` que tenía el registro al abrirse el editor. La interacción del usuario con el formulario de edición no puede alterar ese valor.

**FR-015** — El texto de solo lectura del período en modo edición muestra al menos: identificador del período (`offer_date_id`), fecha de inicio y fecha de fin en formato `dd/MM/yyyy`. El formato exacto y la presencia de descripción adicional son decisiones de la fase de design.

> **Pregunta abierta QA-02:** ¿El texto de período en edición va dentro del grid (ocupando el slot donde estaba el `<select>`) o como línea aparte fuera del grid? Decisión de la fase de design.

### 2.4 Visibilidad de la lista durante la edición

**FR-016** — Al abrir el editor de reglas (creación o edición), la tabla de reglas, el paginador y el buscador del panel de reglas permanecen visibles en el DOM. Los guardas `*ngIf="!isRuleEditorOpen()"` que hoy ocultan esos bloques se eliminan.

**FR-017** — Al abrir el editor de params (creación o edición), la tabla de params, el paginador y el buscador del panel de params permanecen visibles en el DOM. Los guardas `*ngIf="!isParamEditorOpen()"` que hoy ocultan esos bloques se eliminan.

**FR-018** — El formulario del editor (reglas o params) se muestra en posición inline por encima de la tabla correspondiente. La tabla queda debajo del editor en flujo normal de documento.

### 2.5 Layout compactado del formulario de params

**FR-019** — El grid del formulario de params (`form-grid-params`) pasa a tener 4 controles dispuestos en 2×2: `[Oferta | Key]` en la primera fila y `[Tipo de valor | Valor]` en la segunda fila. El campo "Valor" ocupa la celda que antes correspondía al campo "Período".

**FR-020** — El campo "Período de vigencia" no aparece en el grid de params ni como elemento de grid separado en ningún modo de creación.

**FR-021** — En modo edición de params, el texto de solo lectura del período se muestra en el formulario (su posición exacta es decisión de design; ver QA-02), sin que ello altere el layout 2×2 del grid de los cuatro campos de datos.

> **Pregunta abierta QA-03:** ¿El campo "Valor" en el grid de params debe tener `span` de ancho completo en lugar de ocupar una única celda del grid 2×2? Decisión de la fase de design tras validar con valores largos.

### 2.6 Integridad del payload

**FR-022** — En ninguna operación de creación (regla o param) puede el frontend enviar `offer_date_id = null` o ausente. Si el período activo es `null` cuando se intenta abrir el editor, `openCreateRuleEditor()` y `openCreateParamEditor()` no abren el editor (el botón está desactivado por FR-007 / FR-008 y la acción es inalcanzable por el usuario).

**FR-023** — El frontend no modifica ni extiende los contratos de la API. Los payloads siguen siendo los mismos objetos que hoy, con la única diferencia de que `offer_date_id` llega siempre como entero positivo en creación.

---

## 3. Criterios de aceptación

| ID | Área | Descripción | Condiciones | Resultado esperado |
|----|------|-------------|-------------|-------------------|
| CA-001 | Reglas — Creación | Crear regla con período activo válido | `activePeriodRules()` devuelve `{ offer_date_id: 5, tipo_cd: "REGLAS", ... }`. El usuario hace clic en "Crear" y completa el formulario sin tocar período. | `openCreateRuleEditor()` inyecta `offer_date_id = 5`. El payload enviado al backend contiene `offer_date_id: 5` (entero positivo). El backend responde 2xx. |
| CA-002 | Reglas — Creación | Crear regla con período activo tipo AMBOS | `activePeriodRules()` devuelve `{ offer_date_id: 7, tipo_cd: "AMBOS", ... }`. | Mismo resultado que CA-001 con `offer_date_id = 7`. El tipo `AMBOS` es válido para reglas. |
| CA-003 | Params — Creación | Crear param con período activo válido | `activePeriodParams()` devuelve `{ offer_date_id: 3, tipo_cd: "PARAMS", ... }`. El usuario hace clic en "Crear" y completa el formulario sin tocar período. | `openCreateParamEditor()` inyecta `offer_date_id = 3`. El payload enviado al backend contiene `offer_date_id: 3`. El backend responde 2xx. |
| CA-004 | Params — Creación | Crear param con período activo tipo AMBOS | `activePeriodParams()` devuelve `{ offer_date_id: 8, tipo_cd: "AMBOS", ... }`. | Mismo resultado que CA-003 con `offer_date_id = 8`. |
| CA-005 | Reglas — Sin período | Botón "Crear" desactivado (reglas) | `activePeriodRules()` es `null` (localStorage vacío o no seleccionado). | El botón "Crear" del panel de reglas tiene `disabled`. El banner de guía con enlace a `/offer-dates` es visible en el panel. No se puede abrir el editor. |
| CA-006 | Params — Sin período | Botón "Crear" desactivado (params) | `activePeriodParams()` es `null`. | El botón "Crear" del panel de params tiene `disabled`. El banner de guía con enlace a `/offer-dates` es visible en el panel. No se puede abrir el editor. |
| CA-007 | Reglas — Sin período | Período de params no habilita crear en reglas | `activePeriodRules()` es `null` pero `activePeriodParams()` no es `null`. | El botón "Crear" de reglas sigue desactivado. El botón "Crear" de params está habilitado. Los dos signals son independientes. |
| CA-008 | Params — Sin período | Período de reglas no habilita crear en params | `activePeriodParams()` es `null` pero `activePeriodRules()` no es `null`. | El botón "Crear" de params sigue desactivado. El botón "Crear" de reglas está habilitado. |
| CA-009 | Reglas — Edición | Período inmutable en edición de regla | El usuario abre para editar una regla con `offer_date_id = 2`. El período activo actual es `offer_date_id = 9`. | El editor muestra el período `2` como texto de solo lectura. No existe control editable de período. Al guardar, el payload contiene `offer_date_id: 2` (el del registro, no el activo). |
| CA-010 | Params — Edición | Período inmutable en edición de param | El usuario abre para editar un param con `offer_date_id = 4`. El período activo actual es `offer_date_id = 11`. | El editor muestra el período `4` como texto de solo lectura. Al guardar, el payload contiene `offer_date_id: 4`. |
| CA-011 | Reglas — Visibilidad | Lista visible con editor abierto (reglas) | El editor de reglas está abierto (creación o edición). | La tabla de reglas, el paginador y el buscador son visibles en el DOM simultáneamente con el formulario del editor. |
| CA-012 | Params — Visibilidad | Lista visible con editor abierto (params) | El editor de params está abierto (creación o edición). | La tabla de params, el paginador y el buscador son visibles en el DOM simultáneamente con el formulario del editor. |
| CA-013 | Params — Layout | Grid 2×2 en creación de param | El editor de params está en modo creación. | El formulario muestra 4 campos: Oferta, Key, Tipo de valor y Valor. No aparece campo "Período" ni `<select>` de período. La disposición es 2 columnas × 2 filas. |
| CA-014 | Params — Layout | Campo "Valor" en grid 2×2 en edición | El editor de params está en modo edición. | El formulario muestra los 4 campos de datos en grid 2×2. El período aparece como texto de solo lectura fuera del grid o en el hueco designado por design (ver QA-02). |
| CA-015 | Reglas — UI | Sin `<select>` de período en formulario de creación de reglas | Se inspecciona el DOM con el editor de reglas en modo creación. | No existe ningún elemento `<select>` vinculado al control `offer_date_id` en el formulario de reglas. |
| CA-016 | Params — UI | Sin `<select>` de período en formulario de creación de params | Se inspecciona el DOM con el editor de params en modo creación. | No existe ningún elemento `<select>` vinculado al control `offer_date_id` en el formulario de params. |
| CA-017 | Reglas — Payload | No se envía `offer_date_id: null` en creación de regla | El botón "Crear" de reglas solo es alcanzable cuando `activePeriodRules()` no es `null` (FR-022). Se crea una regla. | El payload de la petición POST a `/api/admin/rules` contiene `offer_date_id` como entero positivo. |
| CA-018 | Params — Payload | No se envía `offer_date_id: null` en creación de param | El botón "Crear" de params solo es alcanzable cuando `activePeriodParams()` no es `null` (FR-022). Se crea un param. | El payload de la petición POST a `/api/admin/params` contiene `offer_date_id` como entero positivo. |
| CA-019 | Reglas — Habilitación | Botón "Crear" de reglas se habilita al seleccionar período | El usuario estaba en estado sin período (CA-005). Navega a `/offer-dates`, selecciona un período activo de reglas y regresa al configurador. | El botón "Crear" del panel de reglas está habilitado. El banner de guía ya no se muestra. |
| CA-020 | Params — Habilitación | Botón "Crear" de params se habilita al seleccionar período | Análogo a CA-019 para el panel de params. | El botón "Crear" del panel de params está habilitado. El banner de guía ya no se muestra. |

---

## 4. Fuera de especificación (confirmado)

Los siguientes puntos están explícitamente fuera del alcance de este cambio y NO deben implementarse:

- Cambios en `admin_validator.js`, `admin_service.js`, controladores o esquema SQL.
- Introducción de "período activo" como concepto en el backend.
- Modificación del scope global de `cfg_offer_dates` (sigue siendo global, no por oferta).
- Permiso de reasignar período desde el editor de un registro existente.
- Modificación de los formularios del panel de ofertas (`panel-offers`).
- Cambios en la lógica de filtrado por período activo de las listas.
- Side-by-side layout (editor y lista lado a lado).

---

## 5. Preguntas abiertas

| ID | Pregunta | Bloquea |
|----|----------|---------|
| QA-01 | Redacción exacta del banner de período inactivo (texto literal y si es clase alerta o texto inline). | Design |
| QA-02 | Posición del texto de solo lectura del período en modo edición: ¿dentro del grid (slot del `<select>` eliminado) o como línea aparte fuera del grid? Aplica a ambos paneles. | Design |
| QA-03 | En params: ¿el campo "Valor" en el grid debe ocupar span ancho completo en lugar de una celda de la segunda fila? | Design |

---

## 6. Supuestos de especificación

- `activePeriodService.activePeriodRules()` y `activePeriodService.activePeriodParams()` son Angular signals accesibles en la plantilla del componente. El comportamiento reactivo (habilitar/deshabilitar botón) es automático sin código adicional de change detection.
- Un período de tipo `AMBOS` es válido tanto para reglas como para params (tratado igual que `REGLAS` para el panel de reglas y que `PARAMS` para el panel de params).
- La validación de tipo de período (`tipo_cd`) para determinar si habilita el botón de cada panel es responsabilidad del comportamiento actual de `ActivePeriodService` (el signal `activePeriodRules` solo se rellena con períodos de tipo `REGLAS` o `AMBOS`; `activePeriodParams` con `PARAMS` o `AMBOS`). Este spec no requiere que el componente valide `tipo_cd` adicionalmente.

> **Nota:** si `ActivePeriodService` no filtra por `tipo_cd` al almacenar el período (es decir, acepta cualquier tipo en cualquier signal), la validación de tipo recaería en el componente. Esto debe verificarse en design.
