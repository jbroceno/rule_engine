USE [OPEN_PRE]
GO
/****** Object:  StoredProcedure [dbo].[cfg_get_rules_json]    Script Date: 02/06/26 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- ============================================================
-- 2. SP DE FALLBACK
--    Usado si cfg_get_offers_and_params_json no esta disponible.
--    Diferencias respecto al SP principal:
--      - Fecha fija: GETDATE() -- no permite evaluacion historica
--      - Devuelve una sola columna: REGLAS_JSON
--      - SI lee MRO_MOTORCONDICIONVALOR y construye VALORES_LISTA
--
--    Estructura de REGLAS_JSON:
--      { "OFERTAS": [ { OFERTA_ID, OFERTA_RANK_NM, REGLAS:[...] } ],
--        "PARAMETROS": [ { OFERTA_ID, PARAMS:[{PARAM_KEY_CD, TIPO_VALOR_CD, VALOR_DS}] } ] }
--
-- SCOPE NOTE (mro-snapshot-deploy, 2026-06-02):
--    Este SP es un fallback de solo lectura para entornos donde el SP
--    principal no esta disponible. NO implementa most-recent-wins ni
--    filtrado por TIPO_DS. Devuelve TODAS las reglas y params activas
--    (BORRADO_FL=0) para la fecha actual independientemente del periodo.
--
--    LIMITACIONES conocidas (no corregidas en este PR, fuera de scope):
--      - No filtra por MOTORFECHA: puede devolver reglas/params de
--        multiples periodos solapados si existen.
--      - No distingue TIPO_DS (REGLAS/PARAMS/AMBOS).
--      - Solo usa GETDATE() -- sin soporte de evaluacion historica.
--
--    USO RECOMENDADO: solo en desarrollo/local donde el SP principal
--    no esta desplegado. En produccion, siempre usar
--    cfg_get_offers_and_params_json.
--
--    VIGENCIA_* COLUMNS (limpieza):
--      Las lineas comentadas con VIGENCIA_DESDE_DT/VIGENCIA_HASTA_DT
--      han sido eliminadas. Esas columnas NO existen en
--      MRO_MOTORREGLA ni MRO_MOTORPARAM -- su presencia era codigo
--      muerto de un modelo anterior. Confirmado en grounding discovery
--      del diseno mro-snapshot-deploy.
-- ============================================================
ALTER   PROCEDURE [dbo].[cfg_get_rules_json]
  @offer_codes NVARCHAR(MAX) = NULL
AS
BEGIN
  SET NOCOUNT ON;

  ;WITH filter_codes AS (
    SELECT LTRIM(RTRIM(t.c.value('.', 'NVARCHAR(100)'))) AS code
    FROM   (SELECT CAST('<v>' + REPLACE(ISNULL(@offer_codes,''),',','</v><v>') + '</v>' AS XML)) AS s(x)
    CROSS APPLY s.x.nodes('v') AS t(c)
    WHERE  LTRIM(RTRIM(t.c.value('.', 'NVARCHAR(100)'))) <> ''
  ),
  rs AS (
    SELECT s.MOTOROFERTA_ID
          ,h.OFERTA_ID
          ,h.OFERTA_CD
          ,s.OFERTA_RANK_NM
    FROM   dbo.MRO_MOTOROFERTA s
    INNER JOIN dbo.HIPO_OFERTA h ON h.OFERTA_ID = s.OFERTA_ID
    WHERE  ISNULL(s.BORRADO_FL, 0) = 0
      AND  (
             @offer_codes IS NULL OR @offer_codes = '' OR
             EXISTS (SELECT 1 FROM filter_codes f WHERE f.code = h.OFERTA_CD)
           )
  )
  SELECT REGLAS_JSON =
  (
    SELECT
      OFERTAS = JSON_QUERY(
        (
          SELECT
            rs.OFERTA_ID,
            rs.OFERTA_CD,
            rs.OFERTA_RANK_NM,
            REGLAS = JSON_QUERY(
              (
                SELECT
                  r.MOTORREGLA_ID,
                  r.MOTORREGLA_DS,
                  r.PRIORIDAD_NM,
                  r.PARAR_PROCESO_FL,
                  CONDICIONES = JSON_QUERY(
                    (
                      SELECT
                        c.MOTORCONDICION_ID,
                        c.GRUPO_CONDICION_CD,
                        c.CAMPO_CD,
                        c.OPERADOR_CD,
                        c.TIPO_VALOR_CD,
                        c.VALOR1_DS,
                        c.VALOR2_DS,
                        VALORES_LISTA = JSON_QUERY(
                          ISNULL(
                            '[' + STUFF(
                              ISNULL(
                                (SELECT ',"' + STRING_ESCAPE(cv.VALOR_DS, 'json') + '"'
                                 FROM   dbo.MRO_MOTORCONDICIONVALOR AS cv
                                 WHERE  cv.MOTORCONDICION_ID = c.MOTORCONDICION_ID
                                 ORDER BY cv.MOTORCONDICIONVALOR_ID
                                 FOR XML PATH(''), TYPE
                                ).value('.', 'NVARCHAR(MAX)'),
                                ''
                              ), 1, 1, '') + ']',
                            '[]'
                          )
                        )
                      FROM dbo.MRO_MOTORCONDICION AS c
                      WHERE c.MOTORREGLA_ID = r.MOTORREGLA_ID
                      FOR JSON PATH
                    )
                  ),
                  ACCIONES = JSON_QUERY(
                    (
                      SELECT
                        a.MOTORACCION_ID,
                        a.TIPO_ACCION_CD,
                        a.CAMPO_CD,
                        a.VALOR_DS,
                        a.TIPO_VALOR_CD
                      FROM dbo.MRO_MOTORACCION AS a
                      WHERE a.MOTORREGLA_ID = r.MOTORREGLA_ID
                      FOR JSON PATH
                    )
                  )
                FROM dbo.MRO_MOTORREGLA AS r
                WHERE r.MOTOROFERTA_ID   = rs.MOTOROFERTA_ID
                  AND ISNULL(r.BORRADO_FL, 0) = 0
                ORDER BY r.PRIORIDAD_NM DESC, r.MOTORREGLA_ID ASC
                FOR JSON PATH
              )
            )
          FROM rs
          ORDER BY rs.OFERTA_RANK_NM DESC, rs.OFERTA_CD ASC
          FOR JSON PATH
        )
      ),
      PARAMETROS = JSON_QUERY(
        (
          SELECT
            p.OFERTA_ID,
            p.OFERTA_CD,
            PARAMS = JSON_QUERY(
              (
                SELECT p2.PARAM_KEY_CD, p2.TIPO_VALOR_CD, p2.VALOR_DS
                FROM dbo.MRO_MOTORPARAM p2
                WHERE p2.MOTOROFERTA_ID  = p.MOTOROFERTA_ID
                  AND ISNULL(p2.BORRADO_FL, 0) = 0
                FOR JSON PATH
              )
            )
          FROM (
            SELECT DISTINCT rs2.MOTOROFERTA_ID, rs2.OFERTA_ID, rs2.OFERTA_CD
            FROM   dbo.MRO_MOTORPARAM op
            INNER JOIN rs rs2 ON rs2.MOTOROFERTA_ID = op.MOTOROFERTA_ID
            WHERE  ISNULL(op.BORRADO_FL, 0) = 0
          ) AS p
          ORDER BY p.OFERTA_CD
          FOR JSON PATH
        )
      )
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
  );
END
