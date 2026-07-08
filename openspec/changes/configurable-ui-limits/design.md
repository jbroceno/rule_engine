# Diseño técnico: `configurable-ui-limits`

> **Estado**: Diseño completo. Implementación diferida.
> **Bloqueante**: el cambio modifica el contrato POC↔WF (`uiLimits` se vuelve dinámico, dependiente de `aggregate` declarado en cada acción). La aplicación **WF (Workflow)** queda fuera del alcance actual y debe coordinarse antes de implementar.

Este documento es la traducción técnica de `proposal.md` y resuelve las tres preguntas abiertas (Q1, Q2, Q3) que quedaron pendientes. Está pensado para que un implementador futuro pueda abordar el cambio en frío, con la suficiente granularidad por capa.

---

## 1. Decisiones de diseño resueltas

### Q1 — Política ante colisión de `aggregate` para el mismo `field`

**Decisión adoptada**

- **Validación en modo no estricto**: emitir **warning** (no rotura) cuando dos acciones distintas escriben el mismo `field` con valores **no-`NONE`** distintos de `aggregate` (p. ej. una acción declara `MIN` y otra `MAX` sobre `maxPlazo`). El warning se reporta a través del mismo canal que las validaciones suaves de `normalizeConfig`.
- **Validación en modo estricto (`strictValidation: true`)**: el mismo escenario se promueve a **error**, abortando la carga del config. Esto se usa en `POST /admin/validate` y en el pipeline de `apply` antes de persistir.
- **Semántica en runtime (cuando la validación deja pasar)**: **last-action-wins**. La última acción ejecutada (orden actual: `priority` descendente, `rule_id` ascendente) define el modo `aggregate` efectivo para ese `field` en esa oferta.

**Alternativas evaluadas**

| Opción           | Pros                                                                 | Contras                                                                                       |
|------------------|----------------------------------------------------------------------|-----------------------------------------------------------------------------------------------|
| **Last-wins (elegida)** | Coherente con la semántica actual de `SET`/`ADD`/`APPEND` sobre `dictamen[field]`; migración suave; el config se autocorrige al pasar por el validador estricto. | Si nadie corre validación estricta, una colisión puede producir agregación inesperada en producción. |
| Strict-only      | Imposible meter configs ambiguos.                                    | Migración rígida: cualquier snapshot legacy que (por casualidad) escriba el mismo campo desde dos reglas distintas, peta. Demasiado agresivo para una transición. |
| First-wins       | Predecible respecto a "el primero define el contrato".               | Contraintuitivo: rompe la convención del motor (`SET` last-wins). Hace que un cambio de prioridad no surta efecto sobre `aggregate`. |

**Por qué last-wins + validación escalonada gana**

1. **Consistencia con `applyActions`**: el `dictamen[field]` ya sigue last-wins para el valor escrito; resulta natural que el `aggregate` asociado siga la misma regla.
2. **Migración soft**: snapshots existentes (que no declaran `aggregate`) se procesan en modo no estricto sin abortar; el operador ve warnings y puede limpiar progresivamente.
3. **Auto-corrección**: cuando se ejecuta `apply` (snapshot, import, grabar config), `strictValidation: true` está activo y bloquea configs ambiguos. La incoherencia no llega a producción si el operador respeta el flujo.

---

### Q2 — Compatibilidad hacia atrás con `UI_LIMITS_MIN` / `UI_LIMITS_MAX`

**Decisión adoptada**

- Introducir un **único flag de transición**: `RULE_ENGINE_LEGACY_UI_LIMITS` (variable de entorno, también aceptable como opción `legacyUiLimits` en `normalizeConfig({...})`). Cuando vale `1` / `true` **y** el config cargado **no contiene ninguna acción con `aggregate ∈ {MIN, MAX}`**, el motor cae al comportamiento histórico (`UI_LIMITS_MIN` / `UI_LIMITS_MAX` hardcodeados).
- Si **al menos una acción** declara `aggregate ∈ {MIN, MAX}` en cualquier oferta, el motor adopta el modo nuevo de forma íntegra y los arrays hardcodeados pasan a estar muertos, independientemente del flag. Esto evita rutas duales en simultáneo.
- **Cutoff de deprecación**: una vez WF esté actualizado y todas las acciones que hoy pueblan `uiLimits` declaren `aggregate`, se elimina:
  - El flag `RULE_ENGINE_LEGACY_UI_LIMITS`
  - Los arrays `UI_LIMITS_MIN`, `UI_LIMITS_MAX`, `LIMIT_FIELDS`
  - Se documenta en `CHANGELOG.md` y se programa como issue separado.

**Por qué un flag y no detección automática silenciosa**

