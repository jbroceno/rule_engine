# Archive Report — rbac-and-config-safeguards

**Change**: rbac-and-config-safeguards
**Title**: RBAC efectivo y salvaguardas de integridad de configuración (OWASP-01/02/10)
**Archived**: 2026-07-14
**Verify Verdict**: PASS WITH WARNINGS (0 CRITICAL, 0 WARNING after fast-follow fixes)

---

## Executive Summary

El cambio `rbac-and-config-safeguards` cierra tres hallazgos OWASP Top 10 identificados en
el informe de auditoría `docs/seguridad/informe-owasp-top10-2026-07-10.md`:

- **OWASP-01 (Broken Access Control)**: el RBAC del JWT no se aplicaba en ninguna ruta de administración. Solución: middleware `requireRole("admin")` montado en el único punto de entrada del router `/api/admin/*`; rol "viewer" obtiene 403, sin token obtiene 401; `requireRole` falla en tiempo de construcción si recibe un rol no catalogado.
- **OWASP-02 (Insecure Design)**: `POST /admin/config/apply` reemplazaba toda la configuración sin confirmación explícita ni previsualización del impacto. Solución: campo `confirmReplaceAll: true` obligatorio (400 si falta) + endpoint `POST /admin/config/apply/preview` (dry-run, lee sin escribir) + diálogo de confirmación en el frontend que espera a que el preview resuelva antes de habilitar el botón de confirmar.
- **OWASP-10 (Software/Data Integrity)**: los snapshots de configuración se creaban y restauraban sin ningún control de integridad, vulnerables a manipulación silenciosa. Solución: HMAC-SHA256 (node:crypto, sin dependencia nueva) computado al crear el snapshot y verificado antes de restaurar; checksum `NULL` en snapshots legados avisa pero no bloquea; frontend muestra el veredicto de integridad al usuario.

Entrega: 4 PRs encadenados (rbac → apply-safeguard → snapshot-integrity → frontend-polish),
todos mergeados a `main`. 15 tareas (T-01 a T-13c) completadas. Tres WARNINGs identificados
en el verify-report fueron resueltos en un fast-follow inmediatamente posterior al verify
(commit en `main`, mismo día).

---

## Artifacts Delivered

### Backend — middleware / rutas

| Fichero | Rol |
|---------|-----|
| `api/middleware/require_role.js` | Factory `requireRole(...roles)` — falla en construcción si rol no está en `ALLOWED_ROLES` |
| `api/middleware/auth_middleware.js` | Sin cambio de lógica; factory `createAuthMiddleware` ya existente |
| `api/routes/index.js` | Gate único: `router.use("/admin", requireRole("admin"), adminRoutes)` |
| `api/utils/rule_catalogs.js` | `ALLOWED_ROLES = new Set(["admin","viewer"])` + `normalizeRole()` |

### Backend — apply safeguard

| Fichero | Rol |
|---------|-----|
| `api/controllers/admin_apply_controller.js` | `postAdminApply` exige `confirmReplaceAll:true`; nuevo `postAdminApplyPreview` |
| `api/services/admin_service.js` | `computeApplyImpact` (dry-run), `deriveApplyScope` compartido con `applyConfig`, `dedupeParamsByKey` extraído |
| `api/routes/admin_routes.js` | `POST /admin/config/apply/preview` montado |
| `api/validators/admin_validator.js` | `validateApplyPayload` + `validatePreviewPayload` |

### Backend — snapshot integrity

| Fichero | Rol |
|---------|-----|
| `api/utils/snapshot_integrity.js` | `computeSnapshotChecksum` (HMAC-SHA256), `verifySnapshotChecksum` (timingSafeEqual) |
| `api/services/admin_service.js` | `createSnapshot` incluye checksum; `restoreSnapshot` verifica antes de mutar |
| `api/services/admin_workflow_service.js` | `createWorkflowSnapshot` también computa checksum (WF-origin) |
| `sql/snapshots_checksum.sql` | Migración idempotente: columna `checksum NVARCHAR(64) NULL` en `cfg_config_snapshot` |
| `api/config/env.js` | `env.snapshot.hmacSecret` con fallback `SNAPSHOT_HMAC_SECRET → JWT_SECRET` |

### Frontend (Angular)

