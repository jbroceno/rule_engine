# Informe de auditoría OWASP Top 10 (2021) — Rule Engine

**Fecha**: 2026-07-10
**Alcance**: `rule_set/` completo — API Express (`api/`), frontend Angular (`web/`), esquema y stored procedures SQL Server (`sql/`), despliegue Docker (`docker-compose.yml`, `nginx*.conf`).
**Método**: revisión estática de código (sin explotación real), 5 auditorías paralelas de solo lectura cubriendo las 10 categorías OWASP Top 10 2021. No se aplicó ningún cambio durante la auditoría.

Este informe es la fuente de verdad para los cambios que se aborden vía SDD. Cada hallazgo tiene un identificador estable (`OWASP-NN`) para referenciarlo desde `openspec`/engram al planificar los cambios.

## Índice de severidad

| ID | Categoría | Severidad | Estado |
|----|-----------|-----------|--------|
| OWASP-01 | A01 Broken Access Control | Critical | Abierto |
| OWASP-02 | A04 Insecure Design | Critical | Abierto |
| OWASP-03 | A02 Cryptographic Failures (SQL sin cifrar) | Alto → **Aceptado (excepción)** | Excepcionado — ver [ADR 0001](../adr/0001-excepcion-cifrado-sql-poc-tfm.md) |
| OWASP-04 | A02 Cryptographic Failures (JWT_SECRET débil) | Alto | Abierto |
| OWASP-05 | A05 Security Misconfiguration (sin cabeceras HTTP) | Alto | Abierto |
| OWASP-06 | A07 Authentication Failures (sin rate limiting) | Alto | Abierto |
| OWASP-07 | A07 Authentication Failures (logout no revoca token) | Alto | Abierto |
| OWASP-08 | A09 Logging Failures (`createdBy` falsificable) | Alto | Abierto |
| OWASP-09 | A08 Software/Data Integrity (import sin whitelist) | Alto | Abierto |
| OWASP-10 | A08 Software/Data Integrity (snapshots sin checksum) | Alto | Abierto |
| OWASP-11 | A09 Logging Failures (sin logging de seguridad) | Alto | Abierto |
| OWASP-12 | A02 Cryptographic Failures (bcrypt cost=10) | Medio | Abierto |
| OWASP-13 | A05 Security Misconfiguration (TLS ciphers nginx) | Bajo | Abierto |
| OWASP-14 | A04 Insecure Design (validación de rangos en simulación) | Medio | Abierto |
| OWASP-15 | A03 Injection (STRING_SPLIT interpolado) | Bajo | Abierto |
| OWASP-16 | Info disclosure (token WF en mensaje de error) | Medio | Abierto |

---

## Hallazgos críticos

### OWASP-01 — A01: Broken Access Control — sin RBAC real

`auth_middleware.js` decodifica el JWT y adjunta `req.user = { userId, email, role }`, pero **ningún controlador lee `req.user.role`** (0 coincidencias en `api/controllers/*.js`). Todas las rutas de `api/routes/admin_routes.js` (ofertas, reglas, params, snapshots, apply, export, reset-seed) solo exigen "token válido".

- **Evidencia**: `api/middleware/auth_middleware.js:69-73`, `api/routes/admin_routes.js:22-61`.
- **Escenario**: un usuario con `role` no-admin en `dbo.cfg_user` que obtenga login válido puede crear/editar/borrar reglas, ofertas, parámetros, restaurar/eliminar snapshots y aplicar configuración — acciones que deberían requerir rol admin.
- **Severidad**: Critical.

### OWASP-02 — A04: Insecure Design — reemplazo total de configuración sin salvaguardas

`POST /admin/config/apply` con `deleteAllPeriods: true` borra reglas/params de **todos** los periodos antes de insertar la nueva configuración. Única protección: un campo de texto libre "motivo" + snapshot automático previo (mitiga pero no impide).

- **Evidencia**: `api/controllers/admin_apply_controller.js:34-56`.
- **Escenario**: cualquier usuario autenticado (agravado por OWASP-01) puede sustituir toda la configuración de producción sin doble confirmación, aprobación de segundo usuario ni dry-run.
- **Severidad**: Critical.

---

## Hallazgos altos

### OWASP-03 — A02: Cryptographic Failures — SQL sin cifrar — **EXCEPCIONADO**

`env.js:32-33` fija `encrypt: false` y `trustServerCertificate: true` por defecto; `docker-compose.yml:83-84,117-118` los fuerza explícitamente. El tráfico API↔SQL Server viaja sin cifrar y sin validación de certificado.

