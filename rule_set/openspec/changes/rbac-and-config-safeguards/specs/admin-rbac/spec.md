# Delta — admin-rbac

> Cambio: `rbac-and-config-safeguards`
> Dominio: autorización por rol sobre `/api/admin/*` (middleware + frontend)
> Tipo: MODIFIED (acceso actual solo exige token válido) + ADDED (`requireRole`, catálogo de roles, UI)
>
> **Amendment (2026-07-13)**: `/api/workflow/*` quedó fuera de alcance de este change — ver
> `proposal.md § Amendment (2026-07-13)`. `/api/workflow/*` se comporta como `/api/simulate/*`
> (autenticado, cualquier rol), NO como una ruta administrativa.

---

## MODIFIED Requirements

### Requirement: Acceso a rutas administrativas

El sistema MUST exigir `req.user.role === "admin"` para cualquier ruta bajo `/api/admin/*`,
además del token válido que ya exige `authMiddleware`.
(Previously: cualquier usuario con un token JWT válido, sin importar su `role`, podía invocar
cualquier ruta de `admin_routes.js`.)

Las rutas públicas (`GET /api/health`, `POST /api/auth/login`), `/api/simulate/*`,
`/api/workflow/*` y `GET /api/config` MUST NOT requerir rol `admin` — siguen exigiendo únicamente
lo que ya exigían (token válido o acceso público, sin cambios). `/api/workflow/*` está
explícitamente fuera de alcance de este change: solo expone una consulta de elegibilidad en tiempo
real (`POST /workflow/condiciones-hipotecas`), funcionalmente un par de `/api/simulate/*`, no una
acción de administración. Las acciones reales de publicación a WF ya viven bajo
`/api/admin/workflow/*` y ya están cubiertas por el gate `/admin`.

#### Scenario: Usuario admin accede con normalidad

- GIVEN un usuario autenticado con `role = "admin"`
- WHEN invoca cualquier ruta bajo `/api/admin/*`
- THEN la petición procede al controlador correspondiente sin error de autorización

#### Scenario: Usuario viewer recibe 403 en ruta admin

- GIVEN un usuario autenticado con `role = "viewer"` (token válido)
- WHEN invoca `POST /api/admin/config/apply` (o cualquier otra ruta bajo `/api/admin/*`)
- THEN la respuesta es `403`
- AND el cuerpo incluye un mensaje en español indicando falta de permisos de administrador
- AND la operación NO se ejecuta (no hay efectos en BD)

#### Scenario: Usuario viewer NO recibe 403 en ruta de workflow (fuera de alcance)

- GIVEN un usuario autenticado con `role = "viewer"` (token válido)
- WHEN invoca `POST /api/workflow/condiciones-hipotecas`
- THEN la respuesta NO es `403` por motivo de rol (se comporta como `/api/simulate/*`)

#### Scenario: Sin token sigue siendo 401, no 403

- GIVEN una petición sin cabecera `Authorization` o con un token inválido/expirado
- WHEN se invoca cualquier ruta bajo `/api/admin/*`
- THEN la respuesta es `401` (comportamiento inalterado de `authMiddleware`)
- AND `requireRole` NUNCA se ejecuta sin que `req.user` exista primero

#### Scenario: Rutas no administrativas no exigen rol

- GIVEN un usuario autenticado con `role = "viewer"`
- WHEN invoca `GET /api/config`, `POST /api/simulate/init`, `POST /api/simulate/pre`,
  `POST /api/simulate/final` o `POST /api/workflow/condiciones-hipotecas`
- THEN la respuesta NO es `403` por motivo de rol

---

## ADDED Requirements

### Requirement: Middleware factory `requireRole`

El sistema MUST proveer un middleware factory `requireRole(...roles)` que, dado un `req.user` ya
adjuntado por `authMiddleware`:
- MUST devolver `403` si `req.user.role` no está en la lista de roles permitidos.
- MUST NOT modificar el comportamiento del caso `req.user` ausente (delega el 401 a `authMiddleware`,
  que se ejecuta antes en la cadena).
