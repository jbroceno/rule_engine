# Propuesta: params-active-period

## Resumen

Eliminar la selección manual de período de vigencia en los formularios de **crear reglas** y **crear params** del configurador, inyectando automáticamente el período activo (`ActivePeriodService`). Bloquear la creación cuando no hay período activo aplicable, mantener la lista visible mientras el editor está abierto y compactar el formulario de params. Cambio **solo de frontend** (Angular). No se modifica API ni SQL.

## Intención (problema, por qué ahora, éxito)

**Problema.** Hoy ambos formularios muestran un `<select>` "Período de vigencia" que por defecto vale `null`. El usuario debe elegir el período manualmente, lo cual:
1. Es redundante: el configurador ya trabaja sobre un período activo seleccionado en la página `offer-dates` (`ActivePeriodService.activePeriodRules` / `activePeriodParams`), y la lista ya se filtra por él.
2. Provoca un **bug real**: el FE deja `offer_date_id` en `null` al abrir el editor de creación (`openCreateRuleEditor`, `openCreateParamEditor`), pero el validador backend lo exige como entero positivo (`admin_validator.js:59-61` reglas, `:197-200` params). Crear sin elegir período termina en `400` silencioso.
3. Permite **error humano**: elegir un período distinto del activo, descuadrando datos respecto a la lista que se está viendo.

Además, al abrir el editor desaparece toda la tabla (los `*ngIf="!isXEditorOpen()"` destruyen lista, paginador y buscador), perdiendo el contexto de lo que ya existe.

**Por qué ahora.** El modelo de período activo ya está implantado y es la fuente de verdad del filtrado. La UI de creación quedó desalineada con ese modelo y arrastra un bug de validación. Es una deuda pequeña, de bajo riesgo y alto impacto en UX.

**Éxito.** Crear una regla o un param sin tocar ningún selector de período: el sistema usa el período activo. Si no hay período activo, el botón "Crear" está desactivado con indicación clara de cómo activarlo. La lista permanece visible junto al editor. El formulario de params es más compacto.

## Alcance

### Dentro de alcance

- **Ambos paneles** del configurador: reglas Y params reciben el mismo tratamiento (decisión confirmada del usuario).
- Quitar el `<select>` "Período de vigencia" de los formularios de **crear** reglas y params.
- En creación, autoinyectar `offer_date_id` desde el período activo correspondiente (`activePeriodRules` para reglas, `activePeriodParams` para params).
- Desactivar el botón "Crear" de cada panel cuando su período activo es `null`, con indicación de por qué y cómo resolverlo (ir a `offer-dates`).
- **Modo edición**: el período es **inmutable**. Se muestra como texto de solo lectura (no editable). Cambiar de período = borrar + recrear.
- Mantener visibles lista, paginador y buscador mientras el editor está abierto (en ambos paneles, por consistencia).
- Compactar el formulario de params: el campo "Valor" pasa al hueco que deja "Período" en el grid (`form-grid-params`, 2×2).

### Fuera de alcance (límites explícitos)

- **Cualquier cambio en API o SQL.** No se toca `admin_validator.js`, `admin_service.js`, controladores ni esquema. El bug del `400` se resuelve enteramente en FE inyectando un `offer_date_id` válido; el validador backend ya es correcto al exigirlo.
- No se introduce concepto de "período activo" en backend: sigue siendo estado de frontend en `localStorage`.
- No se cambia el alcance global de los períodos (`cfg_offer_dates` sigue sin ser por oferta).
- No se permite reasignar el período de un registro existente desde el editor (eso es delete + recreate, comportamiento ya vigente).
- No se modifican los formularios de creación/edición de **ofertas** (panel-offers).
- No se altera la lógica de filtrado por período activo de la lista (ya funciona).

### Supuestos

- El período activo de `ActivePeriodService` es la única fuente válida para crear en el configurador.
- Para edición, el `offer_date_id` del propio registro es la fuente (no el período activo), por lo que un registro de un período no activo se edita conservando su período.

## Enfoque (Approach A, confirmado)

Frontend-only. Leer el período activo de `ActivePeriodService` (ya inyectado en el componente) y eliminar la entrada manual.

### Decisiones de UX (calls de esta propuesta)

