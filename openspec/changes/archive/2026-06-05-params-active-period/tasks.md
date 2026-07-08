# Tasks — params-active-period

**Cambio:** params-active-period
**Fecha:** 2026-06-05
**Alcance:** Frontend-only. Un único archivo principal de cambio: `configurator-page.component.{ts,html,css}` + nuevo `.spec.ts`.
**Rama sugerida:** `feat/params-active-period`
**PR:** único (≤400 líneas — ver Review Workload Forecast al final)

---

## Convenciones aplicadas

- Cada WU = un commit autónomo (código + tests juntos, conventional commits).
- TDD ESTRICTO ACTIVO: cada WU escribe el test antes (o junto con) la implementación.
- No fabricar tests tautológicos — todos ejercitan el componente real vía TestBed.
- El spec file NO existe todavía → WU-01 crea el scaffolding; el resto añade tests incrementalmente.

---

## Grafo de dependencias

```
WU-01 (scaffolding TestBed)
  └── WU-02 (computeds canCreate + activeLabel)   ← depende de WU-01
        └── WU-03 (botón disabled + banner reglas)  ← depende de WU-02
        └── WU-04 (botón disabled + banner params)  ← depende de WU-02
              └── WU-05 (inyección open-time + submit-time reglas)  ← depende de WU-03
              └── WU-06 (inyección open-time + submit-time params)  ← depende de WU-04
                    └── WU-07 (duplicateRule re-inyección)  ← depende de WU-05
                    └── WU-08 (período inmutable en edición — reglas)  ← depende de WU-05
                    └── WU-09 (período inmutable en edición — params)  ← depende de WU-06
                          └── WU-10 (eliminar guardas de lista — reglas)  ← depende de WU-08
                          └── WU-11 (eliminar guardas de lista — params)  ← depende de WU-09
                                └── WU-12 (eliminar <select> Período de HTML)  ← depende de WU-10, WU-11
                                      └── WU-13 (CSS: readonly-period-line + form-grid-params 2×2)  ← depende de WU-12
                                            └── WU-14 (docs: CLAUDE.md 4013)  ← depende de WU-13
```

WU-03 y WU-04 son paralelos entre sí (paneles independientes).
WU-05, WU-06 son paralelos entre sí.
WU-07, WU-08, WU-09 son paralelos entre sí (dependencias distintas).
WU-10, WU-11 son paralelos entre sí.

---

## Work Units

### WU-01 — TestBed scaffolding

**Requisitos satisfechos:** prerrequisito técnico para todos los demás tests (CA-001 a CA-020 requieren TestBed).
**Secuencia:** PRIMERO. Nada puede testarse sin esto.
**Paralelo con:** nada.

**Archivos afectados:**
- NUEVO `rule_set/web/src/app/pages/configurator-page.component.spec.ts`

**Qué hacer:**
1. Crear el archivo `configurator-page.component.spec.ts`.
2. Configurar `TestBed.configureTestingModule` con:
   - `imports: [ConfiguratorPageComponent]`
   - `providers`: mock de `AdminApiService` (retorna Observables vacíos para todos los métodos relevantes) y mock de `ActivePeriodService` (signals `activePeriodRules` y `activePeriodParams` seteables en tests).
   - `provideRouter([])` para satisfacer `RouterLink` del standalone component.
3. Helper `createComponent()` que crea el componente + fixture + detectChanges.
4. Smoke test: el componente se crea sin error.

**Commit sugerido:**
```
test(configurator): scaffold TestBed for configurator-page component
```

---

### WU-02 — Computeds `canCreateRule`, `canCreateParam`, `activeRulesPeriodLabel`, `activeParamsPeriodLabel`, helper `formatPeriodById`

**Requisitos satisfechos:** FR-007, FR-008, FR-015, base para FR-009/010.
**Secuencia:** después de WU-01.
**Paralelo con:** nada (es base para WU-03 y WU-04).

**Archivos afectados:**
- `configurator-page.component.ts` (+~15 líneas TS)

**Qué hacer:**
1. Añadir computed:
   ```ts
   protected readonly canCreateRule = computed(() => this.activePeriodService.activePeriodRules() !== null);
   protected readonly canCreateParam = computed(() => this.activePeriodService.activePeriodParams() !== null);
   ```
