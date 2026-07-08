USE [OPEN_PRE]
GO
/****** Object:  StoredProcedure [dbo].[cfg_get_offers_and_params_json]    Script Date: 02/06/26 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
-- ============================================================
-- SPs del Motor de Oferta Hipotecaria
-- PKT4 – US4013 – Base de datos: EngineRulesV2
--
-- Ejecutar este script completo en OPEN_PRE.
-- Crea o reemplaza los dos procedimientos almacenados del motor:
--
--   1. dbo.cfg_get_offers_and_params_json  (SP principal)
--      Llamado por la API. Acepta @offer_codes y @DATE para
--      evaluación en un punto en el tiempo.
--      Devuelve dos columnas JSON: OFERTAS_JSON y PARAMETROS_JSON.
--      Columnas en nomenclatura MRO (OFERTA_ID, MOTORREGLA_ID...).
--
--   2. dbo.cfg_get_rules_json              (SP de fallback)
--      Usado si el SP principal no está disponible.
--      Usa GETDATE() – no permite evaluación histórica.
--      Devuelve una sola columna: REGLAS_JSON.
--
-- Nota VALORES_LISTA:
--   cfg_get_offers_and_params_json devuelve VALORES_LISTA = []
--   en todas las condiciones. Los operadores IN / NOT_IN deben
--   usar PARAM:<CLAVE> en VALOR1_DS apuntando a un parámetro JSON.
--   cfg_get_rules_json SÍ lee MRO_MOTORCONDICIONVALOR.
--
-- ============================================================
-- CHANGE: mro-snapshot-deploy (2026-06-02)
-- ============================================================
-- PROBLEMA CERRADO:
--   El SP anterior filtraba reglas y parámetros únicamente por
--   DESDE_DT/HASTA_DT de MRO_MOTORFECHA, sin distinguir por
--   TIPO_DS ni aplicar most-recent-wins. Si existían periodos
--   solapados (ej. AMBOS anterior + PARAMS posterior), la misma
--   regla o parámetro podía aparecer dos veces en la salida,
--   causando evaluación duplicada silenciosa en el motor JS.
--
-- SOLUCIÓN:
--   Dos CTEs independientes de winner por (MOTOROFERTA_ID, TIPO_DS):
--     • mf_rules_win : TIPO_DS IN ('REGLAS','AMBOS'), rn=1 por
--                      DESDE_DT DESC, MOTORFECHA_ID DESC
--     • mf_params_win: TIPO_DS IN ('PARAMS','AMBOS'), misma regla
--   Las CTEs rules y params hacen JOIN a su winner CTE respectivo,
--   garantizando exactamente un periodo por oferta+tipo → cero duplicados.
--
--   NO se leen columnas VIGENCIA_DESDE_DT / VIGENCIA_HASTA_DT
--   (esas columnas no existen en MRO_MOTORREGLA / MRO_MOTORPARAM).
--
-- INVARIANTE de regresión:
--   Si el SP devuelve N reglas para una oferta, el motor JS aplicará
--   exactamente N reglas (sin repetición). Verificado por tests
--   T1.1a–b en rule_engine.test.js (CI-green).
--
-- VERIFICACIÓN LIVE-DB REQUERIDA (no cubierta por CI):
-- ============================================================
-- Checklist de verificación manual antes de promover a producción:
--
-- Caso 1 — Único periodo AMBOS
--   Setup:  Una oferta con un MRO_MOTORFECHA TIPO_DS='AMBOS',
--           DESDE_DT='2025-01-01', HASTA_DT=NULL, con 3 reglas y 2 params.
--   Query:  EXEC cfg_get_offers_and_params_json @DATE='2026-01-01'
--   Expect: OFERTAS_JSON contiene exactamente 3 reglas para esa oferta.
--           PARAMETROS_JSON contiene exactamente 2 params.
--           Sin duplicados (verificar COUNT en JSON_VALUE).
--
-- Caso 2 — AMBOS (antiguo) + PARAMS (posterior) solapados
--   Setup:  mf1: TIPO_DS='AMBOS',  DESDE_DT='2025-01-01', 3 reglas, 2 params
--           mf2: TIPO_DS='PARAMS', DESDE_DT='2025-06-01', 0 reglas, 3 params distintos
--   Query:  EXEC cfg_get_offers_and_params_json @DATE='2026-01-01'
--   Expect: OFERTAS_JSON contiene reglas de mf1 (mf_rules_win=mf1).
--           PARAMETROS_JSON contiene params de mf2 (mf_params_win=mf2, más reciente).
--           Cero duplicados: COUNT(params) = 3, no 2+3=5.
--           Esto prueba zero-duplicates ante solapamiento AMBOS+PARAMS.
--
-- Caso 3 — Sin periodo cubriendo la fecha
--   Setup:  mf1: DESDE_DT='2030-01-01', HASTA_DT=NULL
--   Query:  EXEC cfg_get_offers_and_params_json @DATE='2026-01-01'
--   Expect: La oferta NO aparece en OFERTAS_JSON (el EXISTS de rs falla).
--           PARAMETROS_JSON vacío [].
--
-- Caso 4 — Empate en DESDE_DT: gana mayor MOTORFECHA_ID
--   Setup:  mf1: MOTORFECHA_ID=10, TIPO_DS='AMBOS', DESDE_DT='2025-01-01', 2 reglas
--           mf2: MOTORFECHA_ID=20, TIPO_DS='AMBOS', DESDE_DT='2025-01-01', 3 reglas
--   Query:  EXEC cfg_get_offers_and_params_json @DATE='2026-01-01'
--   Expect: OFERTAS_JSON contiene 3 reglas (de mf2, MOTORFECHA_ID mayor).
--           NO 2+3=5 reglas.
--
-- Caso 5 — TIPO_DS=REGLAS: params no deben aparecer
--   Setup:  mf1: TIPO_DS='REGLAS', DESDE_DT='2025-01-01', 2 reglas, sin params
--   Query:  EXEC cfg_get_offers_and_params_json @DATE='2026-01-01'
--   Expect: OFERTAS_JSON contiene 2 reglas.
--           PARAMETROS_JSON: la oferta NO aparece (sin params para REGLAS-only).
--
-- Caso 6 — Resolución POR OFERTA con ofertas en periodos distintos
--   (valida que el ganador es per-oferta, no global)
--   Setup:  Oferta A: reglas en mf1 (TIPO_DS='AMBOS', DESDE_DT='2025-01-01', HASTA NULL)
--           Oferta B: reglas en mf2 (TIPO_DS='AMBOS', DESDE_DT='2025-06-01', HASTA NULL)
--           (A no tiene reglas en mf2; B no tiene reglas en mf1)
--   Query:  EXEC cfg_get_offers_and_params_json @DATE='2026-01-01'
--   Expect: AMBAS ofertas aparecen — A con sus reglas de mf1, B con las de mf2.
--           El periodo más reciente (mf2) NO descarta a la oferta A.
--           (Una resolución global devolvería solo B → INCORRECTO.)
--
-- ============================================================


-- ============================================================
-- 1. SP PRINCIPAL
--    Parámetros:
--      @offer_codes  NVARCHAR(MAX)  CSV de OFERTA_ID (NULL = todas)
--      @DATE         DATETIME       Fecha de corte para vigencias
--
--    Salida (una sola fila, dos columnas):
--      OFERTAS_JSON    – array de MotorOferta con REGLAS anidadas
--      PARAMETROS_JSON – array de { OFERTA_ID, PARAMS[] }
-- ============================================================
CREATE OR ALTER PROCEDURE [dbo].[cfg_get_offers_and_params_json]
  @offer_codes NVARCHAR(MAX) = NULL
 ,@DATE        DATETIME
AS
BEGIN
  SET NOCOUNT ON;

  ;WITH filter_codes AS (
    SELECT LTRIM(RTRIM(t.c.value('.', 'NVARCHAR(100)'))) AS code
    FROM   (SELECT CAST('<v>' + REPLACE(ISNULL(@offer_codes,''),',','</v><v>') + '</v>' AS XML)) AS s(x)
    CROSS APPLY s.x.nodes('v') AS t(c)
    WHERE  LTRIM(RTRIM(t.c.value('.', 'NVARCHAR(100)'))) <> ''
  ),

  -- ------------------------------------------------------------------
  -- mf_rules_win: for each MOTOROFERTA_ID, the single most-recent
  -- MRO_MOTORFECHA that covers @DATE and carries rules
  -- (TIPO_DS IN ('REGLAS','AMBOS')).
  --
  -- ROW_NUMBER ORDER BY DESDE_DT DESC, MOTORFECHA_ID DESC → rn=1 wins.
  -- Exactly one row per MOTOROFERTA_ID → zero rule duplicates.
  -- ------------------------------------------------------------------
  -- MRO_MOTORFECHA is a GLOBAL period table (it has NO MOTOROFERTA_ID column).
  -- The offer<->period association lives in MRO_MOTORREGLA. We derive it from
  -- there, then pick — per offer — the most-recent rule period covering @DATE.
  mf_rules_win AS (
    SELECT
       ro.MOTOROFERTA_ID
      ,mf.MOTORFECHA_ID
      ,ROW_NUMBER() OVER (
          PARTITION BY ro.MOTOROFERTA_ID
          ORDER BY mf.DESDE_DT DESC, mf.MOTORFECHA_ID DESC
       ) AS rn
    FROM dbo.MRO_MOTORFECHA mf
    INNER JOIN (
      SELECT DISTINCT MOTOROFERTA_ID, MOTORFECHA_ID
      FROM   dbo.MRO_MOTORREGLA
      WHERE  ISNULL(BORRADO_FL, 0) = 0
    ) ro ON ro.MOTORFECHA_ID = mf.MOTORFECHA_ID
    WHERE mf.TIPO_DS IN ('REGLAS', 'AMBOS')
      AND ISNULL(mf.BORRADO_FL, 0) = 0
      AND mf.DESDE_DT <= @DATE
      AND (mf.HASTA_DT IS NULL OR mf.HASTA_DT > @DATE)
  ),

  -- ------------------------------------------------------------------
  -- mf_params_win: for each MOTOROFERTA_ID, the single most-recent
  -- MRO_MOTORFECHA that covers @DATE and carries params
  -- (TIPO_DS IN ('PARAMS','AMBOS')).
  --
  -- Independent from mf_rules_win: a single offer may take rules from
  -- one MOTORFECHA and params from a different (newer) one.
  -- ------------------------------------------------------------------
  -- Same global-table derivation as mf_rules_win, but the offer<->period
  -- association comes from MRO_MOTORPARAM. Independent winner: an offer may
  -- take rules from one MOTORFECHA and params from a different (newer) one.
  mf_params_win AS (
    SELECT
       po.MOTOROFERTA_ID
      ,mf.MOTORFECHA_ID
      ,ROW_NUMBER() OVER (
          PARTITION BY po.MOTOROFERTA_ID
          ORDER BY mf.DESDE_DT DESC, mf.MOTORFECHA_ID DESC
       ) AS rn
    FROM dbo.MRO_MOTORFECHA mf
    INNER JOIN (
      SELECT DISTINCT MOTOROFERTA_ID, MOTORFECHA_ID
      FROM   dbo.MRO_MOTORPARAM
      WHERE  ISNULL(BORRADO_FL, 0) = 0
    ) po ON po.MOTORFECHA_ID = mf.MOTORFECHA_ID
    WHERE mf.TIPO_DS IN ('PARAMS', 'AMBOS')
      AND ISNULL(mf.BORRADO_FL, 0) = 0
      AND mf.DESDE_DT <= @DATE
      AND (mf.HASTA_DT IS NULL OR mf.HASTA_DT > @DATE)
  ),

  -- ------------------------------------------------------------------
  -- rs: active offers with at least one covering rule period.
  -- Existence check now uses mf_rules_win (rn=1) to avoid the
  -- previous date-only EXISTS scan that could match multiple periods.
  -- ------------------------------------------------------------------
  rs AS (
    SELECT s.MOTOROFERTA_ID
          ,h.OFERTA_ID
          ,h.OFERTA_CD
          ,h.OFERTA_DS
          ,s.OFERTA_RANK_NM
    FROM   dbo.MRO_MOTOROFERTA s
    INNER JOIN dbo.HIPO_OFERTA h ON h.OFERTA_ID = s.OFERTA_ID
    WHERE  ISNULL(s.BORRADO_FL, 0) = 0
      AND  (
             @offer_codes IS NULL OR @offer_codes = '' OR
             EXISTS (SELECT 1 FROM filter_codes f WHERE f.code = h.OFERTA_CD)
           )
      AND  EXISTS (
             -- mf_rules_win already joins non-deleted rules; presence of a
             -- rn=1 winner for this offer means it has an active rule period.
             SELECT 1
             FROM   mf_rules_win win
             WHERE  win.MOTOROFERTA_ID = s.MOTOROFERTA_ID
               AND  win.rn = 1
           )
  ),

  -- ------------------------------------------------------------------
  -- rules: all non-deleted rules from the single winning rule period
  -- per offer (JOIN to mf_rules_win WHERE rn=1).
  -- ------------------------------------------------------------------
  rules AS (
    SELECT r.MOTOROFERTA_ID
          ,r.MOTORREGLA_ID
          ,r.MOTORREGLA_DS
          ,r.PRIORIDAD_NM
          ,r.PARAR_PROCESO_FL
    FROM   dbo.MRO_MOTORREGLA r
    INNER JOIN mf_rules_win win
           ON  win.MOTORFECHA_ID  = r.MOTORFECHA_ID
           AND win.MOTOROFERTA_ID = r.MOTOROFERTA_ID
           AND win.rn = 1
    WHERE  r.MOTOROFERTA_ID IN (SELECT MOTOROFERTA_ID FROM rs)
      AND  ISNULL(r.BORRADO_FL, 0) = 0
  ),

  -- ------------------------------------------------------------------
  -- params: all non-deleted params from the single winning param period
  -- per offer (JOIN to mf_params_win WHERE rn=1).
  -- ------------------------------------------------------------------
  params AS (
    SELECT rs.OFERTA_ID
          ,rs.OFERTA_CD
          ,p.PARAM_KEY_CD
          ,p.TIPO_VALOR_CD
          ,p.VALOR_DS
    FROM   dbo.MRO_MOTORPARAM p
    INNER JOIN rs ON rs.MOTOROFERTA_ID = p.MOTOROFERTA_ID
    INNER JOIN mf_params_win win
           ON  win.MOTORFECHA_ID = p.MOTORFECHA_ID
           AND win.MOTOROFERTA_ID = p.MOTOROFERTA_ID
           AND win.rn = 1
    WHERE  ISNULL(p.BORRADO_FL, 0) = 0
  )

  SELECT
    OFERTAS_JSON =
    (
      SELECT
        rs.OFERTA_ID,
        rs.OFERTA_CD,
        rs.OFERTA_DS,
        rs.OFERTA_RANK_NM,
        REGLAS =
        (
          SELECT
            ru.MOTORREGLA_ID,
            ru.MOTORREGLA_DS,
            ru.PRIORIDAD_NM,
            ru.PARAR_PROCESO_FL,
            CONDICIONES =
            (
              SELECT
                c.MOTORCONDICION_ID,
                c.GRUPO_CONDICION_CD,
                c.CAMPO_CD,
                c.OPERADOR_CD,
                c.TIPO_VALOR_CD,
                c.VALOR1_DS,
                c.VALOR2_DS,
                VALORES_LISTA = JSON_QUERY('[]')
              FROM dbo.MRO_MOTORCONDICION c
              WHERE c.MOTORREGLA_ID = ru.MOTORREGLA_ID
              FOR JSON PATH
            ),
            ACCIONES =
            (
              SELECT
                a.MOTORACCION_ID,
                a.TIPO_ACCION_CD,
                a.CAMPO_CD,
                a.VALOR_DS,
                a.TIPO_VALOR_CD
              FROM dbo.MRO_MOTORACCION a
              WHERE a.MOTORREGLA_ID = ru.MOTORREGLA_ID
              FOR JSON PATH
            )
          FROM rules ru
          WHERE ru.MOTOROFERTA_ID = rs.MOTOROFERTA_ID
          ORDER BY ru.PRIORIDAD_NM DESC, ru.MOTORREGLA_ID ASC
          FOR JSON PATH
        )
      FROM rs
      ORDER BY rs.OFERTA_RANK_NM DESC, rs.OFERTA_CD ASC
      FOR JSON PATH
    ),

    -- ---------------------------------------------------------
    -- PARAMETROS_JSON
    -- Array de { OFERTA_ID, PARAMS: [{PARAM_KEY_CD, TIPO_VALOR_CD, VALOR_DS}] }
    -- El motor construye IndiceParametros desde este array.
    -- ---------------------------------------------------------
    PARAMETROS_JSON =
    (
      SELECT
        p.OFERTA_ID,
        p.OFERTA_CD,
        PARAMS =
        (
          SELECT p2.PARAM_KEY_CD, p2.TIPO_VALOR_CD, p2.VALOR_DS
          FROM params p2
          WHERE p2.OFERTA_CD = p.OFERTA_CD
          FOR JSON PATH
        )
      FROM (SELECT DISTINCT OFERTA_ID, OFERTA_CD FROM params) p
      ORDER BY p.OFERTA_CD
      FOR JSON PATH
    );

END
