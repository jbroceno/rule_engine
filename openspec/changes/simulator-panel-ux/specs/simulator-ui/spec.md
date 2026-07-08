---
change: simulator-panel-ux
capability: simulator-ui
date: 2026-05-26
---

# Simulator UI Specification

## Purpose

Layout and interaction requirements for the simulator results view: a configurable column cap on offer-card grids and collapsible offer cards in the trace-log component.

---

## Requirements

### Requirement: Grid Column Cap

The `.cards` grid in each simulator page (INIT, PRE, FINAL) MUST enforce a maximum column count. The cap value MUST be sourced from `environment.maxSimulatorColumns` (default: `4`). The Angular environment files (`environment.ts` and `environment.development.ts`) MUST be created if they do not exist, each exporting `maxSimulatorColumns: number`.

The page component MUST read the environment value and expose it to the template. The binding MUST live in the three page components that own the `.cards` element; it MUST NOT be an `@Input` on any shared component.

#### Scenario: Cap at default value

- GIVEN `environment.maxSimulatorColumns` is `4` and the API returns 6 offers
- WHEN the simulator page renders the `.cards` grid
- THEN the grid displays at most 4 columns
- AND the remaining cards wrap to subsequent rows

#### Scenario: Cap overridden in environment

- GIVEN `environment.maxSimulatorColumns` is changed to `2` in the environment file
- WHEN the simulator page renders
- THEN the grid displays at most 2 columns without any code change in the component

#### Scenario: Fewer offers than cap

- GIVEN the API returns 2 offers and `maxSimulatorColumns` is `4`
- WHEN the simulator page renders
- THEN the grid uses only 2 columns (no empty forced columns)

---

### Requirement: Offer Cards Collapsed by Default

Each offer card rendered inside `SimulationTraceLogComponent` MUST start in a collapsed state. The collapsed view MUST show only the offer code and an eligibility badge (e.g. `initEligible: true/false`). The rule-trace table and dictamen detail MUST NOT be visible while collapsed.

#### Scenario: Initial render

- GIVEN the simulator returns results for 3 offers
- WHEN `SimulationTraceLogComponent` renders
- THEN all 3 offer cards are collapsed
- AND no rule-trace rows are visible

#### Scenario: Expanding a single card

- GIVEN all cards are collapsed
- WHEN the user clicks a collapsed offer card header
- THEN that card expands to show the rule-trace table and dictamen detail
- AND the other cards remain collapsed

#### Scenario: Re-collapsing an expanded card

- GIVEN one card is expanded
- WHEN the user clicks its header again
- THEN the card returns to collapsed state

---

### Requirement: Per-Offer Expand State Survives Change Detection

The expand/collapse state for each offer MUST be held in a component-level `signal<Set<string>>` keyed by `offerCode`. It MUST NOT be embedded in the view-model array returned by `buildViews()` or an equivalent method. When `buildViews()` is called during change detection, the expand states MUST remain unchanged.

#### Scenario: State survives CD cycle

- GIVEN offer `ALTO_RIESGO` is expanded
- WHEN Angular triggers a change-detection cycle that rebuilds the view-model array
- THEN offer `ALTO_RIESGO` remains expanded

---

### Requirement: Per-Instance Expand-All Toggle

Each `SimulationTraceLogComponent` instance MUST render a "Expandir todo / Colapsar todo" checkbox in its header. Checking the box MUST expand all cards within that instance. Unchecking it MUST collapse all cards within that instance. The toggle MUST affect only the cards owned by that instance and MUST NOT influence other `SimulationTraceLogComponent` instances on the same page.

#### Scenario: Expand all via checkbox

- GIVEN all cards are collapsed in an instance
- WHEN the user checks the "Expandir todo" checkbox
- THEN all cards in that instance expand
- AND cards in other instances on the page are unaffected

#### Scenario: Collapse all via checkbox

- GIVEN all cards are expanded in an instance
- WHEN the user unchecks the checkbox
- THEN all cards in that instance collapse

#### Scenario: Independent state across INIT / PRE / FINAL logs

- GIVEN the FINAL simulator page renders three `SimulationTraceLogComponent` instances (INIT log, PRE log, FINAL log)
- WHEN the user checks "Expandir todo" on the INIT log instance
- THEN only the INIT log cards expand
- AND the PRE log and FINAL log instances remain in their previous state

#### Scenario: Checkbox reflects mixed state correctly

- GIVEN the user manually expands some but not all cards in an instance
- WHEN the user checks the "Expandir todo" checkbox
- THEN all cards in that instance become expanded
- AND the checkbox stays checked

---

### Requirement: No Regression on Existing Simulator Requirements

The layout changes MUST NOT alter the data sent to or received from the simulation API endpoints. RF-001 through RF-006 from the `simulator` spec MUST continue to hold without modification.

#### Scenario: API payload unchanged

- GIVEN the panel UX changes are applied
- WHEN the user submits a simulation form
- THEN the request payload is identical to pre-change behaviour
- AND the response is rendered (collapsed by default) without data loss