2. Añadir helper privado:
   ```ts
   private formatPeriodById(id: number | null): string {
     if (id === null) return '—';
     const f = this.fechas().find(x => x.offer_date_id === id);
     if (!f) return `#${id}`;
     const from = this.formatDate(f.valid_from);
     const to = f.valid_to ? this.formatDate(f.valid_to) : '∞';
     return `#${id} ${from} – ${to} · ${f.descripcion}`;
   }
   private formatDate(d: string): string {
     const dt = new Date(d);
     return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
   }
   ```
   *(Alternativamente, inyectar `DatePipe` si ya está disponible — verificar durante apply.)*
3. Añadir computeds de label:
   ```ts
   protected readonly activeRulesPeriodLabel = computed(() =>
     this.formatPeriodById(this.activePeriodService.activePeriodRules()?.offer_date_id ?? null)
   );
   protected readonly activeParamsPeriodLabel = computed(() =>
     this.formatPeriodById(this.activePeriodService.activePeriodParams()?.offer_date_id ?? null)
   );
   ```

**Tests a añadir en spec (T13 del test plan):**
- `formatPeriodById`: cuando `fechas()` tiene el período → muestra id + fechas; cuando no lo tiene → fallback `#id`; cuando `id === null` → `'—'`.
- `canCreateRule`: true cuando `activePeriodRules()` no es null, false cuando es null.
- `canCreateParam`: true cuando `activePeriodParams()` no es null, false cuando es null.

**Commit sugerido:**
```
feat(configurator): add canCreateRule/Param computeds and formatPeriodById helper
```

---

### WU-03 — Botón "Crear" desactivado + banner de bloqueo en panel Reglas

**Requisitos satisfechos:** FR-007, FR-009, CA-004, CA-008, CA-009 (panel reglas).
**Secuencia:** después de WU-02.
**Paralelo con:** WU-04.

**Archivos afectados:**
- `configurator-page.component.html` (±5 líneas)
- `configurator-page.component.spec.ts` (+3 tests)

**Qué hacer (HTML línea ~295):**
1. Añadir `[disabled]="!canCreateRule()"` al botón "Crear" del panel Reglas.
2. Añadir banner debajo de `<div class="panel-head">` (antes del `<form>`):
   ```html
   @if (!canCreateRule()) {
     <p class="period-banner">
       Sin período activo para reglas.
       <a routerLink="/offer-dates">Ir a Períodos</a>
     </p>
   }
   ```
   Verificar que `RouterLink` ya está en `imports` del componente standalone (sí está en línea 4 del TS).

**Tests a añadir (T4, T5 del test plan — panel reglas):**
- Botón "Crear" tiene `disabled` cuando `activePeriodRules()` es null.
- Banner `.period-banner` visible con `<a>` que apunta a `/offer-dates` cuando no hay período activo.
- Banner no visible cuando `activePeriodRules()` no es null.

**Commit sugerido:**
```
feat(configurator): disable create-rule button and show banner when no active rules period
```

---

### WU-04 — Botón "Crear" desactivado + banner de bloqueo en panel Params

**Requisitos satisfechos:** FR-008, FR-010, CA-005, CA-008, CA-009 (panel params).
**Secuencia:** después de WU-02.
**Paralelo con:** WU-03.

**Archivos afectados:**
- `configurator-page.component.html` (±5 líneas)
- `configurator-page.component.spec.ts` (+3 tests)

**Qué hacer (HTML línea ~563):**
1. Añadir `[disabled]="!canCreateParam()"` al botón "Crear" del panel Params.
2. Añadir banner debajo de `<div class="panel-head">` del panel params:
   ```html
   @if (!canCreateParam()) {
     <p class="period-banner">
       Sin período activo para parámetros.
       <a routerLink="/offer-dates">Ir a Períodos</a>
     </p>
   }
   ```

**Tests a añadir (T6, T5 del test plan — panel params):**
- Botón "Crear" de params tiene `disabled` cuando `activePeriodParams()` es null.
- Banner visible con link cuando no hay período activo para params.
- `canCreateRule` y `canCreateParam` son independientes: el primero puede ser null sin afectar el segundo (CA-007).

**Commit sugerido:**
```
feat(configurator): disable create-param button and show banner when no active params period
```

---

### WU-05 — Auto-inyección de `offer_date_id` en creación de reglas (open-time + submit-time)

**Requisitos satisfechos:** FR-001, FR-005, FR-022, CA-001, CA-003.
**Secuencia:** después de WU-03.
**Paralelo con:** WU-06.

