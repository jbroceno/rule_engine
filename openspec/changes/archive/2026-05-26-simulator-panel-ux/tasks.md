---
change: simulator-panel-ux
phase: tasks
date: 2026-05-26
estimated_changed_lines: ~285
chained_prs_recommended: false
---

# Tasks: Simulator Panel UX

## Review Workload Forecast

| Metric | Value |
|--------|-------|
| Estimated changed/added lines | ~285 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Decision needed before apply | No |

All tasks fit in a single PR. Proceed to `sdd-apply`.

---

## Dependency Graph

```
T1 (env files)
  └── T2 (angular.json patch)
        └── T3 (init page col-cap)     ──┐
        └── T4 (pre page col-cap)      ──┼── T6 (trace-log TS)
        └── T5 (final page col-cap)    ──┘      └── T7 (trace-log HTML)
                                                       └── T8 (trace-log CSS)
                                                             └── T9 (karma spec)
                                                                   └── T10 (manual smoke)
```

Parallel opportunities:
- T3, T4, T5 are independent of each other — can run in parallel after T2.
- T6, T7, T8 must run sequentially (each builds on the previous).
- T9 depends on T6+T7+T8 being stable.

---

## Tasks

### [x] T1 — Create Angular environment files
**Sequential** (no dependencies)
**Spec refs**: Grid Column Cap requirement — "Angular environment files MUST be created if they do not exist"
**Design refs**: ADR-2

**Work:**
Create `rule_set/web/src/environments/environment.ts`:
```typescript
export const environment = {
  production: true,
  maxSimulatorColumns: 4,
};
```

Create `rule_set/web/src/environments/environment.development.ts`:
```typescript
export const environment = {
  production: false,
  maxSimulatorColumns: 4,
};
```

**Verify**: both files exist and export `maxSimulatorColumns: number`.

**Commit**: `feat(web): add Angular environment files with maxSimulatorColumns`

---

### [x] T2 — Patch angular.json with fileReplacements
**Sequential** (depends on T1)
**Spec refs**: Grid Column Cap requirement
**Design refs**: ADR-2

**Work:**
In `rule_set/web/angular.json`, under `projects.web.architect.build.configurations.development`, add:
```json
"fileReplacements": [
  {
    "replace": "src/environments/environment.ts",
    "with": "src/environments/environment.development.ts"
  }
]
```

**Verify**: `npm run web:build -- --configuration development` completes without error (run from `rule_set/web/`).

**Commit**: `feat(web): configure fileReplacements for development environment`

---

### [x] T3 — Apply column-cap binding to INIT simulator page
**Parallel** (depends on T2; independent of T4, T5)
**Spec refs**: Grid Column Cap requirement — "binding MUST live in the three page components that own the `.cards` element"
**Design refs**: ADR-2, ADR-3

**Files:** `init-simulator-page.component.ts`, `init-simulator-page.component.html`, `init-simulator-page.component.css`

**Work (TS):**
- Add import: `import { environment } from '../../environments/environment';`
- Add class member: `protected readonly maxCols = environment.maxSimulatorColumns;`

**Work (HTML):**
- On the single `.cards` div (line ~96), add `[style.--cards-max-cols]="maxCols"`:
  ```html
  <div class="cards" *ngIf="initElegibles().length" [style.--cards-max-cols]="maxCols">
  ```

**Work (CSS):**
- Replace the `.cards` `grid-template-columns` line:
  ```css
  .cards {
    display: grid;
    grid-template-columns: repeat(min(var(--cards-max-cols, 4), auto-fill), minmax(230px, 1fr));
    gap: 0.85rem;
  }
  ```

**Verify (manual):** Open INIT simulator with ≥4 offers; confirm grid caps at 4 columns. Change env to `maxSimulatorColumns: 2`; confirm 2-column cap without touching component code.

**Commit**: `feat(web): bind maxSimulatorColumns column cap on INIT simulator cards grid`

---

### [x] T4 — Apply column-cap binding to PRE simulator page
**Parallel** (depends on T2; independent of T3, T5)
**Spec refs**: Grid Column Cap requirement
**Design refs**: ADR-2, ADR-3

**Files:** `pre-simulator-page.component.ts`, `pre-simulator-page.component.html`, `pre-simulator-page.component.css`

**Work:** Same pattern as T3. The PRE template has **two** `.cards` divs (uiLimits summary + offer cards) — both need `[style.--cards-max-cols]="maxCols"`.

**Verify (manual):** Open PRE simulator; confirm both card grids cap at 4 columns.

**Commit**: `feat(web): bind maxSimulatorColumns column cap on PRE simulator cards grids`

---

### [x] T5 — Apply column-cap binding to FINAL simulator page
**Parallel** (depends on T2; independent of T3, T4)
**Spec refs**: Grid Column Cap requirement
**Design refs**: ADR-2, ADR-3

**Files:** `final-simulator-page.component.ts`, `final-simulator-page.component.html`, `final-simulator-page.component.css`