- El flag es **explícito** y queda en el `.env` de cada entorno (POC, WF, dev). Hace visible la fase de transición.
- La condición de bypass automático (cuando alguna acción declara `aggregate`) garantiza que el flag no quede activo por descuido en producción una vez migrado.
- Evita el escenario "POC migrado, WF legacy" produciendo `uiLimits` distintos sin que nadie lo note.

---

### Q3 — Visibilidad en `trace`

**Decisión adoptada**

- Cuando `options.debug === true`, `precheck` / `initcheck` / `finalize` añaden al envelope una sección `trace.uiLimitsAggregation` con la forma:

  ```json
  {
    "uiLimitsAggregation": {
      "minHipoteca": {
        "mode": "MIN",
        "sources": [
          { "offerCode": "OFERTA_RESTRICTIVA", "rule_id": 12, "action_id": 34 },
          { "offerCode": "OFERTA_PERMISIVA",  "rule_id": 27, "action_id": 51 }
        ],
        "effectiveValue": 50000
      }
    }
  }
  ```

- `sources` lista todas las acciones (en distintas ofertas) que contribuyeron al límite agregado. El **último elemento** por oferta es la que ganó dentro de esa oferta (last-action-wins).
- Esta estructura se omite cuando `debug !== true` para no inflar el envelope en producción.

**Por qué nivel envelope y no por oferta**

- `uiLimits` se calcula **agregando entre ofertas**; la información solo tiene sentido a ese nivel.
- Por oferta (dentro de `dictamen.__aggregate`, ver §2) se mantiene el modo efectivo, suficiente para reconstruir el envelope si hace falta.

---

## 2. Cambios técnicos detallados, por capa

> Convención: en cada apartado se describe **qué cambia, dónde y la forma del cambio** (signatures / código aproximado). El detalle exacto se materializa en `sdd-tasks` cuando se reabra el ciclo.

### 2.1 Esquema SQL — `dbo.cfg_offer_rule_action`

**Archivo**: `/rule_set/sql/data_model.sql`

Añadir columna opcional `aggregate`:

```sql
ALTER TABLE dbo.cfg_offer_rule_action
  ADD aggregate NVARCHAR(8) NULL
      CONSTRAINT CK_cfg_offer_rule_action_aggregate
      CHECK (aggregate IS NULL OR aggregate IN (N'MIN', N'MAX', N'NONE'));
```

- `NULL` se interpreta semánticamente igual que `NONE` (no se publica en `uiLimits`).
- El `CHECK` constraint blinda la coherencia incluso ante escrituras directas a la tabla.
- **Migration script outline**:
  1. `ALTER TABLE … ADD aggregate …` (idempotente: chequear `sys.columns` antes).
  2. Backfill opcional **sólo para campos previamente publicados**:
     ```sql
     UPDATE a
       SET aggregate = CASE WHEN a.field IN (N'minHipoteca', N'minPlazo', N'minPlazoMeses', N'minLtvExclusive', N'minLtvRatio') THEN N'MIN'
                            WHEN a.field IN (N'maxHipoteca', N'maxPlazo', N'maxPlazoMeses', N'maxLtv', N'maxLtvRatio', N'edadPlazo') THEN N'MAX'
                            ELSE N'NONE' END
       FROM dbo.cfg_offer_rule_action a
      WHERE a.aggregate IS NULL;
     ```
     Este backfill **no es obligatorio** — el fallback Q2 cubre snapshots sin la columna poblada — pero es recomendable para eliminar dependencia del flag legacy lo antes posible.

### 2.2 Stored procedures / loaders

**Archivos afectados**:

- `/rule_set/sql/sp_rules_params.sql` — `dbo.cfg_get_rules_json`
- `dbo.cfg_get_offers_and_params_json` (SP primario; localizar en `sql/`)
- `dbo.cfg_get_workflow_snapshot_json` (publicación POC→WF y restore WF→POC)

En cada SP, en el bloque `FOR JSON` que serializa la acción, añadir el campo `aggregate` con `ISNULL(aggregate, N'NONE')`:

```sql
SELECT
  a.action_id,
  a.action_type,
  a.field,
  a.value,
  a.value_type,
  ISNULL(a.aggregate, N'NONE') AS aggregate
FROM dbo.cfg_offer_rule_action a
WHERE ...
FOR JSON PATH;
```

- Para snapshots históricos restaurados, los `rules_json` no traerán el campo. El motor (vía fallback Q2) los procesará en modo legacy hasta que se rescriban.

### 2.3 `rule_engine.js`

**Archivo**: `/rule_set/rule_engine.js`

#### 2.3.1 Constantes y `validateConfigShape`

