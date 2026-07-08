# Design — rules-cache-motorfecha-key

> Evolución directa de `db-rules-cache`. **Supersede** su esquema de clave (fecha literal →
> fingerprint de períodos `MRO_MOTORFECHA` ganadores) y varias de sus ADR (ADR-2, ADR-3, ADR-5).
> El SP base `dbo.cfg_get_offers_and_params_json` **no se toca**; la firma del wrapper y la
> interfaz Node.js permanecen estables.

## 1. Solution overview

La clave del caché deja de codificar **la pregunta** (qué fecha se preguntó) y pasa a codificar
**la respuesta** (qué configuración resuelve esa fecha). Para cada request se resuelven los períodos
`MRO_MOTORFECHA` ganadores — winner de reglas y winner de params, por oferta — usando *exactamente* la
misma lógica de los CTEs `mf_rules_win` / `mf_params_win` del SP base, y se construye un **fingerprint
determinista** sobre esas tuplas. Ese fingerprint es la clave de caché.

Consecuencias:
- Dos fechas que resuelven a los mismos períodos ganadores comparten entrada → **hit** (mata D1).
- Un publish que introduce un período con `DESDE_DT` futuro cambia el fingerprint en cuanto una
  petición lo cubre → **miss controlado** → entrada fresca, sin refresh (mata D2).
- El fingerprint no depende de si `@DATE` es NULL → el POC se beneficia igual que cualquier cliente
  (mata D3). La distinción G/H desaparece por completo.

La capa costosa (`FOR JSON` anidado, 2N subqueries correlacionadas por regla) sigue ejecutándose
**solo en miss**. La capa ligera (resolución de ganadores + `STRING_AGG`) se ejecuta en cada request,
que es el supuesto estructural de coste validado en exploración.

### Flujo

```
┌─────────────────────────────────────────────────────────────┐
│ config_service.js                                            │
│   EXEC cfg_get_offers_and_params_json_cached                 │
│        (@offer_codes, @DATE, @max_history_size)   ← firma estable
└───────────────┬─────────────────────────────────────────────┘
                ▼
┌─────────────────────────────────────────────────────────────┐
│ WRAPPER cfg_get_offers_and_params_json_cached                │
│   1. SELECT @fingerprint = fingerprint                       │
│        FROM dbo.cfg_resolve_mf_winners(@offer_codes,@DATE)   │  ← TVF inline
│   2. @cache_key = offer_codes_key + '|FP:' + @fingerprint    │
│   3. lookup TTL-aware → HIT → SELECT cached JSON, RETURN     │
│   4. MISS: sp_getapplock(@cache_key) → re-check              │
│        → EXEC SP base → @tmp                                 │
│        → INSERT best-effort (ignora PK violation)            │
│        → evicción FIFO acotada por @max_history_size         │
│        → release lock → SELECT @tmp                          │
└───────────────┬─────────────────────────────────────────────┘
                ▼
┌─────────────────────────────────────────────────────────────┐
│ SP BASE cfg_get_offers_and_params_json  (INTACTO)            │
│   resuelve winners + serializa FOR JSON (capa costosa)       │
└─────────────────────────────────────────────────────────────┘
```

La novedad estructural respecto a `db-rules-cache` es **`cfg_resolve_mf_winners`** modelado como
**función con valores de tabla inline (TVF)**, no como SP. La justificación está en ADR-002.

## 2. File changes

| Fichero | Tipo | Cambio |
|---|---|---|
| `rule_set/sql/workflow_deploy/wf_sp_cfg_rules_cache.sql` | rewrite | Tabla `cfg_rules_cache` recreada sin `cache_type` (drop+recreate, ADR-003); índice de evicción recreado; **TVF inline nueva `dbo.cfg_resolve_mf_winners`**; wrapper reescrito a clave-fingerprint; `cfg_refresh_rules_cache` y su `EXEC` de seed **eliminados**. |
| `rule_set/api/services/admin_service.js` | modify | Eliminar el bloque `try { … cfg_refresh_rules_cache … } catch` tras `tx.commit()` (~líneas 1500-1505). El resto de `applyConfig` intacto. |
| `rule_set/test/config_cache.test.js` | modify | Eliminar 3.4 y 3.5 (obsoletos); reescribir cabecera; añadir ~6 tests de fingerprint. 3.1/3.2/3.3 permanecen. |

**Sin cambios:** `wf_sp_cfg_get_offers_and_params_json.sql` (SP base), `config_service.js` (interfaz),
motor JS y simuladores.

## 3. Architecture Decision Records

### ADR-001 — Clave = fingerprint de winners, no la fecha (decisión bloqueada)

