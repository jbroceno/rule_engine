-- ============================================================
-- POC fingerprint/TTL config cache — Deploy script
-- Ofertas hipotecarias / Motor de Oferta (POC/demo track)
--
-- Ejecutar este script completo (idempotente) contra la base de datos
-- POC/demo destino. 1:1 adaptacion de la cache de WF
-- (rule_set/sql/workflow_deploy/wf_sp_cfg_rules_cache.sql) contra el
-- esquema propio de POC (cfg_offer_ruleset / cfg_offer_dates /
-- cfg_offer_rule / cfg_offer_param). Ver ADR:
-- docs/adr/0001-cache-fingerprint-poc-stored-procedure.md
--
-- Objetos creados/reemplazados:
--   1. DROP INDEX  IX_cfg_rules_cache_evict (si existe, de un deploy previo)
--   2. DROP TABLE  dbo.cfg_rules_cache      (si existe; cache desechable)
--   3. CREATE TABLE dbo.cfg_rules_cache
--   4. CREATE INDEX IX_cfg_rules_cache_evict (offer_codes_key, created_at) INCLUDE (cache_key)
--   5. CREATE OR ALTER FUNCTION dbo.cfg_resolve_offer_dates_winners (TVF inline)
--   6. CREATE OR ALTER PROCEDURE dbo.cfg_get_offers_and_params_json_cached
--
-- Clave de cache: <offer_codes_key>|FP:<fingerprint>
--   fingerprint = STRING_AGG(ruleset_id:rules_did:params_did, '|')
--                 WITHIN GROUP (ORDER BY ruleset_id ASC)
--   con ISNULL(did, 0) -> ruleset sin periodo cubriente contribuye :0:0
--
-- Diferencia con la SP base dbo.cfg_get_offers_and_params_json:
--   La SP base excluye (via EXISTS) rulesets sin regla vigente en @DATE.
--   Esta TVF usa LEFT JOIN para que un ruleset sin periodo cubriente SIGA
--   contribuyendo su tupla ruleset_id:0:0 al fingerprint. Esto es necesario
--   para que activar un periodo futuro (0->N) cambie el fingerprint y
--   produzca un miss controlado, en vez de un hit obsoleto silencioso.
--
-- Parametro @max_history_size: "maximo de entradas de cache por
-- offer_codes_key" (heredado del nombre usado en WF).
--
-- Naturaleza puramente didactica (TFM): no requerido para la correccion
-- funcional del POC — el shim passthrough anterior ya devolvia resultados
-- correctos. El valor es demostrar el patron completo de cache con
-- fingerprint + TTL + anti-stampede + eviccion FIFO contra el propio
-- esquema del POC.
--
-- ------------------------------------------------------------
-- CHECKLIST DE VERIFICACION MANUAL (no hay SQL Server en CI; ver
-- test/config_cache.test.js para los mirrors JS del algoritmo, y
-- CA-013/workflow_service para el mismo precedente de skip en WF):
--
--   [ ] (a) Ejecutar este script completo DOS veces seguidas contra la
--           misma BD — debe completar sin errores ambas veces (idempotencia).
--   [ ] (b) EXEC dbo.cfg_get_offers_and_params_json_cached con los mismos
--           parametros dos veces seguidas — el segundo JSON devuelto debe
--           ser identico al primero, y NO debe crearse una fila nueva en
--           dbo.cfg_rules_cache (SELECT COUNT(*) FROM dbo.cfg_rules_cache
--           antes/despues del segundo call debe ser igual) -> confirma hit.
--   [ ] (c) Editar una regla/param via la API admin (crea un nuevo periodo
--           cfg_offer_dates) y volver a llamar la SP -> debe generarse un
--           nuevo fingerprint/cache_key y una fila nueva en cfg_rules_cache
--           (miss controlado tras el cambio).
--   [ ] (d) UPDATE dbo.cfg_rules_cache SET created_at = DATEADD(day,
--           -(@ttl_days+1), SYSDATETIME()) WHERE cache_key = '<key>' y
--           volver a llamar la SP -> debe producirse un miss (recalculo)
--           y la fila expirada debe quedar purgada (borrado oportunista).
--   [ ] (e) Insertar (o generar via llamadas con distintos @offer_codes)
--           @max_history_size + 1 filas para el mismo offer_codes_key y
--           confirmar que la fila mas antigua (menor created_at) es
--           evictada (FIFO), dejando como maximo @max_history_size filas.
-- ------------------------------------------------------------
-- ============================================================