- Añadir `const SUPPORTED_AGGREGATE = new Set(["MIN", "MAX", "NONE"]);`
- Añadir dentro del bucle `for (const action of actions)` (línea ~236):

  ```js
  if (action?.aggregate !== undefined && action?.aggregate !== null) {
    if (!SUPPORTED_AGGREGATE.has(action.aggregate)) {
      errors.push(buildValidationError(`${actionPath}.aggregate`,
        `unsupported aggregate '${action.aggregate}', expected one of MIN|MAX|NONE`));
    } else if (strictValidation && action.aggregate !== "NONE" && action.value_type !== "NUMBER") {
      errors.push(buildValidationError(`${actionPath}.aggregate`,
        `aggregate '${action.aggregate}' requires value_type='NUMBER'`));
    }
  }
  ```

- **Detección de colisión** (modo estricto): tras procesar todas las acciones de todas las reglas de la oferta, construir un mapa `Map<field, Set<aggregate>>` y emitir error si alguno tiene más de un modo no-`NONE` distinto. Pseudo-código:

  ```js
  const aggregateByField = new Map(); // field -> Set<{MIN|MAX}>
  for (const rule of rules) {
    for (const action of rule.actions ?? []) {
      const agg = action?.aggregate;
      if (agg && agg !== "NONE" && SUPPORTED_AGGREGATE.has(agg)) {
        if (!aggregateByField.has(action.field)) aggregateByField.set(action.field, new Set());
        aggregateByField.get(action.field).add(agg);
      }
    }
  }
  for (const [field, modes] of aggregateByField.entries()) {
    if (modes.size > 1) {
      const msg = `field '${field}' declared with conflicting aggregate modes: ${[...modes].join(", ")}`;
      if (strictValidation) errors.push(buildValidationError(`${offerPath}`, msg));
      else warnings.push(/* canal de warnings */ msg);
    }
  }
  ```

  > Nota: hoy `validateConfigShape` solo devuelve `errors`. Para soportar Q1 hay que extender el contrato a `{ errors, warnings }` o añadir un segundo retorno. La forma exacta se decide en `sdd-tasks` (la opción más simple: cambiar la firma a un objeto y actualizar callers; son 2-3 sitios).

#### 2.3.2 `applyActions` — propagación del modo

**Decisión clave (alternativa elegida — ver §6)**: registrar el modo en `trace` (no en `dictamen`).

Razonamiento (resumen — detalle en §6):
- `dictamen` es contrato de salida hacia la UI y hacia WF. Inyectar un mapa lateral `__aggregate` allí ensucia el contrato y obliga a filtrarlo en cada serializador.
- `trace` ya es la sede natural del metadato de ejecución y ya viaja oferta por oferta.

Cambio concreto en `applyActions` (línea ~550):

```js
function applyActions(dictamen, rule, offerCode, paramsIndex, applied, trace, matchedConds = []) {
  for (const action of rule.actions ?? []) {
    // ... cálculo de value (sin cambios) ...

    if (action.action_type === "SET") {
      dictamen[action.field] = value;
    } else if (action.action_type === "APPEND") {
      // ... sin cambios ...
    } else if (action.action_type === "ADD") {
      dictamen[action.field] = Number(dictamen[action.field] ?? 0) + Number(value ?? 0);
    } else {
      throw new Error(`Unsupported action_type: ${action.action_type}`);
    }

    // NUEVO: registrar modo de agregación efectivo (last-action-wins por field)
    const agg = action.aggregate;
    if (agg && agg !== "NONE") {
      trace.aggregateByField = trace.aggregateByField || {};
      trace.aggregateByField[action.field] = {
        mode: agg,
        sourceRuleId: rule.rule_id,
        sourceActionId: action.action_id,
      };
    }
  }
  // ... resto sin cambios ...
}
```

- `trace.aggregateByField` es **por oferta** (vive en el `trace` que `evaluateRuleset` retorna para cada oferta).
- Last-action-wins se materializa naturalmente porque cada acción nueva sobrescribe la entry del `field`.

#### 2.3.3 `aggregateUiLimits` — descubrimiento dinámico

Reemplazo completo de la función (línea ~666):