**Archivos afectados:**
- `configurator-page.component.ts` (±10 líneas TS en `openCreateRuleEditor` y `buildRulePayloadFromForm`)
- `configurator-page.component.spec.ts` (+3 tests)

**Qué hacer:**

1. En `openCreateRuleEditor()` (línea ~722 del TS), cambiar el reset:
   ```ts
   offer_date_id: this.activePeriodService.activePeriodRules()?.offer_date_id ?? null,
   ```
   (reemplaza el actual `offer_date_id: null`).

2. En `buildRulePayloadFromForm()` (línea ~1536 del TS), cambiar la línea de `offer_date_id` en el retorno para CREATE:
   ```ts
   // Modo create: re-leer signal para capturar cambio de período con editor abierto
   offer_date_id: this.isRuleCreateMode()
     ? (this.activePeriodService.activePeriodRules()?.offer_date_id ?? null)
     : (raw.offer_date_id ? Number(raw.offer_date_id) : null),
   ```

**Tests a añadir (T7, T9 del test plan):**
- Al llamar `openCreateRuleEditor()` con `activePeriodRules()` devolviendo `{ offer_date_id: 3, ... }`, el `ruleForm.value.offer_date_id` es 3.
- Al cambiar el signal entre `openCreateRuleEditor()` y `saveRule()`, el payload usa el valor actualizado del signal (no el stale del form).
- `buildRulePayloadFromForm` en modo edit NO re-lee el signal (usa el valor del form).

**Commit sugerido:**
```
feat(configurator): auto-inject active rules period at open-time and submit-time for rule create
```

---

### WU-06 — Auto-inyección de `offer_date_id` en creación de params (open-time + submit-time)

**Requisitos satisfechos:** FR-002, FR-006, FR-023, CA-002, CA-003.
**Secuencia:** después de WU-04.
**Paralelo con:** WU-05.

**Archivos afectados:**
- `configurator-page.component.ts` (±8 líneas TS en `openCreateParamEditor` y `saveParam`)
- `configurator-page.component.spec.ts` (+2 tests)

**Qué hacer:**

1. En `openCreateParamEditor()` (línea ~944 del TS), cambiar el reset:
   ```ts
   offer_date_id: this.activePeriodService.activePeriodParams()?.offer_date_id ?? null,
   ```

2. En `saveParam()` (línea ~903 del TS), cambiar la línea de `offer_date_id` en el payload:
   ```ts
   offer_date_id: this.isParamCreateMode()
     ? (this.activePeriodService.activePeriodParams()?.offer_date_id ?? null)
     : (raw.offer_date_id ? Number(raw.offer_date_id) : null),
   ```

**Tests a añadir (T8 del test plan):**
- Al llamar `openCreateParamEditor()` con `activePeriodParams()` = `{ offer_date_id: 5, ... }`, `paramForm.value.offer_date_id` es 5.
- Re-sync submit-time con signal cambiado (análogo a T9 para params).

**Commit sugerido:**
```
feat(configurator): auto-inject active params period at open-time and submit-time for param create
```

---

### WU-07 — `duplicateRule` re-inyecta período activo (no copia el de la regla origen)

**Requisitos satisfechos:** FR-001, FR-005 (duplicar = crear con período activo), CA-001, CA-003.
**Secuencia:** después de WU-05.
**Paralelo con:** WU-08, WU-09.

**Archivos afectados:**
- `configurator-page.component.ts` (~3 líneas en `duplicateRule`, línea ~746)
- `configurator-page.component.spec.ts` (+1 test)

**Qué hacer:**
En `duplicateRule()` (línea ~754 del TS), `offer_date_id` se establece actualmente con `rule.offer_date_id ?? null`. Cambiar a:
```ts
offer_date_id: this.activePeriodService.activePeriodRules()?.offer_date_id ?? null,
```
(La duplicación es una operación de CREAR; el período activo es el correcto, no el del original.)

**Test a añadir:**
- `duplicateRule()` con `activePeriodRules()` = `{ offer_date_id: 7, ... }` y regla origen con `offer_date_id: 2` → `ruleForm.value.offer_date_id` es 7 (no 2).

**Commit sugerido:**
```
fix(configurator): duplicateRule injects active rules period instead of copying source rule period
```

---

### WU-08 — Período inmutable en modo edición de reglas (texto solo-lectura + `activeRulesPeriodLabel`)

