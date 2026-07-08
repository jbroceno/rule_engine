-- ============================================================
-- rules-cache-motorfecha-key — Deploy script
-- Ofertas Hipotecarias / Motor de Oferta
--
-- Ejecutar este script completo contra la base de datos destino.
-- Crea o reemplaza los objetos necesarios para el cache de reglas
-- basado en fingerprint de periodos MRO_MOTORFECHA ganadores:
--
--   1. DROP INDEX  IX_cfg_rules_cache_evict (esquema anterior incluia cache_type)
--   2. DROP TABLE  dbo.cfg_rules_cache      (elimina cache_type y su CHECK)
--   3. CREATE TABLE dbo.cfg_rules_cache     (sin cache_type; ADR-003)
--   4. CREATE INDEX IX_cfg_rules_cache_evict (offer_codes_key, created_at) INCLUDE (cache_key)
--   5. CREATE OR ALTER FUNCTION dbo.cfg_resolve_mf_winners  (TVF inline; ADR-002)
--   6. CREATE OR ALTER PROCEDURE dbo.cfg_get_offers_and_params_json_cached
--      (wrapper reescrito a clave-fingerprint; ADR-001, ADR-005, ADR-006, ADR-007)
--   7. DROP PROCEDURE dbo.cfg_refresh_rules_cache  (eliminado; ADR-004)
--
-- Clave de cache: <offer_codes_key>|FP:<fingerprint>
--   fingerprint = STRING_AGG(MOTOROFERTA_ID:rules_mfid:params_mfid, '|')
--                 WITHIN GROUP (ORDER BY MOTOROFERTA_ID ASC)
--   con ISNULL(mfid, 0) -> oferta sin periodo cubriente contribuye :0:0
--
-- La TVF dbo.cfg_resolve_mf_winners encapsula la resolucion de ganadores
-- (misma logica que mf_rules_win / mf_params_win del SP base) y es
-- consumida por el wrapper con SELECT @fp = fingerprint FROM dbo.cfg_resolve_mf_winners(...).
--
-- Parametro @max_history_size: nombre legado (era "historia G/H"); hoy
-- significa "maximo de entradas de cache por offer_codes_key" (ADR-007).
--
-- Supersede: db-rules-cache (esquema de clave fecha literal; cache_type G/H;
-- cfg_refresh_rules_cache; EXEC de seed).
-- ============================================================

-- ============================================================
-- 1. Drop indice de eviccion anterior
--    (incluia cache_type en su clave; debe caer antes que la tabla)
-- ============================================================
DROP INDEX IF EXISTS IX_cfg_rules_cache_evict ON dbo.cfg_rules_cache;
GO

-- ============================================================
-- 2. Drop tabla anterior
--    (cache desechable; filas con clave-fecha son inservibles con
--    la clave-fingerprint nueva; drop+recreate es atomico; ADR-003)
-- ============================================================
DROP TABLE IF EXISTS dbo.cfg_rules_cache;
GO

-- ============================================================
-- 3. Tabla dbo.cfg_rules_cache (sin cache_type ni CHECK)
-- ============================================================
CREATE TABLE dbo.cfg_rules_cache
(
  cache_key         NVARCHAR(500) NOT NULL,   -- '<offer_codes_key>|FP:<fingerprint>'
  offer_codes_key   NVARCHAR(500) NOT NULL,   -- ISNULL(@offer_codes,'__ALL__'); ambito de eviccion
  ofertas_json      NVARCHAR(MAX) NOT NULL,
  parametros_json   NVARCHAR(MAX) NOT NULL,
  created_at        DATETIME2(0)  NOT NULL
                    CONSTRAINT DF_cfg_rules_cache_created_at DEFAULT SYSDATETIME(),
  CONSTRAINT PK_cfg_rules_cache PRIMARY KEY CLUSTERED (cache_key)
);
GO

-- ============================================================
-- 4. Indice NC para eviccion FIFO
--    Clave: (offer_codes_key, created_at) — sin cache_type
--    INCLUDE (cache_key) para satisfacer el DELETE del CTE ranked
-- ============================================================
CREATE NONCLUSTERED INDEX IX_cfg_rules_cache_evict
  ON dbo.cfg_rules_cache (offer_codes_key, created_at)
  INCLUDE (cache_key);
GO