**Decisión**: la clave de caché es `<offer_codes_key>|FP:<fingerprint>`, donde el fingerprint es el
`STRING_AGG` ordenado de `(MOTOROFERTA_ID:rules_mfid:params_mfid)` por oferta. Fingerprint **crudo,
sin hash** (PH-5: ~6 ofertas → clave ≈275 chars < `NVARCHAR(500)`).

**Rationale**: codifica la respuesta, no la pregunta. Mata D1/D2/D3 de raíz. Es la solución óptima que
el propio doc funcional `04 - config-cache.md` describe. La legibilidad del fingerprint crudo permite
diagnóstico directo en producción.

**Supersede**: el esquema de clave de `db-rules-cache` (fecha literal `CONVERT(varchar(19),…,120)` +
literal `__CURRENT__`).

**Rechazado**: hash `SHA2_256` (sacrifica legibilidad; reservado como cambio de una línea si el catálogo
crece a >25 ofertas).

### ADR-002 — `cfg_resolve_mf_winners` como TVF inline, NO como SP

**Decisión**: implementar la resolución de ganadores como **función con valores de tabla inline**
(`CREATE FUNCTION … RETURNS TABLE AS RETURN (…)`), no como procedimiento almacenado.

**Rationale**:
- El wrapper necesita **consumir** la salida del resolvedor para construir el fingerprint *y* poder
  ejecutarlo dentro de su propio flujo. Un SP no se puede componer en una expresión: para capturar su
  resultado habría que hacer `INSERT … EXEC` en una tabla temporal (overhead + no componible en
  `SELECT @x = …`). Una **TVF inline** se consume directamente con
  `SELECT @fingerprint = fingerprint FROM dbo.cfg_resolve_mf_winners(@offer_codes, @DATE)` — limpio,
  sin tabla intermedia.
- Una TVF **inline** (a diferencia de las multi-statement) es expandida por el optimizador como una
  vista parametrizada: sin penalización de caja negra, plan integrado con el range-scan de
  `MRO_MOTORFECHA`. Es el mecanismo idiomático para "lógica de consulta reutilizable y componible".
- Mantiene el DRY de PH-1: la lógica de resolución vive en un único objeto, reutilizable también para
  diagnóstico (`SELECT * FROM dbo.cfg_resolve_mf_winners('PRO', GETDATE())`).

**Tradeoff (TVF vs SP)**: una TVF inline **no puede** contener `EXEC`, transacciones ni efectos
laterales — pero la resolución de winners es pura lectura, así que esa restricción no aplica. La TVF
gana en composición; el SP solo sería necesario si la resolución tuviera efectos, que no los tiene.
El SP auxiliar (Opción A de exploración) sigue siendo "un objeto SQL más"; la TVF es ese mismo objeto
pero en la forma correcta para que el wrapper lo consuma sin fricción.

**Rechazado**:
- *SP auxiliar `cfg_resolve_mf_winners` (Opción A literal)*: forzaría `INSERT @winners EXEC …` solo
  para luego agregar el fingerprint — composición torpe y una tabla temporal extra por request.
- *Query inline duplicada en el wrapper (Opción B)*: duplica los CTEs del SP base; al evolucionar el
  base (ya pasó con `mro-snapshot-deploy`) habría dos sitios que sincronizar. Deuda de mantenimiento.

### ADR-003 — Recrear la tabla (drop+recreate), NO `ALTER … DROP COLUMN`

**Decisión** (resuelve PH-3 / open question 1): en el deploy script, **dropear y recrear** la tabla
`dbo.cfg_rules_cache` sin la columna `cache_type` ni su `CHECK`. El índice de evicción
`IX_cfg_rules_cache_evict` se recrea **sin** `cache_type` en la clave (queda
`(offer_codes_key, created_at) INCLUDE (cache_key)`).

**Rationale**:
- La tabla es un **caché puro**: sus filas son desechables. Perderlas solo fuerza repoblar en los
  primeros misses — no hay pérdida de datos correctos. El drop+recreate es la operación más simple y
  determinista.
- El deploy actual usa `IF NOT EXISTS … CREATE TABLE` (idempotente para crear, pero **no** migra un
  esquema existente). Un `ALTER TABLE DROP COLUMN cache_type` requeriría primero dropear el `CHECK
  CK_cfg_rules_cache_type` y luego el índice (que incluye `cache_type` en su clave) y recrearlo —
  tres pasos frágiles y dependientes del estado previo. El drop+recreate colapsa todo eso en una
  operación atómica e idempotente respecto al esquema objetivo.
- Las filas pre-existentes de `db-rules-cache` tienen el **esquema de clave viejo** (fecha literal):
  conservarlas sería contraproducente (nunca producirían hit con la clave-fingerprint nueva y
  ocuparían cap). Dropearlas las elimina limpiamente.

