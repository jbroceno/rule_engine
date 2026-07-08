USE [OPEN_PRE];
GO
SET NOCOUNT ON;
GO
-- =====================================================================
-- verify_read_sp.sql
-- Harness de verificación para dbo.cfg_get_offers_and_params_json
-- (resolución most-recent-wins POR OFERTA + TIPO_DS).
--
-- Ejecuta los 6 casos del checklist contra ofertas EXISTENTES.
-- TODAS las escrituras ocurren dentro de una transacción y se REVIERTEN
-- (ROLLBACK al final, y también en caso de error) — NO deja rastro en
-- OPEN_PRE.
--
-- Cómo usar: abrir en SSMS contra OPEN_PRE y ejecutar. Ver resultados en
-- la pestaña "Messages" (cada caso imprime PASS/FAIL con los conteos).
--
-- Mecánica:
--   1. Toma 1-2 ofertas reales (MRO_MOTOROFERTA no borradas).
--   2. Marca BORRADO_FL=1 en sus reglas/params reales (se restaura en el
--      ROLLBACK) para que SOLO ganen los periodos sintéticos del test.
--   3. Cada caso limpia las filas sintéticas (id >= @B) del caso anterior,
--      inserta sus fixtures, ejecuta el SP filtrando por OFERTA_CD, y cuenta
--      reglas/params del JSON.
-- =====================================================================

DECLARE @d     DATETIME = '20260101';   -- fecha de evaluación (@DATE)
DECLARE @B     INT      = 2000000000;     -- base ids sintéticos (dentro de rango INT)
DECLARE @moid1 INT, @oid1 INT, @cd1 VARCHAR(100);
DECLARE @moid2 INT, @oid2 INT, @cd2 VARCHAR(100);
DECLARE @ofertas NVARCHAR(MAX), @params NVARCHAR(MAX), @codes VARCHAR(300);
DECLARE @rc1 INT, @pc1 INT, @rc2 INT;
DECLARE @out TABLE (OFERTAS_JSON NVARCHAR(MAX), PARAMETROS_JSON NVARCHAR(MAX));

SELECT TOP 1 @moid1 = s.MOTOROFERTA_ID, @oid1 = s.OFERTA_ID, @cd1 = h.OFERTA_CD
FROM dbo.MRO_MOTOROFERTA s
INNER JOIN dbo.HIPO_OFERTA h ON h.OFERTA_ID = s.OFERTA_ID
WHERE ISNULL(s.BORRADO_FL, 0) = 0
ORDER BY s.MOTOROFERTA_ID;

SELECT TOP 1 @moid2 = s.MOTOROFERTA_ID, @oid2 = s.OFERTA_ID, @cd2 = h.OFERTA_CD
FROM dbo.MRO_MOTOROFERTA s
INNER JOIN dbo.HIPO_OFERTA h ON h.OFERTA_ID = s.OFERTA_ID
WHERE ISNULL(s.BORRADO_FL, 0) = 0 AND s.MOTOROFERTA_ID <> @moid1
ORDER BY s.MOTOROFERTA_ID;

IF @moid1 IS NULL
BEGIN
  PRINT 'ABORT: no hay ofertas (MRO_MOTOROFERTA no borradas) para probar.';
  RETURN;
END;

PRINT 'Oferta test 1: MOTOROFERTA_ID=' + CAST(@moid1 AS VARCHAR) + '  OFERTA_CD=' + @cd1;
IF @moid2 IS NOT NULL
  PRINT 'Oferta test 2: MOTOROFERTA_ID=' + CAST(@moid2 AS VARCHAR) + '  OFERTA_CD=' + @cd2;
ELSE
  PRINT 'AVISO: solo hay 1 oferta; Caso 6 (per-oferta) se omite.';
PRINT '------------------------------------------------------------';