- **Evidencia**: `api/config/env.js:32-33`, `docker-compose.yml:83-84,117-118`.
- **Escenario**: un atacante con acceso a la red interna de Docker (contenedor comprometido, sidecar malicioso) podría interceptar el tráfico SQL en texto plano. SQL Server solo publica en `127.0.0.1` (no accesible desde Internet), por lo que el riesgo real queda acotado al propio host Docker.
- **Decisión**: **aceptado como excepción documentada** para el alcance de este TFM. Ver [ADR 0001 — Excepción de cifrado SQL para el entorno POC del TFM](../adr/0001-excepcion-cifrado-sql-poc-tfm.md).
- **Severidad original**: Alto. **Estado**: Excepcionado, no se abordará en los cambios SDD derivados de este informe.

### OWASP-04 — A02: Cryptographic Failures — `JWT_SECRET` sin validación de fuerza

`assertAuthConfig()` (`api/config/env.js:76-82`) solo comprueba que `JWT_SECRET` no esté vacío; no valida longitud/entropía mínima.

- **Evidencia**: `api/config/env.js:76-82`.
- **Escenario**: un despliegue con `JWT_SECRET=1` arrancaría sin error y sería trivialmente fuerza-bruteable para forjar tokens JWT con rol `admin`.
- **Severidad**: Alto.

### OWASP-05 — A05: Security Misconfiguration — sin cabeceras de seguridad HTTP

No hay `helmet` ni cabeceras manuales en `api/app.js`; `web/nginx.conf` y `web/nginx-ssl.conf` no añaden `X-Frame-Options`, `X-Content-Type-Options`, `Content-Security-Policy` ni `Strict-Transport-Security`.

- **Evidencia**: `api/app.js:1-26`, `web/nginx.conf:1-22`, `web/nginx-ssl.conf:7-37`.
- **Escenario**: con TLS activo, la ausencia de HSTS permite downgrade a HTTP en el primer request (SSL-stripping); la ausencia de X-Frame-Options/CSP facilita clickjacking sobre el panel de administración Angular.
- **Severidad**: Alto.

### OWASP-06 — A07: Authentication Failures — sin rate limiting

No hay `express-rate-limit` ni middleware de throttling en ningún endpoint, incluyendo `/api/auth/login` y `/api/admin/export`.

- **Evidencia**: ausencia confirmada en `package.json` y `api/app.js`/`api/routes/auth_routes.js`.
- **Escenario**: expuesto a fuerza bruta/credential stuffing sobre login, y a scraping masivo de la configuración de reglas vía `/admin/export`.
- **Severidad**: Alto.

### OWASP-07 — A07: Authentication Failures — logout no revoca el token en servidor

`web/src/app/services/auth.service.ts:35-37` — `logout()` solo hace `localStorage.removeItem`. No existe endpoint `/api/auth/logout` ni blacklist/revocación en el backend.

- **Evidencia**: `web/src/app/services/auth.service.ts:35-37`.
- **Escenario**: un token robado (XSS, log, proxy) sigue siendo válido hasta su expiración natural (`JWT_EXPIRES_IN` default 8h) aunque el usuario cierre sesión o cambie su contraseña.
- **Severidad**: Alto.

### OWASP-08 — A09: Security Logging Failures — `createdBy` falsificable

El campo de auditoría `createdBy` se toma literalmente del body del cliente (`admin_apply_controller.js:46`, `admin_snapshots_controller.js:66,80,100,149`, `admin_reset_controller.js:49-57`) en vez de derivarse del JWT verificado.

- **Evidencia**: archivos y líneas citados arriba.
- **Escenario**: cualquier usuario puede atribuir sus cambios a otro nombre de usuario — rompe la trazabilidad real de auditoría.
- **Severidad**: Alto.

### OWASP-09 — A08: Software/Data Integrity Failures — import masivo sin validación de catálogos

`admin_apply_controller.js` (import/aplicación masiva) no valida `operator`/`action_type`/`value_type`/`stage` contra los catálogos whitelisted que sí aplica `admin_validator.js` para el alta individual de reglas.

- **Evidencia**: `api/controllers/admin_apply_controller.js` vs. `api/validators/admin_validator.js`.
- **Escenario**: permite persistir reglas con campos arbitrarios vía import masivo, rompiendo la integridad del motor de reglas aguas abajo.
- **Severidad**: Alto.