**Pasos de migración del esquema** (en el deploy):
1. `DROP INDEX IF EXISTS IX_cfg_rules_cache_evict ON dbo.cfg_rules_cache;`
2. `DROP TABLE IF EXISTS dbo.cfg_rules_cache;`
3. `CREATE TABLE dbo.cfg_rules_cache (…)` sin `cache_type` (DDL en §4.1).
4. `CREATE NONCLUSTERED INDEX IX_cfg_rules_cache_evict ON dbo.cfg_rules_cache (offer_codes_key, created_at) INCLUDE (cache_key);`

**Supersede**: la creación condicional `IF NOT EXISTS … CREATE TABLE` de `db-rules-cache` (que asumía
una tabla con `cache_type`).

**Rechazado**: `ALTER TABLE … DROP COLUMN cache_type` + recrear índice — más pasos, dependiente del
estado previo, sin beneficio (las filas viejas son inservibles con la clave nueva igualmente).

### ADR-004 — Eliminar `cfg_refresh_rules_cache` y su llamada Node (PH-2, bloqueado)

**Decisión**: eliminar el SP `cfg_refresh_rules_cache`, su `EXEC` de seed del deploy, y el bloque
best-effort en `admin_service.js` tras `applyConfig`. No se reconvierte en purge.

**Rationale**: con clave-fingerprint la invalidación es **emergente** — un publish introduce una nueva
`MRO_MOTORFECHA` → la próxima petición resuelve otro fingerprint → miss → entrada fresca. La entrada
anterior queda **huérfana pero NO incorrecta** (sigue válida para las fechas que resuelven a ese
winner). El refresh perdería su función de corrección. Un purge de huérfanas sería redundante con el
cap de tamaño + TTL y añadiría complejidad sin valor de corrección.

**Supersede**: ADR-5 de `db-rules-cache` ("Refresh on Publish, Not TTL"). Se invierte: ahora es
"TTL + cap, no refresh".

**Rechazado**: reconvertir en `cfg_purge_stale_cache_entries` — mejora operativa futura opcional si el
volumen lo justifica, no necesaria para corrección.

### ADR-005 — Eliminar distinción G/H y el applock-solo-en-H (PH-3, PH-4)

**Decisión**: no existe `cache_type`. **Todo** miss pasa por `sp_getapplock` (keyed en el `@cache_key`
fingerprint) + re-check. No hay warm-up post-publish (PH-4).

**Rationale**: la distinción G/H solo tenía sentido porque G se pre-materializaba (refresh) y H se
poblaba lazy. Sin refresh, **todas** las entradas se pueblan lazy y todas son stampede-prone en su
primer miss → todas merecen el applock. El perfil continuo de WF tolera el único miss tras un publish;
el segundo request ya es hit. Materializar por adelantado reintroduciría la maquinaria de refresh que
estamos eliminando.

**Supersede**: ADR-3 de `db-rules-cache` ("sp_getapplock Only on H Path"). Ahora el applock se aplica
en **todos** los misses. Mantiene ADR-4 (FIFO por `created_at`) y ADR-1 (tabla en disco, no OLTP).

### ADR-006 — TTL como gestión de almacenamiento: filtro en lookup + borrado oportunista (PH open question 2)

**Decisión** (resuelve open question 2):
- **Default**: **14 días** (rango días-a-semanas; la corrección ya no depende del TTL).
- **Mecanismo**: opción (a) — filtro `created_at`-based en el lookup + **borrado oportunista** de filas
  expiradas durante la ruta de **miss** (no en el hot path de hit). Sin job, sin OLTP, SQL de tabla en
  disco plano.
- **Configurable**: vía un **tercer parámetro del wrapper con default**, `@ttl_days INT = 14`, añadido
  **al final** de la firma. Node sigue llamando posicional/nombradamente sin tocar nada (no envía el
  parámetro → toma el default). Cumple el requisito funcional "tiempo de vida configurable" sin romper
  la interfaz Node.

**Por qué (a) y no un job ni `expires_at`**:
- **Filtro en lookup**: `WHERE cache_key = @cache_key AND created_at >= DATEADD(DAY, -@ttl_days,
  SYSDATETIME())` → una fila expirada **no produce hit**, cae a miss y se regenera. Correcto sin job.
- **Borrado oportunista en miss**: tras insertar la entrada nueva, un `DELETE … WHERE created_at <
  DATEADD(DAY, -@ttl_days, SYSDATETIME())` limpia expiradas. Se ejecuta solo en miss (frío), nunca en
  hit (caliente) → no penaliza el hot path. Esto, combinado con el cap FIFO, acota el almacenamiento.
- **No `expires_at`**: `created_at + @ttl_days` calculado en query es suficiente y deja el TTL
  **configurable en tiempo de ejecución** (un `expires_at` materializado congelaría el TTL en el
  momento del insert → cambiar el default obligaría a reescribir filas). Se conserva `created_at`
  (que ya existe y alimenta la evicción FIFO).

