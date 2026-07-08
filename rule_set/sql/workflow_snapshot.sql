-- SP que exporta las tablas MRO_ de Workflow a JSON.
-- Usado por la API para generar snapshots de entorno WF.
--
-- MIGRATION PR2a (mro-snapshot-deploy):
--   Validity is now sourced from MRO_MOTORFECHA via MOTORFECHA_ID JOIN.
--   MRO_MOTORREGLA and MRO_MOTORPARAM have NO inline VIGENCIA_DESDE_DT /
--   VIGENCIA_HASTA_DT columns — those never existed in the real schema.
--   The SP signature (@VIGENCIA_DESDE / @VIGENCIA_HASTA) is preserved for
--   backward compatibility with createWorkflowSnapshot in admin_workflow_service.js.
--   Filtering is now applied against mf.DESDE_DT / mf.HASTA_DT.
--   Output field names VIGENCIA_DESDE_DT / VIGENCIA_HASTA_DT are kept stable
--   (aliased from mf.DESDE_DT / mf.HASTA_DT) so the JS payload shape is unchanged.
--
-- @VIGENCIA_DESDE DATETIME2(0) = NULL : if provided, filters to periods where mf.DESDE_DT = @VIGENCIA_DESDE (exact second)
-- @VIGENCIA_HASTA DATETIME2(0) = NULL : if provided, filters to periods where mf.HASTA_DT = @VIGENCIA_HASTA (exact second)
-- If both are NULL, all MRO_ rows are exported (full WF dump).
--
-- LIVE-DB VERIFICATION CHECKLIST (run against SQL Server before deploying to prod):
--   1. Execute with @VIGENCIA_DESDE = <known mf.DESDE_DT>, @VIGENCIA_HASTA = <known mf.HASTA_DT>;
--      assert reglas and params are returned with VIGENCIA_DESDE_DT / VIGENCIA_HASTA_DT matching
--      those values.
--   2. Execute with both params NULL; assert all current MRO_ rows are returned.
--   3. Execute with a MOTORFECHA that has TIPO_DS = 'REGLAS'; assert params array is
--      empty (no MRO_MOTORPARAM linked to that MOTORFECHA_ID).
--   4. Execute with a MOTORFECHA that has TIPO_DS = 'PARAMS'; assert reglas array is
--      empty (no MRO_MOTORREGLA linked to that MOTORFECHA_ID).
--   5. Execute with a MOTORFECHA that has TIPO_DS = 'AMBOS'; assert both arrays are
--      populated with matching VIGENCIA_DESDE_DT / VIGENCIA_HASTA_DT.
--   6. Execute with @VIGENCIA_DESDE matching a date that exists in MRO_MOTORFECHA.DESDE_DT;
--      confirm no rows appear from other periods (cross-period isolation).
--   7. Confirm restoreSnapshot on the resulting snapshot JSON succeeds end-to-end (POC insert).

CREATE OR ALTER PROCEDURE dbo.cfg_get_workflow_snapshot_json
  @VIGENCIA_DESDE DATETIME2(0) = NULL,
  @VIGENCIA_HASTA DATETIME2(0) = NULL