**Work:** Same pattern as T3. The FINAL template has **two** `.cards` divs — both need `[style.--cards-max-cols]="maxCols"`.

**Verify (manual):** Open FINAL simulator; confirm both card grids cap at 4 columns.

**Commit**: `feat(web): bind maxSimulatorColumns column cap on FINAL simulator cards grids`

---

### [x] T6 — Add expand state and logic to SimulationTraceLogComponent (TypeScript)
**Sequential** (depends on T3/T4/T5 being in the branch; can start after T1)
**Spec refs**: "Offer Cards Collapsed by Default", "Per-Offer Expand State Survives Change Detection", "Per-Instance Expand-All Toggle"
**Design refs**: ADR-1, ADR-4

**File:** `rule_set/web/src/app/shared/simulation-trace-log.component.ts`

**Work:**
1. Add imports: `OnChanges, SimpleChanges, computed, signal` from `@angular/core`.
2. Extend `OfferTraceView` type with `summary: string` field.
3. Add `implements OnChanges` on the class.
4. Add signals and methods:
   ```typescript
   protected readonly expanded = signal<Set<string>>(new Set<string>());

   protected readonly allExpanded = computed(() => {
     const set = this.expanded();
     return this.evaluations.length > 0 &&
       this.evaluations.every((e) => set.has(e.offerCode));
   });

   ngOnChanges(changes: SimpleChanges): void {
     if (changes['evaluations']) {
       this.expanded.set(new Set());
     }
   }

   protected isExpanded(offerCode: string): boolean {
     return this.expanded().has(offerCode);
   }

   protected toggle(offerCode: string): void {
     this.expanded.update((set) => {
       const next = new Set(set);
       if (next.has(offerCode)) next.delete(offerCode);
       else next.add(offerCode);
       return next;
     });
   }

   protected toggleAll(checked: boolean): void {
     if (checked) {
       this.expanded.set(new Set(this.evaluations.map((e) => e.offerCode)));
     } else {
       this.expanded.set(new Set());
     }
   }
   ```
5. In `buildViews()`, compute `summary` from dictamen entries:
   ```typescript
   const motivos = evaluation.dictamen?.['motivos'];
   const motivosStr = Array.isArray(motivos) ? motivos.join(' · ') : (motivos ? String(motivos) : '');
   const dictamenSummary = dictamenEntries
     .slice(0, 3)
     .map(({ key, value }) => `${key}: ${value}`)
     .join(' · ');
   const summary = [motivosStr, dictamenSummary].filter(Boolean).join(' | ');
   ```
6. Return `summary` in the `OfferTraceView` object.

**Verify**: TypeScript compiles without errors (`npm run web:build`).

**Commit**: `feat(web): add expand-state signals and toggle logic to SimulationTraceLogComponent`

---

### [x] T7 — Update SimulationTraceLogComponent template for collapsible cards
**Sequential** (depends on T6)
**Spec refs**: "Offer Cards Collapsed by Default", "Per-Instance Expand-All Toggle"
**Design refs**: ADR-4, "Collapsed Card Header" section

**File:** `rule_set/web/src/app/shared/simulation-trace-log.component.html`

**Work:**
1. Add "Expandir todo" checkbox to `.trace-head`:
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

2. Make `.offer-head` clickable with full accessibility:
   ```html
   <header class="offer-head"
     role="button"
     tabindex="0"
     [attr.aria-expanded]="isExpanded(offer.offerCode)"
     (click)="toggle(offer.offerCode)"
     (keydown.enter)="toggle(offer.offerCode)"
     (keydown.space)="$event.preventDefault(); toggle(offer.offerCode)">
     <h4>{{ offer.offerCode }}</h4>
     <span class="offer-state" [class.offer-state-failed]="!offer.eligible">
       {{ offer.eligible ? "Elegible" : "No elegible" }}
     </span>
     <span class="offer-summary" *ngIf="!isExpanded(offer.offerCode) && offer.summary">
       {{ offer.summary }}
     </span>
     <span class="chevron">{{ isExpanded(offer.offerCode) ? '▾' : '▸' }}</span>
   </header>
   ```

3. Wrap body content with `*ngIf="isExpanded(offer.offerCode)"`:
   ```html
   <ng-container *ngIf="isExpanded(offer.offerCode)">
     <div class="trace-table-wrapper">...</div>
     <div class="dictamen-result" *ngIf="offer.dictamen.length > 0">...</div>
   </ng-container>
   ```

**Verify (manual)**:
- All cards start collapsed after simulation run.
- Clicking a header expands only that card; others stay collapsed.
- Clicking an expanded header collapses it.
- Enter/Space keys trigger toggle.
- `aria-expanded` attribute reflects state correctly (inspect in browser DevTools).

**Commit**: `feat(web): add collapsible card UI to SimulationTraceLogComponent template`

---

### [x] T8 — Add CSS for collapsible card header and toggle-all control
**Sequential** (depends on T7)
**Spec refs**: All collapse/expand requirements
**Design refs**: "Collapsed Card Header" section

**File:** `rule_set/web/src/app/shared/simulation-trace-log.component.css`

