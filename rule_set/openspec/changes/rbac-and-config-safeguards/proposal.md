# Proposal — rbac-and-config-safeguards

> Endurece la superficie de administración frente a tres hallazgos de la auditoría OWASP
> (`docs/seguridad/informe-owasp-top10-2026-07-10.md`): **OWASP-01** (sin RBAC real),
> **OWASP-02** (reemplazo total de configuración sin salvaguarda real) y **OWASP-10**
> (restauración de snapshots sin verificación de integridad). Los otros hallazgos abiertos del
> informe son cambios SDD independientes y **no** entran aquí.

## Intent

Cerrar tres vectores de la auditoría que comparten un mismo eje —**quién puede tocar la
configuración y con qué garantías**— con soluciones proporcionadas al alcance de un TFM
(herramienta interna, un solo equipo, sin multi-tenancy):

1. **OWASP-01 (Critical, A01)** — Convertir el `role` que ya viaja en el JWT en una autorización
   **efectiva**: las rutas `/api/admin/*` deben exigir rol `admin`, no solo "token válido".
2. **OWASP-02 (Critical, A04)** — Añadir una salvaguarda **real** (no solo texto libre) al
   reemplazo total de configuración vía `POST /admin/config/apply` con `deleteAllPeriods: true`.
3. **OWASP-10 (High, A08)** — Verificar la **integridad** del contenido de un snapshot antes de
   restaurarlo, para que una restauración no aplique una configuración alterada o corrupta.

### Problema

**OWASP-01 — RBAC decorativo.** El middleware JWT decodifica y adjunta
`req.user = { userId, email, role }` (`api/middleware/auth_middleware.js:69-73`), y el login ya
firma el `role` en el token (`api/controllers/auth_controller.js:65`). Pero **ningún controlador ni
ruta lee `req.user.role`**: `api/routes/index.js:18` monta `router.use("/admin", adminRoutes)` sin
ningún guard de rol, así que las ~30 rutas de `admin_routes.js` (ofertas, reglas, params, snapshots,
apply, export, reset-seed, publish WF) solo exigen "token válido". Cualquier usuario habilitado en
`dbo.cfg_user`, sea cual sea su `role`, tiene CRUD administrativo completo. La señal de autorización
existe pero **no se aplica en ningún punto**.

**OWASP-02 — reemplazo total sin freno.** `POST /admin/config/apply`
(`api/controllers/admin_apply_controller.js:34-56`) llama a `applyConfig(..., { deleteAllPeriods: true })`,
que borra reglas y params de **todos** los períodos antes de insertar la nueva configuración. La
única protección de la acción más destructiva del sistema es un campo de texto libre `comment`
(validado solo como "no vacío", líneas 11-13) más un snapshot automático previo. El snapshot
**mitiga** (permite deshacer) pero **no impide** disparar el borrado por error: no hay confirmación
explícita ni previsualización de lo que se va a destruir.

**OWASP-10 — restauración sin verificación de integridad.** `createSnapshot`
(`api/services/admin_service.js:1112-1134`) guarda `rules_json`/`params_json` como texto plano en
`dbo.cfg_config_snapshot` (`sql/snapshots.sql`), **sin checksum ni firma**. `restoreSnapshot`
(`admin_service.js:1307`) lee ese JSON, solo comprueba que **parsee** (líneas 1324-1329) y lo
aplica. No hay ninguna garantía de que el contenido no haya sido alterado (por un cambio directo en
BD, una migración defectuosa o una restauración de backup parcial) entre la creación y la
restauración.

### Why now

- La auditoría OWASP es la fuente de verdad acordada para el trabajo de seguridad del repositorio
  (`informe-owasp-top10-2026-07-10.md`), y estos tres hallazgos son los **dos únicos Critical** más
  un High del mismo eje (A08 integridad). Abordarlos juntos es coherente: OWASP-02 y OWASP-10 son
  precisamente las acciones destructivas que OWASP-01 deja hoy abiertas a cualquier usuario
  autenticado — el propio informe señala esa combinación como agravante (líneas 47 y 116).