```js
function aggregateUiLimits(offersWithDictamen, options = {}) {
  const ui = {};
  const aggregationDebug = options.debug ? {} : null;

  // 1) Descubrir todos los (field, mode) que aparecen en los traces.
  //    Last-action-wins ya está aplicado dentro de cada oferta.
  const modesByField = new Map(); // field -> mode efectivo (last-wins entre ofertas también)
  const sourcesByField = new Map(); // field -> [{offerCode, rule_id, action_id}]

  for (const offer of offersWithDictamen) {
    const aggMap = offer.trace?.aggregateByField || {};
    for (const [field, info] of Object.entries(aggMap)) {
      modesByField.set(field, info.mode); // last offer wins (orden de iteración)
      if (!sourcesByField.has(field)) sourcesByField.set(field, []);
      sourcesByField.get(field).push({ offerCode: offer.offerCode, rule_id: info.sourceRuleId, action_id: info.sourceActionId });
    }
  }

  // 2) Fallback Q2: si NO hay ningún field con modo declarado, usar arrays legacy.
  if (modesByField.size === 0 && options.legacyUiLimits === true) {
    return aggregateUiLimitsLegacy(offersWithDictamen);
  }

  // 3) Agregar según el modo declarado.
  for (const [field, mode] of modesByField.entries()) {
    const values = offersWithDictamen
      .map((o) => o.dictamen?.[field])
      .filter((v) => typeof v === "number" && Number.isFinite(v));
    if (!values.length) continue;
    if (mode === "MIN") ui[field] = Math.min(...values);
    else if (mode === "MAX") ui[field] = Math.max(...values);
    // NONE: nunca llega acá (filtrado arriba)

    if (aggregationDebug) {
      aggregationDebug[field] = {
        mode,
        sources: sourcesByField.get(field) || [],
        effectiveValue: ui[field],
      };
    }
  }

  return aggregationDebug ? { ui, debug: aggregationDebug } : ui;
}

function aggregateUiLimitsLegacy(offersWithDictamen) {
  // Comportamiento histórico: UI_LIMITS_MIN / UI_LIMITS_MAX hardcodeados.
  // Se mantiene durante la transición controlada por RULE_ENGINE_LEGACY_UI_LIMITS.
  // TODO(deprecation cutoff): borrar esta función y los arrays UI_LIMITS_* tras migrar WF.
  const ui = {};
  for (const field of UI_LIMITS_MIN_LEGACY) { /* ... como hoy ... */ }
  for (const field of UI_LIMITS_MAX_LEGACY) { /* ... como hoy ... */ }
  return ui;
}
```

- Los callers (`initcheck`, `precheck`, `finalize`) pasan `{ debug, legacyUiLimits }` derivados de `options` (ver §2.3.4).
- Renombrar las constantes vivas a `UI_LIMITS_MIN_LEGACY` / `UI_LIMITS_MAX_LEGACY` para dejar claro que son transitorias.

#### 2.3.4 `initcheck`, `precheck`, `finalize`

- Aceptar y propagar `options.legacyUiLimits` (default: leer de `process.env.RULE_ENGINE_LEGACY_UI_LIMITS === "1"`).
- Si `options.debug === true`, capturar el envelope retornado por `aggregateUiLimits` y exponer `uiLimitsAggregation`:

  ```js
  const aggRes = aggregateUiLimits(eligibleFull, { debug, legacyUiLimits });
  const uiLimits = debug ? aggRes.ui : aggRes;
  const uiLimitsAggregation = debug ? aggRes.debug : undefined;
  return { eligibleOffers, uiLimits, ...(debug ? { uiLimitsAggregation } : {}), all };
  ```

#### 2.3.5 Borrado — `LIMIT_FIELDS`

- Eliminar `const LIMIT_FIELDS = [...]` (línea 659). Está declarado y no se referencia en ningún punto del repo (verificable con `rg "LIMIT_FIELDS"`).

### 2.4 API admin

#### 2.4.1 `admin_validator.js`

**Archivo**: `/rule_set/api/validators/admin_validator.js`

- Aceptar `aggregate` en el `action_payload` (o como campo plano según cómo viaje hoy — verificar con `normalizeActionType`).
- Reusar `SUPPORTED_AGGREGATE`/`ALLOWED_AGGREGATE` (importado o duplicado en `utils/rule_catalogs.js`).
- Validar:
  - Si presente, ∈ `{MIN, MAX, NONE}`.
  - Si ∈ `{MIN, MAX}`, `value_type` debe ser `NUMBER`.

#### 2.4.2 `admin_rules_controller.js` y `admin_service.js`

**Archivos**:
- `/rule_set/api/controllers/admin_rules_controller.js`
- `/rule_set/api/services/admin_service.js`

- En el upsert de acciones (`INSERT`/`UPDATE` sobre `cfg_offer_rule_action`), persistir `aggregate` (`NULL` si viene `undefined` o `"NONE"`; o conservar `"NONE"` literal — definir convención al ejecutar; recomiendo persistir `NULL` para minimizar storage y tratar `NULL == NONE` en SELECT).
- En el GET (`/rules`), exponer `aggregate` en cada acción (ya viene del SP con `ISNULL(..., 'NONE')`).

#### 2.4.3 `utils/rule_catalogs.js`

**Archivo**: `/rule_set/api/utils/rule_catalogs.js`

- Añadir `export const ALLOWED_AGGREGATE = new Set(["MIN", "MAX", "NONE"]);`
- Añadir `export function normalizeAggregate(v) { /* trim + upper + default NONE */ }`.

### 2.5 Export / Import / Snapshot