| Tema | Decisión | Razón |
|------|----------|-------|
| Botón "Crear" sin período | `[disabled]="!activePeriodService.activePeriodRules()"` (reglas) / `activePeriodParams()` (params). Texto guía visible cuando está desactivado: banner/nota "Activá un período de vigencia en la página *Fechas de oferta* para poder crear." con enlace a la ruta `/offer-dates`. | El computed ya es accesible en plantilla; el banner evita el tooltip-solo (descubribilidad pobre). |
| Período en modo edición | Texto de solo lectura dentro del editor, en la posición donde estaba el `<select>` (reglas) / en el hueco previo (params), formato `#{id} dd/MM/yyyy – dd/MM/yyyy · descripción`. En modo creación ese mismo hueco no muestra período (params lo reocupa con "Valor"). | Cumple la inmutabilidad confirmada y mantiene trazabilidad visual sin permitir cambio. |
| Layout del editor vs lista | **Inline encima de la tabla, la lista permanece debajo.** Se logra quitando los guardas `*ngIf="!isXEditorOpen()"` de lista, paginador, buscador y mensajes de estado, dejando el `<form *ngIf="isXEditorOpen()">` donde ya está (arriba). | Es la opción de **menor esfuerzo** y consistente con el markup actual (el formulario ya está arriba del bloque de lista). Side-by-side exigiría reestructurar el grid del panel. |
| Consistencia entre paneles | Aplicar lista-visible y botón-desactivado a reglas Y params. | Decisión del usuario; ambos paneles comparten el mismo patrón `*ngIf`. |
| Layout params | Grid `form-grid-params` queda [Oferta \| Key] / [Tipo valor \| **Valor**]; "Período" desaparece del grid en creación. En edición, el hueco de Valor se mantiene y el período se muestra como texto de solo lectura sobre/junto al grid. | El usuario lo pidió; el grid 6-col × span 3 ya soporta 2×2. |

### Flujo resultante

- **Crear regla/param**: botón habilitado solo si hay período activo del tipo correspondiente → `openCreateXEditor` autoinyecta `offer_date_id = activePeriodX().offer_date_id` → payload válido → backend acepta. No hay `<select>` de período.
- **Editar regla/param**: editor abre con los datos del registro; el período se muestra como texto inmutable; al guardar se envía el `offer_date_id` original sin cambios.
- **Sin período activo**: "Crear" desactivado + banner con enlace a `/offer-dates`.

## Archivos afectados (esperados)

| Archivo | Cambio |
|---------|--------|
| `rule_set/web/src/app/pages/configurator-page.component.ts` | `openCreateRuleEditor` / `openCreateParamEditor` autoinyectan `offer_date_id` desde `activePeriodService`; quitar `offer_date_id` como control editable de creación (o convertirlo en valor calculado); helper(s) para texto de período en edición. |
| `rule_set/web/src/app/pages/configurator-page.component.html` | Quitar `<select>` de período en ambos formularios; añadir texto de solo lectura en edición; mover "Valor" al grid de params; `[disabled]` + banner en botones "Crear"; quitar guardas `*ngIf="!isXEditorOpen()"` de lista/paginador/buscador/estados en ambos paneles. |
| `rule_set/web/src/app/pages/configurator-page.component.css` | Ajuste de `form-grid-params` (Valor ocupa el slot liberado); estilo del banner/nota de "Crear" desactivado y del texto de período de solo lectura. |

Solo lectura (referencia, sin cambios): `active-period.service.ts`, `admin_validator.js`, `admin_service.js`, `data_model.sql`.

## Riesgos y preguntas abiertas

| Riesgo | Mitigación |
|--------|-----------|
| Lista + editor visibles a la vez pueden generar layout largo / scroll incómodo. | Aceptable; el formulario queda arriba y la lista debajo. Si molesta, futura iteración con colapso — fuera de alcance. |
| Un registro creado bajo un período que luego deja de ser activo: al editarlo conserva su período (correcto), pero el usuario podría confundirse al ver período distinto del activo. | El texto de solo lectura del período en edición hace explícito a qué período pertenece. |
| `value` movido al grid de params podría quedar estrecho para valores largos. | El input ocupa una celda `span 3`; si se valida insuficiente en diseño, evaluar `span` completo en una fila propia — decisión de la fase design. |
| Pérdida de `localStorage` (incógnito/otro navegador) ⇒ sin período activo ⇒ creación bloqueada. | Comportamiento esperado; el banner dirige a `/offer-dates`. |

**Preguntas abiertas (para spec/design):** redacción exacta del banner; si el texto de período en edición va dentro del grid o como línea aparte; si "Valor" en params debe ser fila completa en lugar de celda del grid.

## Criterios de éxito

- Crear una regla y un param sin interactuar con ningún selector de período; ambos se asignan al período activo y el backend responde 2xx (sin el `400` actual).
- Con período activo `null`, el botón "Crear" del panel correspondiente está desactivado y se muestra indicación con enlace a `/offer-dates`.
- Al abrir el editor (crear o editar) en cualquiera de los dos paneles, la tabla, el paginador y el buscador siguen visibles.
- En edición, el período aparece como texto no editable y se conserva al guardar.
- El formulario de params muestra "Valor" en el grid (2×2) sin el campo "Período".

## Magnitud estimada

< 400 líneas modificadas (un único componente Angular: TS + HTML + CSS). **PR único**, sin necesidad de troceo en chained PRs.

## Próximas fases

`sdd-spec` y `sdd-design` pueden ejecutarse en paralelo a partir de esta propuesta.