-- ============================================================
-- 1. Drop indice de eviccion anterior (si existe de un deploy previo)
-- ============================================================
DROP INDEX IF EXISTS IX_cfg_rules_cache_evict ON dbo.cfg_rules_cache;
GO

-- ============================================================
-- 2. Drop tabla anterior
--    (cache desechable; drop+recreate es atomico y seguro — el SP base
--    cfg_get_offers_and_params_json no se ve afectado, solo se pierde
--    el contenido de cache actual, que se recalcula bajo demanda)
-- ============================================================
DROP TABLE IF EXISTS dbo.cfg_rules_cache;
GO

-- ============================================================
-- 3. Tabla dbo.cfg_rules_cache — byte-identica a la DDL de WF
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
--    Clave: (offer_codes_key, created_at); INCLUDE (cache_key) para
--    satisfacer el DELETE del CTE ranked sin lookup adicional.
-- ============================================================
CREATE NONCLUSTERED INDEX IX_cfg_rules_cache_evict
  ON dbo.cfg_rules_cache (offer_codes_key, created_at)
  INCLUDE (cache_key);
GO

-- ============================================================
-- 5. TVF inline: dbo.cfg_resolve_offer_dates_winners
--
--    Resuelve, para cada ruleset en alcance, el periodo cfg_offer_dates
--    ganador de reglas y el ganador de parametros a la fecha @DATE, y
--    construye el fingerprint determinista del estado de configuracion.
--
--    Firma: (@offer_codes NVARCHAR(MAX), @DATE DATETIME)
--    Retorna una fila con columna `fingerprint` (STRING_AGG de tuplas
--    ruleset_id:rules_did:params_did ordenadas por ruleset_id).
--
--    Adapta 1:1 la logica mf_rules_win / mf_params_win de
--    wf_sp_cfg_rules_cache.sql al esquema POC. Si la SP base
--    cfg_get_offers_and_params_json evoluciona, esta TVF debe
--    actualizarse en paralelo.
--
--    Usa STRING_SPLIT para @offer_codes (convencion de la SP base POC,
--    a diferencia del split via XML de WF).
--
--    Diferencia intencional respecto a la SP base: esta usa LEFT JOIN
--    en `scope`/`winners` (la SP base usa EXISTS) para que un ruleset
--    sin periodo cubriente siga contribuyendo su tupla ruleset_id:0:0
--    al fingerprint — necesario para que activar un periodo futuro
--    (0->N) produzca un miss controlado.
--
--    Si `winners` queda vacio (ningun ruleset en alcance), STRING_AGG
--    devuelve NULL. El wrapper trata ese caso con ISNULL(@fp, N''),
--    produciendo una clave '<offer_codes_key>|FP:' estable y cacheable.
-- ============================================================
CREATE OR ALTER FUNCTION dbo.cfg_resolve_offer_dates_winners
(
  @offer_codes NVARCHAR(MAX),
  @DATE        DATETIME
)
RETURNS TABLE
AS
RETURN
(
  WITH filter_codes AS (
    -- Identico a la SP base: split CSV de @offer_codes via STRING_SPLIT.
    SELECT LTRIM(RTRIM(value)) AS code
    FROM STRING_SPLIT(ISNULL(@offer_codes,''), ',')
    WHERE LTRIM(RTRIM(value)) <> ''
  ),

  -- ----------------------------------------------------------------
  -- rules_win: por cada ruleset_id, el unico cfg_offer_dates mas
  -- reciente que cubre @DATE y lleva reglas (tipo_cd IN ('REGLAS','AMBOS')),
  -- rn=1. Se apoya en cfg_offer_rule (enabled=1) para la asociacion
  -- ruleset_id <-> offer_date_id.
  -- ----------------------------------------------------------------
  rules_win AS (
    SELECT r.ruleset_id,
           mf.offer_date_id,
           ROW_NUMBER() OVER (
               PARTITION BY r.ruleset_id
               ORDER BY mf.valid_from DESC, mf.offer_date_id DESC
           ) AS rn
    FROM dbo.cfg_offer_dates mf
    INNER JOIN (
      SELECT DISTINCT ruleset_id, offer_date_id
      FROM dbo.cfg_offer_rule
      WHERE enabled = 1
    ) r ON r.offer_date_id = mf.offer_date_id
    WHERE mf.tipo_cd IN ('REGLAS', 'AMBOS')
      AND mf.valid_from <= @DATE
      AND (mf.valid_to IS NULL OR mf.valid_to > @DATE)
  ),

  -- ----------------------------------------------------------------
  -- params_win: por cada ruleset_id, el unico cfg_offer_dates mas
  -- reciente que cubre @DATE y lleva parametros (tipo_cd IN ('PARAMS','AMBOS')),
  -- rn=1. Independiente de rules_win: un ruleset puede tomar reglas de
  -- un periodo y params de otro (mas reciente); ambos FKs son
  -- independientes en el esquema POC (cfg_offer_rule.offer_date_id y
  -- cfg_offer_param.offer_date_id).
  -- ----------------------------------------------------------------
  params_win AS (
    SELECT p.ruleset_id,
           mf.offer_date_id,
           ROW_NUMBER() OVER (
               PARTITION BY p.ruleset_id
               ORDER BY mf.valid_from DESC, mf.offer_date_id DESC
           ) AS rn
    FROM dbo.cfg_offer_dates mf
    INNER JOIN (
      SELECT DISTINCT ruleset_id, offer_date_id
      FROM dbo.cfg_offer_param
      WHERE enabled = 1
    ) p ON p.offer_date_id = mf.offer_date_id
    WHERE mf.tipo_cd IN ('PARAMS', 'AMBOS')
      AND mf.valid_from <= @DATE
      AND (mf.valid_to IS NULL OR mf.valid_to > @DATE)
  ),

  -- ----------------------------------------------------------------
  -- scope: rulesets activos en alcance de @offer_codes.
  -- DIFERENCIA vs SP base: usa LEFT JOIN (no EXISTS) para incluir
  -- rulesets sin periodo cubriente y que contribuyan :0:0 al fingerprint.
  -- ----------------------------------------------------------------
  scope AS (
    SELECT s.ruleset_id
    FROM dbo.cfg_offer_ruleset s
    WHERE s.enabled = 1
      AND (
            @offer_codes IS NULL OR @offer_codes = ''
            OR EXISTS (SELECT 1 FROM filter_codes f WHERE f.code = s.code)
          )
  ),

  -- ----------------------------------------------------------------
  -- winners: tuplas (ruleset_id, rules_did, params_did).
  -- NULL si el ruleset no tiene periodo cubriente para esa dimension;
  -- ISNULL(..., 0) colapsa ausencia a 0 en el fingerprint.
  -- ----------------------------------------------------------------
  winners AS (
    SELECT sc.ruleset_id,
           rw.offer_date_id AS rules_did,
           pw.offer_date_id AS params_did
    FROM scope sc
    LEFT JOIN rules_win  rw ON rw.ruleset_id = sc.ruleset_id AND rw.rn = 1
    LEFT JOIN params_win pw ON pw.ruleset_id = sc.ruleset_id AND pw.rn = 1
  )

  SELECT fingerprint =
    STRING_AGG(
      CAST(w.ruleset_id AS VARCHAR(10)) + ':' +
      CAST(ISNULL(w.rules_did,  0) AS VARCHAR(10)) + ':' +
      CAST(ISNULL(w.params_did, 0) AS VARCHAR(10)),
      '|'
    ) WITHIN GROUP (ORDER BY w.ruleset_id ASC)
  FROM winners w
);
GO