- **Export** (`admin_export_controller.js`): no requiere cambios — el campo viaja en `rules` porque el SELECT lo trae.
- **Import / Apply** (`admin_apply_controller.js` + `admin_service.applyConfig`): persistir el campo en el INSERT a `cfg_offer_rule_action`.
- **Snapshot**:
  - **Creación**: el snapshot guarda `rules_json` tal cual lo lee del SP; ya incluirá `aggregate`.
  - **Restore**:
    - Si el snapshot **trae** `aggregate` → escritura directa.
    - Si **no lo trae** (snapshot histórico) → escribir `NULL` en la columna; el fallback Q2 activado garantiza que el motor lo procese correctamente.

### 2.6 Workflow adapter (BLOQUEANTE — fuera del scope actual)

> **Esta sección es la razón por la que el cambio está diferido.** Documentar los puntos de cambio aunque la implementación se haga en otro ciclo coordinado con el equipo de WF.

#### 2.6.1 `api/services/workflow_adapter.js`

**Archivo**: `/rule_set/api/services/workflow_adapter.js`

- `adaptMotorToWorkflow(motorResult)` (línea 73-89): `LIMITES: motorResult.uiLimits` ya es dinámico → **no requiere cambios estructurales**, pero requiere que WF entienda que las claves del objeto pueden cambiar entre versiones de config. Validar con el equipo WF si su esquema de validación (¿JSON schema, contratos en algún OpenAPI?) acepta `additionalProperties` o si hay que sincronizar listas.

#### 2.6.2 `api/services/admin_workflow_service.js`

- Verificar que en el ciclo de publicación POC→WF (y restore WF→POC), el campo `aggregate` viaje en el `rules_json` del snapshot WF.
- Si el SP `cfg_get_workflow_snapshot_json` no lo incluye (ver §2.2), se publica vacío y WF queda en modo legacy permanente.
- **Punto crítico**: hasta que WF declare las mismas acciones con `aggregate`, **el flag `RULE_ENGINE_LEGACY_UI_LIMITS` debe permanecer `1` en WF**, y la migración solo puede cerrar (cutoff) cuando ambos entornos hayan publicado configs con `aggregate`.

#### 2.6.3 Aplicación WF (Workflow) externa

- Los formularios de configuración de WF deben sumar el `<select>` de `aggregate` en su propio formulario de acción (paralelo a §2.7).
- El validador del lado WF debe replicar la lógica de §2.4.1.
- Sin esto, una publicación POC→WF puede dejar el campo `NULL` y romper la sincronización si POC ya migró.

### 2.7 Configurator UI

**Archivos**:
- `/rule_set/web/src/app/pages/configurator-page.component.ts`
- `/rule_set/web/src/app/pages/configurator-page.component.html`
- `/rule_set/web/src/app/pages/configurator-page.component.css`

- En el formulario de **acción de regla** (panel rules → editor de actions), añadir un `<select>` `aggregate` con opciones:
  - `Ninguna` → `NONE`
  - `Mínimo` → `MIN`
  - `Máximo` → `MAX`
- Default: `NONE`.
- Validación cliente:
  - Si `aggregate ∈ {MIN, MAX}`, el `value_type` de la acción debe ser `NUMBER`. Si el usuario elige `MIN`/`MAX` con `value_type` distinto, mostrar error inline y deshabilitar el submit.
- Persistir el valor en el payload del controlador `admin-api.service.ts`.
- En el listado de acciones, mostrar el modo como badge pequeño (`MIN`/`MAX`) junto al `field` para que el operador vea de un vistazo qué se publica.

### 2.8 Modelos TypeScript

**Archivo**: `/rule_set/web/src/app/models/admin.models.ts`

```ts
export type AdminAggregate = "MIN" | "MAX" | "NONE";

export interface AdminRuleAction {
  action_type: string;
  action_payload: Record<string, unknown>;
  aggregate?: AdminAggregate;   // NUEVO
}
```

(Dependiendo de cómo viva hoy `aggregate` en `action_payload` vs como hermano, mantener consistencia. La opción más limpia es exponerlo como hermano del `action_payload`, alineado con cómo viaja `aggregate` en `cfg_offer_rule_action` — columna propia.)

También exponer `aggregate?` en `api.models.ts` → `RuleAction` para que la UI de simulación pueda mostrarlo en `trace.uiLimitsAggregation`:

```ts
export interface RuleAction {
  action_id?: number;
  action_type: string;
  field: string;
  value?: unknown;
  value_type?: string;
  aggregate?: "MIN" | "MAX" | "NONE";   // NUEVO
}
```

### 2.9 Tests

**Archivos**:
- `/rule_set/test/rule_engine.test.js`
- `/rule_set/test/workflow_adapter.test.js`
- Eventual `test/admin_validator.test.js` (si existe).

Detalle de matriz de tests → §5.

---

## 3. Estrategia de migración

