-- rule_set/sql/users.sql
-- AUTH SEQUENCING (Risk 1): apply this table AND run scripts/seed_user.mjs to
-- create the first user BEFORE enabling auth_middleware in app.js. Otherwise the
-- API is permanently locked (no token obtainable without a seeded user).
--
-- Apply order:
--   1) Execute this file against the target DB.
--   2) Run: node scripts/seed_user.mjs --email <op> --password <secret>
--   3) Set JWT_SECRET in api/.env.
--   4) Only then deploy/start the build that has authMiddleware mounted in app.js.
--
-- ROLES (RBAC, OWASP-01): the `role` column is enforced against the catalog
-- ALLOWED_ROLES = ["admin", "viewer"] (api/utils/rule_catalogs.js), consumed by
-- the requireRole("admin") middleware gating /api/admin/* ONLY
-- (api/middleware/require_role.js). /api/workflow/* is NOT gated by role — it
-- behaves like /api/simulate/*, authenticated (any role) — see
-- api/routes/index.js comment and openspec/changes/rbac-and-config-safeguards/
-- proposal.md § Amendment. "admin" is the default and can operate the full API
-- surface; "viewer" is authenticated but gets 403 on admin routes. Seed a
-- viewer user with:
--   node scripts/seed_user.mjs --email <viewer-email> --password <secret> --role viewer

-- El contexto de base de datos lo fija quien ejecuta el script
-- (p. ej. `sqlcmd -d <BD>`), no se hardcodea aquí.

IF OBJECT_ID('dbo.cfg_user', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.cfg_user (
    user_id       INT IDENTITY(1,1) PRIMARY KEY,
    email         NVARCHAR(200) NOT NULL,
    password_hash NVARCHAR(300) NOT NULL,
    role          NVARCHAR(50)  NOT NULL CONSTRAINT DF_cfg_user_role    DEFAULT ('admin'),
    enabled       BIT           NOT NULL CONSTRAINT DF_cfg_user_enabled DEFAULT (1),
    created_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_cfg_user_created DEFAULT (SYSDATETIME()),
    CONSTRAINT UQ_cfg_user_email UNIQUE (email)
  );
END
GO
