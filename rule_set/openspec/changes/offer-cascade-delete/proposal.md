# Proposal — offer-cascade-delete

> Cambia la semántica de `DELETE /api/admin/offers/:offerCode`: de **"bloquea con 409 si la oferta
> tiene reglas"** a **borrado en cascada incondicional dentro de una transacción, con snapshot previo
> automático**. Decisiones de producto bloqueadas por negocio (Aproximación D de la exploración) — no
> se re-discuten.

## Intent

Permitir **eliminar por completo una oferta** (`cfg_offer_ruleset`) junto con todas sus reglas,
condiciones, acciones y parámetros, en **todos los períodos** (`offer_date_id`), en una sola
operación atómica y reversible vía snapshot.

### Problema

Hoy no se puede borrar una oferta que tenga reglas asociadas. El servicio `deleteOffer`
(`admin_service.js:892-922`) ejecuta un COUNT de reglas y, si `ruleCount > 0`, lanza
`AppError(..., 409)`. En la práctica **toda oferta operativa tiene reglas**, así que el endpoint de
borrado es inútil: para eliminar una oferta hay que borrar manualmente todas sus reglas una a una
desde el configurador, y aun así quedarían parámetros huérfanos. No existe ninguna ruta de "limpieza
total" de una oferta.

Además, el borrado actual:
- **No es transaccional** — es un `DELETE` de una sola tabla tras el COUNT.
- **No crea snapshot** — a diferencia de `applyConfig` y de los restores, una operación destructiva
  no deja rastro de auditoría ni es reversible.
- **Ignora los parámetros** — el guard solo cuenta reglas; los params nunca se consideran.

### Why now

- El configurador ya expone un botón "Eliminar oferta" cuyo único resultado posible, en datos reales,
  es un 409. La funcionalidad está rota de cara al usuario.
- La exploración confirma que el patrón a seguir **ya existe** (`deleteRule`,
  `admin_service.js:490-539`: cascade-in-transaction) y el de snapshot también
  (`createSnapshot`, `admin_service.js:945-967`). El cambio reutiliza maquinaria probada.
- Negocio ha **bloqueado las decisiones de producto** (cascada incondicional, snapshot previo, todos
  los períodos, hard-delete de params soft-deleted, diálogo solo-aviso). No hay ambigüedad pendiente
  que justifique esperar.

### Success criteria

1. `DELETE /api/admin/offers/:offerCode` borra la oferta y **todas** sus reglas + condiciones +
   acciones + parámetros en **todos** los `offer_date_id`, en una transacción que hace commit completo
   o rollback completo.
2. Antes de borrar nada se crea un **snapshot automático** del estado previo (vía `createSnapshot`),
   cuyo `snapshot_id` se devuelve en la respuesta → la operación es reversible vía restore.
3. Se borran los params **soft-deleted** (`enabled=0`) además de los activos — no quedan filas
   huérfanas en `cfg_offer_param`.
4. El orden de DELETE respeta la única FK viva (`cfg_offer_param → cfg_offer_ruleset`): la oferta se
   borra **después** de sus params → cero violaciones de FK.
5. La respuesta tiene la forma `{ offerCode, deleted: true, snapshot_id, deletedRules, deletedParams }`
   y el frontend confirma al usuario cuántas reglas y params se eliminaron.
6. El diálogo de confirmación avisa, **en español y de forma inequívoca**, que se eliminarán la oferta
   y todas sus reglas y parámetros en todos los períodos, y que la acción **no se puede deshacer**.
7. Tests primero (Strict TDD): el comportamiento de cascada, el orden de borrado, el snapshot-antes-de-
   borrar y el rollback en error están cubiertos antes de implementar.

## Scope

### In scope

- **Backend — `deleteOffer` (`admin_service.js:892-922`)**
  - Eliminar el guard de 409.
  - Crear snapshot del estado previo (vía `createSnapshot`) **antes** de abrir/ejecutar el borrado.
  - Borrado en cascada dentro de una `sql.Transaction`, en el orden:
    `condition_values → conditions → actions → rules → params(todos) → ruleset`.
  - Borrado en **todos los períodos** (sin filtro por `offer_date_id`).
  - Borrado de params **sin filtro `enabled`** (incluye soft-deleted).
  - Devolver `{ offerCode, deleted: true, snapshot_id, deletedRules, deletedParams }`.
