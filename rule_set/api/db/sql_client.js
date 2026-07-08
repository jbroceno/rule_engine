import sql from "mssql";

import { env, hasSqlCredentials, hasWfSqlCredentials } from "../config/env.js";
import { AppError } from "../utils/app_error.js";

let poolPromise;
let wfPoolPromise;

function buildSqlConfig() {
  return {
    server: env.sql.server,
    port: env.sql.port,
    database: env.sql.database,
    user: env.sql.user,
    password: env.sql.password,
    options: {
      encrypt: env.sql.encrypt,
      trustServerCertificate: env.sql.trustServerCertificate,
      // ADR-002: useUTC:false keeps datetime values as local wall-clock.
      // MUST ship together with sql.DateTime2(0) bindings (WU-05/06/07) —
      // never split. Without this, the driver shifts every second-precision
      // vigencia by the server UTC offset and corrupts WF period matching.
      // Acceptance checkpoint CA-VDT-007: verify created_at display in
      // /snapshots after deploy (audit timestamps now read as local — more
      // correct, but verify no visual regression).
      useUTC: false,
    },
    pool: {
      max: env.sql.poolMax,
      min: env.sql.poolMin,
      idleTimeoutMillis: env.sql.idleTimeoutMillis,
    },
    requestTimeout: env.sql.requestTimeout,
  };
}

function buildWfSqlConfig() {
  const wf = env.sqlWf;
  const poc = env.sql;
  return {
    server: wf.server || poc.server,
    port: wf.port || poc.port,
    database: wf.database || poc.database,
    user: wf.user || poc.user,
    password: wf.password || poc.password,
    options: {
      encrypt: wf.server ? wf.encrypt : poc.encrypt,
      trustServerCertificate: wf.server ? wf.trustServerCertificate : poc.trustServerCertificate,
      // ADR-002: same as POC pool — useUTC:false for local wall-clock datetime
      // semantics. Co-required with sql.DateTime2(0) vigencia bindings.
      useUTC: false,
    },
    pool: {
      max: poc.poolMax,
      min: poc.poolMin,
      idleTimeoutMillis: poc.idleTimeoutMillis,
    },
    requestTimeout: poc.requestTimeout,
  };
}

export async function getSqlPool() {
  if (!hasSqlCredentials()) {
    throw new AppError(
      "SQL Server no configurado. Completa rule_set/api/.env con SQL_SERVER, SQL_DATABASE, SQL_USER y SQL_PASSWORD.",
      503
    );
  }

  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(buildSqlConfig())
      .connect()
      .catch((error) => {
        poolPromise = undefined;
        throw new AppError(
          "No se pudo conectar a SQL Server. Verifica host, puerto, base de datos, usuario y credenciales en rule_set/api/.env.",
          503,
          { cause: error.message }
        );
      });
  }

  return poolPromise;
}

export async function getWfSqlPool() {
  if (!hasSqlCredentials()) {
    throw new AppError(
      "SQL Server no configurado. Completa rule_set/api/.env con SQL_SERVER, SQL_DATABASE, SQL_USER y SQL_PASSWORD.",
      503
    );
  }

  // Si no hay config WF específica, reutiliza el pool POC
  if (!hasWfSqlCredentials()) {
    return getSqlPool();
  }

  if (!wfPoolPromise) {
    wfPoolPromise = new sql.ConnectionPool(buildWfSqlConfig())
      .connect()
      .catch((error) => {
        wfPoolPromise = undefined;
        throw new AppError(
          "No se pudo conectar al servidor Workflow. Verifica WF_SQL_SERVER, WF_SQL_DATABASE, WF_SQL_USER y WF_SQL_PASSWORD en rule_set/api/.env.",
          503,
          { cause: error.message }
        );
      });
  }

  return wfPoolPromise;
}

export { sql };