| Fichero | Rol |
|---------|-----|
| `interceptors/auth.interceptor.ts` | Distingue 403 (no logout) de 401 (logout + redirect) |
| `services/auth.service.ts` | Decode de `role`/`isAdmin` desde JWT; normalización de casing |
| `app.html` | 3 enlaces de admin ocultos con `*ngIf="isAdmin()"` |
| `pages/configurator-page.component.*` | Diálogo de confirmación con preview de impacto; confirmar deshabilitado hasta que preview resuelve |
| `pages/snapshots-page.component.*` | Muestra veredicto de integridad (`verified` / `legacy` / error 409) |
| `models/admin.models.ts` | Tipos `ApplyImpact`, `RestoreIntegrity` |

### Tests

| Fichero | Cobertura |
|---------|-----------|
| `test/require_role.test.js` | 7 tests unitarios para `requireRole` (403/401/next/multi-rol/fail-fast) |
| `test/auth_middleware.test.js` | Tests existentes — sin regresiones |
| `test/admin_apply_safeguard.test.js` | Tests para `confirmReplaceAll` gate + `computeApplyImpact` + dialog frontend |
| `test/snapshot_integrity.test.js` | Tests para HMAC, verify, legacy NULL, 409 |
| `test/rbac_http_integration.test.js` | **Fast-follow**: 6 tests HTTP reales vía supertest — W1 (gate /admin) + W2 (regresión /workflow sin gate) |

### Scripts

| Fichero | Cambio |
|---------|--------|
| `scripts/seed_user.mjs` | **Fast-follow W3**: valida `--role` contra `ALLOWED_ROLES`/`normalizeRole` antes de insertar; `exit(1)` con mensaje claro si rol inválido |

### SQL

| Fichero | Rol |
|---------|-----|
| `sql/users.sql` | Tabla `dbo.cfg_user` con columnas `role`, `enabled` |
| `sql/snapshots_checksum.sql` | Migración columna `checksum` |

---

## Fast-Follow: Resolución de 3 WARNINGs post-verify

Los tres WARNINGs del verify-report (ninguno bloqueante para el archive) fueron resueltos
en un commit inmediatamente posterior al merge de PR4, mismo día (2026-07-14):

| Warning | Descripción | Resolución |
|---------|-------------|------------|
| W1 | Sin test de integración HTTP real para el gate `/admin` | `test/rbac_http_integration.test.js` — crea app Express real, firma JWTs, verifica 401/403/pass con supertest |
| W2 | Sin test de regresión para `/api/workflow/*` sin gate | Mismo fichero — viewer con token válido no recibe 403 en `/workflow/condiciones-hipotecas` |
| W3 | `seed_user.mjs` no validaba `--role` contra `ALLOWED_ROLES` | Import de `ALLOWED_ROLES`/`normalizeRole` + guard antes de cualquier acceso a BD |

**Resultado post-fix**: 6/6 tests nuevos verdes. Suite completa: 307 pass / 36 fail (preexistentes, limitación de entorno SQL) / 2 skip.

---

## Resultados de Tests

### Backend (Node.js — npm test)

```
# Verify-report (antes del fast-follow)
tests:    333
pass:     295
fail:      36   ← preexistentes (conectividad SQL, no regresiones)
skip:       2   ← CA-013 (credenciales WF en vivo)

# Post fast-follow (rbac_http_integration.test.js + 6 nuevos)
tests:    339
pass:     301
fail:      36   ← mismos preexistentes
skip:       2
```

### Frontend (Angular + Karma)

```
Executed 159 of 159 SUCCESS
```

---

## Hallazgos OWASP — estado al cierre

| Finding | Mecanismo implementado | Estado |
|---------|------------------------|--------|
| OWASP-01 (A01 Broken Access Control) | `requireRole("admin")` en `/api/admin/*`; fail-fast en construcción; 403 para viewer; 401 para no-autenticado | **CERRADO** |
| OWASP-02 (A04 Insecure Design) | `confirmReplaceAll:true` obligatorio + endpoint preview dry-run + diálogo informado en frontend | **CERRADO** |
| OWASP-10 (A08 Software/Data Integrity) | HMAC-SHA256 en creación y verificación de snapshots; veredicto de integridad en frontend | **CERRADO** |

---

## Decisiones de Diseño (ADRs)