AS
BEGIN
  SET NOCOUNT ON;

  SELECT snapshot_json =
  (
    SELECT
      ofertas = JSON_QUERY(
        (
          SELECT
            o.OFERTA_ID,
            ofe.OFERTA_CD,
            o.OFERTA_RANK_NM
          FROM dbo.MRO_MOTOROFERTA o
            INNER JOIN dbo.HIPO_OFERTA ofe ON ofe.OFERTA_ID = o.OFERTA_ID
          FOR JSON PATH
        )
      ),
      reglas = JSON_QUERY(
        (
          SELECT
            r.MOTORREGLA_ID as REGLA_ID,
            mo.OFERTA_ID,
            ofe.OFERTA_CD,
            r.MOTORREGLA_DS as NOMBRE_REGLA_TXT,
            r.PRIORIDAD_NM,
            mf.DESDE_DT    as VIGENCIA_DESDE_DT,
            mf.HASTA_DT    as VIGENCIA_HASTA_DT,
            mf.TIPO_DS,
            r.PARAR_PROCESO_FL as STOP_PROCESSING_CD,
            condiciones = JSON_QUERY(
              (
                SELECT
                  c.MOTORCONDICION_ID as CONDICION_ID,
                  c.GRUPO_CONDICION_CD as GRUPO_ID,
                  c.CAMPO_CD as CAMPO_TXT,
                  c.OPERADOR_CD as OPERADOR_TXT,
                  c.TIPO_VALOR_CD as TIPO_VALOR_TXT,
                  c.VALOR1_DS as VALOR1_TXT,
                  c.VALOR2_DS as VALOR2_TEXT,
                  valores = JSON_QUERY(
                    (
                      SELECT cv.VALOR_DS as VALOR_TXT
                      FROM dbo.MRO_MOTORCONDICIONVALOR cv
                      WHERE cv.MOTORCONDICION_ID = c.MOTORCONDICION_ID
                      FOR JSON PATH
                    )
                  )
                FROM dbo.MRO_MOTORCONDICION c
                WHERE c.MOTORREGLA_ID = r.MOTORREGLA_ID
                FOR JSON PATH
              )
            ),
            acciones = JSON_QUERY(
              (
                SELECT
                  a.MOTORACCION_ID,
                  a.TIPO_ACCION_CD as TIPO_ACCION_TXT,
                  a.CAMPO_CD as CAMPO_TXT,
                  a.VALOR_DS as VALOR_TXT,
                  a.TIPO_VALOR_CD as TIPO_VALOR_TXT
                FROM dbo.MRO_MOTORACCION a
                WHERE a.MOTORREGLA_ID = r.MOTORREGLA_ID
                FOR JSON PATH
              )
            )
          FROM dbo.MRO_MOTORREGLA r
            INNER JOIN dbo.MRO_MOTORFECHA mf ON mf.MOTORFECHA_ID = r.MOTORFECHA_ID
            INNER JOIN dbo.MRO_MOTOROFERTA mo ON mo.MOTOROFERTA_ID = r.MOTOROFERTA_ID
            INNER JOIN dbo.HIPO_OFERTA ofe ON ofe.OFERTA_ID = mo.OFERTA_ID
          WHERE (@VIGENCIA_DESDE IS NULL OR mf.DESDE_DT = @VIGENCIA_DESDE)
            AND (@VIGENCIA_HASTA IS NULL OR mf.HASTA_DT = @VIGENCIA_HASTA)
          FOR JSON PATH
        )
      ),
      params = JSON_QUERY(
        (
          SELECT
            p.MOTORPARAM_ID as PARAM_ID,
            mo.OFERTA_ID,
            p.PARAM_KEY_CD as PARAM_KEY_TXT,
            p.TIPO_VALOR_CD as TIPO_VALOR_TXT,
            p.VALOR_DS as VALOR_TXT,
            mf.DESDE_DT    as VIGENCIA_DESDE_DT,
            mf.HASTA_DT    as VIGENCIA_HASTA_DT,
            mf.TIPO_DS
          FROM dbo.MRO_MOTORPARAM p
            INNER JOIN dbo.MRO_MOTORFECHA mf ON mf.MOTORFECHA_ID = p.MOTORFECHA_ID
            INNER JOIN dbo.MRO_MOTOROFERTA mo ON mo.MOTOROFERTA_ID = p.MOTOROFERTA_ID
          WHERE (@VIGENCIA_DESDE IS NULL OR mf.DESDE_DT = @VIGENCIA_DESDE)
            AND (@VIGENCIA_HASTA IS NULL OR mf.HASTA_DT = @VIGENCIA_HASTA)
          FOR JSON PATH
        )
      )
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
  );
END
GO