**Requisitos satisfechos:** FR-011, FR-013, FR-015, CA-010, CA-013.
**Secuencia:** después de WU-05.
**Paralelo con:** WU-07, WU-09.

**Archivos afectados:**
- `configurator-page.component.html` (~8 líneas — reemplaza `<label>Período de vigencia + <select>` en sección reglas por texto condicional)
- `configurator-page.component.spec.ts` (+1 test)

**Qué hacer (HTML, dentro del `<form ... *ngIf="isRuleEditorOpen()">`  entorno al `<select formControlName="offer_date_id">`):**
Reemplazar el bloque `<label>Período de vigencia ... </select></label>` (líneas ~334-341) por:
```html
@if (isRuleCreateMode()) {
  <!-- offer_date_id se inyecta en TS, sin campo visible -->
} @else {
  <p class="readonly-period-line">
    Período: {{ formatPeriodById(ruleForm.get('offer_date_id')?.value) }}
  </p>
}
```
Nota: `formatPeriodById` deberá ser `protected` (no `private`) para ser accesible desde el template.

**Test a añadir (T10 del test plan):**
- Al llamar `editRule(ruleConOferDateId5)` con `activePeriodRules()` = `{ offer_date_id: 2, ... }`, el `ruleForm.value.offer_date_id` conserva 5 (no sobreescrito por el signal).

**Commit sugerido:**
```
feat(configurator): show read-only period text in rule edit mode, remove select
```

---

### WU-09 — Período inmutable en modo edición de params (texto solo-lectura + `activeParamsPeriodLabel`)

**Requisitos satisfechos:** FR-012, FR-014, FR-015, CA-011, CA-014.
**Secuencia:** después de WU-06.
**Paralelo con:** WU-07, WU-08.

**Archivos afectados:**
- `configurator-page.component.html` (~8 líneas — análogo al panel params, líneas ~597-604)
- `configurator-page.component.spec.ts` (+1 test)

**Qué hacer:**
Reemplazar el bloque `<label>Período de vigencia ... </select></label>` del panel params por:
```html
@if (isParamCreateMode()) {
  <!-- offer_date_id inyectado en TS, sin campo visible -->
} @else {
  <p class="readonly-period-line">
    Período: {{ formatPeriodById(paramForm.get('offer_date_id')?.value) }}
  </p>
}
```
La `.readonly-period-line` para params debe ser `full-width` encima del grid (ADR-5 del design: `display: block; grid-column: 1 / -1` o fuera del grid). Verificar posicionamiento en WU-13.

**Test a añadir:**
- Al llamar `editParam(rowConOferDateId5)` con `activePeriodParams()` = `{ offer_date_id: 9, ... }`, `paramForm.value.offer_date_id` conserva 5.

**Commit sugerido:**
```
feat(configurator): show read-only period text in param edit mode, remove select
```

---

### WU-10 — Eliminar guardas `*ngIf="!isRuleEditorOpen()"` de lista, pager, estados (panel Reglas)

**Requisitos satisfechos:** FR-016, FR-018, CA-015, CA-017.
**Secuencia:** después de WU-08 (el editor de reglas ya no ocupa el espacio del select).
**Paralelo con:** WU-11.

**Archivos afectados:**
- `configurator-page.component.html` (~5 líneas modificadas)
- `configurator-page.component.spec.ts` (+1 test)

**Qué hacer:**
Quitar `!isRuleEditorOpen() &&` de las condiciones en las líneas:
- ~399: `*ngIf="!isRuleEditorOpen() && rulesLoading()"` → `*ngIf="rulesLoading()"`
- ~400: `*ngIf="!isRuleEditorOpen() && rulesError() as message"` → `*ngIf="rulesError() as message"`
- ~404: `*ngIf="!isRuleEditorOpen() && !rulesLoading() && !rulesError() && rules().length === 0"` → `*ngIf="!rulesLoading() && !rulesError() && rules().length === 0"`
- ~408: `*ngIf="!isRuleEditorOpen() && !rulesLoading() && !rulesError() && rules().length > 0"` → `*ngIf="!rulesLoading() && !rulesError() && rules().length > 0"`

Nota: el pager de reglas (línea ~534) ya NO tiene guarda `!isRuleEditorOpen()` — verificar durante apply y no añadir si no está.

**Test a añadir (T11 del test plan):**
- Con `ruleEditorMode = 'create'` y `rules()` no vacía → la tabla de reglas es visible en el DOM.

**Commit sugerido:**
```
feat(configurator): keep rules list visible when rule editor is open (remove ngIf guards)
```