- MUST montarse una única vez por superficie (`router.use("/admin", requireRole("admin"), adminRoutes)`),
  no por controlador individual. `/api/workflow/*` NO lleva este gate (fuera de alcance, ver
  Amendment arriba).

#### Scenario: Rol permitido en lista de varios roles

- GIVEN `requireRole("admin", "viewer")` está montado en una ruta
- AND un usuario autenticado con `role = "viewer"` la invoca
- THEN la petición procede (viewer está en la lista permitida para esa ruta)

#### Scenario: Rol no reconocido en el catálogo

- GIVEN un usuario autenticado cuyo `role` no pertenece a `ALLOWED_ROLES`
- WHEN invoca una ruta protegida por `requireRole("admin")`
- THEN la respuesta es `403` (tratado igual que cualquier rol insuficiente, no como error 5xx)

#### Scenario: Argumento de rol inválido falla rápido en tiempo de construcción

> Añadido durante la revisión de código de PR1 (2026-07-13) — hallazgo: filtrar en silencio un rol
> no reconocido pasado a `requireRole(...)` podía producir, ante un typo futuro en un call site,
> un middleware con el allow-set vacío que devolvería 403 a TODAS las peticiones para siempre, sin
> ninguna señal en el arranque.

- GIVEN una llamada `requireRole(...roles)` donde al menos un `role` no pertenece a `ALLOWED_ROLES`
- WHEN se invoca `requireRole(...)` (tiempo de construcción del middleware, no de petición HTTP)
- THEN se lanza un `Error` de forma síncrona, nombrando el/los rol(es) no reconocido(s)
- AND el middleware NUNCA llega a construirse ni a montarse

---

### Requirement: Catálogo de roles permitidos

El sistema MUST definir `ALLOWED_ROLES = ["admin", "viewer"]` en un catálogo centralizado
(`api/utils/rule_catalogs.js` o fichero análogo), documentado en `CLAUDE.md` junto con el
procedimiento para sembrar un usuario `viewer` vía `scripts/seed_user.mjs --role viewer`.

#### Scenario: Catálogo referenciado por el seed de usuarios

- GIVEN el catálogo `ALLOWED_ROLES` contiene `"admin"` y `"viewer"`
- WHEN se ejecuta `node scripts/seed_user.mjs --role viewer`
- THEN el usuario se crea con `role = "viewer"` sin error de validación

---

### Requirement: Interceptor Angular distingue 403 de 401

El interceptor Angular (`auth.interceptor.ts`) MUST tratar una respuesta `403` de forma distinta a
una `401`: en `403` MUST mostrar un aviso de "sin permisos suficientes" y MUST NOT invocar
`logout()` ni redirigir a `/login`. El comportamiento existente ante `401` (logout + redirect) no
cambia.

#### Scenario: 403 no desloguea al usuario

- GIVEN un usuario autenticado con sesión válida (`viewer`)
- WHEN una petición HTTP recibe `403`
- THEN el interceptor NO llama a `auth.logout()`
- AND el interceptor NO navega a `/login`
- AND el usuario ve un aviso de permisos insuficientes

#### Scenario: 401 conserva el comportamiento de logout

- GIVEN cualquier petición HTTP
- WHEN la respuesta es `401`
- THEN el interceptor llama a `auth.logout()` y navega a `/login` (sin cambios respecto al
  comportamiento previo)

---

### Requirement: Navegación admin oculta para `viewer` (defensa en UI)

El frontend SHOULD ocultar las entradas de navegación hacia páginas exclusivamente
administrativas (configurador, snapshots, fechas de oferta) cuando el `role` decodificado del
usuario autenticado es `viewer`. Esta es una defensa de experiencia de usuario, NOT a security
boundary — el gate real es el backend (`requireRole`).

#### Scenario: Viewer no ve enlaces de administración

- GIVEN un usuario autenticado con `role = "viewer"`
- WHEN se renderiza la navegación principal
- THEN los enlaces a `/configurador`, `/snapshots` y `/offer-dates` NOT aparecen en el menú

#### Scenario: Admin ve la navegación completa

- GIVEN un usuario autenticado con `role = "admin"`
- WHEN se renderiza la navegación principal
- THEN todos los enlaces (incluidos los administrativos) aparecen sin cambios
