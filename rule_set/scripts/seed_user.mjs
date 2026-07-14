#!/usr/bin/env node
/**
 * scripts/seed_user.mjs — First-user seed for JWT authentication
 *
 * IMPORTANT — lives in scripts/ NOT test/ (node --test would execute anything
 * under test/ as a test file; see CLAUDE.md Gotcha).
 *
 * Usage:
 *   node scripts/seed_user.mjs --email admin@example.com --password 's3cret' [--role admin]
 *
 * If --password is omitted the script prompts interactively (readline fallback).
 * Note: readline prompt echoes the password on screen (no masking on Node).
 * For CI/non-interactive use, pass --password on the command line or set
 * the SEED_PASSWORD environment variable.
 *
 * Exit codes:
 *   0 — user inserted successfully
 *   1 — validation error, duplicate email, or DB error
 *
 * APPLY ORDER (Risk 1):
 *   1) Execute sql/users.sql against the target DB.
 *   2) Run this script to create the first user.
 *   3) Set JWT_SECRET in api/.env.
 *   4) Only then start the server (which mounts authMiddleware).
 */
import readline from "node:readline";
import process from "node:process";

// PITFALL (CJS interop): bcryptjs ships CommonJS. Under type:module use the
// default import — named imports do NOT resolve under ESM interop.
import bcrypt from "bcryptjs"; // default import required — CJS interop

// Reuse the shared SQL pool so we respect the same .env config as the API.
// NOTE: importing these also loads dotenv (via env.js) so .env is respected
// without any extra dotenv.config() call here.
import { getSqlPool, sql } from "../api/db/sql_client.js";

// Validate --role against the same catalog used by requireRole — a typo here
// would create a user whose role never matches any gate, so they could never
// authenticate to admin endpoints (silent lockout).
import { ALLOWED_ROLES, normalizeRole } from "../api/utils/rule_catalogs.js";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--email" && argv[i + 1]) args.email = argv[++i];
    else if (argv[i] === "--password" && argv[i + 1]) args.password = argv[++i];
    else if (argv[i] === "--role" && argv[i + 1]) args.role = argv[++i];
    else if (argv[i] === "--force") args.force = true;
  }
  return args;
}

// ---------------------------------------------------------------------------
// Interactive readline prompt
// ---------------------------------------------------------------------------

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Resolve email
  const email = args.email ?? (await prompt("Email: "));
  if (!email) {
    console.error("Error: el email no puede estar vacío.");
    process.exit(1);
  }

  // Resolve password — argv > env > interactive prompt
  const password =
    args.password ??
    process.env.SEED_PASSWORD ??
    (await prompt("Contraseña (se mostrará en pantalla): "));
  if (!password) {
    console.error("Error: la contraseña no puede estar vacía.");
    process.exit(1);
  }

  // Validate role against ALLOWED_ROLES — normalizeRole trims + lowercases,
  // matching the same transform used by requireRole at runtime.
  const roleRaw = args.role ?? "admin";
  const role = normalizeRole(roleRaw);
  if (!ALLOWED_ROLES.has(role)) {
    const valid = [...ALLOWED_ROLES].join(", ");
    console.error(
      `Error: rol inválido '${roleRaw}'. Valores permitidos: ${valid}.`
    );
    process.exit(1);
  }

  const BCRYPT_COST = 10;

  console.log(`Generando hash bcrypt (cost ${BCRYPT_COST})…`);
  const hash = await bcrypt.hash(password, BCRYPT_COST);

  let pool;
  try {
    pool = await getSqlPool();
  } catch (err) {
    console.error("Error de conexión a SQL Server:", err.message ?? err);
    process.exit(1);
  }

  try {
    if (args.force) {
      // --force: update existing password_hash if email already exists.
      await pool
        .request()
        .input("email", sql.NVarChar(200), email)
        .input("hash", sql.NVarChar(300), hash)
        .input("role", sql.NVarChar(50), role)
        .query(
          `IF EXISTS (SELECT 1 FROM dbo.cfg_user WHERE email = @email)
             UPDATE dbo.cfg_user SET password_hash = @hash, role = @role WHERE email = @email
           ELSE
             INSERT INTO dbo.cfg_user (email, password_hash, role) VALUES (@email, @hash, @role)`
        );
      console.log(`Usuario '${email}' creado o actualizado correctamente.`);
    } else {
      await pool
        .request()
        .input("email", sql.NVarChar(200), email)
        .input("hash", sql.NVarChar(300), hash)
        .input("role", sql.NVarChar(50), role)
        .query(
          "INSERT INTO dbo.cfg_user (email, password_hash, role) VALUES (@email, @hash, @role)"
        );
      console.log(`Usuario '${email}' creado correctamente con rol '${role}'.`);
    }
  } catch (err) {
    // mssql surfaces SQL Server error numbers on err.number
    if (err.number === 2627 || err.number === 2601) {
      console.error(`Ya existe un usuario con ese email: '${email}'.`);
      console.error("Usa --force para actualizar la contraseña de un usuario existente.");
      process.exit(1);
    }
    console.error("Error al insertar el usuario:", err.message ?? err);
    process.exit(1);
  }

  // process.exit(0) is needed because the mssql pool keeps the event loop alive.
  process.exit(0);
}

main().catch((err) => {
  console.error("Error inesperado:", err.message ?? err);
  process.exit(1);
});
