# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **mortgage offer rule engine** for "Ofertas hipotecarias". It evaluates applicant data against configurable rule sets to determine eligibility across three pipeline stages (INIT → PRE → FINAL) for multiple mortgage offers.

## Commands

All commands run from the `rule_set/` directory.

```bash
# Run all tests (Node.js built-in test runner)
npm test

# Run a specific test file
npm run test:file -- test/rule_engine.test.js

# Run tests matching a name pattern
npm run test:name -- "precheck"

# Run the business-scenario suite (offers × stages decision matrix)
npm run test:scenarios

# Start the Express API server
npm run api:start

# Start API in watch mode (auto-restart on change)
npm run api:dev

# Run the demo (loads rules.json and prints results to stdout)
node offer_rule_engine.js

# Enable debug output in the demo
RULE_ENGINE_DEBUG=1 node offer_rule_engine.js
```

### Angular frontend (`rule_set/web/`)

```bash
npm run web:start   # Serve at http://localhost:4200
npm run web:build   # Build to web/dist/
npm run web:test    # Run Karma unit tests
```

## Test suite & client evidence

The full suite (`npm test`) spans 11 files covering the engine, dates/vigencias, workflow
adapter/publish/snapshot, and the business scenarios. `rules.json` is the engine's source of
truth — **not** `docs/offers-settings.md`, which is functional documentation only.

### Business-scenario model (single source of truth)

The offers × stages decision matrix is data-driven so the test and the client report can
**never** diverge — both consume the same scenario definitions:

| File | Role |
|------|------|
| `fixtures/business_scenarios.js` | The scenarios: input + **expected winner** (the business contract from the decision matrix). Hand-authored. |
| `fixtures/scenario_runner.js` | Shared runner — loads `rules.json` once, runs INIT→PRE→FINAL (independent or chained), returns a snapshot. |
| `fixtures/business_scenarios.golden.json` | Frozen snapshot per scenario (eligibles per stage + uiLimits). **Engine-generated**, human-reviewed — never hand-typed. |
| `scripts/freeze_scenarios.mjs` | Regenerates the golden and **fails loudly** if any engine winner ≠ the hand-authored expected winner (catches transcription errors). |
| `test/offer_scenarios.test.js` | Iterates the scenarios; asserts (1) winner === expected, (2) full snapshot === golden. |
| `scripts/gen_evidencia_report.mjs` | Renders the client report from the same scenarios + golden. |

> Fixtures live in `fixtures/`, **not** `test/` — see the gotcha below.