**Rechazado**: (b) job/SP de limpieza (introduce un objeto agendado y dependencia de SQL Agent — fuera
del perfil "solo objetos SQL del caché"); (c) parámetro sin filtro en lookup (no protegería contra
servir una expirada).

### ADR-007 — Conservar `@max_history_size` (PH open question 3)

**Decisión** (resuelve open question 3): **conservar el nombre** `@max_history_size`. No se renombra.

**Rationale**: el nombre es semánticamente impreciso tras eliminar G/H ("history" ya no distingue
nada), pero `config_service.js` lo pasa hoy como `request.input("max_history_size", sql.Int, 50)`.
Renombrar el parámetro del SP **rompería** ese `input` nombrado (mssql/Tedious empareja por nombre) →
obligaría a tocar `config_service.js`, contra el criterio de éxito #4 ("interfaz Node estable") y la
decisión bloqueada de no tocar config_service. El coste de un nombre subóptimo (mitigable con un
comentario en el SP) es menor que el riesgo de tocar la capa Node y reescribir el test 3.2.

**Tradeoff**: claridad del nombre vs. estabilidad de interfaz. Se prioriza estabilidad. Se documenta en
el cuerpo del SP que "history" es legado y hoy significa "máximo de entradas de caché".

**Rechazado**: renombrar a `@max_cache_entries` + actualizar el único call site en `config_service.js`
y el test 3.2 — más limpio semánticamente pero viola la restricción bloqueada de no tocar
`config_service.js`.

## 4. Detailed design

### 4.1 DDL — `dbo.cfg_rules_cache` (sin `cache_type`)

```sql
CREATE TABLE dbo.cfg_rules_cache
(
  cache_key         NVARCHAR(500) NOT NULL,   -- '<offer_codes_key>|FP:<fingerprint>'
  offer_codes_key   NVARCHAR(500) NOT NULL,   -- ISNULL(@offer_codes,'__ALL__'); ámbito de evicción
  ofertas_json      NVARCHAR(MAX) NOT NULL,
  parametros_json   NVARCHAR(MAX) NOT NULL,
  created_at        DATETIME2(0)  NOT NULL
                    CONSTRAINT DF_cfg_rules_cache_created_at DEFAULT SYSDATETIME(),
  CONSTRAINT PK_cfg_rules_cache PRIMARY KEY CLUSTERED (cache_key)
);

CREATE NONCLUSTERED INDEX IX_cfg_rules_cache_evict
  ON dbo.cfg_rules_cache (offer_codes_key, created_at)
  INCLUDE (cache_key);
```

Notas:
- Eliminadas la columna `cache_type` y el `CHECK CK_cfg_rules_cache_type`.
- `created_at` se conserva: alimenta tanto la evicción FIFO como el filtro/borrado TTL (ADR-006).
- **Sin** columna `expires_at`: el TTL se calcula en query desde `created_at + @ttl_days` (ADR-006).
- El índice de evicción pierde `cache_type` de su clave compuesta.

### 4.2 TVF inline `dbo.cfg_resolve_mf_winners`

**Firma**: `dbo.cfg_resolve_mf_winners(@offer_codes NVARCHAR(MAX), @DATE DATETIME) RETURNS TABLE`.

**Qué devuelve**: un **result set** (no OUTPUT param — una TVF no tiene). Devuelve **una sola fila** con
el fingerprint agregado más, para diagnóstico, las tuplas detalladas. Concretamente, una columna
`fingerprint NVARCHAR(MAX)` (la cadena agregada). El wrapper consume solo `fingerprint`; el detalle
por oferta es inspeccionable expandiendo la CTE en una consulta de diagnóstico ad-hoc o exponiendo una
segunda TVF de detalle si se quisiera (no requerido para v1).

**Reutiliza EXACTAMENTE la lógica del SP base** — mismos `mf_rules_win` / `mf_params_win`: derivación
desde la tabla global `MRO_MOTORFECHA` (sin columna `MOTOROFERTA_ID`), asociación oferta↔período vía
`MRO_MOTORREGLA` / `MRO_MOTORPARAM` con `ISNULL(BORRADO_FL,0)=0`, filtro `TIPO_DS`
(`REGLAS`/`AMBOS` para reglas, `PARAMS`/`AMBOS` para params), ventana
`DESDE_DT <= @DATE AND (HASTA_DT IS NULL OR HASTA_DT > @DATE)`, y
`ROW_NUMBER() OVER (PARTITION BY MOTOROFERTA_ID ORDER BY DESDE_DT DESC, MOTORFECHA_ID DESC)` → `rn=1`.