### 3.1 Orden recomendado de despliegue

1. **SQL**: aplicar migration `ALTER TABLE … ADD aggregate` con `CHECK` constraint. Idempotente.
2. **SP**: redepliegue de `cfg_get_offers_and_params_json`, `cfg_get_rules_json`, `cfg_get_workflow_snapshot_json` con el nuevo campo.
3. **Motor**: desplegar `rule_engine.js` con `RULE_ENGINE_LEGACY_UI_LIMITS=1` en todos los entornos (POC, WF, dev). En este estado, el comportamiento es idéntico al actual porque ninguna acción declara `aggregate`.
4. **API admin**: añadir validación y persistencia de `aggregate`. Idempotente respecto al motor.
5. **UI configurador**: exponer el `<select>`. Operadores pueden empezar a declarar `aggregate` en reglas nuevas y existentes.
6. **WF adapter** (último, coordinado con equipo WF): asegurar que `aggregate` viaja en `rules_json` POC↔WF y que la app WF entiende el campo. Cambiar `RULE_ENGINE_LEGACY_UI_LIMITS=0` en POC primero, validar, luego en WF.
7. **Cleanup post-cutoff** (issue separado): eliminar `RULE_ENGINE_LEGACY_UI_LIMITS`, `UI_LIMITS_MIN_LEGACY`, `UI_LIMITS_MAX_LEGACY`, `LIMIT_FIELDS`, `aggregateUiLimitsLegacy`.

### 3.2 Backfill

- **Snapshots existentes**: no se modifican retroactivamente. Al restaurarlos, el motor opera en modo legacy gracias a Q2.
- **Reglas activas**: el backfill opcional (§2.1) puede ejecutarse para acelerar la migración. Si no se ejecuta, los operadores migran progresivamente por UI.
- **Verificación pre-cutoff**: query SQL para confirmar que no quedan acciones cuyo `field` aparecía en `UI_LIMITS_*_LEGACY` y tienen `aggregate IS NULL OR aggregate = 'NONE'`:

  ```sql
  SELECT a.action_id, a.field, a.aggregate
    FROM dbo.cfg_offer_rule_action a
   WHERE a.field IN (
        N'minHipoteca', N'minPlazo', N'minPlazoMeses', N'minLtvExclusive', N'minLtvRatio',
        N'maxHipoteca', N'maxPlazo', N'maxPlazoMeses', N'maxLtv', N'maxLtvRatio', N'edadPlazo'
     )
     AND (a.aggregate IS NULL OR a.aggregate = N'NONE');
  ```

  Esta query debe devolver 0 filas tanto en POC como en WF antes de cerrar el cutoff.

### 3.3 Cutoff

Condiciones obligatorias para cerrar la migración:

1. POC y WF tienen actualizado el motor (commit con `aggregateUiLimits` nuevo).
2. POC y WF han publicado snapshots con `aggregate` declarado en todas las acciones publicables.
3. La query de verificación devuelve 0 filas en ambos entornos.
4. La app WF entiende el campo en sus formularios.
5. Tests de regresión POC↔WF (`/admin/workflow/compare`) verdes.

Solo cuando se cumplen los 5 puntos se ejecuta el cleanup y se borra el flag legacy.

---

## 4. Compatibilidad y riesgos técnicos

### 4.1 Asimetría POC↔WF durante la transición

**Riesgo**: que POC migre antes que WF y `/admin/workflow/compare` reporte `limites.match = false` por diferencia entre `uiLimits` dinámico (POC) y legacy (WF).

**Mitigación**:
- Mantener `RULE_ENGINE_LEGACY_UI_LIMITS=1` en ambos entornos hasta que ambos hayan publicado configs con `aggregate`.
- El flag legacy hace fallback **sólo cuando no hay ninguna acción con `aggregate`**, así que con WF aún sin migrar (configs sin `aggregate` en WF), POC también caería al fallback → ambos producen el mismo `uiLimits`.
- Una vez WF publica configs con `aggregate`, el flag se vuelve inerte y ambos entornos ejecutan la ruta nueva.

### 4.2 Performance

- `aggregateUiLimits` actual recorre `offersWithDictamen` una vez por field. La versión nueva recorre el array una vez para construir `modesByField` y otra vez por field para agregar. **Sigue siendo `O(N * F)` donde N = ofertas elegibles, F = campos con `aggregate ≠ NONE`**.
- En la práctica N ≤ 3-5 ofertas y F ≤ 10-15 fields. El impacto es despreciable.

### 4.3 Riesgo de drift entre `validateConfigShape` y `applyConfig`

- Hoy `apply` ya llama a `validateConfigShape({ strictValidation: true })` antes de persistir. Hay que verificar que el nuevo error de colisión Q1 se propaga correctamente al cliente (HTTP 400 con detalle).