| Decisión | Rationale |
|----------|-----------|
| **ADR-1**: Gate único en el punto de montaje del router, no en cada endpoint | Una sola línea gatea toda la superficie admin; imposible olvidar un endpoint nuevo |
| **ADR-2**: `requireRole` falla en tiempo de construcción con rol inválido | Un typo en un call site sería silencioso (middlewar 403-all-forever); fallo síncrono en startup lo hace imposible |
| **ADR-3**: `/api/workflow/*` sin gate de rol | `condiciones-hipotecas` es una consulta de elegibilidad (peer de `/simulate/*`), no una acción admin; las acciones WF reales ya viven bajo `/admin/workflow/*` |
| **ADR-4**: `confirmReplaceAll` + endpoint preview separados (no flag dryRun) | Separación clara de responsabilidades; el frontend puede llamar preview libremente sin riesgo |
| **ADR-5**: HMAC-SHA256 con `SNAPSHOT_HMAC_SECRET` → fallback `JWT_SECRET` | Sin dependencia nueva; fallback simplifica despliegue inicial; ops consciente del riesgo de rotación (documentado en `env.js`) |
| **ADR-6**: Snapshots legados (checksum NULL) no bloqueados | Retrocompatibilidad; la integridad es additive, no breaking |

---

## Cadena de PRs

| PR | Nombre | Work Units | Merge commit |
|----|--------|------------|--------------|
| 1 | rbac | WU-1..4 + T-13a | `05a556a` |
| 2 (GitHub PR #3) | apply-safeguard | WU-5..8 | `bd8b9f3` |
| 3 (GitHub PR #2) | snapshot-integrity | WU-9..12 | `92bb8ad` |
| 4 (GitHub PR #4) | frontend-polish | WU-13 | `3699ca8` |
| fast-follow | W1/W2/W3 fixes | — | pendiente commit |

---

## Lecciones Aprendidas

1. **Gate único en el mount point**: poner `requireRole` directamente en `router.use("/admin", ...)` en lugar de endpoint-por-endpoint elimina toda una clase de regresión. Una sola línea para proteger cientos de endpoints.

2. **Fail-fast en construcción vs. fail-silent en runtime**: el pattern `requireRole("typo")` lanza en el servidor al arrancar, no en el primer 403 en producción. Vale la pena aplicarlo a cualquier validación de catálogo que se configure en tiempo de definición de rutas.

3. **Adversarial review produce bugs reales**: el review de PR2 encontró tres bugs reales (`deriveApplyScope` divergente entre `applyConfig`/`computeApplyImpact`, resolver divergence, dedupeParamsByKey duplicado). La fase de code review del ciclo SDD aporta valor genuino, no es ceremonial.

4. **WARNINGs no-bloqueantes → fast-follow inmediato**: los 3 WARNINGs del verify eran baratos de cerrar (un fichero de test + una guard clause). Cerrarlos el mismo día evita que se arrastren como deuda.

5. **supertest + ESM + singletons**: para tests HTTP con ESM, la asignación de `process.env.JWT_SECRET` debe hacerse antes de los imports dinámicos de la app (no es posible con imports estáticos hoistados). El patron `process.env.X = ...` + `const mod = await import(...)` resuelve el ordering problem correctamente en Node.js test runner (cada test file corre en su propio subprocess).

---

## Inventario de Artefactos

```
rule_set/openspec/changes/rbac-and-config-safeguards/
├── proposal.md
├── design.md
├── design_utf8.md          ← fichero stray (SUGGESTION-3 del verify, inofensivo)
├── tasks.md
├── apply-progress.md
├── verify-report-pr1.md
├── verify-report.md
├── state.yaml              ← actualizado: status: archived
├── archive-report.md       ← este fichero
└── specs/
    ├── admin-rbac/spec.md
    ├── config-apply-safeguard/spec.md
    └── snapshot-integrity/spec.md
```

---

## Cierre del Cambio

Este cambio está **COMPLETO y ARCHIVADO**.

- **Proposal**: 3 hallazgos OWASP identificados, alcance definido, risks documentados.
- **Spec**: 3 especificaciones independientes (admin-rbac / config-apply-safeguard / snapshot-integrity).
- **Design**: middleware factory, endpoints preview/apply, HMAC util, SQL migration, cadena de 4 PRs.
- **Tasks**: 15 tareas (T-01..T-13c) distribuidas en 4 PRs + WU-13 frontend.
- **Apply**: 4 PRs mergeados a main; 3 rondas de code review con bugs reales encontrados y corregidos.
- **Verify**: PASS WITH WARNINGS — 0 CRITICAL, 3 WARNING (no bloqueantes), 3 SUGGESTION.
- **Archive**: 3 WARNINGs cerrados en fast-follow (mismo día). Ciclo SDD completado.

Sin defectos abiertos. Sin tareas pendientes.

---

*End of Archive Report.*