- **Backend — `removeOffer` (`admin_offers_controller.js:48-56`)**
  - Propagar la nueva forma de respuesta (counts + snapshot_id).
- **Frontend**
  - `configurator-page.component.ts` — `deleteOffer()` (~496): mensaje de confirmación con aviso de
    cascada irreversible; `executeOfferDelete()` (~1354): mostrar counts + snapshot_id tras el borrado.
  - `configurator-page.component.html` — modal de confirmación (~714): texto de aviso de cascada para
    `type === 'offer'`.
  - `admin-api.service.ts` — `deleteOffer()` (~77): tipo de retorno actualizado.
  - `models/admin.models.ts` — `AdminOfferDeleteResponse` (~42): añadir `snapshot_id`, `deletedRules`,
    `deletedParams`.
- **Tests** (`test/`, runner `npm test` / node:test, desde `/rule_set/`)
  - Nuevo fichero cubriendo `deleteOffer`: orden de DELETE, snapshot-antes-de-borrar, rollback en error,
    inclusión de params soft-deleted, borrado multi-período, counts en la respuesta. **Tests primero.**

### Out of scope

- **Migración del esquema de FKs en BD.** Las FKs de rule/condition/action siguen comentadas en
  `data_model.sql`; no se crean ni se añade `ON DELETE CASCADE`. La cascada es **a nivel de aplicación**
  (Aproximación D), no de BD.
- **Pre-fetch del conteo de reglas/params para el diálogo.** El diálogo es **solo texto de aviso**; no
  consulta cuántas reglas/params hay antes de confirmar. Los counts se conocen y se muestran
  **después** del borrado (los devuelve el servicio).
- **Flag `?cascade=true` / `?force=true`.** El borrado es **incondicional**; no hay modo no-cascada.
- **Conservar el comportamiento 409 previo** para consumidores de API. Se sustituye por completo.

## Approach

### High-level

1. **Snapshot primero.** `deleteOffer` llama a `createSnapshot(name, comment, createdBy)` antes de
   tocar nada, igual que `applyConfig` y los restores. Captura el estado global (es el patrón existente
   de `exportConfig`; capturar toda la config aunque solo se borre una oferta es correcto y consistente).
   El `snapshot_id` resultante viaja en la respuesta.
2. **Cascada en transacción.** Se abre una `sql.Transaction` y se ejecutan los DELETE en el orden que
   satisface la FK viva, resolviendo cada hijo por join hasta `ruleset` por `code = @offerCode`:
   1. `cfg_offer_rule_condition_value` (join condiciones → reglas → ruleset)
   2. `cfg_offer_rule_condition` (join reglas → ruleset)
   3. `cfg_offer_rule_action` (join reglas → ruleset)
   4. `cfg_offer_rule` (por `ruleset_id`, **todos** los períodos)
   5. `cfg_offer_param` (por `ruleset_id`, **todos** los períodos, **sin** filtro `enabled`)
   6. `cfg_offer_ruleset` (la oferta)
   Commit completo o rollback completo. Se capturan `rowsAffected` de los pasos 4 y 5 para
   `deletedRules` / `deletedParams`.
3. **Respuesta enriquecida.** El controlador devuelve
   `{ offerCode, deleted: true, snapshot_id, deletedRules, deletedParams }`. El frontend muestra un
   mensaje de éxito con los counts y referencia al snapshot creado (reversible vía página de snapshots).
4. **Aviso en UI.** El modal de confirmación (`type === 'offer'`) muestra texto claro:
   *"Se eliminará la oferta {nombre} ({CODE}) junto con TODAS sus reglas y parámetros en TODOS los
   períodos. Esta acción no se puede deshacer (se guardará un snapshot previo para restaurar)."*

### Rationale