When an offer parameter changes (e.g. an offer's `MAX_LTV`):

1. Regenerate `rules.json` so the engine reflects the new value (changing the doc alone has no effect).
2. Edit `fixtures/business_scenarios.js`: add boundary/regression scenarios for the changed limit
   (a value the old config accepted but the new one must reject) with their expected winner.
3. Re-freeze the golden and **review it** against the decision matrix:
   ```bash
   node scripts/freeze_scenarios.mjs   # fails if expected winners don't match the engine
   ```
4. Run the **whole** suite and build the evidence report:
   ```bash
   # from rule_set/
   node --test > docs/evidencias/evidencia-full-<fecha>.txt 2>&1            # (a) merged raw TAP
   mkdir -p docs/evidencias/raw
   for f in test/*.test.js; do b=$(basename "$f" .test.js); node --test "$f" > docs/evidencias/raw/$b.tap 2>&1; done  # (b) per-file TAP
   node scripts/gen_evidencia_report.mjs <fecha>                            # (c) Markdown report
   ```

Deliverables land in `docs/evidencias/`:
- `evidencia-full-<fecha>.txt` — merged raw runner output (TAP) of the whole suite.
- `raw/<fichero>.tap` — raw runner output per test file.
- `informe-evidencias-full-<fecha>.md` — client report: per-file summary, config-change summary,
  **per-scenario detail** (engine input → expected winner → obtained eligibles/winner/uiLimits +
  verdict), and the breakdown of the remaining test files (PASS / SKIP / FAIL).

> The 2 `SKIP` are *live* `workflow_service` tests (CA-013) needing real environment credentials;
> skipped locally by design, not failures.

> **Gotcha — helper scripts must NOT live in `test/`.** `npm test` runs `node --test` with no
> path, whose default glob includes `**/test/**/*.{js,mjs,cjs}`. Any file under `test/` is executed
> as a test, side effects and all. Evidence/tooling scripts therefore live in `scripts/`, never `test/`.

## Architecture

```
rule_set/
├── rule_engine.js          # Core engine (pure functions, no I/O)
├── rules.json              # Local config fixture (offers + params)
├── offer_rule_engine.js    # CLI demo runner
├── test/
│   └── rule_engine.test.js # All unit tests
├── api/                    # Express.js REST API
│   ├── server.js / app.js
│   ├── routes/
│   │   ├── index.js                      # /health, /config, /simulate/*
│   │   └── admin_routes.js               # /admin/* — all admin endpoints
│   ├── controllers/
│   │   ├── admin_offers_controller.js    # Offers CRUD
│   │   ├── admin_rules_controller.js     # Rules CRUD
│   │   ├── admin_params_controller.js    # Params CRUD
│   │   ├── admin_validate_controller.js  # Config validation
│   │   ├── admin_export_controller.js    # Bulk export
│   │   ├── admin_apply_controller.js     # Bulk apply (with snapshot)
│   │   └── admin_snapshots_controller.js # Snapshot list + restore
│   ├── services/
│   │   ├── config_service.js             # SQL Server config loader
│   │   └── admin_service.js              # All admin DB operations (offers + rules + params + snapshots)
│   ├── validators/admin_validator.js     # Request payload validation
│   ├── utils/rule_catalogs.js            # Allowed values + normalizers (ALLOWED_STAGES = INIT|PRE|FINAL)
│   ├── db/sql_client.js                  # mssql pool
│   └── .env / .env.example
├── web/                    # Angular 20 simulator UI
│   └── src/app/
│       ├── pages/
│       │   ├── init-simulator-page.component.*  # INIT-stage simulation form
│       │   ├── pre-simulator-page.component.*   # PRE-stage simulation form
│       │   ├── final-simulator-page.component.* # FINAL-stage simulation form
│       │   ├── configurator-page.component.*    # Offer/Rule/Param CRUD + export/import/apply
│       │   ├── config-page.component.*          # Read-only config viewer
│       │   └── snapshots-page.component.*       # Snapshot browser + restore
│       ├── services/
│       │   ├── api.service.ts                  # Simulation endpoints (init + pre + final)
│       │   └── admin-api.service.ts            # All admin endpoints (offers + rules + params + snapshots)
│       └── models/
│           ├── api.models.ts
│           └── admin.models.ts
└── sql/                    # SQL Server schema + stored procedures
    ├── data_model.sql       # Core tables (ruleset, rule, condition, action, param)
    ├── sp_rules_params.sql  # Stored procedure cfg_get_rules_json
    ├── rule_sets.sql        # Seed data for offer rulesets
    ├── param.sql            # Seed data for parameters
    └── snapshots.sql        # Table cfg_config_snapshot
```

### Core engine (`rule_engine.js`)

Five exported functions form the evaluation pipeline:

1. **`normalizeConfig(config, options?)`** — validates and normalizes the raw JSON config (from file or SQL). Throws on invalid shape. Pass `{ strictValidation: true }` for full validation.
2. **`initcheck(inputBase, offers, paramsIndex)`** — runs INIT-stage rules against all offers; returns `{ eligibleOffers, all }`. `eligibleOffers` contains offers where `dictamen.initEligible === true`, sorted by `offer_rank` desc.
3. **`precheck(inputBase, offers, paramsIndex)`** — runs PRE-stage rules; returns `{ eligibleOffers, uiLimits, all }`.
4. **`computeDerived(input)`** — computes `ltv` and `baseGarantia` from raw financial inputs.
5. **`finalize(inputFull, offers, paramsIndex, preResult)`** — runs FINAL-stage rules on pre-eligible offers only; returns `{ winner, results }`.

### Three-stage pipeline

Each simulator is **independent** — each receives its own complete input. There is no state chaining between stages.

| Stage | Function | Eligibility flag | Scope |
|-------|----------|-----------------|-------|
| INIT | `initcheck()` | `dictamen.initEligible` | All offers evaluated |
| PRE | `precheck()` | `dictamen.preEligible` | All offers evaluated |
| FINAL | `finalize()` | `dictamen.eligible` | Pre-eligible offers only |

### Rule evaluation semantics

- Rules execute in **descending priority order**, ties broken by ascending `rule_id`.
- Conditions within a rule use **DNF (Disjunctive Normal Form)**: conditions sharing the same `group_id` are ANDed; groups are ORed.
- Each rule must have at least one `stage` guard (`field: "stage", operator: "EQ", value1: "INIT"|"PRE"|"FINAL"`).
- A rule with `stop_processing: true` halts further rule evaluation for that offer after it matches.
- Fields `eligible`, `rejected`, `selectedOffer` are FINAL-only; they cannot be set by INIT or PRE rules.

### Inversion pattern — rules fire on rejection, not eligibility

Rules act as **rejection detectors**: they fire when their conditions match and set flags like `preRejected = true`. Eligibility conditions (positive logic from the functional spec) must therefore be **negated** before encoding as rule conditions.

Apply De Morgan's laws:

| Positive spec | Negated rule condition | DNF impact |
|---------------|----------------------|------------|
| `NOT (A AND B)` | `(NOT A) OR (NOT B)` | expands: one group per negated term |
| `NOT (A OR B)` | `(NOT A) AND (NOT B)` | collapses: single group, all terms negated |

**Example — ANDed condition (expands on negation):**
- Spec: `(NumIntervinientes=1 AND EdadT1<MAXEDAD) OR (NumIntervinientes=2 AND EdadT1<MAXEDAD AND EdadT2<MAXEDAD)`
- Rejection rule needs 3–4 groups (one per way the spec can fail).

**Example — ORed condition (collapses on negation):**
- Spec: `AntiguedadT1>ANT OR AntiguedadT2>ANT OR DomiciliaT1=true OR DomiciliaT2=true`
- Rejection rule needs 1 group: `AntiguedadT1<=ANT AND AntiguedadT2<=ANT AND DomiciliaT1=false AND DomiciliaT2=false`

> Document the original positive condition in the rule `name` field (prefix `neg.:`) so maintainers can trace back to the functional spec. Full worked examples with JSON in `docs/CONFIGURACION_REGLAS.md § Patrón de inversión`.

### Parameter references

In conditions and actions, `value1: "PARAM:<KEY>"` resolves at runtime from `paramsIndex`. Params are **offer-scoped only** (no stage): `paramsIndex[offerCode][key]`. The same param value applies across all stages (INIT, PRE, FINAL) for that offer.

---

## API endpoints (base: `/api`)

### Autenticación

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/login` | Obtiene un JWT. Body: `{ email, password }`. Respuesta 200: `{ token, expiresIn }`. |

**Errores de login:**
- `400` — falta `email` o `password` en el body.
- `401 "Credenciales inválidas."` — email desconocido, contraseña incorrecta o usuario deshabilitado. Respuesta genérica sin enumerar el caso concreto.

**Middleware JWT** (`api/middleware/auth_middleware.js`):
Protege **todas** las rutas `/api/*` excepto exactamente `GET /api/health` y `POST /api/auth/login`. Espera cabecera `Authorization: Bearer <token>`. Si el token es válido, inyecta `req.user = { userId, email, role }` en el request y pasa al siguiente handler. Si falta, es inválido o ha expirado devuelve `401`.

El middleware se monta en `app.js` **después** de `express.json()` y **antes** de `app.use("/api", apiRoutes)`. La comprobación de rutas públicas usa method+path exactos (`GET /api/health`, `POST /api/auth/login`) para evitar que `/api/healthcheck` o futuros `/api/auth/refresh` queden accidentalmente expuestos.

**Middleware RBAC** (`api/middleware/require_role.js`):
Factory `requireRole(...roles)`, montado como segundo middleware en el único punto de montaje del router admin (`api/routes/index.js`): `router.use("/admin", requireRole("admin"), adminRoutes)`. Como `authMiddleware` ya garantiza `req.user` para estas rutas, `requireRole` solo lee `req.user.role`: `403` si el rol no está en la lista permitida (rol insuficiente o no reconocido — nunca un 5xx), `401` defensivo si `req.user` faltara. `requireRole(...roles)` también falla rápido (lanza `Error` síncrono en tiempo de construcción, no de petición) si alguno de los `roles` pasados como argumento no está en `ALLOWED_ROLES` — evita que un typo en un call site produzca en silencio un middleware que 403 todo para siempre. Catálogo `ALLOWED_ROLES = new Set(["admin", "viewer"])` + `normalizeRole(v)` en `api/utils/rule_catalogs.js`, siguiendo la misma convención que `ALLOWED_STAGES`/`normalizeStage`. Rutas públicas, `/api/simulate/*`, `GET /api/config` y **`/api/workflow/*`** no llevan este gate — **solo `/api/admin/*` lo exige**. `/api/workflow/*` (`workflow_routes.js`) expone únicamente `POST /workflow/condiciones-hipotecas`, una consulta de elegibilidad en tiempo real par de `/api/simulate/*` (no una acción de administración/publicación); las acciones reales de publicación a WF (`postWorkflowSnapshot`, `postWorkflowPublicar`) ya viven bajo `/api/admin/workflow/*`, dentro de `adminRoutes`, y por tanto ya están cubiertas por el gate `/admin` de arriba.

### Simulation & config

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/config` | Load normalized config from SQL |
| POST | `/simulate/init` | Run INIT simulation |
| POST | `/simulate/pre` | Run PRE simulation |
| POST | `/simulate/final` | Run FINAL simulation |

### Admin — offers (base: `/api/admin`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/offers` | List all offers |
| POST | `/offers` | Create offer |
| PUT | `/offers/:offerCode` | Update offer (code, name, rank, enabled, oferta_id) |
| DELETE | `/offers/:offerCode` | Delete offer (fails with 409 if rules exist) |
| PATCH | `/offers/:offerCode/enabled` | Toggle offer enabled/disabled |

> Renaming an offer's `code` cascades automatically: rules reference offers by `ruleset_id` (integer FK) so no update needed there, but params store `offer_code` as a string column so `updateOffer` runs a follow-up `UPDATE cfg_offer_param SET offer_code = @newCode WHERE offer_code = @oldCode`.

### Admin — rules & params (base: `/api/admin`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/rules` | List rules (paginated; filters: offerCode, stage, q) |
| POST | `/rules` | Create rule |
| PUT | `/rules/:ruleId` | Update rule |
| DELETE | `/rules/:ruleId` | Delete rule |
| PATCH | `/rules/:ruleId/enabled` | Toggle rule enabled/disabled |
| PATCH | `/rules/reorder` | Reorder rule priorities |
| GET | `/params` | List params (filters: offerCode, stage) |
| POST | `/params` | Create param |
| PUT | `/params/:paramId` | Update param |
| DELETE | `/params/:paramId` | Soft-delete param (sets enabled=0) |
| POST | `/validate` | Validate rule payload shape |

### Admin — bulk config operations

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/export` | Export all rules + params as JSON |
| POST | `/admin/config/apply/preview` | **Read-only** impact preview: offer codes afectados, reglas/params a borrar e insertar. No escribe en BD, no crea snapshot. No requiere `comment` ni `confirmReplaceAll`. |
| POST | `/admin/config/apply` | Replace rules (and optionally params) in DB. Creates a snapshot automatically. Requires `comment` y `confirmReplaceAll: true`. |

#### `POST /admin/config/apply` payload

```json
{
  "rules": [ ...AdminRuleItem[] ],
  "params": [ ...AdminParamsItem[] ],   // optional — omit to keep existing params
  "comment": "Motivo del cambio",       // required
  "confirmReplaceAll": true,            // required — confirmación explícita del reemplazo total (OWASP-02)
  "createdBy": "nombre.usuario"         // optional
}
```

Si `confirmReplaceAll` falta o es `false`, la API responde `400` con
`"Debes confirmar el reemplazo total de la configuración (confirmReplaceAll)."`
antes de crear ningún snapshot o tocar la BD.

Response includes `snapshot_id` of the pre-apply backup snapshot.

> **Scope behavior**: "Grabar configuración" calls `applyConfig` with `deleteAllPeriods: true`, which deletes rules and params for the affected offer codes across **all** `offer_date_id` periods before inserting. Snapshot restore calls `applyConfig` without that flag, so the delete is scoped to only the `offer_date_id` values present in the payload — other periods are not touched.

#### `POST /admin/config/apply/preview` payload

```json
{
  "rules": [ ...AdminRuleItem[] ],
  "params": [ ...AdminParamsItem[] ]   // optional — same shape as /config/apply, sin comment ni confirmReplaceAll
}
```

Respuesta (`ApplyImpact`):

```json
{
  "offerCodes": ["OFERTA_A", "OFERTA_B"],
  "rulesToDelete": 4,
  "paramsToDelete": 2,
  "rulesToInsert": 5,
  "paramsToInsert": 3,
  "perOffer": [
    { "offerCode": "OFERTA_A", "rulesToDelete": 2, "paramsToDelete": 1, "rulesToInsert": 3, "paramsToInsert": 2 }
  ]
}
```

`computeApplyImpact` (servicio detrás de este endpoint) reutiliza la misma
derivación de scope que `applyConfig` (`deriveApplyScope`) y los mismos
resolvers de `ruleset_id` por offerCode, para que el preview y el apply real
nunca puedan discrepar en qué offerCodes/periodos están en alcance. El
frontend ("Grabar configuración") llama a este endpoint al abrir el diálogo
de confirmación y mantiene el botón de confirmar deshabilitado hasta que el
preview resuelve.

### Admin — snapshots

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/snapshots` | List snapshots (paginated; filters: dateFrom, dateTo, q, entorno) |
| POST | `/admin/snapshots/:snapshotId/restore` | Restore a snapshot. Creates a pre-restore safety snapshot automatically. |

#### `POST /admin/snapshots/:snapshotId/restore` payload

```json
{
  "createdBy": "nombre.usuario",
  "destino": "POC",
  "pocFechaDesde": "2026-01-01",
  "rangoDestino": null,
  "ofertaIdOverrides": null
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `destino` | no | `"POC"` (default) or `"WF"` |
| `pocFechaDesde` | **yes if WF→POC** | Target period start date (`YYYY-MM-DD`). Must match an existing `cfg_offer_dates.valid_from`, or a new period is created automatically. |
| `rangoDestino` | yes if `destino=WF` | `{ vigDesde, vigHasta }` — WF vigencia range |
| `ofertaIdOverrides` | no | `Record<offerCode, number>` — remap `oferta_id` per offer at publish time (WF only) |

---

## Config bulk operations workflow

The configurator page exposes three actions in the config operations bar:

1. **Exportar configuración** — downloads `config_export_YYYY-MM-DD.json` with all rules and params from the current DB state.

2. **Importar configuración** — opens a file picker. The selected JSON must have a `rules` array; `params` is optional (if absent, existing DB params are left untouched). After import, the tables show the imported data for review and a yellow banner indicates the config is "pending save".

3. **Grabar configuración** — saves the imported config to DB. Opens a confirmation dialog that:
   - Calls `POST /admin/config/apply/preview` immediately on open and renders a read-only impact
     summary (offer codes affected, rules/params to delete and insert per offer). The confirm
     button stays disabled until this preview resolves (OWASP-02 informed-consent safeguard).
   - Requires **Motivo** (required) — reason for the change, stored in the snapshot.
   - **Usuario** (optional) — name or identifier.
   - On confirm, sends `confirmReplaceAll: true` alongside the payload to `POST /admin/config/apply`.

   Before applying, a snapshot of the current DB state is saved automatically.

### Import JSON format

The file must be a valid JSON object matching the export format:

```json
{
  "exportedAt": "2026-03-16T14:30:00.000Z",
  "rules": [ ...AdminRuleItem[] ],
  "params": [ ...AdminParamsItem[] ]
}
```

`params` can be omitted if only rules should be replaced.

---

## Snapshots system

Every destructive config change automatically creates a snapshot of the **previous state** before applying:

- **Grabar** → snapshot tagged with the user-provided `comment` and `createdBy`
- **Restore** → automatic snapshot tagged `"Auto: antes de restaurar snapshot #N (…)"`

### `dbo.cfg_config_snapshot` table

| Column | Type | Description |
|--------|------|-------------|
| `snapshot_id` | INT IDENTITY PK | Auto-incremented ID |
| `snapshot_name` | NVARCHAR(200) | Auto-generated name (`"Grabacion YYYY-MM-DD HH:mm"`) |
| `comment` | NVARCHAR(1000) | User-provided motivo or auto-generated description |
| `created_by` | NVARCHAR(100) | Optional user identifier |
| `created_at` | DATETIME2(0) | Timestamp of snapshot creation |
| `rules_json` | NVARCHAR(MAX) | JSON array of all rules at snapshot time |
| `params_json` | NVARCHAR(MAX) | JSON array of all params at snapshot time |

Apply the schema with `sql/snapshots.sql`.

### Snapshots page (`/snapshots`)

- Search by date range (`dateFrom`, `dateTo`), free text (name, user, comment), and `entorno` (POC / WF)
- Results table: ID · Date/time · Name · User · Comment · Restore button (folder-open icon)
- Restore opens a confirmation dialog; on confirm, the snapshot's rules and params replace the current DB config

#### WF snapshot → POC restore

When restoring a WF snapshot to POC, the dialog requires an extra **Fecha destino POC** field (`pocFechaDesde`, `YYYY-MM-DD`):

1. If a `cfg_offer_dates` period with `valid_from = pocFechaDesde` already exists, it is used as-is.
2. If not, a new period is created automatically. Any currently-open period starting before `pocFechaDesde` is closed (`valid_to = pocFechaDesde - 1 day`), and the new period's `valid_to` is set to the day before the next existing period.
3. Offer codes are resolved via `cfg_offer_ruleset.oferta_id` FK — not from the WF text code — so POC and WF codes can differ.
4. Params from multiple WF vigencia periods are deduplicated by key (last-wins) before insertion.

---

## Config loading strategy

`config_service.js` calls SQL Server stored procedure `dbo.cfg_get_offers_and_params_json_cached` (primary — a fingerprint/TTL cache wrapper around `dbo.cfg_get_offers_and_params_json`, deployed via `rule_set/sql/sp_cached_wrapper.sql`; see `docs/adr/0001-cache-fingerprint-poc-stored-procedure.md` for the design). If that SP is missing, it falls back to `dbo.cfg_get_rules_json`. Configure the SQL connection via `api/.env` (see `.env.example`).

---

## Offer codes in `rules.json`

- `OFERTA_RESTRICTIVA` (`offer_rank: 100`) — stricter limits, requires first home, lower LTV/income thresholds.
- `OFERTA_PERMISIVA` (`offer_rank: 10`) — looser limits, LTV range `(0.80, 0.95]`, no first-home requirement.

The winner is selected as the eligible offer with the **highest `offer_rank`**.

---

## SQL schema overview

| Table | Purpose |
|-------|---------|
| `dbo.cfg_offer_ruleset` | Offer definitions (code, rank, enabled) |
| `dbo.cfg_offer_rule` | Individual rules (priority, enabled, valid dates) |
| `dbo.cfg_offer_rule_condition` | Rule conditions (field, operator, values) |
| `dbo.cfg_offer_rule_condition_value` | IN/NOT_IN value lists for conditions |
| `dbo.cfg_offer_rule_action` | Rule actions (SET/ADD/APPEND/SET_DICTAMEN) |
| `dbo.cfg_offer_param` | Global parameters per offerCode (offer-scoped, no stage, soft-delete) |
| `dbo.cfg_config_snapshot` | Config snapshots for audit and rollback |
| `dbo.cfg_user` | Authentication users — email, bcrypt password hash, role, enabled flag. Apply `sql/users.sql`. |

> **WF date type**: `dbo.cfg_get_workflow_snapshot_json` uses `DATE` parameters (not `DATETIME`) and matches via `CAST(VIGENCIA_DESDE_DT AS DATE)`. `admin_workflow_service.js` likewise passes `sql.Date` — never `sql.DateTime` — for all WF vigencia inputs. This avoids false mismatches caused by time components in `DATETIME` columns.

---

## Autenticación y JWT

### Mecanismo

| Aspecto | Decisión |
|---------|----------|
| Hashing | `bcryptjs` (default import CJS), coste 10 |
| Tokens | `jsonwebtoken` HS256, access-token only (sin refresh) |
| Expiración | `JWT_EXPIRES_IN` (default `8h`); comprobación server-side, no en cliente |
| Almacenamiento (frontend) | `localStorage` bajo la clave `auth_token` |

### Variables de entorno (`api/.env`)

| Variable | Requerida | Default | Notas |
|----------|-----------|---------|-------|
| `JWT_SECRET` | **Sí** | — | **Fail-fast**: la API se niega a arrancar si no está definida (`assertAuthConfig()` en `server.js`). |
| `JWT_EXPIRES_IN` | No | `8h` | Cualquier valor válido para `jsonwebtoken` (`"1h"`, `"24h"`, etc.). |

### Gotcha — import CJS bajo `type:module`

`jsonwebtoken` y `bcryptjs` distribuyen CommonJS. Con el proyecto en `"type": "module"` **los imports con nombre no resuelven**:

```js
// INCORRECTO — sign/verify son undefined bajo ESM interop
import { sign, verify } from "jsonwebtoken";

// CORRECTO — siempre default import
import jwt from "jsonwebtoken";  // jwt.sign(...), jwt.verify(...)
import bcrypt from "bcryptjs";   // bcrypt.hash(...), bcrypt.compare(...)
```

Mismo patrón ya demostrado por `mssql` (`import sql from "mssql"` en `sql_client.js`).

### `dbo.cfg_user` — columnas

| Columna | Tipo | Notas |
|---------|------|-------|
| `user_id` | INT IDENTITY PK | |
| `email` | NVARCHAR(200) NOT NULL | UNIQUE constraint `UQ_cfg_user_email` |
| `password_hash` | NVARCHAR(300) NOT NULL | Hash bcrypt (`$2a$10$…`, ~60 chars) |
| `role` | NVARCHAR(50) DEFAULT `'admin'` | Almacenado en el JWT; validado contra `ALLOWED_ROLES` (RBAC, ver abajo) por `requireRole` en `/api/admin/*` (`/api/workflow/*` NO lleva este gate) |
| `enabled` | BIT DEFAULT `1` | Usuario deshabilitado → login rechazado con 401 genérico |
| `created_at` | DATETIME2(0) DEFAULT SYSDATETIME() | |

#### Catálogo de roles (`ALLOWED_ROLES`)

`api/utils/rule_catalogs.js` define `ALLOWED_ROLES = new Set(["admin", "viewer"])` (+ `normalizeRole(v)`), consumido por el middleware `requireRole(...roles)` (`api/middleware/require_role.js`) montado únicamente sobre `/api/admin/*`. `admin` tiene acceso completo; `viewer` está autenticado (JWT válido) pero recibe `403` en rutas admin — no queda desautenticado (sin logout/redirect en el frontend). `/api/workflow/*` no lleva este gate — se comporta como `/api/simulate/*` (cualquier rol autenticado); ver la nota en `api/routes/index.js` y § Middleware RBAC arriba.

### Alta del primer usuario

```bash
# Desde rule_set/
node scripts/seed_user.mjs --email admin@example.com --password 's3cret' [--role admin]

# Alta de un usuario viewer (solo lectura, sin acceso a /admin; /workflow sigue accesible, no lleva gate de rol):
node scripts/seed_user.mjs --email viewer@example.com --password 's3cret' --role viewer

# Si --password se omite, el script pide la contraseña de forma interactiva (readline, sin enmascarar).
# Para CI/no-interactivo, usar la variable de entorno SEED_PASSWORD.
# --force actualiza el hash si el email ya existe.
```

### ⚠️ Orden de despliegue obligatorio

**Riesgo de lockout**: si el middleware JWT está activo antes de que exista un usuario en la BD,
el sistema queda bloqueado (no hay forma de obtener un token).

| Paso | Acción |
|------|--------|
| 1 | Ejecutar `sql/users.sql` contra la BD destino (crea `dbo.cfg_user`). |
| 2 | Ejecutar `node scripts/seed_user.mjs` para insertar el primer usuario. |
| 3 | Definir `JWT_SECRET` en `api/.env`. |
| 4 | Arrancar la API (que tiene `authMiddleware` montado). Si se arranca antes de los pasos 1–3, `assertAuthConfig()` falla en el paso 3 o el sistema queda sin usuarios en el 1–2. |

---

## Angular navigation

| Route | Component | Guard | Description |
|-------|-----------|-------|-------------|
| `/login` | LoginPageComponent | — | Formulario de login (ruta pública) |
| `/offer-dates` | OfferDatesPageComponent | `authGuard` | cfg_offer_dates CRUD + active period selector (home) |
| `/configurador` | ConfiguratorPageComponent | `authGuard` | Offer/Rule/Param CRUD + export/import/apply |
| `/configuracion` | ConfigPageComponent | `authGuard` | Read-only config view (load from DB) |
| `/snapshots` | SnapshotsPageComponent | `authGuard` | Snapshot browser + restore |
| `/simulador-init` | InitSimulatorPageComponent | `authGuard` | INIT-stage simulation form |
| `/simulador-pre` | PreSimulatorPageComponent | `authGuard` | PRE-stage simulation form |
| `/simulador-final` | FinalSimulatorPageComponent | `authGuard` | FINAL-stage simulation form |

Las 8 rutas protegidas llevan `canActivate: [authGuard]`. Las entradas de redirección (`''`, `'**'`) no llevan guard propio — redirigen a una ruta protegida que lo aplica.

**Piezas de autenticación frontend** (`web/src/app/`):

| Fichero | Rol |
|---------|-----|
| `services/auth.service.ts` | Token en `localStorage`, señal `isAuthenticated`, métodos `login/logout/getToken`. |
| `interceptors/auth.interceptor.ts` | Interceptor funcional (`HttpInterceptorFn`): adjunta `Authorization: Bearer <token>` a todas las peticiones salvo `POST /api/auth/login`. En 401 llama a `logout()` y redirige a `/login`. |
| `guards/auth.guard.ts` | `CanActivateFn` funcional: devuelve `true` si autenticado, `UrlTree` a `/login` si no (con `returnUrl` en query params). |
| `pages/login-page.component.*` | Formulario reactivo, muestra "Credenciales inválidas." en 401, spinner mientras pide, redirige al `returnUrl` o a `/` en éxito. |

## Offers management (configurator)

The configurator includes an **Offers** panel (`panel-offers`) at the top of the page for managing `cfg_offer_ruleset` entries:

- Table shows all offers with code, name, rank, oferta_id, enabled status, and action buttons.
- **Create** — opens inline form to add a new offer.
- **Edit** — opens inline form pre-filled with the selected offer's data.
- **Enable/Disable** — toggle button (no confirmation required).
- **Delete** — opens confirmation dialog; blocked with error if the offer has associated rules.

`offerCode` fields in rules and params forms are `<select>` dropdowns populated dynamically from the offers list, replacing the previous free-text inputs.
