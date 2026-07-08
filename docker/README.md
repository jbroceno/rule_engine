# Demo con Docker

Arranque completo del proyecto (SQL Server + API + frontend + datos) con un solo comando,
pensado para mostrar la aplicación en modo **Demo** sin instalar nada en local salvo Docker.

## Qué levanta

| Servicio | Imagen | Rol |
|----------|--------|-----|
| `sqlserver` | `mcr.microsoft.com/mssql/server:2022-latest` (Ubuntu, edición Developer) | Base de datos |
| `db-init` | `mcr.microsoft.com/mssql-tools` | Crea la BD, aplica el esquema y los SP, y carga la semilla. Se ejecuta una vez y termina. |
| `api` | build de `rule_set/api/Dockerfile` (Node 20 + Express) | API REST en el puerto 3000 |
| `web` | build de `rule_set/web/Dockerfile` (Angular → nginx) | Frontend en el puerto 8080, con proxy `/api` → `api` |

Orden de arranque garantizado por `depends_on`:
`sqlserver` (healthy) → `db-init` (completado con éxito) → `api` → `web`.

## Requisitos

- Docker Desktop / Docker Engine con **Docker Compose v2** (`docker compose`).

## Pasos

Desde la **raíz del repositorio**:

```bash
# 1) Crear el fichero de variables a partir del ejemplo
cp env.example .env          # Linux / macOS / Git Bash
# copy env.example .env      # Windows CMD

# 2) (Opcional) editar .env y cambiar la contraseña de 'sa' y los puertos

# 3) Construir y arrancar todo
docker compose up --build
```

Cuando los logs muestren `API escuchando...` y nginx esté arriba:

- **Frontend:** http://localhost:8080
- **API (health):** http://localhost:3000/api/health
- **SQL Server:** `localhost:1433` (usuario `sa`, contraseña la de `.env`)

Para parar y borrar contenedores (los datos de SQL persisten en el volumen):

```bash
docker compose down
```

Para borrar también los datos de la base de datos:

```bash
docker compose down -v
```

## Variables de entorno (`.env`)

| Variable | Por defecto | Descripción |
|----------|-------------|-------------|
| `MSSQL_SA_PASSWORD` | `Demo_Rule_Engine_2026!` | Contraseña de `sa`. Debe cumplir la política de SQL Server (8+ caracteres con mayúsculas, minúsculas, números y símbolos). |
| `SQL_DB_NAME` | `RULE_ENGINE` | Nombre de la BD. Totalmente configurable: la crea el script de init y los scripts SQL son agnósticos al nombre. |
| `SQLSERVER_PORT` | `1433` | Puerto de SQL Server, publicado **solo en 127.0.0.1** (nunca accesible desde fuera del host). |
| `API_PORT` | `3000` | Puerto de la API en el host. |
| `WEB_PORT` | `8080` | Puerto HTTP del frontend en el host. |
| `WEB_HTTPS_PORT` | `443` | Puerto HTTPS del frontend en el host (activo solo si hay certificados en `SSL_CERTS_DIR`). |
| `SSL_CERTS_DIR` | `./docker/certs` | Directorio con `fullchain.pem`/`privkey.pem`. Si ambos existen, `api` y `web` arrancan en HTTPS automáticamente; si está vacío, sirven HTTP normal. |

> La API recibe la conexión a SQL Server por variables de entorno inyectadas desde Compose
> (`SQL_SERVER=sqlserver`, `SQL_DATABASE`, `SQL_USER=sa`, `SQL_PASSWORD`, …), por lo que **no**
> necesita el fichero `rule_set/api/.env` dentro del contenedor.

## Inicialización de datos

`db-init` ejecuta [`docker/db-init/init.sh`](db-init/init.sh), que:

1. Espera a que SQL Server acepte conexiones.
2. Crea la base de datos (`SQL_DB_NAME`, por defecto `RULE_ENGINE`) si no existe.
3. Si el esquema ya existe (tabla `cfg_offer_ruleset`), **no hace nada** (idempotente).
4. Aplica, en orden, los scripts de `rule_set/sql/`:
   `data_model.sql` → `sp_rules_params.sql` → `snapshots.sql` →
   `sp_cached_wrapper.sql` → `seed_offers.sql`.

La semilla `seed_offers.sql` carga el conjunto completo de ofertas, el mismo que usan `rules.json` y la batería de escenarios de negocio.

Para **re-sembrar desde cero**, borra el volumen y vuelve a levantar:

```bash
docker compose down -v
docker compose up --build
```

## Notas

- El frontend se sirve como bundle estático de producción; las llamadas relativas `/api/...`
  las reenvía nginx al contenedor `api` (ver [`rule_set/web/nginx.conf`](../rule_set/web/nginx.conf)).
- Las funciones de **Workflow** (publicación / snapshots WF) requieren credenciales de un SQL
  externo y **no** se configuran en este demo; sus endpoints responderán de forma controlada.
- `sp_cached_wrapper.sql` es un *shim* solo para el demo: expone
  `cfg_get_offers_and_params_json_cached` delegando en el SP base, para que la ruta primaria de
  la API resuelva sin la maquinaria de caché del entorno de Workflow.