**Esqueleto**:

```sql
CREATE OR ALTER FUNCTION dbo.cfg_resolve_mf_winners
(
  @offer_codes NVARCHAR(MAX),
  @DATE        DATETIME
)
RETURNS TABLE
AS
RETURN
(
  WITH filter_codes AS (
    -- idéntico al SP base: split CSV de @offer_codes vía XML
    SELECT LTRIM(RTRIM(t.c.value('.', 'NVARCHAR(100)'))) AS code
    FROM (SELECT CAST('<v>' + REPLACE(ISNULL(@offer_codes,''),',','</v><v>') + '</v>' AS XML)) AS s(x)
    CROSS APPLY s.x.nodes('v') AS t(c)
    WHERE LTRIM(RTRIM(t.c.value('.', 'NVARCHAR(100)'))) <> ''
  ),
  mf_rules_win AS (   -- COPIA EXACTA del CTE del SP base
    SELECT ro.MOTOROFERTA_ID, mf.MOTORFECHA_ID,
           ROW_NUMBER() OVER (PARTITION BY ro.MOTOROFERTA_ID
                              ORDER BY mf.DESDE_DT DESC, mf.MOTORFECHA_ID DESC) AS rn
    FROM dbo.MRO_MOTORFECHA mf
    INNER JOIN (SELECT DISTINCT MOTOROFERTA_ID, MOTORFECHA_ID
                FROM dbo.MRO_MOTORREGLA WHERE ISNULL(BORRADO_FL,0)=0) ro
           ON ro.MOTORFECHA_ID = mf.MOTORFECHA_ID
    WHERE mf.TIPO_DS IN ('REGLAS','AMBOS') AND ISNULL(mf.BORRADO_FL,0)=0
      AND mf.DESDE_DT <= @DATE AND (mf.HASTA_DT IS NULL OR mf.HASTA_DT > @DATE)
  ),
  mf_params_win AS (  -- COPIA EXACTA del CTE del SP base (MRO_MOTORPARAM, TIPO_DS PARAMS/AMBOS)
    SELECT po.MOTOROFERTA_ID, mf.MOTORFECHA_ID,
           ROW_NUMBER() OVER (PARTITION BY po.MOTOROFERTA_ID
                              ORDER BY mf.DESDE_DT DESC, mf.MOTORFECHA_ID DESC) AS rn
    FROM dbo.MRO_MOTORFECHA mf
    INNER JOIN (SELECT DISTINCT MOTOROFERTA_ID, MOTORFECHA_ID
                FROM dbo.MRO_MOTORPARAM WHERE ISNULL(BORRADO_FL,0)=0) po
           ON po.MOTORFECHA_ID = mf.MOTORFECHA_ID
    WHERE mf.TIPO_DS IN ('PARAMS','AMBOS') AND ISNULL(mf.BORRADO_FL,0)=0
      AND mf.DESDE_DT <= @DATE AND (mf.HASTA_DT IS NULL OR mf.HASTA_DT > @DATE)
  ),
  -- ofertas en alcance: activas, filtradas por @offer_codes (mismo gate que `rs` del base,
  -- PERO sin exigir período cubriente — una oferta sin período debe contribuir :0:0).
  scope AS (
    SELECT s.MOTOROFERTA_ID
    FROM dbo.MRO_MOTOROFERTA s
    INNER JOIN dbo.HIPO_OFERTA h ON h.OFERTA_ID = s.OFERTA_ID
    WHERE ISNULL(s.BORRADO_FL,0)=0
      AND (@offer_codes IS NULL OR @offer_codes='' 
           OR EXISTS (SELECT 1 FROM filter_codes f WHERE f.code = h.OFERTA_CD))
  ),
  winners AS (
    SELECT sc.MOTOROFERTA_ID,
           rw.MOTORFECHA_ID AS rules_mfid,   -- NULL si no hay período cubriente
           pw.MOTORFECHA_ID AS params_mfid
    FROM scope sc
    LEFT JOIN mf_rules_win  rw ON rw.MOTOROFERTA_ID = sc.MOTOROFERTA_ID AND rw.rn = 1
    LEFT JOIN mf_params_win pw ON pw.MOTOROFERTA_ID = sc.MOTOROFERTA_ID AND pw.rn = 1
  )
  SELECT fingerprint =
    STRING_AGG(
      CAST(w.MOTOROFERTA_ID AS VARCHAR(10)) + ':' +
      CAST(ISNULL(w.rules_mfid,  0) AS VARCHAR(10)) + ':' +
      CAST(ISNULL(w.params_mfid, 0) AS VARCHAR(10)),
      '|'
    ) WITHIN GROUP (ORDER BY w.MOTOROFERTA_ID ASC)
  FROM winners w
);
```

