# Design: Simulator Panel UX

## Architecture Approach

This change is a **localized UI refactor** scoped to three simulator pages and one shared trace-log component, plus the first introduction of an Angular `environment` token in the workspace. There is no new module, no routing change, no service-layer change, and no backend impact.

The pattern used throughout is the existing one in `web/src/app`:

- Page components are **smart containers** that own form state (Reactive Forms) and result signals.
- Shared presentation lives in dedicated components under `web/src/app/shared/` and receives data via `@Input`.
- Styles are co-located with the component (`*.component.css`) and use global CSS variables defined in `app.css` (`--surface`, `--line-soft`, `--radius-md`, etc.).

We extend that pattern with two surgical additions:

1. A column-cap CSS variable resolved at the page level (where the `.cards` grid lives).
2. Per-offer expand state inside `SimulationTraceLogComponent`, kept in a signal on the component class so it survives `buildViews()` recomputation.

## Component Map and Data Flow

```
environment.ts (NEW)
  maxSimulatorColumns: 4
        |
        v
InitSimulatorPageComponent ----+    PreSimulatorPageComponent ----+    FinalSimulatorPageComponent ----+
  reads maxSimulatorColumns    |      reads maxSimulatorColumns   |      reads maxSimulatorColumns    |
  exposes maxCols getter       |      exposes maxCols getter      |      exposes maxCols getter       |
        |                      |              |                   |              |                    |
        v                      |              v                   |              v                    |
  <div class="cards"           |       <div class="cards"         |       <div class="cards"          |
       [style.--cards-max-cols]|>           [style.--cards-max-cols]>          [style.--cards-max-cols]>
                               |                                  |
                               +-------- SimulationTraceLogComponent (SHARED) --------+
                                          @Input evaluations
                                          @Input title
                                          @Input eligibilityKey
                                          Internal:
                                            - expanded: signal<Set<string>>(new Set())
                                            - allExpanded: computed<boolean>
                                            - toggle(offerCode)
                                            - toggleAll(checked)
```

Each `<app-simulation-trace-log>` instance keeps its **own** expand state, so the same page can host INIT, PRE, and FINAL logs that collapse and expand independently.

## ADR-1: Per-offer expand state storage

**Decision**: store expanded offers in a `signal<Set<string>>` on the component class, keyed by `offerCode`.

```typescript
protected readonly expanded = signal<Set<string>>(new Set<string>());

protected isExpanded(offerCode: string): boolean {
  return this.expanded().has(offerCode);
}

protected toggle(offerCode: string): void {
  this.expanded.update((set) => {
    const next = new Set(set);
    if (next.has(offerCode)) {
      next.delete(offerCode);
    } else {
      next.add(offerCode);
    }
    return next;
  });
}
```

**Rationale**:

- `buildViews()` is invoked from the template (`*ngFor="let offer of buildViews()"`) and returns a **new array on every change-detection cycle**. Any state embedded in the view object resets on each tick — proven non-starter.
- A `Set<string>` keyed by `offerCode` is naturally indexed, immune to array reorder, and uses the same key the user sees on screen.
- A signal wraps the Set so reads in templates trigger CD only when toggled; `Set` mutation must produce a new Set (`new Set(prev)`) for `signal.update` to publish a change.

**Rejected alternatives**:

- `signal<Map<string, boolean>>` — equivalent power but more verbose (`map.get(code) === true`), and stores a "false" entry for offers that were expanded once then collapsed. The Set form keeps memory smaller and read sites cleaner.
- Boolean field embedded in `OfferTraceView` — fails because `buildViews()` recomputes per CD cycle; documented as a risk in the proposal.
- One signal per offer (dynamic) — uncontrolled lifetime; harder to reason about when `evaluations` input changes.

**State lifecycle**: when `@Input evaluations` changes (new simulation submitted), should we reset `expanded`? Yes — stale offerCodes lingering in the Set wastes memory but does not break anything. Reset is implemented by hooking `ngOnChanges` and clearing the Set when the new `evaluations` array's offer codes do not intersect the old set. **Simpler choice**: clear unconditionally on input change. Adopted.

## ADR-2: Angular environment token for column cap

**Decision**: introduce `src/environments/environment.ts` and `src/environments/environment.development.ts` with `maxSimulatorColumns: 4`. Configure `fileReplacements` in `angular.json` for the **development** configuration only.

`environment.ts` (production default):

```typescript
export const environment = {
  production: true,
  maxSimulatorColumns: 4,
};
```

`environment.development.ts`:

```typescript
export const environment = {
  production: false,
  maxSimulatorColumns: 4,
};
```

