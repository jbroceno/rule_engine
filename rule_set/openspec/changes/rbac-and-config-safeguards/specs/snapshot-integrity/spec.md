# Delta — snapshot-integrity

> Cambio: `rbac-and-config-safeguards`
> Dominio: integridad de snapshots (HMAC-SHA256 al crear, verificación al restaurar)
> Tipo: MODIFIED (creación/restauración actuales) + ADDED (columna checksum, veredicto en UI)

---

## MODIFIED Requirements

### Requirement: Creación de snapshot calcula checksum de integridad

El sistema MUST calcular un HMAC-SHA256 sobre el contenido canónico de `rules_json` + `params_json`
(usando `node:crypto`, sin nueva dependencia, y el secreto resuelto — ver Requirement "Secreto
HMAC") en toda invocación de `createSnapshot`, y MUST persistirlo en la nueva columna `checksum`
de `dbo.cfg_config_snapshot`.
(Previously: `createSnapshot` insertaba `rules_json`/`params_json` como texto plano sin ningún
checksum ni firma; no existía la columna `checksum`.)

#### Scenario: Snapshot nuevo incluye checksum

- GIVEN se invoca `createSnapshot(name, comment, createdBy)` con `rules`/`params` obtenidos de
  `exportConfig()`
- WHEN la fila se inserta en `dbo.cfg_config_snapshot`
- THEN la columna `checksum` contiene un HMAC-SHA256 en hexadecimal (64 caracteres) no nulo

#### Scenario: Mismo contenido produce el mismo checksum

- GIVEN dos snapshots creados con exactamente el mismo `rules_json` y `params_json`
- WHEN se comparan sus columnas `checksum`
- THEN ambos valores son idénticos (cálculo determinista sobre el mismo secreto)

#### Scenario: Contenido distinto produce checksum distinto

- GIVEN dos snapshots con `rules_json` o `params_json` diferentes
- WHEN se comparan sus columnas `checksum`
- THEN los valores difieren

---

### Requirement: Restauración de snapshot verifica el checksum

El sistema MUST recalcular el HMAC-SHA256 sobre el `rules_json` + `params_json` leídos de
`dbo.cfg_config_snapshot` ANTES de transformar o aplicar el contenido, y MUST comparar el
resultado con la columna `checksum` almacenada.
(Previously: `restoreSnapshot` solo comprobaba que `rules_json`/`params_json` parseasen como JSON
válido; no existía ninguna verificación de integridad del contenido.)

Si el checksum almacenado NO es NULL y NO coincide con el recalculado, el sistema MUST rechazar la
restauración con `409` y MUST NOT aplicar ningún cambio en la base de datos.

Si el checksum almacenado ES NULL (snapshot legado, creado antes de esta funcionalidad), el sistema
MUST permitir la restauración y MUST registrar (log) un aviso indicando que el snapshot no es
verificable — sin bloquear la operación.

#### Scenario: Checksum coincide — restauración procede

- GIVEN un snapshot con `checksum` no nulo que coincide con el HMAC recalculado sobre su contenido
  actual
- WHEN se invoca `POST /admin/snapshots/:snapshotId/restore`
- THEN la restauración procede con normalidad (sin cambios en el flujo existente)

#### Scenario: Checksum no coincide — restauración rechazada

- GIVEN un snapshot cuyo `rules_json` o `params_json` fue alterado directamente en BD tras su
  creación (el `checksum` almacenado ya no coincide con el contenido actual)
- WHEN se invoca `POST /admin/snapshots/:snapshotId/restore`
- THEN la respuesta es `409`
- AND el mensaje indica que la integridad del snapshot no pudo verificarse
- AND NINGÚN dato de la BD destino cambia (ni reglas, ni params, ni se crea el snapshot de
  seguridad pre-restore)

#### Scenario: Checksum NULL (legado) — restauración permitida con aviso

- GIVEN un snapshot creado antes de esta funcionalidad, con `checksum = NULL`
- WHEN se invoca `POST /admin/snapshots/:snapshotId/restore`
- THEN la restauración procede (no se bloquea)
- AND se registra un aviso (log) indicando que el snapshot es "no verificable" / legado

---

## ADDED Requirements

### Requirement: Columna `checksum` en `cfg_config_snapshot`

El esquema SQL MUST añadir la columna `checksum NVARCHAR(64) NULL` a `dbo.cfg_config_snapshot`
mediante una migración no disruptiva (`ALTER TABLE ... ADD`), permitiendo `NULL` para las filas
existentes (legadas) sin backfill retroactivo.

#### Scenario: Migración aplicada no rompe filas existentes

- GIVEN filas existentes en `dbo.cfg_config_snapshot` anteriores a la migración
- WHEN se aplica `ALTER TABLE dbo.cfg_config_snapshot ADD checksum NVARCHAR(64) NULL`
- THEN las filas existentes tienen `checksum = NULL`
- AND las filas nuevas creadas después de desplegar el código de `createSnapshot` tienen `checksum`
  poblado

---

### Requirement: Secreto HMAC con fallback

El sistema MUST resolver el secreto usado para el HMAC-SHA256 desde `SNAPSHOT_HMAC_SECRET` si está
definido en el entorno; si `SNAPSHOT_HMAC_SECRET` NOT está definido, el sistema MUST usar
`JWT_SECRET` como fallback. El sistema MUST NOT exigir `SNAPSHOT_HMAC_SECRET` como variable
obligatoria (no debe romper el arranque `assertAuthConfig()` si está ausente).

#### Scenario: Fallback a JWT_SECRET cuando no hay SNAPSHOT_HMAC_SECRET

- GIVEN `SNAPSHOT_HMAC_SECRET` no está definido en el entorno
- AND `JWT_SECRET` sí está definido
- WHEN se calcula el HMAC de un snapshot
- THEN el cálculo usa `JWT_SECRET` como clave sin error de arranque

#### Scenario: SNAPSHOT_HMAC_SECRET dedicado tiene prioridad

- GIVEN `SNAPSHOT_HMAC_SECRET` está definido con un valor distinto de `JWT_SECRET`
- WHEN se calcula el HMAC de un snapshot
- THEN el cálculo usa `SNAPSHOT_HMAC_SECRET`, no `JWT_SECRET`

---

### Requirement: Veredicto de integridad propagado al frontend

Cuando la restauración de un snapshot es rechazada por checksum no coincidente, la respuesta `409`
MUST incluir información suficiente para que el frontend muestre un mensaje distinto al de un
error genérico. Cuando el snapshot es legado (`checksum = NULL`), la API SHOULD indicarlo en la
respuesta de éxito para que la UI pueda mostrar el veredicto ("verificado" / "legado / no
verificable").

#### Scenario: UI muestra error de integridad distinto al genérico

- GIVEN el usuario intenta restaurar un snapshot cuyo checksum no coincide
- WHEN la API responde `409`
- THEN la página de snapshots muestra un mensaje específico de integridad, no un error genérico de
  servidor

#### Scenario: UI indica snapshot legado tras restaurar con éxito

- GIVEN el usuario restaura un snapshot con `checksum = NULL`
- WHEN la restauración se completa con éxito
- THEN la UI indica que el snapshot restaurado era "legado / no verificable"