BEGIN TRY
  BEGIN TRAN;

  -- Neutralizar datos reales de las ofertas test (restaurado por el ROLLBACK).
  UPDATE dbo.MRO_MOTORREGLA SET BORRADO_FL = 1 WHERE MOTOROFERTA_ID IN (@moid1, ISNULL(@moid2, -1));
  UPDATE dbo.MRO_MOTORPARAM SET BORRADO_FL = 1 WHERE MOTOROFERTA_ID IN (@moid1, ISNULL(@moid2, -1));

  -- =================== CASO 1 — AMBOS único (3 reglas, 2 params) ===================
  DELETE FROM dbo.MRO_MOTORREGLA WHERE MOTORREGLA_ID >= @B;
  DELETE FROM dbo.MRO_MOTORPARAM WHERE MOTORPARAM_ID >= @B;
  DELETE FROM dbo.MRO_MOTORFECHA WHERE MOTORFECHA_ID >= @B;

  INSERT dbo.MRO_MOTORFECHA (MOTORFECHA_ID, DESDE_DT, HASTA_DT, TIPO_DS, BORRADO_FL)
  VALUES (@B+1, '20250101', NULL, 'AMBOS', 0);
  INSERT dbo.MRO_MOTORREGLA (MOTORREGLA_ID, MOTOROFERTA_ID, MOTORFECHA_ID, MOTORREGLA_DS, PRIORIDAD_NM, PARAR_PROCESO_FL, BORRADO_FL)
  VALUES (@B+1,@moid1,@B+1,'r1',10,0,0),(@B+2,@moid1,@B+1,'r2',20,0,0),(@B+3,@moid1,@B+1,'r3',30,0,0);
  INSERT dbo.MRO_MOTORPARAM (MOTORPARAM_ID, MOTOROFERTA_ID, MOTORFECHA_ID, PARAM_KEY_CD, TIPO_VALOR_CD, VALOR_DS, BORRADO_FL)
  VALUES (@B+1,@moid1,@B+1,'K1','NUMBER','1',0),(@B+2,@moid1,@B+1,'K2','NUMBER','2',0);

  DELETE FROM @out;
  INSERT @out EXEC dbo.cfg_get_offers_and_params_json @offer_codes=@cd1, @DATE=@d;
  SELECT @ofertas=ISNULL(OFERTAS_JSON,'[]'), @params=ISNULL(PARAMETROS_JSON,'[]') FROM @out;
  SELECT @rc1 = COUNT(*) FROM OPENJSON(@ofertas) WITH (cd VARCHAR(100) '$.OFERTA_CD', REGLAS NVARCHAR(MAX) '$.REGLAS' AS JSON) o CROSS APPLY OPENJSON(o.REGLAS) r WHERE o.cd=@cd1;
  SELECT @pc1 = COUNT(*) FROM OPENJSON(@params)  WITH (cd VARCHAR(100) '$.OFERTA_CD', PARAMS NVARCHAR(MAX) '$.PARAMS' AS JSON) o CROSS APPLY OPENJSON(o.PARAMS) p WHERE o.cd=@cd1;
  PRINT 'Caso 1 (AMBOS único)        reglas=' + CAST(@rc1 AS VARCHAR) + ' (esp 3)  params=' + CAST(@pc1 AS VARCHAR) + ' (esp 2)  -> ' + CASE WHEN @rc1=3 AND @pc1=2 THEN 'PASS' ELSE 'FAIL' END;

  -- =================== CASO 2 — AMBOS + PARAMS posterior solapados ===================
  -- reglas ganan en mf1 (AMBOS); params ganan en mf2 (PARAMS, más reciente). Cero duplicados.
  DELETE FROM dbo.MRO_MOTORREGLA WHERE MOTORREGLA_ID >= @B;
  DELETE FROM dbo.MRO_MOTORPARAM WHERE MOTORPARAM_ID >= @B;
  DELETE FROM dbo.MRO_MOTORFECHA WHERE MOTORFECHA_ID >= @B;

  INSERT dbo.MRO_MOTORFECHA (MOTORFECHA_ID, DESDE_DT, HASTA_DT, TIPO_DS, BORRADO_FL)
  VALUES (@B+1, '20250101', NULL, 'AMBOS', 0),   -- mf1
         (@B+2, '20250601', NULL, 'PARAMS', 0);  -- mf2 (más reciente, solo params)
  INSERT dbo.MRO_MOTORREGLA (MOTORREGLA_ID, MOTOROFERTA_ID, MOTORFECHA_ID, MOTORREGLA_DS, PRIORIDAD_NM, PARAR_PROCESO_FL, BORRADO_FL)
  VALUES (@B+1,@moid1,@B+1,'r1',10,0,0),(@B+2,@moid1,@B+1,'r2',20,0,0),(@B+3,@moid1,@B+1,'r3',30,0,0);
  INSERT dbo.MRO_MOTORPARAM (MOTORPARAM_ID, MOTOROFERTA_ID, MOTORFECHA_ID, PARAM_KEY_CD, TIPO_VALOR_CD, VALOR_DS, BORRADO_FL)
  VALUES (@B+1,@moid1,@B+1,'K1','NUMBER','1',0),(@B+2,@moid1,@B+1,'K2','NUMBER','2',0),         -- params de mf1 (NO deben ganar)
         (@B+3,@moid1,@B+2,'P1','NUMBER','1',0),(@B+4,@moid1,@B+2,'P2','NUMBER','2',0),(@B+5,@moid1,@B+2,'P3','NUMBER','3',0); -- mf2 (ganan: 3)

  DELETE FROM @out;
  INSERT @out EXEC dbo.cfg_get_offers_and_params_json @offer_codes=@cd1, @DATE=@d;
  SELECT @ofertas=ISNULL(OFERTAS_JSON,'[]'), @params=ISNULL(PARAMETROS_JSON,'[]') FROM @out;
  SELECT @rc1 = COUNT(*) FROM OPENJSON(@ofertas) WITH (cd VARCHAR(100) '$.OFERTA_CD', REGLAS NVARCHAR(MAX) '$.REGLAS' AS JSON) o CROSS APPLY OPENJSON(o.REGLAS) r WHERE o.cd=@cd1;
  SELECT @pc1 = COUNT(*) FROM OPENJSON(@params)  WITH (cd VARCHAR(100) '$.OFERTA_CD', PARAMS NVARCHAR(MAX) '$.PARAMS' AS JSON) o CROSS APPLY OPENJSON(o.PARAMS) p WHERE o.cd=@cd1;
  PRINT 'Caso 2 (AMBOS+PARAMS solap.) reglas=' + CAST(@rc1 AS VARCHAR) + ' (esp 3)  params=' + CAST(@pc1 AS VARCHAR) + ' (esp 3, no 2 ni 5)  -> ' + CASE WHEN @rc1=3 AND @pc1=3 THEN 'PASS' ELSE 'FAIL' END;

  -- =================== CASO 3 — Sin periodo cubriendo la fecha ===================
  DELETE FROM dbo.MRO_MOTORREGLA WHERE MOTORREGLA_ID >= @B;
  DELETE FROM dbo.MRO_MOTORPARAM WHERE MOTORPARAM_ID >= @B;
  DELETE FROM dbo.MRO_MOTORFECHA WHERE MOTORFECHA_ID >= @B;

  INSERT dbo.MRO_MOTORFECHA (MOTORFECHA_ID, DESDE_DT, HASTA_DT, TIPO_DS, BORRADO_FL)
  VALUES (@B+1, '20300101', NULL, 'AMBOS', 0);  -- futuro respecto de @DATE
  INSERT dbo.MRO_MOTORREGLA (MOTORREGLA_ID, MOTOROFERTA_ID, MOTORFECHA_ID, MOTORREGLA_DS, PRIORIDAD_NM, PARAR_PROCESO_FL, BORRADO_FL)
  VALUES (@B+1,@moid1,@B+1,'r1',10,0,0),(@B+2,@moid1,@B+1,'r2',20,0,0);

  DELETE FROM @out;
  INSERT @out EXEC dbo.cfg_get_offers_and_params_json @offer_codes=@cd1, @DATE=@d;
  SELECT @ofertas=ISNULL(OFERTAS_JSON,'[]'), @params=ISNULL(PARAMETROS_JSON,'[]') FROM @out;
  SELECT @rc1 = COUNT(*) FROM OPENJSON(@ofertas) WITH (cd VARCHAR(100) '$.OFERTA_CD', REGLAS NVARCHAR(MAX) '$.REGLAS' AS JSON) o CROSS APPLY OPENJSON(o.REGLAS) r WHERE o.cd=@cd1;
  PRINT 'Caso 3 (fuera de vigencia)  reglas=' + CAST(@rc1 AS VARCHAR) + ' (esp 0, oferta ausente)  -> ' + CASE WHEN @rc1=0 THEN 'PASS' ELSE 'FAIL' END;

  -- =================== CASO 4 — Empate DESDE_DT: gana mayor MOTORFECHA_ID ===================
  DELETE FROM dbo.MRO_MOTORREGLA WHERE MOTORREGLA_ID >= @B;
  DELETE FROM dbo.MRO_MOTORPARAM WHERE MOTORPARAM_ID >= @B;
  DELETE FROM dbo.MRO_MOTORFECHA WHERE MOTORFECHA_ID >= @B;

  INSERT dbo.MRO_MOTORFECHA (MOTORFECHA_ID, DESDE_DT, HASTA_DT, TIPO_DS, BORRADO_FL)
  VALUES (@B+1, '20250101', NULL, 'AMBOS', 0),   -- id menor: 2 reglas
         (@B+2, '20250101', NULL, 'AMBOS', 0);   -- id mayor: 3 reglas (debe ganar)
  INSERT dbo.MRO_MOTORREGLA (MOTORREGLA_ID, MOTOROFERTA_ID, MOTORFECHA_ID, MOTORREGLA_DS, PRIORIDAD_NM, PARAR_PROCESO_FL, BORRADO_FL)
  VALUES (@B+1,@moid1,@B+1,'a1',10,0,0),(@B+2,@moid1,@B+1,'a2',20,0,0),
         (@B+3,@moid1,@B+2,'b1',10,0,0),(@B+4,@moid1,@B+2,'b2',20,0,0),(@B+5,@moid1,@B+2,'b3',30,0,0);

  DELETE FROM @out;
  INSERT @out EXEC dbo.cfg_get_offers_and_params_json @offer_codes=@cd1, @DATE=@d;
  SELECT @ofertas=ISNULL(OFERTAS_JSON,'[]') FROM @out;
  SELECT @rc1 = COUNT(*) FROM OPENJSON(@ofertas) WITH (cd VARCHAR(100) '$.OFERTA_CD', REGLAS NVARCHAR(MAX) '$.REGLAS' AS JSON) o CROSS APPLY OPENJSON(o.REGLAS) r WHERE o.cd=@cd1;
  PRINT 'Caso 4 (empate -> id mayor) reglas=' + CAST(@rc1 AS VARCHAR) + ' (esp 3, no 5)  -> ' + CASE WHEN @rc1=3 THEN 'PASS' ELSE 'FAIL' END;

  -- =================== CASO 5 — TIPO_DS=REGLAS: params no aparecen ===================
  DELETE FROM dbo.MRO_MOTORREGLA WHERE MOTORREGLA_ID >= @B;
  DELETE FROM dbo.MRO_MOTORPARAM WHERE MOTORPARAM_ID >= @B;
  DELETE FROM dbo.MRO_MOTORFECHA WHERE MOTORFECHA_ID >= @B;

  INSERT dbo.MRO_MOTORFECHA (MOTORFECHA_ID, DESDE_DT, HASTA_DT, TIPO_DS, BORRADO_FL)
  VALUES (@B+1, '20250101', NULL, 'REGLAS', 0);
  INSERT dbo.MRO_MOTORREGLA (MOTORREGLA_ID, MOTOROFERTA_ID, MOTORFECHA_ID, MOTORREGLA_DS, PRIORIDAD_NM, PARAR_PROCESO_FL, BORRADO_FL)
  VALUES (@B+1,@moid1,@B+1,'r1',10,0,0),(@B+2,@moid1,@B+1,'r2',20,0,0);

  DELETE FROM @out;
  INSERT @out EXEC dbo.cfg_get_offers_and_params_json @offer_codes=@cd1, @DATE=@d;
  SELECT @ofertas=ISNULL(OFERTAS_JSON,'[]'), @params=ISNULL(PARAMETROS_JSON,'[]') FROM @out;
  SELECT @rc1 = COUNT(*) FROM OPENJSON(@ofertas) WITH (cd VARCHAR(100) '$.OFERTA_CD', REGLAS NVARCHAR(MAX) '$.REGLAS' AS JSON) o CROSS APPLY OPENJSON(o.REGLAS) r WHERE o.cd=@cd1;
  SELECT @pc1 = COUNT(*) FROM OPENJSON(@params)  WITH (cd VARCHAR(100) '$.OFERTA_CD', PARAMS NVARCHAR(MAX) '$.PARAMS' AS JSON) o CROSS APPLY OPENJSON(o.PARAMS) p WHERE o.cd=@cd1;
  PRINT 'Caso 5 (TIPO_DS=REGLAS)     reglas=' + CAST(@rc1 AS VARCHAR) + ' (esp 2)  params=' + CAST(@pc1 AS VARCHAR) + ' (esp 0)  -> ' + CASE WHEN @rc1=2 AND @pc1=0 THEN 'PASS' ELSE 'FAIL' END;

  -- =================== CASO 6 — Per-oferta: ofertas en periodos distintos ===================
  IF @moid2 IS NOT NULL
  BEGIN
    DELETE FROM dbo.MRO_MOTORREGLA WHERE MOTORREGLA_ID >= @B;
    DELETE FROM dbo.MRO_MOTORPARAM WHERE MOTORPARAM_ID >= @B;
    DELETE FROM dbo.MRO_MOTORFECHA WHERE MOTORFECHA_ID >= @B;

    INSERT dbo.MRO_MOTORFECHA (MOTORFECHA_ID, DESDE_DT, HASTA_DT, TIPO_DS, BORRADO_FL)
    VALUES (@B+1, '20250101', NULL, 'AMBOS', 0),   -- periodo de oferta 1
           (@B+2, '20250601', NULL, 'AMBOS', 0);   -- periodo (más reciente) de oferta 2
    INSERT dbo.MRO_MOTORREGLA (MOTORREGLA_ID, MOTOROFERTA_ID, MOTORFECHA_ID, MOTORREGLA_DS, PRIORIDAD_NM, PARAR_PROCESO_FL, BORRADO_FL)
    VALUES (@B+1,@moid1,@B+1,'o1r1',10,0,0),(@B+2,@moid1,@B+1,'o1r2',20,0,0),                       -- oferta1: 2 reglas en mf1
           (@B+3,@moid2,@B+2,'o2r1',10,0,0),(@B+4,@moid2,@B+2,'o2r2',20,0,0),(@B+5,@moid2,@B+2,'o2r3',30,0,0); -- oferta2: 3 reglas en mf2

    SET @codes = @cd1 + ',' + @cd2;
    DELETE FROM @out;
    INSERT @out EXEC dbo.cfg_get_offers_and_params_json @offer_codes=@codes, @DATE=@d;
    SELECT @ofertas=ISNULL(OFERTAS_JSON,'[]') FROM @out;
    SELECT @rc1 = COUNT(*) FROM OPENJSON(@ofertas) WITH (cd VARCHAR(100) '$.OFERTA_CD', REGLAS NVARCHAR(MAX) '$.REGLAS' AS JSON) o CROSS APPLY OPENJSON(o.REGLAS) r WHERE o.cd=@cd1;
    SELECT @rc2 = COUNT(*) FROM OPENJSON(@ofertas) WITH (cd VARCHAR(100) '$.OFERTA_CD', REGLAS NVARCHAR(MAX) '$.REGLAS' AS JSON) o CROSS APPLY OPENJSON(o.REGLAS) r WHERE o.cd=@cd2;
    PRINT 'Caso 6 (per-oferta)         oferta1 reglas=' + CAST(@rc1 AS VARCHAR) + ' (esp 2)  oferta2 reglas=' + CAST(@rc2 AS VARCHAR) + ' (esp 3)  -> ' + CASE WHEN @rc1=2 AND @rc2=3 THEN 'PASS (ninguna descartada)' ELSE 'FAIL' END;
  END;

  PRINT '------------------------------------------------------------';
  ROLLBACK TRAN;   -- deshace neutralización + TODOS los fixtures sintéticos
  PRINT 'ROLLBACK OK — base sin cambios.';
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRAN;
  PRINT 'ERROR: ' + ERROR_MESSAGE() + '  (línea ' + CAST(ERROR_LINE() AS VARCHAR) + ')';
  PRINT 'Transacción revertida — base sin cambios.';
END CATCH;
GO
