# SDD Design — params-active-period

**Change**: autoinyección del período activo en los formularios de CREAR reglas y params del configurador.
**Alcance**: frontend-only, AMBOS paneles (reglas + params). Sin cambios API/SQL.
**Fecha**: 2026-06-05
**Engram**: `sdd/params-active-period/design`

---

## 1. Resumen del enfoque (Approach A)

Se elimina el `<select>` "Período de vigencia" de los dos formularios de creación. El `offer_date_id` deja de ser un campo editado por el usuario y pasa a ser un **valor interno del form** que:

- En **creación**: se autoinyecta desde `activePeriodService.activePeriodRules()` / `activePeriodParams()` en el momento de **abrir** el editor, y se vuelve a leer del signal en el momento de **enviar** (re-sincronización en `saveRule`/`saveParam`) para cubrir el caso de que el signal cambie con el editor abierto.
- En **edición**: NUNCA cambia. Se conserva el `offer_date_id` original del registro (período inmutable). Se muestra como texto de solo lectura.

El botón "Crear" se desactiva cuando no hay período activo aplicable, con un banner que enlaza a `/offer-dates`. Los listados/paginador/buscador permanecen visibles con el editor abierto (se quitan las guardas `*ngIf="!isXEditorOpen()"`). En params, "Valor" ocupa la celda liberada por el período.

**Patrón arquitectónico**: presentational component con estado en Angular signals + reactive forms. Sin nuevos servicios. Se reutiliza `ActivePeriodService` (root, ya inyectado en :127) como única fuente de verdad del período.

---

## 2. Decisión clave: `offer_date_id` se mantiene como control interno NO renderizado

**Alternativas evaluadas:**

| Opción | Descripción | Veredicto |
|--------|-------------|-----------|
| **A. Mantener `offer_date_id` en el FormGroup, sin render** | El control sigue en `ruleForm`/`paramForm`; se quita su `<label>` del HTML; se popula vía código | **ELEGIDA** |
| B. Sacar `offer_date_id` del FormGroup y calcularlo solo en payload | Requiere reescribir `buildRulePayloadFromForm`, `saveParam`, `editRule`, `editParam`, `duplicateRule` y todos los `reset`/`setValue` | Rechazada: más superficie de cambio, rompe `setValue` (exige todas las claves) |

**Por qué A.** Hoy `editRule` (:778-787), `editParam` (:966-972) y `duplicateRule` (:746-755) usan `setValue`, que en Angular **exige el objeto completo** del FormGroup. Si quito la clave `offer_date_id` del grupo tengo que tocar los 6+ sitios que hacen `reset`/`setValue`. Manteniendo el control y solo quitándolo del template:

- `editRule`/`editParam` siguen cargando el `offer_date_id` original del registro → el payload de update lo conserva **sin cambios de lógica** (verificado: `buildRulePayloadFromForm` :1536 y `saveParam` :914 ya leen `raw.offer_date_id`).
- En `update` el período original viaja intacto en el payload → cumple "período inmutable en edición".
- `duplicateRule` (:754) ya copia `rule.offer_date_id`; lo dejaremos pero será sobrescrito por la autoinyección de creación (ver §3) para evitar arrastrar un período que ya no sea el activo. Decisión: en `duplicateRule` forzar el período activo de reglas igual que `openCreateRuleEditor` (es una creación).

---

## 3. Autoinyección y re-sincronización del período (create)

Punto de inyección **doble** (open-time + submit-time):

**Open-time** — en `openCreateRuleEditor` (:722) y `openCreateParamEditor` (:949), el `reset({...})` cambia:
```
offer_date_id: this.activePeriodService.activePeriodRules()?.offer_date_id ?? null
// params:
offer_date_id: this.activePeriodService.activePeriodParams()?.offer_date_id ?? null
```
Esto muestra al usuario el período activo (texto solo-lectura, §6) desde que abre el editor.