### 4.4 Tests existentes — regresión

- Los tests actuales (`rule_engine.test.js`) trabajan con `rules.json` que escribe `minHipoteca`, `maxHipoteca`, etc. **Sin** declarar `aggregate`. Tras el cambio, si `RULE_ENGINE_LEGACY_UI_LIMITS` está activo, los tests deben seguir pasando idénticos. Si está desactivado, los tests deben actualizarse para declarar `aggregate` en las acciones correspondientes — o duplicarse para cubrir ambos modos.

---

## 5. Plan de tests

### 5.1 Unit tests — `rule_engine.test.js`

| ID    | Escenario | Resultado esperado |
|-------|-----------|--------------------|
| T-01  | Una sola oferta con `aggregate: "MIN"` en `field: "minHipoteca"` | `uiLimits.minHipoteca === dictamen.minHipoteca` |
| T-02  | Dos ofertas elegibles, ambas declaran `aggregate: "MIN"` con valores distintos | `uiLimits.minHipoteca === Math.min(v1, v2)` |
| T-03  | Dos ofertas elegibles, ambas declaran `aggregate: "MAX"` | `uiLimits.maxPlazo === Math.max(v1, v2)` |
| T-04  | Acción con `aggregate: "NONE"` (o ausente) | el field NO aparece en `uiLimits` |
| T-05  | Acción con `aggregate: "MIN"` pero `value_type: "STRING"` en strict | `validateConfigShape` retorna error |
| T-06  | Acción con `aggregate: "FOO"` | `validateConfigShape` retorna error en cualquier modo |
| T-07  | Misma oferta, regla A `aggregate: "MIN"` sobre `f1`, regla B `aggregate: "MAX"` sobre `f1`, en strict | `validateConfigShape` retorna error de colisión |
| T-08  | Mismo escenario T-07 en no-strict | warning + runtime usa last-action-wins (regla con mayor prioridad o, a igual prioridad, mayor `rule_id`) |
| T-09  | Config sin ninguna `aggregate` declarada + `legacyUiLimits: true` | `uiLimits` se computa por arrays legacy (comportamiento histórico) |
| T-10  | Config con al menos una `aggregate` declarada + `legacyUiLimits: true` | `uiLimits` se computa por modo dinámico (el flag queda inerte) |
| T-11  | `options.debug: true` | el envelope incluye `uiLimitsAggregation` con `mode`, `sources`, `effectiveValue` |
| T-12  | `options.debug: false` | el envelope NO incluye `uiLimitsAggregation` |
| T-13  | Valor no numérico en `dictamen[field]` cuando `aggregate: "MIN"` | el field se ignora en `uiLimits` (filtrado por `typeof === "number"`) |
| T-14  | INIT-stage: una acción `aggregate: "MAX"` solo en regla INIT | `initcheck.uiLimits` lo refleja; `precheck`/`finalize` lo recomputan correctamente |
| T-15  | `finalize` con preResult ya calculado: la agregación toma todos los dictámenes (pre + final mergeados) | `uiLimits` consistente con `eligibleOffers` final |

### 5.2 Unit tests — `workflow_adapter.test.js`

| ID    | Escenario | Resultado esperado |
|-------|-----------|--------------------|
| W-01  | `motorResult.uiLimits = { minHipoteca: 50000, maxPlazo: 30 }` | `LIMITES.minHipoteca === 50000`, `LIMITES.maxPlazo === 30` (sin cambios estructurales) |
| W-02  | `motorResult.uiLimits` vacío | `LIMITES === {}` (no `null`) |
| W-03  | `motorResult.uiLimits` contiene un field nuevo no listado en arrays legacy | aparece en `LIMITES` sin filtrado (confirma que la lista hardcodeada ya no es gating) |

### 5.3 Integration tests — API admin

| ID    | Escenario | Resultado esperado |
|-------|-----------|--------------------|
| I-01  | `POST /admin/rules` con `aggregate: "MIN"` y `value_type: "NUMBER"` | 200, persiste `aggregate` en DB |
| I-02  | `POST /admin/rules` con `aggregate: "FOO"` | 400 con detalle del campo |
| I-03  | `POST /admin/rules` con `aggregate: "MAX"` y `value_type: "STRING"` | 400 |
| I-04  | `GET /admin/rules` | cada acción incluye `aggregate` (o `"NONE"` si NULL en DB) |
| I-05  | `POST /admin/validate` con dos acciones colisionantes (mismo field, distintos `aggregate` no-NONE) | 400 |
| I-06  | `POST /admin/config/apply` con un config inconsistente | 400, no se crea snapshot |
| I-07  | `POST /admin/snapshots/:id/restore` con snapshot legacy (sin `aggregate`) | 200, restore exitoso, motor opera en fallback |

### 5.4 Smoke test POC↔WF