---

### WU-11 — Eliminar guardas `*ngIf="!isParamEditorOpen()"` de lista, pager, estados, buscador (panel Params)

**Requisitos satisfechos:** FR-017, FR-018, CA-016, CA-017.
**Secuencia:** después de WU-09.
**Paralelo con:** WU-10.

**Archivos afectados:**
- `configurator-page.component.html` (~6 líneas modificadas)
- `configurator-page.component.spec.ts` (+1 test)

**Qué hacer:**
Quitar `!isParamEditorOpen() &&` de:
- ~567: `*ngIf="!isParamEditorOpen()"` del buscador → eliminarlo completamente (buscador siempre visible).
- ~622: `*ngIf="!isParamEditorOpen() && paramsLoading()"` → `*ngIf="paramsLoading()"`
- ~623: `*ngIf="!isParamEditorOpen() && paramsError() as message"` → `*ngIf="paramsError() as message"`
- ~627: `*ngIf="!isParamEditorOpen() && !paramsLoading() && ...filteredSortedParams().length === 0"` → quitar guarda de editor
- ~631: `*ngIf="!isParamEditorOpen() && !paramsLoading() && ...filteredSortedParams().length > 0"` → quitar guarda de editor
- ~697: `*ngIf="!isParamEditorOpen() && filteredSortedParams().length > 0"` → `*ngIf="filteredSortedParams().length > 0"`

**Test a añadir (T12 del test plan):**
- Con `paramEditorMode = 'create'` y params no vacíos → la tabla de params es visible en el DOM.
- El buscador es visible con el editor abierto.

**Commit sugerido:**
```
feat(configurator): keep params list and search visible when param editor is open (remove ngIf guards)
```

---

### WU-12 — Eliminar `<select>` Período del HTML de ambos formularios

**Requisitos satisfechos:** FR-003, FR-004, CA-018, CA-019 (ausencia del select verificable).
**Secuencia:** después de WU-10 y WU-11.
**Paralelo con:** nada (converge WU-10 y WU-11).

**Archivos afectados:**
- `configurator-page.component.html` (eliminar el `<label>Período de vigencia...` completo en reglas y params; ya reemplazado en WU-08/WU-09, aquí es confirmación/limpieza)
- `configurator-page.component.spec.ts` (+1 test)

**Qué hacer:**
Verificar que los `<select formControlName="offer_date_id">` de creación de reglas y params ya no aparecen en el HTML. Si WU-08/WU-09 usaron `@if (isXCreateMode())` con bloque vacío, confirmar que el selector `select[formControlName="offer_date_id"]` no es visible cuando el editor está en modo create.

**Test a añadir (T14 del test plan):**
- En modo CREATE de params → no existe ningún `<select>` con `formControlName="offer_date_id"` visible en el DOM.
- En modo CREATE de reglas → ídem.

**Commit sugerido:**
```
refactor(configurator): verify removal of period <select> from create forms (cleanup pass)
```

*Nota: si WU-08 y WU-09 ya eliminaron completamente el select (sin @if vacío), este WU puede fusionarse con WU-08+WU-09 durante el apply.*

---

### WU-13 — CSS: `.readonly-period-line`, `.period-banner`, grid params 2×2

**Requisitos satisfechos:** FR-019, FR-020, FR-021, CA-020 (grid 2×2), CA-017 (banner con enlace).
**Secuencia:** después de WU-12.
**Paralelo con:** nada.

**Archivos afectados:**
- `configurator-page.component.css` (+~25 líneas)

**Qué hacer:**
1. Añadir `.readonly-period-line`:
   ```css
   .readonly-period-line {
     font-size: 0.85rem;
     color: var(--ink-soft);
     margin: 0 0 0.4rem;
     padding: 0.3rem 0.5rem;
     background: rgba(0,0,0,0.03);
     border-radius: 4px;
   }
   ```
2. Añadir `.period-banner`:
   ```css
   .period-banner {
     margin: 0.5rem 0 0;
     padding: 0.4rem 0.75rem;
     background: #fff8e1;
     border: 1px solid #ffe082;
     border-radius: 4px;
     font-size: 0.82rem;
     color: var(--ink-soft);
   }
   .period-banner a {
     color: var(--link);
     text-decoration: underline;
   }
   ```