**Work — append to existing styles:**
```css
/* trace-head layout update */
.trace-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.trace-head-titles {
  flex: 1 1 auto;
}

/* Expand-all checkbox */
.trace-toggle-all {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.83rem;
  font-weight: 500;
  color: var(--ink-soft);
  cursor: pointer;
  white-space: nowrap;
}

.trace-toggle-all input {
  width: auto;
  margin: 0;
}

/* Clickable offer header */
.offer-head {
  cursor: pointer;
  user-select: none;
  flex-wrap: wrap;
}

.offer-head:focus-visible {
  outline: 2px solid var(--accent, #0e5f8f);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

/* Chevron */
.chevron {
  margin-left: auto;
  font-size: 0.85rem;
  color: var(--ink-soft);
  flex-shrink: 0;
}

/* Collapsed summary line */
.offer-summary {
  flex: 1 1 100%;
  font-size: 0.78rem;
  color: var(--ink-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 0.2rem;
  font-family: "IBM Plex Mono", monospace;
}
```

**Verify (manual):**
- Cards header shows pointer cursor on hover.
- `.trace-head` has checkbox aligned to the right of the title block.
- Collapsed summary truncates with ellipsis on narrow viewports.
- Focus ring appears when navigating with keyboard (Tab then Space/Enter).

**Commit**: `feat(web): style collapsible card header and trace toggle-all control`

---

### [x] T9 — Add Karma spec for SimulationTraceLogComponent
**Sequential** (depends on T6 + T7 + T8)
**Spec refs**: No-regression requirement; design "Test Strategy" section
**Design refs**: "Test Strategy"

**File (NEW):** `rule_set/web/src/app/shared/simulation-trace-log.component.spec.ts`

**Coverage targets:**
1. Default collapsed render — no trace rows visible after initial render with 3 evaluations.
2. `toggle(code)` — calling toggle for one offer sets `isExpanded(code)` to `true`; others remain `false`.
3. `toggle(code)` twice — returns to collapsed state.
4. `toggleAll(true)` — all offer codes appear in `expanded()` set.
5. `toggleAll(false)` — `expanded()` set is empty.
6. `allExpanded` computed — returns `true` only when every evaluation code is in the set.
7. `ngOnChanges` reset — setting new evaluations input clears `expanded()` set.

**Verify**: `npm run web:test` passes without errors.

**Commit**: `test(web): add Karma spec for SimulationTraceLogComponent expand-state logic`

---

### T10 — Manual smoke checklist
**Sequential** (depends on T9 — all code merged)
**Spec refs**: No Regression requirement; all scenarios

This task has no file output — it is a verification gate before closing the change.

**Checklist:**

**Column cap (Grid Column Cap requirement):**
- [ ] Run INIT simulator with ≥4 eligible offers — grid shows max 4 columns
- [ ] Run PRE simulator — both card grids (uiLimits + offers) show max 4 columns
- [ ] Run FINAL simulator — both card grids show max 4 columns
- [ ] Change `maxSimulatorColumns` to `2` in `environment.development.ts`; restart dev server; confirm 2-column cap on all pages

**Collapsed by default (Offer Cards Collapsed requirement):**
- [ ] Run any simulator — all offer cards in the trace log start collapsed
- [ ] Clicking a card header expands it; others remain collapsed
- [ ] Clicking the expanded header collapses it again
- [ ] Trace table and dictamen block are hidden while collapsed
- [ ] Collapsed header shows offer code + eligibility badge + summary line

**Expand all (Per-Instance Expand-All requirement):**
- [ ] Check "Expandir todo" checkbox — all cards in that instance expand
- [ ] Uncheck it — all cards collapse
- [ ] On FINAL page (3 trace log instances): check "Expandir todo" on first instance; second and third instances are unaffected

**Accessibility:**
- [ ] Tab to offer card header; press Space/Enter — toggles expand state
- [ ] `aria-expanded` attribute reflects current state (verify in DevTools Elements panel)

**No regression:**
- [ ] Submitting INIT/PRE/FINAL forms still sends the correct payload (verify in Network tab)
- [ ] Response data is rendered correctly inside expanded cards
- [ ] `npm run web:test` passes

---

## Summary

| Task | Type | Depends on | Parallel with |
|------|------|------------|---------------|
| T1 — Create env files | feat | — | — |
| T2 — Patch angular.json | feat | T1 | — |
| T3 — INIT col-cap | feat | T2 | T4, T5 |
| T4 — PRE col-cap | feat | T2 | T3, T5 |
| T5 — FINAL col-cap | feat | T2 | T3, T4 |
| T6 — Trace-log TS | feat | T2 | — |
| T7 — Trace-log HTML | feat | T6 | — |
| T8 — Trace-log CSS | feat | T7 | — |
| T9 — Karma spec | test | T8 | — |
| T10 — Manual smoke | verify | T9 | — |

**Total tasks**: 10
**Commits**: 9 (T10 produces no commit)
**Estimated changed lines**: ~285 (below 400-line threshold)