`angular.json` patch — under `projects.web.architect.build.configurations.development`:

```json
"fileReplacements": [
  {
    "replace": "src/environments/environment.ts",
    "with": "src/environments/environment.development.ts"
  }
]
```

**Why both files even though values match today**: Angular 20 convention is for `environment.ts` to be the production source and `environment.development.ts` the dev override. Establishing both now means future tunables (`apiBaseUrl`, feature flags) drop in without restructuring. Matches the standard `ng generate environments` output.

**Rejected alternatives**:

- Hard-code `4` in CSS — fails the success criterion "changes the cap without code edits" (rejecting the env file change still touches code, but a single env edit is the minimum surface; a CSS edit forces three files for the value to propagate).
- Use a `Token` provided via DI — overkill for a single literal; environment files are the idiomatic Angular spot for build-time constants.
- Read from a runtime config endpoint — pointless network round-trip for a layout constant.

## ADR-3: CSS grid binding via custom property

**Decision**: bind `environment.maxSimulatorColumns` as a CSS custom property on the `.cards` element via Angular's `[style.--var-name]` attribute syntax. Update the page-level `.cards` rule to consume the variable.

Page component (TypeScript) — add a read-only getter:

```typescript
protected readonly maxCols = environment.maxSimulatorColumns;
```

Page template:

```html
<div class="cards" *ngIf="initElegibles().length" [style.--cards-max-cols]="maxCols">
  ...
</div>
```

Page CSS — replace the current `auto-fit` line:

```css
.cards {
  display: grid;
  grid-template-columns: repeat(min(var(--cards-max-cols, 4), auto-fill), minmax(230px, 1fr));
  gap: 0.85rem;
}
```

**Behavior**:

- `repeat(min(N, auto-fill), minmax(230px, 1fr))` caps the column count at `N` while still letting the browser drop columns on narrow viewports (responsive on mobile preserved).
- Fallback `var(--cards-max-cols, 4)` keeps the same cap if the binding is missing (defensive).
- `minmax(230px, 1fr)` matches the existing minimum; panels stay above the readability floor.

**Rejected alternatives**:

- `[ngStyle]="{ '--cards-max-cols': maxCols }"` — works but heavier syntax; `[style.--name]` is the modern Angular preferred form (since v15).
- Inline `grid-template-columns` binding from TS — loses CSS responsiveness primitives (`minmax`, `auto-fill`) unless you template-string them in TS, which is ugly.
- Host binding on the shared component — the `.cards` div lives in **page templates**, not in `SimulationTraceLogComponent`, so the binding must live in the pages. No shared wrapper exists today, and adding one would inflate scope.

## ADR-4: Expand/collapse control — checkbox

**Decision**: render a single `<input type="checkbox">` with label "Expandir todo" in `.trace-head`. Checked = all cards expanded; unchecked = all collapsed.

```html
<header class="trace-head">
  <div class="trace-head-titles">
    <h3>{{ title }}</h3>
    <p>Jerarquia regla -> condicion con estado de cumplimiento.</p>
  </div>
  <label class="trace-toggle-all">
    <input
      type="checkbox"
      [checked]="allExpanded()"
      (change)="toggleAll($any($event.target).checked)"
    />
    Expandir todo
  </label>
</header>
```

Component:

```typescript
protected readonly allExpanded = computed(() => {
  const set = this.expanded();
  return this.evaluations.length > 0 && this.evaluations.every((e) => set.has(e.offerCode));
});

protected toggleAll(checked: boolean): void {
  if (checked) {
    this.expanded.set(new Set(this.evaluations.map((e) => e.offerCode)));
  } else {
    this.expanded.set(new Set());
  }
}
```

**Rationale**:

- One control, two states — matches the natural mental model ("toggle them all").
- Indeterminate-style mixed states are conveyed by the checkbox **unchecking itself** as soon as the user collapses one card individually (because `allExpanded()` becomes false). No need for tri-state UX.
- Matches the existing `.check` form pattern already used in simulator pages — visually consistent.

**Rejected alternatives**:

- Two buttons ("Expandir todo" / "Colapsar todo") — duplicates the affordance and adds two click targets; takes more space; less discoverable that they are mutually exclusive.
- Dropdown menu — unnecessary chrome for a binary toggle.
- Per-card chevrons only (no "all" control) — the proposal explicitly requires a per-instance toggle-all in §Scope.

## Collapsed Card Header

Each `<article class="offer-block">` becomes a header-plus-body layout. The header is **always visible and clickable**; the body (`trace-table-wrapper` + `dictamen-result`) is rendered conditionally with `*ngIf="isExpanded(offer.offerCode)"`.

