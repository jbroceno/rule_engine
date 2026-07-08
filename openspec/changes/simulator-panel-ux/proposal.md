# Proposal: Simulator Panel UX

## Intent

Two usability problems degrade the simulator results view:

1. **Panel overflow** — `.cards` uses `auto-fit` with no column cap. With several offers, panels shrink until titles are clipped and content becomes unreadable.
2. **Trace log wall** — `<app-simulation-trace-log>` renders every offer card fully expanded. On pages with INIT + PRE + FINAL logs each holding N offers, the user must scroll through hundreds of rule rows to reach relevant data.

Both issues reduce signal-to-noise for analysts validating rule behaviour.

## Scope

### In Scope
- CSS max-column cap on `.cards` grids (4 columns, configurable via Angular environment token)
- Angular `environment.ts` / `environment.development.ts` files introducing `maxSimulatorColumns: number`
- Collapsible offer cards in `SimulationTraceLogComponent` — collapsed by default, showing only offer code + dictamen summary
- Per-instance "Expandir todo / Colapsar todo" checkbox in `SimulationTraceLogComponent` that toggles all cards within that instance
- CSS for toggle control and collapsed/expanded states

### Out of Scope
- Persistent collapse state (session storage or URL param)
- Animations on expand/collapse
- Pagination of offer cards
- Changes to the rule trace table columns or dictamen format
- Backend changes

## Capabilities

### New Capabilities
- `simulator-panel-ux`: configurable panel grid cap and collapsible trace log cards

### Modified Capabilities
- `simulator`: existing spec RF-002 through RF-006 are unaffected; this change adds layout and interaction requirements only

## Approach

**Grid cap**: replace `repeat(auto-fit, minmax(230px, 1fr))` with `repeat(min(var(--cards-max-cols), auto-fit), minmax(230px, 1fr))`. The cleaner Angular approach is to read `environment.maxSimulatorColumns` in the page component and bind it as an inline style or CSS custom property on the `.cards` element. No CSS custom property injection via `@Input` is needed on the shared component — the binding lives in the three page components that own the `.cards` div.

**Collapsible log**: add an `expanded` boolean array (indexed by offer position) to `SimulationTraceLogComponent`, initialised to `false`. A `toggleAll` signal drives the header checkbox. The template guards the rule-trace and dictamen tables with `*ngIf="offer.expanded"` (or `[hidden]`). The collapsed state renders only `<h4>` (offer code) + eligibility badge + a one-line dictamen summary (e.g. `initEligible: false · motivos: [...]`). No new component is created — all changes are in the existing shared component.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `rule_set/web/src/environments/environment.ts` | New | Introduce `maxSimulatorColumns: 4` |
| `rule_set/web/src/environments/environment.development.ts` | New | Same default, overridable for dev |
| `rule_set/web/src/app/pages/init-simulator-page.component.html` | Modified | Bind `maxSimulatorColumns` as CSS var on `.cards` |
| `rule_set/web/src/app/pages/init-simulator-page.component.ts` | Modified | Read environment value, expose to template |
| `rule_set/web/src/app/pages/pre-simulator-page.component.html` | Modified | Same as INIT |
| `rule_set/web/src/app/pages/pre-simulator-page.component.ts` | Modified | Same as INIT |
| `rule_set/web/src/app/pages/final-simulator-page.component.html` | Modified | Same as INIT |
| `rule_set/web/src/app/pages/final-simulator-page.component.ts` | Modified | Same as INIT |
| `rule_set/web/src/app/shared/simulation-trace-log.component.ts` | Modified | Add expand/collapse state and toggleAll |
| `rule_set/web/src/app/shared/simulation-trace-log.component.html` | Modified | Collapsed header row + toggle checkbox |
| `rule_set/web/src/app/shared/simulation-trace-log.component.css` | Modified | Styles for collapsed state and toggle control |
| `rule_set/web/src/app/pages/init-simulator-page.component.css` | Modified | CSS var for column cap |
| `rule_set/web/src/app/pages/pre-simulator-page.component.css` | Modified | Same |
| `rule_set/web/src/app/pages/final-simulator-page.component.css` | Modified | Same |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Angular environment files missing — project has none yet | Low | Create both files following Angular 20 convention; no `fileReplacements` config needed unless prod build differs |
| `buildViews()` called in template as method — returns new array each change detection cycle; adding per-offer state inside it would reset on each CD cycle | Med | Move offer state to a signal array in the component, keyed by `offerCode`; rebuild only when `evaluations` input changes |
| Three-page duplication for grid cap binding | Low | Acceptable — pages are already independent; no shared wrapper exists |

## Rollback Plan

All changes are additive or CSS-only. Revert commits touching `simulation-trace-log.component.*` and the three page components. The `.cards` change is a single CSS line per file — revert to `repeat(auto-fit, minmax(230px, 1fr))`.

## Dependencies

- None (no new packages, no backend changes)

## Success Criteria

- [ ] `.cards` grid never exceeds 4 columns regardless of how many offers are returned
- [ ] `maxSimulatorColumns` in environment changes the cap without code edits
- [ ] Each `<app-simulation-trace-log>` instance renders all offer cards collapsed by default (only offer code + eligibility badge visible)
- [ ] Clicking a collapsed card expands it showing full rule trace + dictamen
- [ ] "Expandir todo" checkbox on the log header expands all cards in that instance; unchecking collapses all
- [ ] INIT log, PRE log, and FINAL log on the same page maintain independent expand/collapse state
- [ ] No regression on existing simulator spec (RF-001 through RF-006)
