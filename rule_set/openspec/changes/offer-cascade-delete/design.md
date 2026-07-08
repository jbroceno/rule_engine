# Design: offer-cascade-delete

## Technical Approach

Reescribir `deleteOffer(offerCode, createdBy)` en `admin_service.js` siguiendo el patrón cascade-in-transaction ya probado en `deleteRule` (490-539) y `applyConfig`. Flujo: (1) snapshot automático ANTES de la transacción, (2) abrir `sql.Transaction`, resolver `ruleset_id` por `code` con `resolveRulesetId` (sin filtro `enabled` → permite borrar ofertas deshabilitadas, lanza 404 si no existe), (3) cinco DELETE ordenados por FK, capturando rowcounts de reglas y params, (4) commit; rollback en catch. Se elimina el guard 409. El snapshot se toma con el pool normal (lee config completa vía `exportConfig`), no dentro de la transacción, para fotografiar el estado pre-borrado.

## Architecture Decisions

| Decisión | Elección | Alternativa rechazada | Razón |
|----------|----------|----------------------|-------|
| Resolver ruleset_id | `resolveRulesetId` (sin `enabled=1`) | `findRulesetIdByOfferCode` (filtra `enabled=1`) | Una oferta deshabilitada debe poder borrarse; `findRulesetId...` daría 404 falso. |
| Momento del snapshot | ANTES de `tx.begin()` | Dentro de la transacción | `createSnapshot` usa el pool y `exportConfig` (lecturas propias); meterlo en la tx no aporta y complica. Pre-begin captura el estado intacto. Si el DELETE falla y hace rollback, queda un snapshot "huérfano" inocuo (es solo un backup). |
| Scope de borrado | Todos los `offer_date_id` | Solo período activo | La oferta se elimina por completo; debe limpiar todos los períodos. DELETE por `ruleset_id` sin filtro de período. |
| Params soft-deleted | Hard-delete sin filtro `enabled` | Solo `enabled=1` | Filas `enabled=0` quedarían huérfanas con FK viva → violación al borrar el ruleset. Borrar por `ruleset_id` a secas. |
| createdBy al endpoint | Query param `?createdBy=` opcional | Body en DELETE | Body en DELETE está desaconsejado (HTTP). Default `null` si ausente; comment fijo. |
| Counts | `rowsAffected[0]` del DELETE de reglas y de params | COUNT previo | El rowcount del propio DELETE es exacto y gratis. |

## Data Flow

    UI deleteOffer (warning) ─→ admin-api.deleteOffer(code)
        └─ DELETE /api/admin/offers/:code?createdBy=…
             └─ removeOffer ─→ deleteOffer(code, createdBy)
                   ├─ createSnapshot("Auto: ...", comment, createdBy)  → snapshot_id   [pre-begin]
                   └─ tx: rulesetId = resolveRulesetId(code)
                        cv → cond → action → rule(count) → param(count) → ruleset
                        commit ─→ { offerCode, deleted, snapshot_id, deletedRules, deletedParams }

## DELETE statements (parametrizados, dentro de la tx, por @rulesetId)

```sql
-- 1) condition_values (join cond→rule→ruleset)
DELETE cv FROM dbo.cfg_offer_rule_condition_value cv
  INNER JOIN dbo.cfg_offer_rule_condition c ON c.cond_id = cv.cond_id
  INNER JOIN dbo.cfg_offer_rule r          ON r.rule_id = c.rule_id
  WHERE r.ruleset_id = @rulesetId;
-- 2) conditions (join rule→ruleset)
DELETE c FROM dbo.cfg_offer_rule_condition c
  INNER JOIN dbo.cfg_offer_rule r ON r.rule_id = c.rule_id
  WHERE r.ruleset_id = @rulesetId;
-- 3) actions (join rule→ruleset)
DELETE a FROM dbo.cfg_offer_rule_action a
  INNER JOIN dbo.cfg_offer_rule r ON r.rule_id = a.rule_id
  WHERE r.ruleset_id = @rulesetId;
-- 4) rules  → deletedRules = rowsAffected[0]
DELETE FROM dbo.cfg_offer_rule  WHERE ruleset_id = @rulesetId;
-- 5) params (TODOS, sin filtro enabled) → deletedParams = rowsAffected[0]
DELETE FROM dbo.cfg_offer_param WHERE ruleset_id = @rulesetId;
-- 6) ruleset (la oferta)
DELETE FROM dbo.cfg_offer_ruleset WHERE ruleset_id = @rulesetId;
```