- Ejecutar `/admin/workflow/compare` con un caso conocido:
  - **Antes de migración**: `limites.match === true` (ambos legacy).
  - **Durante migración (POC migrado, WF legacy)**: `limites.match === true` (POC también legacy gracias al flag).
  - **Post-migración**: `limites.match === true` (ambos dinámicos).

---

## 6. Alternativas técnicas descartadas

### 6.1 Mapa lateral `__aggregate` en `dictamen` vs en `trace`

**Elegida**: registrar en `trace.aggregateByField` (no en `dictamen`).

**Por qué**:

| Aspecto | `dictamen.__aggregate` | `trace.aggregateByField` (elegida) |
|---------|------------------------|------------------------------------|
| Contrato hacia UI/WF | Lo ensucia: hay que filtrarlo en serializadores y en `adaptMotorToWorkflow`. | Limpio: `trace` ya es metadato de ejecución, nadie lo serializa hacia WF como parte del contrato funcional. |
| Reactividad ante cambios | Si en el futuro `dictamen` se serializa con `JSON.stringify` directo, el mapa lateral aparece. Property no-enumerable rompe en clones (`structuredClone`). | `trace` está pensado para incluir metadatos diagnósticos. |
| Performance | Idéntico. | Idéntico. |
| Debugabilidad | Mezclar metadato de motor con datos de dominio dificulta el debugging. | El metadato vive donde se espera. |

**Coste**: `aggregateUiLimits` lee de `offer.trace.aggregateByField` en vez de `offer.dictamen.__aggregate`. Cambio trivial en el firmado.

### 6.2 `aggregate` como string vs enum vs bitmask

**Elegida**: `aggregate: "MIN" | "MAX" | "NONE"` (string literal).

**Por qué**:

- **Enum (TS) / lookup table SQL**: la columna ya tiene `CHECK CONSTRAINT`; un FK a una tabla `cfg_aggregate_mode` añade ceremonia sin beneficio (3 valores cerrados). Y el TS type union ya da seguridad de tipos.
- **Bitmask (`1=MIN, 2=MAX, …`)**: no hay agregaciones compuestas previstas (un field es MIN o MAX, no ambos). Bitmask sería sobre-ingeniería y haría el config menos legible.
- **String literal**: legible en JSON, legible en SQL, compatible con el patrón existente (`action_type`, `value_type` son todos strings con whitelist).

### 6.3 Mantener `LIMIT_FIELDS` como whitelist de "campos permitidos"

**Descartada**.

Aunque al principio pueda parecer una buena idea limitar qué fields pueden tener `aggregate: MIN|MAX`, **contradice el espíritu del cambio**: el punto era abrir la lista de límites configurables. Mantener `LIMIT_FIELDS` como gate sería volver a tener un acoplamiento `código <-> lista de fields`.

Si en el futuro se necesita una whitelist (para reducir superficie de error humano), se introduce como configuración SQL (`cfg_ui_limit_allowed_fields`), no hardcoded.

### 6.4 Validación de colisión solo en runtime (sin validador)

**Descartada**.

Detectar la colisión solo cuando dos ofertas reciben el mismo dictamen + distintos modos durante `aggregateUiLimits` dejaría la incoherencia llegar a producción. La validación en `validateConfigShape` (estricta o como warning) la atrapa antes de persistir.

---

## 7. Resumen de puntos abiertos resueltos

| Pregunta | Resolución |
|----------|------------|
| Q1 — Colisión `aggregate` | Last-action-wins en runtime. Warning en modo no estricto, error en modo estricto. |
| Q2 — Fallback a `UI_LIMITS_MIN/MAX` durante migración | Flag `RULE_ENGINE_LEGACY_UI_LIMITS` (env/option), activo solo si NO hay ninguna `aggregate` declarada en el config. Cleanup como issue separado tras cutoff. |
| Q3 — Visibilidad en `trace` | `trace.aggregateByField` por oferta (siempre) + `uiLimitsAggregation` a nivel envelope **solo si `options.debug: true`**. |

---

## 8. Resumen ejecutivo

El cambio extiende `cfg_offer_rule_action` con una columna `aggregate ∈ {MIN, MAX, NONE}`. El motor descubre dinámicamente qué fields publicar en `uiLimits` recorriendo el `trace.aggregateByField` por oferta (poblado por `applyActions` con semántica last-action-wins). Un flag de transición (`RULE_ENGINE_LEGACY_UI_LIMITS`) mantiene el comportamiento histórico mientras WF se actualiza; el flag queda inerte automáticamente en cuanto al menos una acción declara `aggregate`. El validador detecta colisiones (mismo field, modos distintos no-NONE) como warning en modo no estricto y como error en modo estricto. La implementación queda diferida hasta coordinar con el equipo de WF, único bloqueante real del despliegue.