### OWASP-10 — A08: Software/Data Integrity Failures — snapshots sin checksum/firma

La restauración de snapshots no verifica firma ni checksum del contenido antes de aplicarlo.

- **Evidencia**: `api/controllers/admin_snapshots_controller.js`, `api/services/admin_service.js` (flujo de restore).
- **Escenario**: combinado con OWASP-01 (sin RBAC), cualquier usuario autenticado puede restaurar cualquier configuración histórica sin garantía de que no ha sido alterada.
- **Severidad**: Alto.

### OWASP-11 — A09: Security Logging Failures — sin logging de eventos de seguridad

No existe logging estructurado (sin winston/pino/morgan) ni registro de logins fallidos, 401/403, cambios de configuración, o IPs de origen.

- **Evidencia**: ausencia confirmada de librerías de logging en `package.json`; únicos `console.log/error` son operativos (`server.js:29,38`, `config_service.js:138`), no de seguridad.
- **Escenario**: imposible auditar a posteriori intentos de acceso no autorizados o abuso del sistema.
- **Severidad**: Alto.

---

## Hallazgos medios

### OWASP-12 — A02: bcrypt cost factor = 10

`scripts/seed_user.mjs:95` fija `BCRYPT_COST = 10`. Aceptable pero OWASP recomienda ≥12 para hardware actual.

- **Severidad**: Medio.

### OWASP-14 — A04: validación de rangos en inputs de simulación

`api/validators/simulate_validator.js:13-39` solo valida que los inputs sean objetos, sin rangos/tipos internos de los campos financieros (LTV, edades, importes). `express.json({limit:"1mb"})` acota el tamaño total pero no valida semántica.

- **Severidad**: Medio.

### OWASP-16 — Info disclosure — token WF en mensaje de error

`api/services/wf_compare_service.js:103,108` incluye el `wfBody` completo (con el token de sesión WF del usuario) en el mensaje de error devuelto al cliente cuando falla la llamada externa.

- **Severidad**: Medio.

---

## Hallazgos bajos

### OWASP-13 — A05: TLS ciphers no fijados en nginx

`web/nginx-ssl.conf:7-12` no fija `ssl_protocols`/`ssl_ciphers` explícitos, depende de los defaults de la imagen base nginx.

- **Severidad**: Bajo.

### OWASP-15 — A03: `STRING_SPLIT` interpolado en `admin_workflow_service.js`

`admin_workflow_service.js:327,340,354` interpola `STRING_SPLIT('${ruleIdsCsv}', ',')` directamente en el texto SQL en vez de parametrizar, a diferencia del patrón correcto en `admin_service.js:256`. Los valores actuales son IDs internos de BD (no input directo de usuario), por lo que no es explotable en el flujo actual — es una regresión de defensa en profundidad frente al patrón ya establecido en el resto del código.

- **Severidad**: Bajo.

---

## Controles ya bien mitigados (no requieren cambio)

- Todas las queries de negocio parametrizadas correctamente (`request.input`), incluidos filtros dinámicos vía `STRING_SPLIT` + parámetro (salvo OWASP-15).
- Manejo de errores correcto: stack traces solo se exponen si `NODE_ENV !== production` (`api/middleware/error_handler.js:17-22`).
- SQL Server publicado solo en `127.0.0.1` (`docker-compose.yml:30`).
- TLS opt-in con fallback seguro a HTTP si el certificado es inválido (`server.js:17-32`); HTTP→HTTPS 301 cuando TLS está activo.
- `.env` real no trackeado en git ni en el historial; solo placeholders en `.env.example`.
- Sin secretos, tokens o passwords en `console.log`.
- Sin SSRF: la única llamada saliente (`wf_compare_service.js`) usa una URL fija de entorno, no derivada de input de usuario.
- Dependencias razonablemente actualizadas (`express` 4.22.1, `jsonwebtoken` 9.0.3, `bcryptjs` 3.0.3, `mssql`/`tedious` 18.x, `@angular/core` 20.3.17); lockfiles presentes y consistentes.
- Dependencias de desarrollo no llegan a las imágenes de producción (API ni Web).

---

## Siguientes pasos

Los hallazgos abiertos (todo excepto OWASP-03, ya excepcionado) se abordarán mediante el flujo SDD de este repositorio, agrupados por tema relacionado. Ver `openspec/changes/` (o engram, según el modo de artefactos elegido) para el seguimiento de cada change derivado de este informe.