- La maquinaria a reutilizar **ya existe**: el patrón factory de middleware
  (`createAuthMiddleware`, `createLoginHandler`), el snapshot automático previo de `applyConfig`, y
  la columna `role` ya poblada en el JWT. El coste incremental es acotado.
- No hay ambigüedad de producto pendiente: el alcance TFM permite decidir salvaguardas
  proporcionadas sin esperar validación de negocio adicional.

### Success criteria

1. **RBAC efectivo.** Un usuario autenticado con `role` distinto de `admin` recibe **403** (no 401)
   en cualquier ruta mutadora bajo `/api/admin/*`; un usuario con `role = admin` opera con
   normalidad. Las rutas públicas (`GET /api/health`, `POST /api/auth/login`), la simulación
   (`/simulate/*`) y la vista de solo lectura (`GET /config`) siguen accesibles para cualquier
   usuario autenticado (o público donde ya lo eran).
2. **Modelo de roles documentado.** Existe un catálogo explícito de roles válidos (`admin`,
   `viewer`) y `dbo.cfg_user.role` se valida/documenta contra él. El script `seed_user.mjs` ya
   soporta `--role`; se documenta cómo crear un `viewer` para probar el 403.
3. **Salvaguarda de apply.** `POST /admin/config/apply` con reemplazo total **rechaza (400)** la
   petición si no incluye una confirmación explícita (flag booleano dedicado, p. ej.
   `confirmReplaceAll: true`), además del `comment`. La API expone una **previsualización de impacto**
   (dry-run) que devuelve, sin escribir nada, el resumen de lo que se va a borrar/insertar (ofertas
   afectadas, nº de reglas y params a eliminar y a insertar), y el frontend la muestra antes de
   permitir confirmar.
4. **Integridad de snapshots.** `createSnapshot` calcula y persiste un **HMAC-SHA256** sobre el
   contenido canónico (`rules_json` + `params_json`) usando un secreto de servidor. `restoreSnapshot`
   recalcula el HMAC sobre el contenido leído y **rechaza la restauración** (409/422) si no coincide.
   Los snapshots legados (sin checksum) se tratan como "no verificables" y se documenta el
   comportamiento (restauración permitida con aviso, no bloqueo retroactivo).
5. **Frontend coherente.** El interceptor Angular distingue **403** (sin permisos → aviso, no
   logout) de **401** (sesión inválida → logout + redirect), y el configurador muestra el diálogo de
   confirmación con la previsualización de impacto antes de grabar.
6. **Tests primero (Strict TDD).** El 403 por rol, el 400 sin confirmación, el contenido de la
   previsualización, y el rechazo de restauración por HMAC no coincidente están cubiertos por tests
   antes de implementar.

## Scope

### In scope

- **OWASP-01 — RBAC (backend)**
  - Nuevo middleware factory `requireRole(...roles)` (fichero nuevo `api/middleware/require_role.js`),
    consistente con el patrón `createAuthMiddleware`. Devuelve **403** (`AppError(..., 403)`) cuando
    `req.user` existe pero `req.user.role` no está en la lista permitida; asume que `authMiddleware`
    ya se ejecutó (si no hay `req.user`, 401).
  - Montar `requireRole("admin")` en el punto único de montaje del router admin
    (`api/routes/index.js:18` → `router.use("/admin", requireRole("admin"), adminRoutes)`), de modo
    que toda la superficie `/api/admin/*` queda protegida en un solo lugar.
  - `/api/workflow/*` (`workflow_routes.js`) **NO** lleva este gate — ver Amendment (2026-07-13) al
    final del documento; queda fuera de alcance de este change.
  - Catálogo de roles en `api/utils/rule_catalogs.js` (o fichero análogo): `ALLOWED_ROLES = ["admin", "viewer"]`.
- **OWASP-02 — salvaguarda de apply (backend)**
  - En `admin_apply_controller.js`: exigir `confirmReplaceAll === true` en el body cuando la
    operación reemplaza todo (400 si falta), **además** del `comment` ya requerido.
  - Endpoint dedicado de **previsualización (dry-run)**: `POST /admin/config/apply/preview` (ruta
    nueva en `admin_routes.js`, decisión confirmada frente al flag `dryRun`), que calcula y devuelve
    el resumen de impacto (offer codes afectados, `rulesToDelete`, `paramsToDelete`, `rulesToInsert`,
    `paramsToInsert`) **sin** escribir en BD ni crear snapshot.
  - Función de cálculo de impacto en `admin_service.js` (reutiliza el conteo por offer code que ya
    conoce `applyConfig`).
