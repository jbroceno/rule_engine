/**
 * test/rbac_http_integration.test.js — HTTP integration tests for RBAC gates
 *
 * Warning 1 (SDD-verify): verifica que el gate /admin está realmente montado
 *   en el servidor Express (JWT + requireRole("admin")), no solo en unitario.
 * Warning 2 (SDD-verify): regresión — /api/workflow/* NO lleva gate de rol;
 *   cualquier usuario autenticado (viewer, admin) puede acceder.
 *
 * Estrategia:
 *   - Crea el servidor real con createApp() (no server.js: sin assertAuthConfig ni listen).
 *   - Firma JWTs reales con el mismo secreto que usará el singleton authMiddleware.
 *   - Lanza peticiones HTTP con supertest (sin abrir un puerto de red real).
 *   - Cuando el gate pasa, el controlador falla por falta de BD en CI → 503/400/422.
 *     Solo se afirma sobre el código de gate (401/403), nunca sobre la respuesta del controlador.
 *
 * PITFALL — orden de imports ESM:
 *   Los imports estáticos se hoistan ANTES del código de módulo. Para que env.js
 *   lea JWT_SECRET ya establecido en process.env se usan imports DINÁMICOS después
 *   de asignar la variable.
 */

// 1. Establece JWT_SECRET ANTES de cargar ningún módulo de la app.
//    (Si el entorno ya tiene uno configurado, lo respeta — no lo machaca.)
process.env.JWT_SECRET = process.env.JWT_SECRET || "integration-test-secret-rbac";

// 2. Imports que NO dependen de env.js primero (siempre seguros como estáticos).
import test from "node:test";
import assert from "node:assert/strict";

// 3. Imports dinámicos — garantizan que env.js se evalúa DESPUÉS del paso 1.
const { createApp } = await import("../api/app.js");
const jwt = (await import("jsonwebtoken")).default;
const supertest = (await import("supertest")).default;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_SECRET = process.env.JWT_SECRET;

/**
 * Firma un JWT mínimo con el secreto de test.
 * @param {"admin"|"viewer"} role
 */
function signToken(role) {
  return jwt.sign(
    { sub: 1, email: `${role}@test.local`, role },
    TEST_SECRET,
    { expiresIn: "1h" }
  );
}

// Un único agente supertest (no abre puerto real — usa http.Server internamente).
const agent = supertest(createApp());

// ---------------------------------------------------------------------------
// Warning 1 — gate /admin: JWT + requireRole("admin")
// ---------------------------------------------------------------------------

test("W1 — GET /api/admin/offers sin token → 401 (auth gate)", async () => {
  const res = await agent.get("/api/admin/offers");
  assert.equal(res.status, 401, `esperado 401, obtenido ${res.status}`);
});

test("W1 — GET /api/admin/offers con token viewer → 403 (role gate)", async () => {
  const res = await agent
    .get("/api/admin/offers")
    .set("Authorization", `Bearer ${signToken("viewer")}`);
  assert.equal(res.status, 403, `esperado 403, obtenido ${res.status}`);
});

test("W1 — GET /api/admin/offers con token admin → gate superado (no 401 ni 403)", async () => {
  const res = await agent
    .get("/api/admin/offers")
    .set("Authorization", `Bearer ${signToken("admin")}`);
  // El controlador falla con 503 (sin BD en CI) — eso es correcto y esperado.
  // Solo afirmamos que ni el gate de auth ni el de rol han disparado.
  assert.notEqual(res.status, 401, "admin no debe recibir 401 del auth gate");
  assert.notEqual(res.status, 403, "admin no debe recibir 403 del role gate");
});

// ---------------------------------------------------------------------------
// Warning 2 — /workflow NO tiene gate de rol (regresión)
// ---------------------------------------------------------------------------

test("W2 — POST /api/workflow/condiciones-hipotecas sin token → 401 (auth gate aplica igual)", async () => {
  const res = await agent
    .post("/api/workflow/condiciones-hipotecas")
    .send({});
  assert.equal(res.status, 401, `esperado 401 sin token, obtenido ${res.status}`);
});

test("W2 — POST /api/workflow/condiciones-hipotecas con token viewer → NO 403 (sin gate de rol)", async () => {
  const res = await agent
    .post("/api/workflow/condiciones-hipotecas")
    .set("Authorization", `Bearer ${signToken("viewer")}`)
    .send({});
  assert.notEqual(
    res.status,
    403,
    `viewer NO debe recibir 403 en /workflow (sin gate de rol), obtenido ${res.status}`
  );
});

test("W2 — POST /api/workflow/condiciones-hipotecas con token admin → NO 403", async () => {
  const res = await agent
    .post("/api/workflow/condiciones-hipotecas")
    .set("Authorization", `Bearer ${signToken("admin")}`)
    .send({});
  assert.notEqual(res.status, 403, `admin no debe recibir 403 en /workflow, obtenido ${res.status}`);
});

// ---------------------------------------------------------------------------
// Warning 3 — new public-adjacent read surface (sdd/permissive-config-readonly)
// stays guarded in SECURE mode (this file's default AUTH_MODE, since only
// JWT_SECRET is set above, not AUTH_MODE) — real HTTP-level regression check,
// complementing the unit-level secure-mode assertions in
// test/auth_middleware.test.js.
// ---------------------------------------------------------------------------

const NEW_CONFIG_READ_PATHS_SECURE = [
  "/api/config/rules",
  "/api/config/params",
  "/api/config/offers",
  "/api/config/fechas",
];

for (const path of NEW_CONFIG_READ_PATHS_SECURE) {
  test(`W3 — GET ${path} sin token en modo secure (default) → 401 (no es público fuera de permissive)`, async () => {
    const res = await agent.get(path);
    assert.equal(res.status, 401, `esperado 401, obtenido ${res.status}`);
  });

  test(`W3 — GET ${path} con token admin en modo secure → NO 401/403 (admin no afectado)`, async () => {
    const res = await agent.get(path).set("Authorization", `Bearer ${signToken("admin")}`);
    assert.notEqual(res.status, 401, "admin no debe recibir 401");
    assert.notEqual(res.status, 403, "admin no debe recibir 403 (sin gate de rol en esta superficie)");
  });
}