-- ============================================================
-- 6. SP wrapper: dbo.cfg_get_offers_and_params_json_cached
--
--    Firma preservada (estable para Node.js / config_service.js):
--      @offer_codes      NVARCHAR(MAX) = NULL
--      @DATE             DATETIME      = NULL
--      @max_history_size INT           = 50
--      @ttl_days         INT           = 14   (nuevo, al final; Node no lo envia -> default)
--
--    Flujo (1:1 con wf_sp_cfg_rules_cache.sql):
--      1. Resolver fingerprint (capa ligera) via TVF cfg_resolve_offer_dates_winners
--      2. Construir @cache_key = @offer_codes_key + '|FP:' + @fingerprint
--      3. Fast path TTL-aware: hit si cache_key existe y created_at >= @cutoff
--      4. Miss: sp_getapplock keyed en @cache_key (anti-stampede en TODOS los misses)
--      5. Re-check tras lock
--      6. EXEC SP base dbo.cfg_get_offers_and_params_json en tabla temporal @tmp
--      7. Borrar fila expirada por clave antes de insertar; INSERT best-effort (ignora 2627/2601)
--      8. Borrado oportunista de expiradas (TTL, solo en miss)
--      9. Eviccion FIFO acotada por @max_history_size, por offer_codes_key
--     10. Liberar lock y retornar resultado de @tmp
-- ============================================================
CREATE OR ALTER PROCEDURE dbo.cfg_get_offers_and_params_json_cached
  @offer_codes      NVARCHAR(MAX) = NULL,
  @DATE             DATETIME      = NULL,
  @max_history_size INT           = 50,   -- "maximo de entradas de cache por offer_codes_key"
  @ttl_days         INT           = 14    -- gestion de almacenamiento, no de correccion (ver ADR-0001)
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  -- LIMITACION CONOCIDA (heredada de WF): @offer_codes_key usa el CSV CRUDO,
  -- sin normalizar el orden. El fingerprint SI es independiente del orden
  -- (STRING_AGG ... WITHIN GROUP (ORDER BY ruleset_id)), pero el prefijo de
  -- la clave no: 'A,B' y 'B,A' generan cache_keys distintas -> entradas
  -- redundantes para la misma config logica. No afecta correctitud (distinta
  -- clave -> miss -> recalculo correcto), solo eficiencia. Impacto nulo en
  -- el perfil dominante @offer_codes=NULL -> '__ALL__', constante.
  DECLARE @effective_date  DATETIME      = ISNULL(@DATE, SYSDATETIME()),
          @offer_codes_key NVARCHAR(500) = ISNULL(@offer_codes, N'__ALL__'),
          @fingerprint     NVARCHAR(MAX),
          @cache_key       NVARCHAR(500),
          @cutoff          DATETIME2(0);

  SET @cutoff = DATEADD(DAY, -@ttl_days, SYSDATETIME());

  -- 1) Resolver fingerprint (capa ligera) via la TVF inline.
  --    Un ruleset sin periodo cubriente contribuye :0:0; STRING_AGG NULL -> ISNULL -> ''.
  SELECT @fingerprint = ISNULL(fingerprint, N'')
  FROM dbo.cfg_resolve_offer_dates_winners(@offer_codes, @effective_date);

  SET @cache_key = @offer_codes_key + N'|FP:' + @fingerprint;

  -- 2) Fast path: hit TTL-aware (una entrada expirada NO produce hit)
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

  -- 3) Miss path: applock keyed en @cache_key (anti-stampede en TODOS los miss)
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
  -- Si @lock_result < 0: timeout — continuar sin garantia de cache (mismo comportamiento que WF)

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
    IF ERROR_NUMBER() <> 2627 AND ERROR_NUMBER() <> 2601 THROW;  -- ignora PK violation (insercion concurrente)
  END CATCH

  -- 7) Borrado oportunista de expiradas (TTL, solo en miss — nunca en hot path)
  DELETE FROM dbo.cfg_rules_cache
  WHERE created_at < @cutoff;

  -- 8) Eviccion FIFO acotada por @max_history_size, por offer_codes_key
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