Collapsed header shows:

- Offer code (existing `<h4>`)
- Eligibility badge (existing `.offer-state`)
- A one-line dictamen summary appended after the badge (e.g. `motivos: PRE_REJECTED · maxLTV: 0.80`). The summary is computed in `buildViews()` from the dictamen entries already produced today, joined with ` · `, truncated visually with CSS (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`) for very long content.
- A chevron icon (`▸` collapsed, `▾` expanded) at the right edge to signal interactivity.

Click target: the **entire header** is clickable (`(click)="toggle(offer.offerCode)"` on `<header class="offer-head">`). Cursor is `pointer`. Accessibility: add `role="button"`, `tabindex="0"`, `(keydown.enter)` and `(keydown.space)` to dispatch the same toggle. `aria-expanded` reflects state.

## Affected Files (final)

| File | Change |
|------|--------|
| `rule_set/web/src/environments/environment.ts` | NEW — production env |
| `rule_set/web/src/environments/environment.development.ts` | NEW — dev env |
| `rule_set/web/angular.json` | Add `fileReplacements` to `development` configuration |
| `rule_set/web/src/app/pages/init-simulator-page.component.ts` | Import env, expose `maxCols` |
| `rule_set/web/src/app/pages/init-simulator-page.component.html` | `[style.--cards-max-cols]="maxCols"` on `.cards` |
| `rule_set/web/src/app/pages/init-simulator-page.component.css` | Update `.cards` grid rule |
| `rule_set/web/src/app/pages/pre-simulator-page.component.ts` | Same |
| `rule_set/web/src/app/pages/pre-simulator-page.component.html` | Same (both `.cards` instances) |
| `rule_set/web/src/app/pages/pre-simulator-page.component.css` | Same |
| `rule_set/web/src/app/pages/final-simulator-page.component.ts` | Same |
| `rule_set/web/src/app/pages/final-simulator-page.component.html` | Same (both `.cards` instances) |
| `rule_set/web/src/app/pages/final-simulator-page.component.css` | Same |
| `rule_set/web/src/app/shared/simulation-trace-log.component.ts` | Add `expanded` signal, `allExpanded`, `toggle`, `toggleAll`, `OnChanges` reset; add `summary` to `OfferTraceView` |
| `rule_set/web/src/app/shared/simulation-trace-log.component.html` | Toggle-all checkbox, clickable header, conditional body, chevron, summary line |
| `rule_set/web/src/app/shared/simulation-trace-log.component.css` | Styles for `.trace-toggle-all`, clickable `.offer-head`, `.chevron`, `.offer-summary` |

## Risks and Open Questions

| Risk | Mitigation |
|------|------------|
| `buildViews()` recomputes each CD tick — embedding state there would reset on every render | State lives on the component as a signal `expanded: Set<string>` keyed by `offerCode`; `buildViews()` reads `isExpanded()` only for the summary path, not for storage |
| `ngOnChanges` reset of `expanded` could surprise users who expand cards, then re-submit the form expecting state to persist | Out of scope per proposal §Out of Scope ("Persistent collapse state"). Reset is intentional and documented |
| Environment file replacement is the first one in `angular.json` — typo here breaks the dev build | Tasks will validate `npm run web:build -- --configuration development` succeeds after the change |
| Long dictamen summary lines could overflow on narrow screens | CSS truncation (`text-overflow: ellipsis`) on `.offer-summary`; expanding the card reveals full data |
| Accessibility regression: making `<header>` clickable without keyboard handlers | Spec includes `role="button"`, `tabindex="0"`, `aria-expanded`, and `(keydown.enter)`/`(keydown.space)` bindings; verify with keyboard nav in tasks phase |

## Test Strategy

The component is presentational and uses Angular signals; existing project pattern (per `web/src/app/`) does not include unit tests for this shared component today. Tasks phase will introduce:

1. A Karma spec for `SimulationTraceLogComponent` covering: default-collapsed render, `toggle(code)` flip, `toggleAll(true/false)`, `allExpanded` computed truthiness, reset on `@Input evaluations` change.
2. Manual smoke checklist in tasks: open INIT/PRE/FINAL simulator with multi-offer config, verify column cap at 4, verify each log collapses/expands independently.

No backend or service test changes — the engine and API are untouched.

## Out of Scope (re-confirmed)

- Persisting expand state across navigation or reloads
- Animations on expand/collapse
- Pagination
- Refactoring `simulation-trace-log.component.html` into sub-components