Cada paso usa su propio `tx.request().input("rulesetId", sql.Int, rulesetId)` (un input por request, igual que `deleteRule`).

## File Changes

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `api/services/admin_service.js` | Modify | Reescribir `deleteOffer(offerCode, createdBy)`: quitar guard 409, snapshot pre-begin, transacción con los 6 DELETE, counts, response ampliada. |
| `api/controllers/admin_offers_controller.js` | Modify | `removeOffer`: leer `createdBy` de `req.query.createdBy ?? null`, pasarlo a `deleteOffer`. |
| `web/.../services/admin-api.service.ts` | Modify | `deleteOffer(offerCode, createdBy?)`: añadir query param; tipo retorno `AdminOfferDeleteResponse` ampliado. |
| `web/.../models/admin.models.ts` | Modify | `AdminOfferDeleteResponse` += `snapshot_id: number; deletedRules: number; deletedParams: number`. |
| `web/.../pages/configurator-page.component.ts` | Modify | `deleteOffer`: mensaje cascada (todas reglas+params en todos los períodos, irreversible, snapshot). `executeOfferDelete`: mostrar counts + snapshot_id en `offerActionSuccess`. |
| `test/admin_offer_cascade_delete.test.js` | Create | Test de integración (node:test, real tx + rollback, skip sin credenciales). |

## Interfaces / Contracts

```ts
// Response (controller 200)
interface AdminOfferDeleteResponse {
  offerCode: string; deleted: boolean;
  snapshot_id: number; deletedRules: number; deletedParams: number;
}
// service: deleteOffer(offerCode: string, createdBy?: string|null)
// snapshot: name="Grabacion {YYYY-MM-DD HH:mm}", comment=`Auto: antes de borrar oferta ${offerCode}`
```

## Testing Strategy (Strict TDD — tests PRIMERO)

El proyecto NO mockea `sql.Transaction`: los tests de BD existentes (`workflow_upsert_match.test.js`) abren un pool real, siembran dentro de una transacción y hacen rollback en `finally`, con `{ skip: !hasSqlCredentials() }`. Replicamos ese patrón.

| Capa | Qué probar | Cómo |
|------|-----------|------|
| Integración (tx+rollback) | Cascada completa borra cv/cond/action/rule/param/ruleset | Sembrar oferta+regla+cond+value+action+param en una tx propia, llamar a la lógica de cascada, verificar 0 filas; rollback al final. |
| Integración | Scope todos los períodos | Sembrar params/reglas en 2 `offer_date_id`; verificar que ambos desaparecen. |
| Integración | Params soft-deleted incluidos | Sembrar param `enabled=0`; verificar borrado. |
| Integración | Counts correctos | `deletedRules`/`deletedParams` === filas sembradas. |
| Integración | Snapshot creado primero | Verificar `snapshot_id` devuelto y fila en `cfg_config_snapshot`. |
| Integración | 404 si code no existe | `resolveRulesetId` lanza `AppError 404`. |
| Integración | Rollback en fallo intermedio | Forzar error tras un DELETE; verificar que nada se borró. |

Fichero: `/rule_set/test/admin_offer_cascade_delete.test.js` (bajo `test/` porque ES un test real; `npm test` lo recoge). Skip limpio sin credenciales SQL.

## Migration / Rollout

Sin migración de esquema (cascada a nivel app, FKs siguen comentadas salvo `cfg_offer_param`). Rollback operativo = restaurar el snapshot automático previo vía `/snapshots`.

## Open Questions

- [ ] Texto exacto del diálogo de confirmación y del mensaje de éxito (español) — se cierra en sdd-tasks/apply.
- [ ] ¿Mostrar nombre de oferta además del code en el mensaje de éxito? (la UI ya tiene `offer.name`).
