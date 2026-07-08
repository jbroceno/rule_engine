#!/usr/bin/env bash
# =============================================================================
# Migraciones + seed del demo.
#   1. Espera a que SQL Server acepte conexiones.
#   2. Crea la base de datos si no existe.
#   3. Si el esquema ya existe, no hace nada (idempotente).
#   4. Aplica esquema, procedimientos almacenados y semilla.
# =============================================================================
set -euo pipefail

SQLCMD=/opt/mssql-tools/bin/sqlcmd
SERVER="sqlserver"
USER="sa"
PASS="${MSSQL_SA_PASSWORD}"
DB="${SQL_DB_NAME:-RULE_ENGINE}"
SQLDIR=/sql

# Ejecuta sqlcmd contra el servidor (-b: corta y devuelve error ante fallos SQL).
run() { "$SQLCMD" -S "$SERVER" -U "$USER" -P "$PASS" -b "$@"; }

echo "[db-init] Esperando a que SQL Server acepte conexiones..."
for i in $(seq 1 60); do
  if run -Q "SELECT 1" -o /dev/null 2>/dev/null; then
    echo "[db-init] SQL Server disponible."
    break
  fi
  echo "[db-init]   intento $i/60..."
  sleep 3
done

# Comprobación final: si sigue sin responder, falla con mensaje claro.
run -Q "SELECT 1" -o /dev/null

echo "[db-init] Creando base de datos [$DB] si no existe..."
run -Q "IF DB_ID('$DB') IS NULL CREATE DATABASE [$DB];"

# users.sql es auto-idempotente (IF OBJECT_ID(...) IS NULL), así que se aplica
# siempre, fuera del guard de abajo: así una BD ya inicializada antes de que
# existiera esta tabla también la recibe en el siguiente arranque.
echo "[db-init] Aplicando tabla de usuarios (idempotente) en [$DB]..."
run -d "$DB" -i "$SQLDIR/users.sql"                # tabla cfg_user (autenticación JWT)

# Idempotencia: si la tabla principal ya existe, asumimos que el resto del
# esquema (no auto-guardado) ya está inicializado.
ALREADY=$(run -d "$DB" -h -1 -W -Q \
  "SET NOCOUNT ON; SELECT CASE WHEN OBJECT_ID('dbo.cfg_offer_ruleset') IS NULL THEN 0 ELSE 1 END;" \
  | tr -d '[:space:]')

if [ "$ALREADY" = "1" ]; then
  echo "[db-init] El esquema ya existe en [$DB]. Inicialización omitida (idempotente)."
  exit 0
fi

echo "[db-init] Aplicando esquema y semilla en [$DB]..."
run -d "$DB" -i "$SQLDIR/data_model.sql"          # tablas + SP cfg_get_offers_and_params_json
run -d "$DB" -i "$SQLDIR/sp_rules_params.sql"      # SP cfg_get_rules_json (fallback)
run -d "$DB" -i "$SQLDIR/snapshots.sql"            # tabla cfg_config_snapshot
run -d "$DB" -i "$SQLDIR/sp_cached_wrapper.sql"    # SP cfg_get_offers_and_params_json_cached (demo)
run -d "$DB" -i "$SQLDIR/seed_offers.sql"          # semilla: ofertas + reglas + parámetros

echo "[db-init] Inicialización completada correctamente."
