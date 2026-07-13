import dotenv from "dotenv";

dotenv.config({ path: new URL("../.env", import.meta.url) });

function asNumber(value, defaultValue) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function asBoolean(value, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }
  return String(value).trim().toLowerCase() === "true";
}

// Exported so tests can call asBoolean(undefined, false) directly instead of
// relying on process.env/dotenv reload timing, which is fragile — dotenv.config()
// can repopulate a deleted process.env var from a local .env file on re-import.
export { asBoolean };

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: asNumber(process.env.PORT, 3000),
  wfBaseUrl: process.env.WF_BASE_URL || "",
  sql: {
    server: process.env.SQL_SERVER || "",
    port: asNumber(process.env.SQL_PORT, 1433),
    database: process.env.SQL_DATABASE || "",
    user: process.env.SQL_USER || "",
    password: process.env.SQL_PASSWORD || "",
    encrypt: asBoolean(process.env.SQL_ENCRYPT, false),
    trustServerCertificate: asBoolean(process.env.SQL_TRUST_SERVER_CERT, true),
    poolMax: asNumber(process.env.SQL_POOL_MAX, 10),
    poolMin: asNumber(process.env.SQL_POOL_MIN, 0),
    idleTimeoutMillis: asNumber(process.env.SQL_IDLE_TIMEOUT_MS, 30000),
    requestTimeout: asNumber(process.env.SQL_REQUEST_TIMEOUT_MS, 30000),
  },
  sqlWf: {
    server: process.env.WF_SQL_SERVER || "",
    port: asNumber(process.env.WF_SQL_PORT, 1433),
    database: process.env.WF_SQL_DATABASE || "",
    user: process.env.WF_SQL_USER || "",
    password: process.env.WF_SQL_PASSWORD || "",
    encrypt: asBoolean(process.env.WF_SQL_ENCRYPT, false),
    trustServerCertificate: asBoolean(process.env.WF_SQL_TRUST_SERVER_CERT, true),
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET || "",
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "8h",
  },
  // OWASP-10: HMAC secret for snapshot integrity checksums. Falls back to
  // JWT_SECRET when SNAPSHOT_HMAC_SECRET is not set — intentionally NOT
  // required by assertAuthConfig() (must not break startup when absent).
  snapshot: {
    hmacSecret: process.env.SNAPSHOT_HMAC_SECRET || process.env.JWT_SECRET || "",
  },
  ssl: {
    fullchainPath: process.env.SSL_FULLCHAIN_PATH || "",
    privkeyPath: process.env.SSL_PRIVKEY_PATH || "",
  },
  // Feature flag: POST /api/admin/config/reset-seed. When false, the controller
  // calls next() with no args so the route falls through to the generic 404
  // handler — indistinguishable from a route that doesn't exist.
  enableSeedReset: asBoolean(process.env.ENABLE_SEED_RESET, false),
};

export function hasSqlCredentials() {
  return Boolean(env.sql.server && env.sql.database && env.sql.user && env.sql.password);
}

export function hasWfSqlCredentials() {
  return Boolean(env.sqlWf.server && env.sqlWf.database && env.sqlWf.user && env.sqlWf.password);
}

/**
 * Fail-fast guard — call this in server.js before app.listen.
 * Tests MUST NOT boot server.js; they use createApp() directly with injected DI.
 * A missing JWT_SECRET means jwt.sign/verify silently misbehave or every token
 * is forgeable with an empty secret, so we refuse to start.
 */
export function assertAuthConfig() {
  if (!env.auth.jwtSecret) {
    throw new Error(
      "JWT_SECRET no configurado. Define JWT_SECRET en rule_set/api/.env antes de arrancar el API."
    );
  }
}