3. Ajustar `.form-grid-params` para grid 2×2:
   - Actualmente: `> label { grid-column: span 3; }` (en grid de 6 columnas = 2 elementos por fila).
   - Con 4 campos (Oferta, Key, Tipo valor, Valor) y "Value" con `span 1` → sin cambios de columnas si ya es `span 3` en grid-6 (2×2 natural). Verificar que `Value` ocupa el 4.º slot correcto.
   - Según ADR-5: si `readonly-period-line` es `full-width` FUERA del grid (encima), el grid queda limpio 2×2 sin necesidad de cambiar la definición de columnas.
   - Añadir al media query `@media (max-width: 980px)` el selector `.readonly-period-line` si aplica.

**No hay tests de CSS puro** — el test T14 (WU-12) ya valida ausencia del select; la disposición visual se cubre con inspección.

**Commit sugerido:**
```
style(configurator): add readonly-period-line, period-banner styles; fix params grid 2x2
```

---

### WU-14 — Docs: actualizar CLAUDE.md de 4013 si la sección del configurador requiere corrección

**Requisitos satisfechos:** mantenimiento de docs (no tiene FR directo).
**Secuencia:** después de WU-13 (cuando el código esté completo).
**Paralelo con:** nada.

**Archivos afectados:**
- `/CLAUDE.md` (sección "Offers management (configurator)" y/o tabla de routes — solo si hay texto desactualizado)

**Qué hacer:**
Revisar el CLAUDE.md actual. Si menciona el `<select>` de período, el flujo de "Crear regla/param requiere seleccionar período manualmente", o los guards de lista, actualizar esas frases para reflejar el comportamiento nuevo. Si no hay texto desactualizado, el WU es no-op y puede omitirse.

**Commit sugerido:**
```
docs(configurator): update CLAUDE.md to reflect auto-injected active period behavior
```

---

## Resumen de requisitos cubiertos por WU

| FR / CA | WU responsable |
|---------|---------------|
| FR-001 / CA-001 | WU-05 |
| FR-002 / CA-002 | WU-06 |
| FR-003 / CA-018 | WU-08 + WU-12 |
| FR-004 / CA-019 | WU-09 + WU-12 |
| FR-005 / CA-003 | WU-05 |
| FR-006 / CA-003 | WU-06 |
| FR-007 / CA-004 | WU-03 |
| FR-008 / CA-005 | WU-04 |
| FR-009 / CA-008 | WU-03 |
| FR-010 / CA-009 | WU-04 |
| FR-011 / CA-010 | WU-08 |
| FR-012 / CA-011 | WU-09 |
| FR-013 / CA-013 | WU-08 |
| FR-014 / CA-014 | WU-09 |
| FR-015 | WU-02 + WU-08 + WU-09 |
| FR-016 / CA-015 | WU-10 |
| FR-017 / CA-016 | WU-11 |
| FR-018 / CA-017 | WU-10 + WU-11 |
| FR-019 / CA-020 | WU-13 |
| FR-020 | WU-13 |
| FR-021 | WU-13 |
| FR-022 / CA-006 | WU-05 |
| FR-023 / CA-006 | WU-06 |
| CA-007 (independencia) | WU-04 (test cruzado) |
| CA-012 (habilitación reactiva) | WU-03 + WU-04 (computed reactivo) |
| duplicateRule | WU-07 |

---

## Review Workload Forecast

| Categoría | Estimado |
|-----------|----------|
| TS (component logic) | +40 líneas |
| HTML (template) | ±60 líneas (eliminaciones compensan adiciones) |
| CSS | +25 líneas |
| SPEC (nuevo archivo) | +150–200 líneas |
| CLAUDE.md (docs) | ±5 líneas |
| **Total estimado** | **~280–330 líneas** |

- Código (TS + HTML + CSS): ~125 líneas netas
- Tests (spec nuevo): ~150–200 líneas
- **400-line budget risk: Low** (máximo estimado 330 < 400)
- **Chained PRs recommended: No** — PR único cubre todos los WUs
- **Decision needed before apply: No** — presupuesto dentro del límite; proceed with single PR

*Nota de riesgo: si el scaffolding del spec resulta más verboso de lo esperado (mocks extensos, más de 200 líneas de spec), el total podría acercarse a 380. En ese caso, WU-01 a WU-04 pueden entregarse como PR-1 (scaffolding + computeds + banners) y WU-05 a WU-14 como PR-2, pero solo si el primer conteo post-WU-04 supera 350 líneas. Decisión a tomar durante apply.*