| Decisión | Por qué |
|---|---|
| **Cascada a nivel de app (D), no FKs en BD** | Las FKs de rule/condition/action están comentadas; activarlas + `ON DELETE CASCADE` exigiría migración de 4 tablas y limpieza previa de huérfanos existentes. La app ya cascadea así en `deleteRule`. Riesgo y alcance mucho menores. |
| **Snapshot antes de borrar** | Es la convención del sistema para toda op destructiva (`applyConfig`, restore). Hace reversible un borrado masivo irreversible por naturaleza. Coste marginal: una llamada ya existente. |
| **Incondicional, sin flag** | Herramienta interna con diálogo de confirmación propio. El único motivo para conservar el 409 sería un consumidor de API que no quiera cascada — improbable aquí. Menos rutas de código que testear, UX más honesta. |
| **Todos los períodos** | La oferta se elimina permanentemente; dejar reglas/params en otros `offer_date_id` dejaría datos huérfanos referenciando una oferta inexistente. Reutiliza la semántica `deleteAllPeriods` de `applyConfig`. |
| **Hard-delete de params soft-deleted** | Una vez la oferta desaparece, las filas `enabled=0` son ruido huérfano. Borrar por `ruleset_id` sin filtro `enabled` deja la tabla limpia y satisface la FK. |
| **Diálogo solo-aviso, sin pre-fetch de counts** | Evita una query extra y un viaje de red antes del diálogo. El usuario no necesita el número exacto para decidir "borrar todo"; los counts reales se muestran tras el borrado. |
| **Tests primero (Strict TDD)** | `deleteOffer` no tiene cobertura hoy. El orden de DELETE y el rollback son justo el tipo de invariante que un test debe fijar antes de tocar el código. |

### Affected files

| Fichero | Cambio |
|---|---|
| `rule_set/api/services/admin_service.js` | `deleteOffer` (~892-922): quitar guard 409; snapshot previo; cascada en transacción (orden cv→cond→action→rule→param→ruleset); todos los períodos; params sin filtro `enabled`; devolver counts + snapshot_id. |
| `rule_set/api/controllers/admin_offers_controller.js` | `removeOffer` (~48-56): propagar nueva forma de respuesta. |
| `rule_set/web/src/app/pages/configurator-page.component.ts` | `deleteOffer()` (~496): mensaje de aviso de cascada irreversible; `executeOfferDelete()` (~1354): mostrar counts + snapshot. |
| `rule_set/web/src/app/pages/configurator-page.component.html` | Modal de confirmación (~714): texto de aviso de cascada para `type === 'offer'`. |
| `rule_set/web/src/app/services/admin-api.service.ts` | `deleteOffer()` (~77): tipo de retorno actualizado. |
| `rule_set/web/src/app/models/admin.models.ts` | `AdminOfferDeleteResponse` (~42): añadir `snapshot_id`, `deletedRules`, `deletedParams`. |
| `rule_set/test/<nuevo>.test.js` | Nuevo: cubrir cascada, orden, snapshot-antes, rollback, soft-deleted, multi-período, counts. **Primero.** |

### No changes

- `rule_set/sql/data_model.sql` — sin migración de FKs (las comentadas siguen comentadas).
- `rule_set/api/routes/admin_routes.js:24` — misma ruta, mismo verbo.
- Motor JS (`rule_engine.js`) y simuladores — ajenos al borrado de ofertas.

### Risks

- **Orden de DELETE / FK viva.** `cfg_offer_param` tiene FK real a `cfg_offer_ruleset`. Borrar la oferta
  antes que sus params lanza violación de FK. **Mitigación:** orden fijo (params en paso 5, ruleset en
  paso 6) verificado por test; todo en una transacción que hace rollback ante error.
- **Reglas/condiciones/acciones huérfanas si la transacción se parte.** Sus FKs están comentadas → la BD
  no protege. **Mitigación:** todo dentro de una única `sql.Transaction`; commit o rollback atómico.
- **Operación irreversible.** Un borrado masivo no se puede deshacer. **Mitigación:** snapshot automático
  previo; `snapshot_id` devuelto y restaurable desde la página de snapshots.
- **Params soft-deleted olvidados.** Si la query de borrado de params arrastrara el filtro `enabled=1`
  (como `listParams`), dejaría huérfanos `enabled=0` que romperían la FK al borrar la oferta.
  **Mitigación:** borrar por `ruleset_id` sin filtro `enabled`; test que inserta una fila soft-deleted y
  verifica que también se borra.
- **Cambio de semántica del endpoint.** Consumidores que esperaban el 409 ven ahora un borrado en
  cascada. **Mitigación:** herramienta interna; el cambio es la intención explícita de negocio; UI con
  confirmación + snapshot.

## Open questions

1. **`comment`/`createdBy` del snapshot automático.** ¿Texto fijo tipo `"Auto: antes de borrar oferta
   {CODE}"` (paralelo al de restore) y `createdBy` opcional desde el frontend? Confirmar en diseño/spec.
2. **Mensaje exacto del diálogo y del éxito.** Redacción final en español (incluir nombre + code de la
   oferta, mención al snapshot). Se fija en spec/diseño junto con el equipo.