-- ============================================================
-- 5. TVF inline: dbo.cfg_resolve_mf_winners
--
--    Resuelve, para cada oferta en alcance, el periodo MRO_MOTORFECHA
--    ganador de reglas y el ganador de parametros a la fecha @DATE.
--    Construye el fingerprint determinista del estado de configuracion.
--
--    Firma: (@offer_codes NVARCHAR(MAX), @DATE DATETIME)
--    Retorna una fila con columna `fingerprint` (STRING_AGG de tuplas
--    MOTOROFERTA_ID:rules_mfid:params_mfid ordenadas por MOTOROFERTA_ID).
--
--    Reutiliza EXACTAMENTE la logica mf_rules_win / mf_params_win del SP
--    base cfg_get_offers_and_params_json. Si el SP base evoluciona (ej.
--    mro-snapshot-deploy), esta TVF debe actualizarse en paralelo.
--
--    Diferencia intencional respecto al SP base:
--      El SP base usa un EXISTS en `rs` para excluir ofertas sin periodo
--      cubriente (evita procesar sin reglas). Esta TVF usa LEFT JOIN en
--      `scope` + `winners` para que una oferta sin periodo cubriente
--      contribuya su tupla MOTOROFERTA_ID:0:0 al fingerprint. Esto es
--      necesario para que activar un periodo futuro (0->N) cambie el
--      fingerprint y produzca un miss controlado (REQ-03, ADR-002).
--
--    Si `winners` queda vacio (ninguna oferta en alcance), STRING_AGG
--    devuelve NULL. El wrapper trata ese caso con ISNULL(@fp, N''),
--    produciendo una clave '<offer_codes_key>|FP:' estable y cacheable.
-- ============================================================
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
    -- Identico al SP base: split CSV de @offer_codes via XML.
    SELECT LTRIM(RTRIM(t.c.value('.', 'NVARCHAR(100)'))) AS code
    FROM (SELECT CAST('<v>' + REPLACE(ISNULL(@offer_codes,''),',','</v><v>') + '</v>' AS XML)) AS s(x)
    CROSS APPLY s.x.nodes('v') AS t(c)
    WHERE LTRIM(RTRIM(t.c.value('.', 'NVARCHAR(100)'))) <> ''
  ),

  -- ----------------------------------------------------------------
  -- mf_rules_win: COPIA EXACTA del CTE del SP base.
  -- Por cada MOTOROFERTA_ID, el unico MRO_MOTORFECHA mas reciente que
  -- cubre @DATE y lleva reglas (TIPO_DS IN ('REGLAS','AMBOS')), rn=1.
  -- MRO_MOTORFECHA es tabla global sin MOTOROFERTA_ID; la asociacion
  -- oferta<->periodo viene de MRO_MOTORREGLA.
  -- ----------------------------------------------------------------
  mf_rules_win AS (
    SELECT ro.MOTOROFERTA_ID,
           mf.MOTORFECHA_ID,
           ROW_NUMBER() OVER (
               PARTITION BY ro.MOTOROFERTA_ID
               ORDER BY mf.DESDE_DT DESC, mf.MOTORFECHA_ID DESC
           ) AS rn
    FROM dbo.MRO_MOTORFECHA mf
    INNER JOIN (
      SELECT DISTINCT MOTOROFERTA_ID, MOTORFECHA_ID
      FROM dbo.MRO_MOTORREGLA
      WHERE ISNULL(BORRADO_FL, 0) = 0
    ) ro ON ro.MOTORFECHA_ID = mf.MOTORFECHA_ID
    WHERE mf.TIPO_DS IN ('REGLAS', 'AMBOS')
      AND ISNULL(mf.BORRADO_FL, 0) = 0
      AND mf.DESDE_DT <= @DATE
      AND (mf.HASTA_DT IS NULL OR mf.HASTA_DT > @DATE)
  ),

  -- ----------------------------------------------------------------
  -- mf_params_win: COPIA EXACTA del CTE del SP base.
  -- Por cada MOTOROFERTA_ID, el unico MRO_MOTORFECHA mas reciente que
  -- cubre @DATE y lleva parametros (TIPO_DS IN ('PARAMS','AMBOS')), rn=1.
  -- Independiente de mf_rules_win: una oferta puede tomar reglas de un
  -- MOTORFECHA y params de otro (mas reciente).
  -- ----------------------------------------------------------------
  mf_params_win AS (
    SELECT po.MOTOROFERTA_ID,
           mf.MOTORFECHA_ID,
           ROW_NUMBER() OVER (
               PARTITION BY po.MOTOROFERTA_ID
               ORDER BY mf.DESDE_DT DESC, mf.MOTORFECHA_ID DESC
           ) AS rn
    FROM dbo.MRO_MOTORFECHA mf
    INNER JOIN (
      SELECT DISTINCT MOTOROFERTA_ID, MOTORFECHA_ID
      FROM dbo.MRO_MOTORPARAM
      WHERE ISNULL(BORRADO_FL, 0) = 0
    ) po ON po.MOTORFECHA_ID = mf.MOTORFECHA_ID
    WHERE mf.TIPO_DS IN ('PARAMS', 'AMBOS')
      AND ISNULL(mf.BORRADO_FL, 0) = 0
      AND mf.DESDE_DT <= @DATE
      AND (mf.HASTA_DT IS NULL OR mf.HASTA_DT > @DATE)
  ),

  -- ----------------------------------------------------------------
  -- scope: ofertas activas en alcance de @offer_codes.
  -- DIFERENCIA vs SP base: usa LEFT JOIN (no EXISTS) para incluir
  -- ofertas sin periodo cubriente y que contribuyan :0:0 al fingerprint.
  -- ----------------------------------------------------------------
  scope AS (
    SELECT s.MOTOROFERTA_ID
    FROM dbo.MRO_MOTOROFERTA s
    INNER JOIN dbo.HIPO_OFERTA h ON h.OFERTA_ID = s.OFERTA_ID
    WHERE ISNULL(s.BORRADO_FL, 0) = 0
      AND (
            @offer_codes IS NULL OR @offer_codes = ''
            OR EXISTS (SELECT 1 FROM filter_codes f WHERE f.code = h.OFERTA_CD)
          )
  ),

  -- ----------------------------------------------------------------
  -- winners: tuplas (MOTOROFERTA_ID, rules_mfid, params_mfid).
  -- NULL si la oferta no tiene periodo cubriente para esa dimension;
  -- ISNULL(..., 0) colapsa ausencia a 0 en el fingerprint.
  -- ----------------------------------------------------------------
  winners AS (
    SELECT sc.MOTOROFERTA_ID,
           rw.MOTORFECHA_ID AS rules_mfid,
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
GO

-- ============================================================
-- 6. SP wrapper: dbo.cfg_get_offers_and_params_json_cached
--
--    Firma (estable para Node.js; ADR-007):
--      @offer_codes      NVARCHAR(MAX) = NULL
--      @DATE             DATETIME      = NULL
--      @max_history_size INT           = 50   (nombre legado = "max entradas")
--      @ttl_days         INT           = 14   (nuevo, al final; Node no lo envia -> default)
--
--    Flujo:
--      1. Resolver fingerprint (capa ligera) via TVF cfg_resolve_mf_winners
--      2. Construir @cache_key = @offer_codes_key + '|FP:' + @fingerprint
--      3. Fast path TTL-aware: hit si cache_key existe y created_at >= @cutoff
--      4. Miss: sp_getapplock keyed en @cache_key (anti-stampede en TODOS los misses)
--      5. Re-check tras lock
--      6. EXEC SP base en tabla temporal @tmp
--      7. Borrar fila expirada por clave antes de insertar; INSERT best-effort (ignora 2627/2601)
--      8. Borrado oportunista de expiradas (TTL, solo en miss)
--      9. Eviccion FIFO acotada por @max_history_size, por offer_codes_key (sin cache_type)
--     10. Liberar lock y retornar resultado de @tmp
-- ============================================================
CREATE OR ALTER PROCEDURE dbo.cfg_get_offers_and_params_json_cached
  @offer_codes      NVARCHAR(MAX) = NULL,
  @DATE             DATETIME      = NULL,
  @max_history_size INT           = 50,   -- nombre legado; hoy = "maximo de entradas de cache" (ADR-007)
  @ttl_days         INT           = 14    -- gestion de almacenamiento, no de correccion (ADR-006)
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  -- LIMITACION CONOCIDA (W-01 / REQ-02 parcial): @offer_codes_key usa el CSV CRUDO,
  -- sin normalizar el orden. El fingerprint SI es independiente del orden de ofertas
  -- (STRING_AGG ... WITHIN GROUP (ORDER BY MOTOROFERTA_ID)), pero el prefijo de la clave
  -- no: 'PRO,RES' y 'RES,PRO' generan cache_keys distintas -> entradas redundantes para
  -- la misma config logica. NO afecta correctitud (distinta clave -> miss -> recalculo
  -- correcto), solo eficiencia. Impacto nulo en el perfil dominante WF (@offer_codes=NULL
  -- -> '__ALL__', constante). Se difiere la normalizacion al llamador; escalar a split+sort
  -- del CSV aqui solo si el cap se contamina con entradas redundantes.
  DECLARE @effective_date  DATETIME      = ISNULL(@DATE, SYSDATETIME()),
          @offer_codes_key NVARCHAR(500) = ISNULL(@offer_codes, N'__ALL__'),
          @fingerprint     NVARCHAR(MAX),
          @cache_key       NVARCHAR(500),
          @cutoff          DATETIME2(0);

  SET @cutoff = DATEADD(DAY, -@ttl_days, SYSDATETIME());

  -- 1) Resolver fingerprint (capa ligera) via la TVF inline.
  --    Una oferta sin periodo cubriente contribuye :0:0; STRING_AGG NULL -> ISNULL -> ''.
  SELECT @fingerprint = ISNULL(fingerprint, N'')
  FROM dbo.cfg_resolve_mf_winners(@offer_codes, @effective_date);

  SET @cache_key = @offer_codes_key + N'|FP:' + @fingerprint;

  -- 2) Fast path: hit TTL-aware (una entrada expirada NO produce hit; ADR-006)
  IF EXISTS (
    SELECT 1 FROM dbo.cfg_rules_cache
    WHERE cache_key = @cache_key AND created_at >= @cutoff
  )
  BEGIN
    SELECT ofertas_json AS OFERTAS_JSON, parametros_json AS PARAMETROS_JSON
    FROM dbo.cfg_rules_cache
    WHERE cache_key = @cache_key;
    RETURN 0;
  END

  -- 3) Miss path: applock keyed en @cache_key (anti-stampede en TODOS los miss; ADR-005)
  --    Sin distincion G/H: no existe cache_type.
  DECLARE @lock_acquired BIT = 0,
          @lock_result   INT;

  EXEC @lock_result = sp_getapplock
    @Resource    = @cache_key,
    @LockMode    = 'Exclusive',
    @LockOwner   = 'Session',
    @LockTimeout = 5000;

  IF @lock_result >= 0
  BEGIN
    SET @lock_acquired = 1;

    -- 4) Re-check tras lock: otra sesion pudo insertar mientras esperabamos
    IF EXISTS (
      SELECT 1 FROM dbo.cfg_rules_cache
      WHERE cache_key = @cache_key AND created_at >= @cutoff
    )
    BEGIN
      EXEC sp_releaseapplock @Resource = @cache_key, @LockOwner = 'Session';
      SELECT ofertas_json AS OFERTAS_JSON, parametros_json AS PARAMETROS_JSON
      FROM dbo.cfg_rules_cache
      WHERE cache_key = @cache_key;
      RETURN 0;
    END
  END
  -- Si @lock_result < 0: timeout — continuar sin garantia de cache (mismo comportamiento que db-rules-cache)

  -- 5) Computar via SP base (capa costosa FOR JSON) en tabla temporal
  DECLARE @tmp TABLE (OFERTAS_JSON NVARCHAR(MAX), PARAMETROS_JSON NVARCHAR(MAX));
  INSERT INTO @tmp (OFERTAS_JSON, PARAMETROS_JSON)
  EXEC dbo.cfg_get_offers_and_params_json
    @offer_codes = @offer_codes,
    @DATE        = @effective_date;

  -- 6) Insert best-effort.
  --    Si la fila existia expirada (created_at < @cutoff) la PK colisiona:
  --    borrar la expirada antes de insertar la refrescada.
  DELETE FROM dbo.cfg_rules_cache
  WHERE cache_key = @cache_key AND created_at < @cutoff;

  BEGIN TRY
    INSERT INTO dbo.cfg_rules_cache
      (cache_key, offer_codes_key, ofertas_json, parametros_json, created_at)
    SELECT @cache_key, @offer_codes_key, OFERTAS_JSON, PARAMETROS_JSON, SYSDATETIME()
    FROM @tmp;
  END TRY
  BEGIN CATCH
    IF ERROR_NUMBER() <> 2627 AND ERROR_NUMBER() <> 2601 THROW;  -- ignora PK violation
  END CATCH

  -- 7) Borrado oportunista de expiradas (TTL, solo en miss — nunca en hot path; ADR-006)
  DELETE FROM dbo.cfg_rules_cache
  WHERE created_at < @cutoff;

  -- 8) Eviccion FIFO acotada por @max_history_size, por offer_codes_key (sin cache_type; ADR-003)
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
GO

-- ============================================================
-- 7. Eliminar SP de pre-materializacion obsoleto (ADR-004)
--    Con clave-fingerprint la invalidacion es emergente: un publish
--    cambia el fingerprint en el siguiente request -> miss controlado.
--    cfg_refresh_rules_cache ya no tiene funcion de correccion.
-- ============================================================
DROP PROCEDURE IF EXISTS dbo.cfg_refresh_rules_cache;
GO