**Diferencia clave con el SP base — el `scope` usa `LEFT JOIN`, no `EXISTS`**: el SP base descarta
(vía `rs`) las ofertas sin período cubriente de reglas; aquí, en cambio, una oferta en alcance pero sin
período debe contribuir su tupla `MOTOROFERTA_ID:0:0`. Esto distingue "sin período" de "no solicitada"
y **garantiza que activar un período futuro cambie el fingerprint** (criterio de éxito #2). Por eso
`scope` parte de `MRO_MOTOROFERTA` (todas las activas en alcance) y los winners son `LEFT JOIN`,
colapsando ausencia a `0` vía `ISNULL`.

> Si `winners` queda vacío (ninguna oferta en alcance), `STRING_AGG` devuelve `NULL`. El wrapper trata
> ese caso como fingerprint vacío (`ISNULL(@fingerprint, N'')`), produciendo una clave
> `<offer_codes_key>|FP:` estable y cacheable.

### 4.3 Wrapper `cfg_get_offers_and_params_json_cached` reescrito

**Firma**: `(@offer_codes NVARCHAR(MAX) = NULL, @DATE DATETIME = NULL, @max_history_size INT = 50,
@ttl_days INT = 14)`. Los dos primeros y el tercero son los de hoy (estables para Node); `@ttl_days`
se añade al final con default (ADR-006), invisible para Node.

**Pseudo-SQL del flujo**:

```sql
CREATE OR ALTER PROCEDURE dbo.cfg_get_offers_and_params_json_cached
  @offer_codes      NVARCHAR(MAX) = NULL,
  @DATE             DATETIME      = NULL,
  @max_history_size INT           = 50,   -- nombre legado; hoy = "máximo de entradas" (ADR-007)
  @ttl_days         INT           = 14    -- gestión de almacenamiento, no corrección (ADR-006)
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @effective_date  DATETIME      = ISNULL(@DATE, SYSDATETIME()),
          @offer_codes_key NVARCHAR(500) = ISNULL(@offer_codes, N'__ALL__'),
          @fingerprint     NVARCHAR(MAX),
          @cache_key       NVARCHAR(500),
          @cutoff          DATETIME2(0);

  SET @cutoff = DATEADD(DAY, -@ttl_days, SYSDATETIME());

  -- 1) Resolver fingerprint (capa ligera) vía la TVF inline
  SELECT @fingerprint = ISNULL(fingerprint, N'')
  FROM dbo.cfg_resolve_mf_winners(@offer_codes, @effective_date);

  SET @cache_key = @offer_codes_key + N'|FP:' + @fingerprint;

  -- 2) Fast path: hit TTL-aware (una entrada expirada NO produce hit)
  IF EXISTS (SELECT 1 FROM dbo.cfg_rules_cache
             WHERE cache_key = @cache_key AND created_at >= @cutoff)
  BEGIN
    SELECT ofertas_json AS OFERTAS_JSON, parametros_json AS PARAMETROS_JSON
    FROM dbo.cfg_rules_cache WHERE cache_key = @cache_key;
    RETURN 0;
  END

  -- 3) Miss path: applock keyed en el cache_key fingerprint (anti-stampede para TODOS los miss)
  DECLARE @lock_acquired BIT = 0, @lock_result INT;
  EXEC @lock_result = sp_getapplock
    @Resource = @cache_key, @LockMode = 'Exclusive',
    @LockOwner = 'Session', @LockTimeout = 5000;

  IF @lock_result >= 0
  BEGIN
    SET @lock_acquired = 1;
    -- 4) Re-check tras lock: otra sesión pudo insertar mientras esperábamos
    IF EXISTS (SELECT 1 FROM dbo.cfg_rules_cache
               WHERE cache_key = @cache_key AND created_at >= @cutoff)
    BEGIN
      EXEC sp_releaseapplock @Resource = @cache_key, @LockOwner = 'Session';
      SELECT ofertas_json AS OFERTAS_JSON, parametros_json AS PARAMETROS_JSON
      FROM dbo.cfg_rules_cache WHERE cache_key = @cache_key;
      RETURN 0;
    END
  END
  -- (si @lock_result < 0: timeout — continuar sin garantía de caché, igual que db-rules-cache)

  -- 5) Computar vía SP base (capa costosa FOR JSON) en tabla temporal
  DECLARE @tmp TABLE (OFERTAS_JSON NVARCHAR(MAX), PARAMETROS_JSON NVARCHAR(MAX));
  INSERT INTO @tmp (OFERTAS_JSON, PARAMETROS_JSON)
  EXEC dbo.cfg_get_offers_and_params_json
    @offer_codes = @offer_codes, @DATE = @effective_date;

  -- 6) Insert best-effort. Si expiró pero la fila sigue (created_at viejo) la PK colisiona:
  --    borrar la expirada antes de insertar la refrescada.
  DELETE FROM dbo.cfg_rules_cache WHERE cache_key = @cache_key AND created_at < @cutoff;
  BEGIN TRY
    INSERT INTO dbo.cfg_rules_cache
      (cache_key, offer_codes_key, ofertas_json, parametros_json, created_at)
    SELECT @cache_key, @offer_codes_key, OFERTAS_JSON, PARAMETROS_JSON, SYSDATETIME()
    FROM @tmp;
  END TRY
  BEGIN CATCH
    IF ERROR_NUMBER() <> 2627 AND ERROR_NUMBER() <> 2601 THROW;  -- ignora PK violation
  END CATCH

  -- 7) Borrado oportunista de expiradas (TTL, solo en miss — nunca en hot path)
  DELETE FROM dbo.cfg_rules_cache WHERE created_at < @cutoff;

  -- 8) Evicción FIFO acotada por @max_history_size, por offer_codes_key
  ;WITH ranked AS (
    SELECT cache_key,
           ROW_NUMBER() OVER (ORDER BY created_at DESC, cache_key DESC) AS rn
    FROM dbo.cfg_rules_cache
    WHERE offer_codes_key = @offer_codes_key
  )
  DELETE FROM dbo.cfg_rules_cache
  WHERE cache_key IN (SELECT cache_key FROM ranked WHERE rn > @max_history_size);

  -- 9) Liberar lock y retornar el resultado computado
  IF @lock_acquired = 1
    EXEC sp_releaseapplock @Resource = @cache_key, @LockOwner = 'Session';

  SELECT OFERTAS_JSON, PARAMETROS_JSON FROM @tmp;
  RETURN 0;
END
```

Diferencias respecto a `db-rules-cache`:
- Paso 1 nuevo: resolución del fingerprint vía TVF.
- Clave `|FP:` en vez de `|<fecha>` / `|__CURRENT__`.
- Lookup y re-check con cláusula `created_at >= @cutoff` (TTL-aware).
- Applock en **todos** los misses (sin rama `@is_generic`).
- Pasos 6/7 nuevos: borrado de expirada por clave antes de insertar + borrado oportunista global.
- Evicción FIFO sin `cache_type` en el filtro.

### 4.4 Concurrencia

`sp_getapplock` se keyea en `@cache_key` (el fingerprint), no en la fecha. Dos requests con fechas
distintas que resuelven al mismo fingerprint **comparten** el recurso de lock → el segundo espera al
primero, hace re-check tras adquirir, encuentra la fila recién insertada y la sirve **sin** invocar el
SP base. Esto previene el stampede exactamente como antes, pero ahora con granularidad de
**configuración** (no de timestamp), que es estrictamente mejor: el stampede que importa es "muchos
requests a la misma config", y ese es justo el que se serializa. El re-check tras el lock es la red de
seguridad contra la carrera insert-mientras-esperaba.

## 5. Migration / deploy steps

1. **Backup operativo opcional**: ninguno necesario — la tabla es caché desechable.
2. Ejecutar el `wf_sp_cfg_rules_cache.sql` reescrito contra la BD destino. En orden:
   a. `DROP INDEX IF EXISTS IX_cfg_rules_cache_evict ON dbo.cfg_rules_cache;`
   b. `DROP TABLE IF EXISTS dbo.cfg_rules_cache;`
   c. `CREATE TABLE dbo.cfg_rules_cache (…)` sin `cache_type` (§4.1).
   d. `CREATE NONCLUSTERED INDEX IX_cfg_rules_cache_evict …` (§4.1).
   e. `CREATE OR ALTER FUNCTION dbo.cfg_resolve_mf_winners …` (§4.2).
   f. `CREATE OR ALTER PROCEDURE dbo.cfg_get_offers_and_params_json_cached …` (§4.3).
   g. `DROP PROCEDURE IF EXISTS dbo.cfg_refresh_rules_cache;`
   h. **Eliminar** el `EXEC dbo.cfg_refresh_rules_cache;` de seed (ya no existe el SP).
3. Desplegar el cambio Node (`admin_service.js` sin el bloque de refresh).
4. Verificación live-DB (no cubierta por CI): dos fechas que resuelven al mismo período →
   confirmar mismo `cache_key` y segundo request = hit (Profiler: no se invoca el SP base);
   publish con `DESDE_DT` futuro → fingerprint distinto → miss → entrada fresca; plan de ejecución de
   la TVF para confirmar el supuesto de coste (resolución barata vs FOR JSON dominante).

`GO` separa cada `CREATE OR ALTER` (requisito de batch en SQL Server). Orden estricto: tabla/índice →
TVF → wrapper (el wrapper referencia ambos).

## 6. Rollback

El rollback es directo (cambio = wrapper + objeto auxiliar + wiring):
1. Revertir `wf_sp_cfg_rules_cache.sql` al script de `db-rules-cache` (restaura tabla con `cache_type`,
   wrapper de clave-fecha, `cfg_refresh_rules_cache` y el seed). Recrear es idempotente; las filas con
   clave-fingerprint se descartan al recrear la tabla.
2. Restaurar el bloque best-effort de `cfg_refresh_rules_cache` en `admin_service.js`.
3. `DROP FUNCTION IF EXISTS dbo.cfg_resolve_mf_winners;`
4. El SP base permanece intacto en ambos sentidos — sin migración de datos.

## 7. Test impact alignment

| Test | Estado | Acción |
|---|---|---|
| 3.1 (nombre del SP cacheado) | válido | sin cambio |
| 3.2 (`max_history_size = 50`) | válido | sin cambio (ADR-007 conserva el parámetro) |
| 3.3 (`isMissingCachedSp`) | válido | sin cambio |
| 3.4 (refresh tras commit) | **obsoleto** | **eliminar** (ADR-004: no hay refresh) |
| 3.5 (refresh failure swallowed) | **obsoleto** | **eliminar** (ADR-004) |
| nuevos (~6) | — | añadir matriz de fingerprint (abajo) |

Cabecera del fichero: actualizar el bloque de comentarios que hoy lista 3.4/3.5 y el helper
`runCacheRefresh` (eliminar el helper completo).

**Matriz de tests de fingerprint a añadir** (unitarios, sin live-DB, espejo de la lógica del wrapper —
mismo patrón helper que 3.1-3.3):
1. **Dos fechas, mismo período → mismo `cache_key` → hit.** Dado un set de winners fijo, dos
   `@DATE` distintas producen idéntico fingerprint → idéntica clave.
2. **Publish (nuevo período) → fingerprint distinto → miss.** Cambiar `rules_mfid` de una oferta
   cambia el fingerprint → clave distinta → miss.
3. **Oferta sin período cubriente → contribuye `:0:0`.** Verificar que `ISNULL(...,0)` produce
   `MOTOROFERTA_ID:0:0` y que activar un período (0→N) cambia el fingerprint.
4. **Determinismo independiente del orden de `@offer_codes`.** `WITHIN GROUP (ORDER BY MOTOROFERTA_ID)`
   → misma clave para `'PRO,RES'` y `'RES,PRO'`.
5. **Evicción FIFO de fingerprints antiguos** acotada por `@max_history_size` y `offer_codes_key`
   (sin `cache_type`).
6. **`sp_getapplock` previene stampede en miss de fingerprint**: segundo hilo re-checkea tras lock,
   encuentra la fila, no invoca el SP base.

(Opcional 7: **TTL** — una entrada con `created_at < cutoff` no produce hit y se regenera.)

## 8. Risks and assumptions

| Riesgo / supuesto | Mitigación |
|---|---|
| Coste estructural no medido (FOR JSON dominante vs resolución barata) | Verificación live-DB con plan de ejecución real de la TVF antes de producción (§5.4). |
| Techo de longitud de clave si el catálogo crece a >25 ofertas | Hoy ~6 → ≈275 chars < 500. Si crece: migrar a `SHA2_256` (cambio de una línea en la TVF). |
| Primer request post-publish = miss (PH-4, sin warm-up) | El perfil continuo de WF lo absorbe en el siguiente request; `sp_getapplock` evita stampede. |
| `STRING_AGG` devuelve NULL con `winners` vacío | `ISNULL(@fingerprint, N'')` en el wrapper → clave estable y cacheable. |
| El `scope` con `LEFT JOIN` difiere del `rs` con `EXISTS` del SP base | Intencional (ADR/§4.2): se necesita representar ofertas sin período como `:0:0` para que la activación futura cambie el fingerprint. Documentado en el cuerpo de la TVF. |
| Drop+recreate borra filas de caché en el deploy | Aceptable: caché desechable; solo fuerza repoblar en los primeros misses (ADR-003). |
| TVF inline + `EXEC` del SP base en el mismo wrapper | La TVF es pura lectura (sin `EXEC`); el `EXEC` vive en el wrapper, no en la TVF — compatible. |

## 9. Out of scope (recap)

- Modificar el SP base `cfg_get_offers_and_params_json`.
- Cambios de interfaz en `config_service.js`.
- In-Memory OLTP (NFR del doc lo prohíbe; tabla en disco, ADR-1 de db-rules-cache se mantiene).
- Hash `SHA2_256` del fingerprint (futuro si crece el catálogo).
- Warm-up explícito post-publish.
- `cfg_purge_stale_cache_entries` (purge de huérfanas; mejora operativa futura opcional).