**Submit-time** — en `saveRule`/`buildRulePayloadFromForm` y `saveParam`, antes de construir el payload **en modo create**, se re-lee el signal y se sobrescribe el valor:
```ts
const isCreate = this.selectedParamId() == null; // o ruleEditorMode()==="create"
const activePeriodId = isCreate
  ? this.activePeriodService.activePeriodParams()?.offer_date_id ?? null
  : raw.offer_date_id; // edit: conserva el original
```

**Por qué doble.** El período activo es estado global en signals que el usuario puede cambiar en otra pestaña/localStorage o navegando a `/offer-dates` con el editor abierto. La **fuente de verdad en el submit es el signal**, no el snapshot del open-time. En edición, en cambio, la fuente es el valor del registro (inmutable). Esto elimina la posibilidad de grabar contra un período obsoleto.

> Nota: `duplicateRule` se trata como create (re-inyecta período activo de reglas en submit).

---

## 4. Computed signals nuevos (estado de botón + helpers de texto)

Se añaden al componente, junto a los `computed` existentes (~:251-341):

```ts
// Disponibilidad de creación: hay período activo del tipo correcto.
// fechasForRules/fechasForParams ya filtran por tipo_cd (REGLAS|AMBOS / PARAMS|AMBOS).
protected readonly canCreateRule = computed(() => this.activePeriodService.activePeriodRules() != null);
protected readonly canCreateParam = computed(() => this.activePeriodService.activePeriodParams() != null);

// Texto de período activo para banner / read-only en creación.
protected readonly activeRulesPeriodLabel = computed(() => this.formatPeriod(this.activePeriodService.activePeriodRules()));
protected readonly activeParamsPeriodLabel = computed(() => this.formatPeriod(this.activePeriodService.activePeriodParams()));
```

Helper privado de formato (centraliza el formato ya usado en el HTML :339/:602):
```ts
private formatPeriod(p: AdminFechaItem | null): string {
  if (!p) return "";
  const from = formatDate(p.valid_from, "dd/MM/yyyy", "es");
  const to = p.valid_to ? formatDate(p.valid_to, "dd/MM/yyyy", "es") : "∞";
  return `#${p.offer_date_id} ${from} – ${to} · ${p.descripcion} (${p.tipo_cd})`;
}
```

**tipo_cd y aplicabilidad.** No se añade lógica nueva de filtrado por tipo: `activePeriodRules`/`activePeriodParams` son selecciones que el usuario ya hizo en `/offer-dates`, donde la asignación respeta `tipo_cd` (REGLAS/AMBOS para reglas; PARAMS/AMBOS para params). El `canCreateX` solo comprueba presencia del signal. Si el usuario seleccionó un período de tipo incompatible, eso es responsabilidad de la página offer-dates, fuera de alcance.

---

## 5. Reestructura del template (editor inline sobre la lista visible)

Se eliminan las guardas `*ngIf="!isRuleEditorOpen()"` / `!isParamEditorOpen()` de listados, paginadores, buscadores y mensajes de estado. El `<form *ngIf="isXEditorOpen()">` permanece donde está (justo encima de la tabla), logrando el layout inline editor-arriba / lista-abajo sin reestructurar el grid.

**Reglas (HTML):**
- :399 `*ngIf="!isRuleEditorOpen() && rulesLoading()"` → `*ngIf="rulesLoading()"`
- :400 `*ngIf="!isRuleEditorOpen() && rulesError() as message"` → `*ngIf="rulesError() as message"`
- :404 quitar `!isRuleEditorOpen() &&`
- :408 quitar `!isRuleEditorOpen() &&` (table-wrapper)
- pager de reglas (mismo patrón, verificar guard equivalente al :697 de params)

**Params (HTML):**
- :567 label buscador → quitar `*ngIf="!isParamEditorOpen()"`
- :622, :623, :627 mensajes de estado → quitar `!isParamEditorOpen() &&`
- :631 table-wrapper → quitar `!isParamEditorOpen() &&`
- :697 pager → quitar `!isParamEditorOpen() &&`

**Botón Crear:**
- Reglas :295 → `[disabled]="!canCreateRule()"`
- Params :563 → `[disabled]="!canCreateParam()"`

**Foco/scroll.** El editor renderiza encima de la tabla. Tras abrir, conviene hacer scroll al inicio del panel para que el usuario vea el form (la tabla queda debajo). Consideración menor: un `element.scrollIntoView()` opcional en `openCreate*`/`edit*`; si añade complejidad de testing, se omite en este PR (la lista visible debajo es aceptable). Decisión: **omitir scroll automático** en este PR; el form aparece arriba del panel, suficiente.

---

## 6. Período de solo lectura

Reemplaza el `<label>` del `<select>` eliminado.

**Reglas** (sustituye HTML :334-342): en la misma posición del grid (`span 2`), un bloque solo-lectura:
```html
<label>
  Período de vigencia
  <span class="readonly-period" *ngIf="isRuleCreateMode()">{{ activeRulesPeriodLabel() }}</span>
  <span class="readonly-period" *ngIf="!isRuleCreateMode()">{{ formatPeriodById(ruleForm.controls.offer_date_id.value) }}</span>
