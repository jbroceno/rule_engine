-- =============================================================================
-- SP cfg_get_offers_and_params_json_cached  (shim para el demo / POC)
--
-- La API llama primero a dbo.cfg_get_offers_and_params_json_cached y, si no
-- existe, cae a dbo.cfg_get_rules_json (ver api/services/config_service.js).
-- El SP "_cached" real vive en el despliegue de Workflow y depende de tablas
-- de caché que no se montan en el demo. Este wrapper expone la misma firma
-- (@offer_codes, @DATE, @max_history_size) delegando en el SP base, de modo
-- que la ruta primaria de la API resuelve sin la maquinaria de caché de WF.
-- =============================================================================
CREATE OR ALTER PROCEDURE dbo.cfg_get_offers_and_params_json_cached
  @offer_codes      NVARCHAR(MAX) = NULL,
  @DATE             DATETIME      = NULL,
  @max_history_size INT           = 50
AS
BEGIN
  SET NOCOUNT ON;
  IF @DATE IS NULL SET @DATE = GETDATE();
  EXEC dbo.cfg_get_offers_and_params_json @offer_codes = @offer_codes, @DATE = @DATE;
END
GO