- **OWASP-10 — integridad de snapshots (backend + SQL)**
  - Migración SQL nueva (`sql/snapshots_checksum.sql`): `ALTER TABLE dbo.cfg_config_snapshot ADD checksum NVARCHAR(64) NULL`
    (HMAC-SHA256 en hex = 64 chars; NULL para filas legadas).
  - `createSnapshot` (`admin_service.js:1112`): calcular HMAC-SHA256 (módulo `node:crypto`, sin nueva
    dependencia) sobre la concatenación canónica de `rulesJson` + `paramsJson` y persistirlo en la
    nueva columna.
  - `restoreSnapshot` (`admin_service.js:1307`): recalcular el HMAC sobre el contenido leído y
    compararlo con el almacenado **antes** de transformar/aplicar; si no coincide → `AppError(..., 409)`.
    Si `checksum` es NULL (snapshot legado) → permitir con aviso registrado (no bloqueo retroactivo).
  - Secreto: `SNAPSHOT_HMAC_SECRET` en `api/config/env.js` con **fallback a `JWT_SECRET`** si no se
    define (evita una env obligatoria adicional en el TFM; se documenta el tradeoff).
- **Frontend (Angular)**
  - `interceptors/auth.interceptor.ts`: manejar **403** de forma distinta al 401 (mostrar aviso "sin
    permisos", **sin** logout ni redirect a login).
  - `services/admin-api.service.ts`: método de previsualización de apply; tipos de retorno de la
    respuesta de impacto.
  - `pages/configurator-page.component.*`: diálogo de "Grabar configuración" muestra la
    previsualización de impacto y requiere confirmación explícita antes de invocar apply.
  - `pages/snapshots-page.component.*` / `models/admin.models.ts`: propagar el estado de integridad
    (verificado / legado / fallo) del restore si la API lo devuelve.
  - `services/auth.service.ts`: exponer el `role` decodificado para ocultar navegación admin a
    `viewer` (decisión confirmada, dentro de alcance) — **defensa en UI, no de seguridad**.
- **SQL / operativa**
  - Documentar en `users.sql` / CLAUDE.md el catálogo de roles y cómo sembrar un `viewer`.
- **Tests (`test/`, runner `npm test` / node:test, desde `/rule_set/`)** — **primero**
  - `requireRole`: 403 con rol insuficiente, paso con `admin`, 401 sin `req.user`.
  - `admin_apply_controller`: 400 sin `confirmReplaceAll`; previsualización devuelve counts correctos
    y **no** escribe; apply con confirmación procede.
  - Integridad de snapshots: HMAC calculado al crear, restore rechazado (409) cuando el contenido
    almacenado se altera, restore permitido con aviso cuando `checksum` es NULL (legado).

### Out of scope

- **Resto de hallazgos OWASP** (04, 05, 06, 07, 08, 09, 11, 12, 13, 14, 15, 16): cambios SDD
  independientes ya planificados. En particular **OWASP-08** (`createdBy` falsificable) es tentador
  de arreglar aquí (derivar `createdBy` de `req.user`) pero es un hallazgo separado — **no** se aborda.
- **RBAC granular / permisos por recurso.** Solo dos roles (`admin` / `viewer`) y un único nivel de
  gate (`admin` para toda la superficie `/api/admin/*`). Sin matriz de permisos por endpoint.
- **Aprobación por segundo usuario ("cuatro ojos") para el apply.** Sobredimensionado para un TFM;
  la salvaguarda es confirmación explícita + previsualización, no un flujo multi-aprobador.
- **Firma criptográfica con gestión de claves (PKI, rotación, KMS).** La integridad se resuelve con
  HMAC-SHA256 y un secreto de servidor; no hay infraestructura de claves distribuidas.
- **Backfill del checksum en snapshots existentes.** No se recalcula retroactivamente (no probaría
  integridad de filas creadas antes del cambio); se tratan como "legados/no verificables".
- **Rate limiting, cabeceras HTTP, logging de seguridad** — otros hallazgos (OWASP-05/06/11).

## Approach

### High-level

1. **RBAC en un punto único.** `requireRole("admin")` se inserta como segundo middleware del montaje
   del router admin en `index.js`. `authMiddleware` (ya montado en `app.js:18`) garantiza `req.user`;
   `requireRole` solo comprueba `req.user.role`. Un solo punto de gate → imposible olvidar proteger
   una ruta admin nueva. Se devuelve **403** (autenticado pero sin permiso), semánticamente distinto
   del **401** del middleware de auth.
2. **Salvaguarda de apply en dos piezas.** (a) *Confirmación explícita*: el controlador exige
   `confirmReplaceAll === true` además del `comment`; sin él, 400 antes de tocar nada. (b)
   *Previsualización de impacto*: una rama dry-run calcula qué se borraría/insertaría (por offer code)
   y lo devuelve sin escribir. El frontend obliga a ver la previsualización antes de habilitar el
   botón de confirmación. El snapshot automático previo se conserva como red de seguridad adicional.
3. **Integridad por HMAC.** Al crear un snapshot se calcula `HMAC-SHA256(secret, canonical(rules)+canonical(params))`
   y se guarda en la nueva columna `checksum`. Al restaurar se recalcula sobre el contenido leído y
   se compara; discrepancia → 409 y no se aplica nada. Se elige HMAC (con secreto) en lugar de un
   checksum simple (SHA-256 pelado) porque un checksum sin clave solo detecta corrupción accidental,
   no manipulación deliberada (un atacante con escritura en BD recalcularía el hash). El HMAC da
   **evidencia de manipulación** proporcionada al modelo de amenaza del TFM, sin PKI.
4. **Frontend consistente.** El interceptor separa 403 de 401. El configurador integra la
   previsualización en el flujo "Importar → Grabar". Los snapshots muestran el veredicto de
   integridad al restaurar.

### Rationale

| Decisión | Por qué |
|---|---|
| **`requireRole()` factory, no chequeo por controlador** | Un único gate en el montaje del router (`index.js`) protege toda la superficie admin y las rutas futuras automáticamente; per-controlador es repetitivo y fácil de olvidar. Sigue el patrón factory ya establecido (`createAuthMiddleware`). |
| **403, no 401, para rol insuficiente** | El usuario **está** autenticado; el problema es autorización. Mezclarlo con 401 haría que el interceptor lo desloguee incorrectamente. Semántica HTTP correcta. |
| **Dos roles (`admin`/`viewer`), no matriz de permisos** | El sistema tiene un único perfil privilegiado real (el administrador de configuración) y, como mucho, un perfil de solo consulta (simulación + lectura). Más granularidad es sobreingeniería para el TFM. `dbo.cfg_user.role` ya existe y por defecto es `admin`, así que los usuarios actuales no se rompen. |
| **`confirmReplaceAll` explícito + previsualización, no aprobación de 2º usuario** | Convierte una acción destructiva en una decisión deliberada e informada (ve qué destruye y confirma) sin el peso operativo de un flujo multi-aprobador. Proporcionado a una herramienta interna. |
| **Dry-run reutiliza el conteo por offer code** | `applyConfig` ya sabe qué offer codes toca; exponer el resumen sin escribir es barato y da al usuario la información que el "motivo" de texto libre nunca daba. |
| **HMAC-SHA256, no checksum simple ni PKI** | HMAC con secreto detecta manipulación deliberada (no solo corrupción), que es lo que exige A08; PKI/firma con gestión de claves es innecesaria para un sistema mono-instancia de TFM. `node:crypto` → sin nueva dependencia. |
| **`SNAPSHOT_HMAC_SECRET` con fallback a `JWT_SECRET`** | Evita una env obligatoria más (riesgo de fail-fast en despliegue) manteniendo la opción de separar secretos. Tradeoff documentado: reutilizar `JWT_SECRET` acopla dos dominios de secreto. |
| **Snapshots legados = "no verificables", sin backfill** | Recalcular el HMAC sobre filas antiguas no probaría su integridad (podrían ya estar alteradas). Tratarlas como legado con aviso es honesto; bloquearlas rompería la restauración de historial válido. |
| **Tests primero (Strict TDD)** | Autorización, rechazo de apply y verificación de integridad son invariantes de seguridad: exactamente lo que debe fijarse con un test antes de tocar el código. |

### Affected files

| Fichero | Cambio |
|---|---|
| `rule_set/api/middleware/require_role.js` | **Nuevo.** Factory `requireRole(...roles)` → middleware que exige `req.user.role` en la lista; 403 si insuficiente, 401 si falta `req.user`. |
| `rule_set/api/routes/index.js` | `router.use("/admin", requireRole("admin"), adminRoutes)` (línea 18). `/workflow` NO cambia — ver Amendment (2026-07-13). |
| `rule_set/api/utils/rule_catalogs.js` | Añadir `ALLOWED_ROLES = ["admin", "viewer"]` + normalizador. |
| `rule_set/api/controllers/admin_apply_controller.js` | Exigir `confirmReplaceAll === true` (400 si falta); rama/endpoint de previsualización dry-run. |
| `rule_set/api/routes/admin_routes.js` | Ruta nueva de previsualización (`POST /config/apply/preview`) si se opta por endpoint separado. |
| `rule_set/api/services/admin_service.js` | `createSnapshot` (~1112): calcular+persistir HMAC. `restoreSnapshot` (~1307): verificar HMAC antes de aplicar. Función nueva de cálculo de impacto (dry-run) para apply. |
| `rule_set/api/config/env.js` | Añadir `SNAPSHOT_HMAC_SECRET` (fallback a `JWT_SECRET`). |
| `rule_set/sql/snapshots_checksum.sql` | **Nuevo.** `ALTER TABLE dbo.cfg_config_snapshot ADD checksum NVARCHAR(64) NULL`. |
| `rule_set/web/src/app/interceptors/auth.interceptor.ts` | Distinguir 403 (aviso, sin logout) de 401 (logout+redirect). |
| `rule_set/web/src/app/services/admin-api.service.ts` | Método de previsualización de apply; tipos de la respuesta de impacto. |
| `rule_set/web/src/app/pages/configurator-page.component.ts/.html` | Diálogo "Grabar": mostrar previsualización + confirmación explícita. |
| `rule_set/web/src/app/pages/snapshots-page.component.*` | Propagar veredicto de integridad del restore. |
| `rule_set/web/src/app/models/admin.models.ts` | Tipos: respuesta de previsualización, veredicto de integridad, `confirmReplaceAll`. |
| `rule_set/web/src/app/services/auth.service.ts` | (Opcional) exponer `role` para ocultar nav admin a `viewer`. |
| `rule_set/sql/users.sql` + `rule_set/CLAUDE.md` | Documentar catálogo de roles y siembra de `viewer`. |
| `rule_set/test/<nuevos>.test.js` | RBAC (403/401), salvaguarda de apply (400 / preview / confirm), integridad de snapshots (HMAC create/verify/legado). **Primero.** |

### No changes

- `rule_set/api/middleware/auth_middleware.js` — ya adjunta `req.user.role`; no cambia. `requireRole`
  se apoya en él.
- `rule_set/api/controllers/auth_controller.js` — ya firma `role` en el JWT; no cambia.
- Motor JS (`rule_engine.js`) y simuladores — ajenos a autorización, apply e integridad de snapshots.
- Semántica DNF / evaluación de reglas — sin cambios (skill `dnf-json-rules` no aplica a este cambio).

### Risks

- **Riesgo de lockout por rol.** Si todos los usuarios existentes tuvieran `role ≠ admin`, activar el
  gate los dejaría fuera del admin. **Mitigación:** `dbo.cfg_user.role` por defecto es `admin`
  (`users.sql:21`) y el seed crea admin por defecto; documentar verificación previa al despliegue de
  que exista al menos un `admin`.
- **403 tratado como 401 en el frontend.** Si el interceptor desloguea ante 403, un `viewer` quedaría
  en bucle de login. **Mitigación:** separar explícitamente 403 (aviso) de 401 (logout); test de
  interceptor.
- **Snapshots legados sin checksum.** Bloquear su restauración rompería el historial válido.
  **Mitigación:** NULL → "no verificable", restauración permitida con aviso; documentado.
- **Fallback de secreto HMAC.** Reutilizar `JWT_SECRET` acopla dominios; si se rota el JWT_SECRET,
  los HMAC previos dejan de validar. **Mitigación:** documentar; permitir `SNAPSHOT_HMAC_SECRET`
  dedicado; tratar fallo de verificación por rotación igual que legado si se decide (a fijar en
  diseño).
- **Tamaño del cambio.** Toca backend (3 áreas), SQL y varios componentes Angular; probablemente
  **>400 líneas**. La fase `tasks` deberá evaluar troceado en PRs encadenados (estrategia
  `ask-on-risk`). Se señala aquí para que no sorprenda en `tasks`.
- **Migración SQL sobre tabla en uso.** `ADD COLUMN ... NULL` es no disruptivo, pero debe aplicarse
  antes de desplegar el código que escribe/lee `checksum`. **Mitigación:** documentar orden de
  despliegue (SQL → API), como ya hace `users.sql`.

## Open questions

Resueltas con el usuario tras la propuesta inicial:

1. ~~¿Gate de rol también sobre `/api/workflow/*`?~~ **Resuelto inicialmente: sí** — **corregido
   después en la revisión de código de PR1, ver Amendment (2026-07-13) más abajo: NO**.
2. ~~¿Previsualización como endpoint separado o flag `dryRun`?~~ **Resuelto: endpoint separado**
   `POST /admin/config/apply/preview`.
3. ~~¿`SNAPSHOT_HMAC_SECRET` dedicado obligatorio o con fallback?~~ **Resuelto: fallback a
   `JWT_SECRET`** si no se define (tradeoff de acoplamiento documentado en Risks).
4. ~~¿Ocultar navegación admin a `viewer`?~~ **Resuelto: sí**, incluido en alcance.

Pendiente para spec/diseño:

5. **Códigos y textos exactos** del 403 ("No tienes permisos de administrador."), del 400 de apply
   ("Debes confirmar el reemplazo total.") y del 409 de integridad ("La integridad del snapshot no se
   pudo verificar."). Redacción final en español en spec/diseño.

## Amendment (2026-07-13) — corrección durante la revisión de código de PR1

Una revisión de código adversarial de PR1 (WU-1..WU-4, RBAC) sobre este branch detectó que el
gate `requireRole("admin")` se había montado también en `router.use("/workflow", requireRole("admin"),
workflowRoutes)`, replicando la decisión "resuelta" en Open questions #1 arriba. **Esa decisión era
incorrecta** y se revierte:

- `workflow_routes.js` solo expone `POST /workflow/condiciones-hipotecas`, una consulta de
  elegibilidad en tiempo real — funcionalmente un **par de `/api/simulate/*`** (que correctamente
  NO lleva gate de rol), **no** una acción de administración/publicación.
- Las acciones reales de publicación a WF (`postWorkflowSnapshot`, `postWorkflowPublicar`) **ya**
  viven bajo `/api/admin/workflow/*`, montadas dentro de `adminRoutes` y por tanto **ya protegidas**
  por el gate `/admin` existente — no requieren ningún cambio adicional.
- Gatear `/api/workflow/*` con `requireRole("admin")` habría roto a cualquier llamador externo
  (Workflow/BPM) que no porte un JWT con rol admin, sin beneficio de seguridad real (la superficie
  ya es de solo consulta y de igual privilegio que `/simulate/*`).

**Corrección aplicada**: `router.use("/workflow", requireRole("admin"), workflowRoutes)` vuelve a
`router.use("/workflow", workflowRoutes)` (sin gate de rol — igual que antes de este change;
`authMiddleware` en la raíz de la app sigue exigiendo un JWT válido de cualquier rol, sin cambios).
`router.use("/admin", requireRole("admin"), adminRoutes)` se mantiene exactamente igual — confirmado
correcto por la spec.

Este documento (Scope, Affected files, Open questions #1 arriba) se ha editado in-place para
reflejar la corrección; este apartado documenta el porqué del cambio para quien revise el historial.