</label>
```
- **Create**: muestra el período activo (`activeRulesPeriodLabel()`).
- **Edit**: muestra el período del registro. Como el listado de fechas (`fechas()`) está cargado, se resuelve por id con un helper `formatPeriodById(id)` que busca en `this.fechas()`. Si no se encuentra (período cerrado/borrado), fallback `#{id}`.

**Params** (sustituye HTML :597-605): mismo patrón con `activeParamsPeriodLabel()` / `formatPeriodById`. Esta celda es la que se libera para mover "Valor" (§7) — decisión: en params **NO** se mantiene la celda de período como label visible; el período en params se muestra como una **línea de texto compacta encima del grid** (no ocupa celda), liberando las 4 celdas para Oferta/Key/Value type/Value. Ver §7.

Helper:
```ts
protected formatPeriodById(id: number | null): string {
  const p = this.fechas().find((f) => f.offer_date_id === id) ?? null;
  return p ? this.formatPeriod(p) : (id ? `#${id}` : "—");
}
```

---

## 7. Grid de params: "Valor" entra en la celda liberada

Layout actual (`.form-grid-params`, 6 cols, cada label `span 3` → 2×2) + "Value" full-width fuera del grid (HTML :607-610).

**Cambio:**
1. Quitar el `<label>Período` del grid (HTML :597-605).
2. Mover el `<label>Value` (:607-610) **dentro** del `<div class="form-grid form-grid-params">`, como 4ª celda.
3. El período de params se muestra como **línea de texto compacta** (clase `.readonly-period-line`) **encima** del grid, abarcando el ancho completo. En create: `activeParamsPeriodLabel()`. En edit: `formatPeriodById(...)`.

Grid resultante (span 3 cada uno, sin cambios CSS de columnas):
```
[Período activo: #12 01/01/2026 – ∞ · ... (PARAMS)]   ← línea texto, full-width
Fila 1: [Oferta]      | [Key]
Fila 2: [Value type]  | [Value]
```

**Ancho de celda de Value: `span 3`** (igual que los demás). No se añade fila full-width. Se elimina la regla/uso full-width previo de Value.

**CSS nuevo** (`.css`):
```css
.readonly-period {           /* texto solo-lectura dentro de label */
  display: block;
  padding: 0.4rem 0.55rem;
  background: rgba(0,0,0,0.04);
  border-radius: 6px;
  font-size: 0.85rem;
}
.readonly-period-line {      /* línea período en params, full-width sobre el grid */
  margin: 0 0 0.6rem;
  font-size: 0.85rem;
  color: var(--muted, #555);
}
.period-banner {             /* banner sin período activo */
  margin: 0.6rem 0;
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--warning-border, #e0c46c);
  background: var(--warning-bg, #fff6da);
  border-radius: 8px;
  font-size: 0.9rem;
}
.period-banner a { font-weight: 600; }
```

---

## 8. Banner "sin período activo"

Se muestra dentro de cada panel, debajo del `panel-head`, cuando no hay período aplicable. Usa `routerLink` (el componente debe importar `RouterLink`; verificar import en `imports` del componente standalone — si falta, añadirlo).

**Reglas** (tras :297):
```html
<div class="period-banner" *ngIf="!canCreateRule()">
  No hay un período de vigencia activo para reglas. Activá uno en
  <a routerLink="/offer-dates">Fechas de oferta</a> para poder crear reglas.
</div>
```
**Params** (tras :565):
```html
<div class="period-banner" *ngIf="!canCreateParam()">
  No hay un período de vigencia activo para parámetros. Activá uno en
  <a routerLink="/offer-dates">Fechas de oferta</a> para poder crear parámetros.
</div>
```
Placement: encima del buscador/lista, siempre visible mientras no haya período (no condicionado a editor abierto). Editar registros existentes sigue permitido aunque no haya período activo (no depende de `canCreateX`).

---

## 9. Componentes y flujo de datos

```
ActivePeriodService (root, localStorage)
  ├─ activePeriodRules:  signal<AdminFechaItem|null>
  └─ activePeriodParams: signal<AdminFechaItem|null>
            │ (lectura reactiva)
            ▼
ConfiguratorPageComponent
  ├─ computed canCreateRule / canCreateParam        → [disabled] botón Crear, *ngIf banner
  ├─ computed activeRulesPeriodLabel / ...Params     → texto solo-lectura create
  ├─ formatPeriodById(id)                            → texto solo-lectura edit (desde fechas())
  ├─ openCreateRuleEditor/openCreateParamEditor      → inyecta offer_date_id (open-time)
  ├─ saveRule/buildRulePayloadFromForm/saveParam     → re-sincroniza offer_date_id (submit-time, solo create)
  └─ editRule/editParam                              → offer_date_id del registro, inmutable
```

**Integración**: ninguna nueva. Endpoints `createRule`/`updateRule`/`createParam`/`updateParam` sin cambios; el payload sigue llevando `offer_date_id` (entero válido en create → corrige el bug del 400 silencioso). `RouterLink` para el banner.

---

## 10. ADRs

### ADR-1: `offer_date_id` permanece como control no renderizado (vs. extraer del form)
- **Contexto**: `setValue` exige objeto completo; 6+ call-sites de reset/setValue.
- **Decisión**: mantener el control en el FormGroup, quitarlo solo del template.
- **Alternativa rechazada**: sacarlo del grupo → reescritura amplia y frágil de payload/setValue.
- **Consecuencia**: cambio mínimo; update conserva el período original sin tocar lógica de payload.

### ADR-2: Fuente del período en submit = signal (create) / registro (edit)
- **Contexto**: el período activo puede cambiar con el editor abierto.
- **Decisión**: re-leer signal en submit para create; usar valor del registro para edit.
- **Alternativa rechazada**: confiar solo en el snapshot del open-time → riesgo de grabar período obsoleto.
- **Consecuencia**: doble lectura (open + submit); ligera duplicación, robustez alta.

### ADR-3: Período inmutable en edición (delete + recreate para reasignar)
- **Contexto**: decisión BINDING del usuario.
- **Decisión**: texto solo-lectura en edit; no se ofrece cambio de período.
- **Consecuencia**: reasignar período = borrar y recrear. Sin migración de datos.

### ADR-4: Layout inline (editor arriba, lista abajo) quitando guardas `*ngIf`
- **Decisión**: eliminar `!isXEditorOpen()` de listas/pager/buscador; form donde ya está.
- **Alternativa rechazada**: layout side-by-side → reestructurar grid, mayor esfuerzo.
- **Consecuencia**: lista visible siempre; sin scroll automático en este PR.

### ADR-5: Período de params como línea de texto sobre el grid (no celda)
- **Contexto**: liberar las 4 celdas para Oferta/Key/Value type/Value (Value entra al grid).
- **Decisión**: período en params = `.readonly-period-line` full-width encima del grid.
- **Consecuencia**: grid 2×2 limpio sin fila full-width de Value.

---

## 11. Plan de pruebas (Strict TDD ACTIVO)

**Estado actual**: NO existe `configurator-page.component.spec.ts`. Hay que crearlo (scaffolding TestBed + mocks de `AdminApiService` y `ActivePeriodService`).

**Comportamientos testeables (escribir test → ver fallar → implementar):**

| # | Comportamiento | Aserción |
|---|----------------|----------|
| T1 | `canCreateRule` falso sin período de reglas | signal null → `canCreateRule()===false` |
| T2 | `canCreateRule` verdadero con período | signal set → `true` |
| T3 | idem T1/T2 para `canCreateParam` | — |
| T4 | botón Crear reglas `[disabled]` sin período | query DOM, `disabled===true` |
| T5 | banner reglas visible sin período, con link a /offer-dates | DOM `.period-banner a[routerLink="/offer-dates"]` |
| T6 | idem T4/T5 para params | — |
| T7 | `openCreateRuleEditor` inyecta `offer_date_id` del período activo | `ruleForm.value.offer_date_id===activeId` |
| T8 | `openCreateParamEditor` inyecta `offer_date_id` activo | idem |
| T9 | submit create re-lee signal cambiado tras abrir editor | cambiar signal post-open → payload lleva el nuevo id (spy en `createRule`) |
| T10 | submit edit NO cambia `offer_date_id` aunque el signal difiera | `editRule` con id=5, signal=9 → `updateRule` payload `offer_date_id===5` |
| T11 | lista de reglas visible con editor abierto | abrir editor → tabla en DOM |
| T12 | lista de params visible con editor abierto | idem |
| T13 | `formatPeriodById` resuelve desde `fechas()` y fallback `#id` | unit puro |
| T14 | grid params: "Value" presente, "Período `<select>`" ausente | DOM: no `select[formControlName=offer_date_id]` en params |
| T15 | create bloqueado sin período: botón disabled impide abrir editor | click no abre form |

Comando: `npm run web:test` (Karma) desde `rule_set/`.

---

## 12. Magnitud y estrategia de PR

| Archivo | Cambio aprox. |
|---------|---------------|
| `configurator-page.component.ts` | +~40 líneas (4 computed, 2 helpers, 4 puntos de inyección/re-sync) |
| `configurator-page.component.html` | ~±60 líneas (quitar 2 selects, 2 banners, 2 read-only, mover Value, quitar ~10 guardas `*ngIf`) |
| `configurator-page.component.css` | +~25 líneas (3 clases) |
| `configurator-page.component.spec.ts` | **nuevo** ~150-200 líneas (scaffolding + 15 tests) |

**Total estimado**: ~280-330 líneas. **< 400 → PR ÚNICO**, sin chained PRs. El spec es nuevo y cargado pero es test (no inflate de prod). Commit único work-unit: TS+HTML+CSS+spec juntos.

---

## 13. Riesgos / supuestos a validar en apply

1. **`RouterLink` import**: confirmar que el componente standalone lo tiene en `imports`; si no, añadirlo (1 línea). Riesgo bajo.
2. **Pager/guard de reglas**: verificar el guard exacto del pager de reglas (análogo al :697 de params) al quitar `!isRuleEditorOpen()`.
3. **`duplicateRule`**: debe re-inyectar período activo de reglas en submit (tratado como create); confirmar que no arrastra período obsoleto.
4. **Scaffolding de spec inexistente**: mayor parte del esfuerzo de test es montar TestBed + mocks; presupuestar tiempo.
5. **`fechas()` cargado en edit**: `formatPeriodById` depende de que `fechas()` esté poblado; si la carga es async y aún no llegó, fallback `#id` cubre el caso.
6. **Período seleccionado de tipo incompatible**: fuera de alcance (responsabilidad de offer-dates); `canCreateX` solo verifica presencia.
