# AGENTS.md

## Purpose
This repository contains a mortgage offer rules engine prototype and SQL support scripts.
Main implementation is in `rule_set/`; business context is in `doc/`.

## Build, Lint, Test
Tooling status:
- No build/lint pipeline yet.
- Tests use Node built-in runner (`node:test`).
- ESLint/Prettier/TypeScript/Jest/Vitest/Mocha are not configured.

Setup (run from `rule_set/`):
- `npm install`

Build commands:
- No build command exists.
- If added, create `build` in `rule_set/package.json` and document it here.

Lint commands:
- No lint command exists.
- If added, prefer `npm run lint` and `npm run lint -- --fix`.

Test commands (current practical verification):
- `npm test`
- `node offer_rule_engine.js`
- Optional capture: `node offer_rule_engine.js > debug.log`

Single-test execution (important):
- Single-test is supported via Node built-in test runner (`node:test`).
- Run one file: `node --test path/to/file.test.js`
- Run one test by name: `node --test --test-name-pattern="name fragment" path/to/file.test.js`
- Available scripts:
  - `"test": "node --test"`
  - `"test:file": "node --test"`
  - `"test:name": "node --test --test-name-pattern"`
- Typical usage:
  - `npm run test:file -- test/rule_engine.test.js`
  - `npm run test:name -- "NOT_IN with missing param"`

## SQL Commands
Use SQL Server tooling (for example `sqlcmd`) and execute in this order:
1. Create tables/indexes/procedures: `:r .\sql\data_model.sql`
2. Seed rulesets and rules: `:r .\sql\rule_sets.sql`
3. Seed parameters: `:r .\sql\param.sql`
4. Optional additional procedure: `:r .\sql\sp_rules_params.sql`
5. Validate payload:
   - `EXEC dbo.cfg_get_offers_and_params_json @offer_codes = NULL, @DATE = '2026-02-12';`

## JavaScript Style Guidelines
Language and modules:
- Use modern JavaScript with ES modules.
- Keep compatibility with `"type": "module"`.
- Use explicit imports at top of file.

Formatting:
- 2-space indentation.
- Semicolons.
- Double quotes in JS source.
- Prefer small, focused functions.

Imports:
- Node built-ins first (e.g., `fs`, `util`).
- Avoid unused imports.
- Keep import order stable.

Naming:
- `camelCase` for variables/functions.
- `UPPER_SNAKE_CASE` for constants.
- Preserve payload keys exactly (`offer_rank`, `rule_id`, `value_type`).

Types and coercion:
- Treat `value_type` as source of truth (`NUMBER`, `BOOL`, `STRING`, `JSON`).
- Centralize parsing/coercion in helper functions.
- Handle `null`/`undefined` explicitly.
- Avoid implicit coercion.

Rule evaluation:
- Keep PRE and FINAL behavior explicit.
- Preserve semantics: AND within `group_id`, OR across groups.
- Keep deterministic order: `priority DESC`, then `rule_id ASC`.

Error handling:
- Throw explicit errors for unsupported operators/action types.
- Fail fast on invalid configuration structure.
- Use safe parsing for recoverable JSON values.
- Record missing params in traces; do not silently ignore.

Side effects:
- Keep pure logic separate from I/O.
- Keep file I/O and console output in demo/bootstrap sections.
- Avoid hidden global mutations.

## SQL Style Guidelines
- Use uppercase SQL keywords.
- Keep naming conventions (`cfg_offer_*`).
- Filter by validity/enabled flags where relevant.
- Keep JSON export ordering deterministic.
- Preserve contracts consumed by JS (`offers`, `params`, `paramValues`).

## Rule and Config Conventions
- Use `PARAM:<KEY>` for configurable references.
- Keep rejection rules high priority and decision rules low priority.
- Use `stop_processing = true` for terminal decision rules.
- Prefix rule names by stage (`PRE ...`, `FINAL ...`).
- Keep `motivos` payload shape stable (`{"code":"..."}`).

## Agent Working Agreement
When modifying this repository:
1. Preserve JSON and SQL contracts.
2. Do not rename external payload keys for style reasons.
3. Add tests when changing evaluation logic.
4. If lint/build/test tooling is added, update this file in the same change.
5. Keep behavior docs aligned with implementation.

## Cursor/Copilot Rules
No repository-level Cursor/Copilot instruction files were found:
- `.cursor/rules/`
- `.cursorrules`
- `.github/copilot-instructions.md`

Until such files exist, this `AGENTS.md` is the authoritative agent guidance for the repository.
