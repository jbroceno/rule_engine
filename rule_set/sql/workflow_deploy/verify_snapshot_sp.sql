USE [OPEN_PRE];
GO
SET NOCOUNT ON;
GO
-- =====================================================================
-- verify_snapshot_sp.sql
-- Harness de verificación para dbo.cfg_get_workflow_snapshot_json
-- (SP de snapshot WF migrado a MOTORFECHA_ID en PR2a).
--
-- Cubre los casos 1-6 del checklist embebido en workflow_snapshot.sql.
-- El caso 7 (restoreSnapshot end-to-end) es de capa API (JS), NO se puede
-- verificar con SQL puro → fuera de alcance de este harness.
--
-- TODAS las escrituras ocurren dentro de una transacción y se REVIERTEN
-- (ROLLBACK al final y ante error) — NO deja rastro en OPEN_PRE.
--
-- Mecánica: este SP filtra por mf.DESDE_DT / mf.HASTA_DT EXACTOS y vuelca
-- todas las ofertas (no hace most-recent ni filtra por oferta). Por eso
-- usamos fechas CENTINELA futuras únicas (2099-...) para aislar cada caso:
-- al consultar con esa fecha, solo vuelven las filas sintéticas del test.
-- No hace falta neutralizar datos reales.
--
-- Uso: abrir en SSMS contra OPEN_PRE, ejecutar (F5), leer la pestaña Messages.
-- =====================================================================

DECLARE @B     INT = 2000000000;     -- base ids sintéticos (rango INT)
DECLARE @moid1 INT, @oid1 INT, @cd1 VARCHAR(100);
DECLARE @json  NVARCHAR(MAX);
DECLARE @rc INT, @pc INT, @found INT;
DECLARE @vd VARCHAR(40), @vh VARCHAR(40), @tp VARCHAR(20);
DECLARE @out TABLE (snapshot_json NVARCHAR(MAX));

SELECT TOP 1 @moid1 = s.MOTOROFERTA_ID, @oid1 = s.OFERTA_ID, @cd1 = h.OFERTA_CD
FROM dbo.MRO_MOTOROFERTA s
INNER JOIN dbo.HIPO_OFERTA h ON h.OFERTA_ID = s.OFERTA_ID
WHERE ISNULL(s.BORRADO_FL, 0) = 0
ORDER BY s.MOTOROFERTA_ID;

IF @moid1 IS NULL
BEGIN
  PRINT 'ABORT: no hay ofertas (MRO_MOTOROFERTA no borradas) para probar.';
  RETURN;
END;

PRINT 'Oferta test: MOTOROFERTA_ID=' + CAST(@moid1 AS VARCHAR) + '  OFERTA_CD=' + @cd1;
PRINT 'Fechas centinela 2099-* (no deben existir en MRO_MOTORFECHA real).';
PRINT '------------------------------------------------------------';

BEGIN TRY
  BEGIN TRAN;

  -- =========== CASO 1+5 — AMBOS: ambos arrays + alias de fechas estables ===========
  DELETE FROM dbo.MRO_MOTORREGLA WHERE MOTORREGLA_ID >= @B;
  DELETE FROM dbo.MRO_MOTORPARAM WHERE MOTORPARAM_ID >= @B;
  DELETE FROM dbo.MRO_MOTORFECHA WHERE MOTORFECHA_ID >= @B;

  INSERT dbo.MRO_MOTORFECHA (MOTORFECHA_ID, DESDE_DT, HASTA_DT, TIPO_DS, BORRADO_FL)
  VALUES (@B+1, '20990101', '20991231', 'AMBOS', 0);
  INSERT dbo.MRO_MOTORREGLA (MOTORREGLA_ID, MOTOROFERTA_ID, MOTORFECHA_ID, MOTORREGLA_DS, PRIORIDAD_NM, PARAR_PROCESO_FL, BORRADO_FL)
  VALUES (@B+1,@moid1,@B+1,'r1',10,0,0),(@B+2,@moid1,@B+1,'r2',20,0,0),(@B+3,@moid1,@B+1,'r3',30,0,0);
  INSERT dbo.MRO_MOTORPARAM (MOTORPARAM_ID, MOTOROFERTA_ID, MOTORFECHA_ID, PARAM_KEY_CD, TIPO_VALOR_CD, VALOR_DS, BORRADO_FL)
  VALUES (@B+1,@moid1,@B+1,'K1','NUMBER','1',0),(@B+2,@moid1,@B+1,'K2','NUMBER','2',0);

  DELETE FROM @out;
  INSERT @out EXEC dbo.cfg_get_workflow_snapshot_json @VIGENCIA_DESDE='2099-01-01', @VIGENCIA_HASTA='2099-12-31';
  SELECT @json = ISNULL(snapshot_json, '{}') FROM @out;

  SELECT @rc = COUNT(*) FROM OPENJSON(@json, '$.reglas') WITH (rid INT '$.REGLA_ID') WHERE rid >= @B;
  SELECT @pc = COUNT(*) FROM OPENJSON(@json, '$.params') WITH (pid INT '$.PARAM_ID') WHERE pid >= @B;
  SELECT @vd = LEFT(JSON_VALUE(@json, '$.reglas[0].VIGENCIA_DESDE_DT'),10),
         @vh = LEFT(JSON_VALUE(@json, '$.reglas[0].VIGENCIA_HASTA_DT'),10),
         @tp = JSON_VALUE(@json, '$.reglas[0].TIPO_DS');
  PRINT 'Caso 1+5 (AMBOS)     reglas=' + CAST(@rc AS VARCHAR) + ' (esp 3)  params=' + CAST(@pc AS VARCHAR) + ' (esp 2)  VIG_DESDE=' + ISNULL(@vd,'NULL') + ' (esp 2099-01-01)  VIG_HASTA=' + ISNULL(@vh,'NULL') + ' (esp 2099-12-31)  TIPO_DS=' + ISNULL(@tp,'NULL')
        + '  -> ' + CASE WHEN @rc=3 AND @pc=2 AND @vd='2099-01-01' AND @vh='2099-12-31' AND @tp='AMBOS' THEN 'PASS' ELSE 'FAIL' END;

  -- =========== CASO 3 — TIPO_DS=REGLAS: params vacío ===========
  DELETE FROM dbo.MRO_MOTORREGLA WHERE MOTORREGLA_ID >= @B;
  DELETE FROM dbo.MRO_MOTORPARAM WHERE MOTORPARAM_ID >= @B;
  DELETE FROM dbo.MRO_MOTORFECHA WHERE MOTORFECHA_ID >= @B;

  INSERT dbo.MRO_MOTORFECHA (MOTORFECHA_ID, DESDE_DT, HASTA_DT, TIPO_DS, BORRADO_FL)
  VALUES (@B+1, '20990201', NULL, 'REGLAS', 0);
  INSERT dbo.MRO_MOTORREGLA (MOTORREGLA_ID, MOTOROFERTA_ID, MOTORFECHA_ID, MOTORREGLA_DS, PRIORIDAD_NM, PARAR_PROCESO_FL, BORRADO_FL)
  VALUES (@B+1,@moid1,@B+1,'r1',10,0,0),(@B+2,@moid1,@B+1,'r2',20,0,0);

  DELETE FROM @out;
  INSERT @out EXEC dbo.cfg_get_workflow_snapshot_json @VIGENCIA_DESDE='2099-02-01';
  SELECT @json = ISNULL(snapshot_json, '{}') FROM @out;
  SELECT @rc = COUNT(*) FROM OPENJSON(@json, '$.reglas') WITH (rid INT '$.REGLA_ID') WHERE rid >= @B;
  SELECT @pc = COUNT(*) FROM OPENJSON(@json, '$.params') WITH (pid INT '$.PARAM_ID') WHERE pid >= @B;
  PRINT 'Caso 3 (TIPO=REGLAS) reglas=' + CAST(@rc AS VARCHAR) + ' (esp 2)  params=' + CAST(@pc AS VARCHAR) + ' (esp 0)  -> ' + CASE WHEN @rc=2 AND @pc=0 THEN 'PASS' ELSE 'FAIL' END;

  -- =========== CASO 4 — TIPO_DS=PARAMS: reglas vacío ===========
  DELETE FROM dbo.MRO_MOTORREGLA WHERE MOTORREGLA_ID >= @B;
  DELETE FROM dbo.MRO_MOTORPARAM WHERE MOTORPARAM_ID >= @B;
  DELETE FROM dbo.MRO_MOTORFECHA WHERE MOTORFECHA_ID >= @B;

  INSERT dbo.MRO_MOTORFECHA (MOTORFECHA_ID, DESDE_DT, HASTA_DT, TIPO_DS, BORRADO_FL)
  VALUES (@B+1, '20990301', NULL, 'PARAMS', 0);
  INSERT dbo.MRO_MOTORPARAM (MOTORPARAM_ID, MOTOROFERTA_ID, MOTORFECHA_ID, PARAM_KEY_CD, TIPO_VALOR_CD, VALOR_DS, BORRADO_FL)
  VALUES (@B+1,@moid1,@B+1,'P1','NUMBER','1',0),(@B+2,@moid1,@B+1,'P2','NUMBER','2',0),(@B+3,@moid1,@B+1,'P3','NUMBER','3',0);

  DELETE FROM @out;
  INSERT @out EXEC dbo.cfg_get_workflow_snapshot_json @VIGENCIA_DESDE='2099-03-01';
  SELECT @json = ISNULL(snapshot_json, '{}') FROM @out;
  SELECT @rc = COUNT(*) FROM OPENJSON(@json, '$.reglas') WITH (rid INT '$.REGLA_ID') WHERE rid >= @B;
  SELECT @pc = COUNT(*) FROM OPENJSON(@json, '$.params') WITH (pid INT '$.PARAM_ID') WHERE pid >= @B;
  PRINT 'Caso 4 (TIPO=PARAMS) reglas=' + CAST(@rc AS VARCHAR) + ' (esp 0)  params=' + CAST(@pc AS VARCHAR) + ' (esp 3)  -> ' + CASE WHEN @rc=0 AND @pc=3 THEN 'PASS' ELSE 'FAIL' END;

  -- =========== CASO 6 — Aislamiento entre periodos (filtro por fecha) ===========
  DELETE FROM dbo.MRO_MOTORREGLA WHERE MOTORREGLA_ID >= @B;
  DELETE FROM dbo.MRO_MOTORPARAM WHERE MOTORPARAM_ID >= @B;
  DELETE FROM dbo.MRO_MOTORFECHA WHERE MOTORFECHA_ID >= @B;

  INSERT dbo.MRO_MOTORFECHA (MOTORFECHA_ID, DESDE_DT, HASTA_DT, TIPO_DS, BORRADO_FL)
  VALUES (@B+1, '20990401', NULL, 'AMBOS', 0),   -- consultado: 2 reglas
         (@B+2, '20990501', NULL, 'AMBOS', 0);   -- NO consultado: 3 reglas
  INSERT dbo.MRO_MOTORREGLA (MOTORREGLA_ID, MOTOROFERTA_ID, MOTORFECHA_ID, MOTORREGLA_DS, PRIORIDAD_NM, PARAR_PROCESO_FL, BORRADO_FL)
  VALUES (@B+1,@moid1,@B+1,'a1',10,0,0),(@B+2,@moid1,@B+1,'a2',20,0,0),
         (@B+3,@moid1,@B+2,'b1',10,0,0),(@B+4,@moid1,@B+2,'b2',20,0,0),(@B+5,@moid1,@B+2,'b3',30,0,0);

  DELETE FROM @out;
  INSERT @out EXEC dbo.cfg_get_workflow_snapshot_json @VIGENCIA_DESDE='2099-04-01';
  SELECT @json = ISNULL(snapshot_json, '{}') FROM @out;
  SELECT @rc = COUNT(*) FROM OPENJSON(@json, '$.reglas') WITH (rid INT '$.REGLA_ID') WHERE rid >= @B;
  PRINT 'Caso 6 (aislam. fecha) reglas=' + CAST(@rc AS VARCHAR) + ' (esp 2, no 5 — no aparece el otro periodo)  -> ' + CASE WHEN @rc=2 THEN 'PASS' ELSE 'FAIL' END;

  -- =========== CASO 2 — Dump completo (ambos params NULL) incluye lo sintético ===========
  DELETE FROM dbo.MRO_MOTORREGLA WHERE MOTORREGLA_ID >= @B;
  DELETE FROM dbo.MRO_MOTORPARAM WHERE MOTORPARAM_ID >= @B;
  DELETE FROM dbo.MRO_MOTORFECHA WHERE MOTORFECHA_ID >= @B;

  INSERT dbo.MRO_MOTORFECHA (MOTORFECHA_ID, DESDE_DT, HASTA_DT, TIPO_DS, BORRADO_FL)
  VALUES (@B+1, '20990601', NULL, 'AMBOS', 0);
  INSERT dbo.MRO_MOTORREGLA (MOTORREGLA_ID, MOTOROFERTA_ID, MOTORFECHA_ID, MOTORREGLA_DS, PRIORIDAD_NM, PARAR_PROCESO_FL, BORRADO_FL)
  VALUES (@B+1,@moid1,@B+1,'dump1',10,0,0);

  DELETE FROM @out;
  INSERT @out EXEC dbo.cfg_get_workflow_snapshot_json;   -- sin parámetros = dump completo
  SELECT @json = ISNULL(snapshot_json, '{}') FROM @out;
  SELECT @found = COUNT(*) FROM OPENJSON(@json, '$.reglas') WITH (rid INT '$.REGLA_ID') WHERE rid = @B+1;
  PRINT 'Caso 2 (dump completo) regla sintética presente=' + CAST(@found AS VARCHAR) + ' (esp 1)  -> ' + CASE WHEN @found=1 THEN 'PASS' ELSE 'FAIL' END;

  PRINT '------------------------------------------------------------';
  PRINT 'Caso 7 (restoreSnapshot end-to-end): NO cubierto aquí — es flujo API (JS). Verificar publicando un snapshot y restaurándolo a POC desde la app.';
  ROLLBACK TRAN;
  PRINT 'ROLLBACK OK — base sin cambios.';
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRAN;
  PRINT 'ERROR: ' + ERROR_MESSAGE() + '  (línea ' + CAST(ERROR_LINE() AS VARCHAR) + ')';
  PRINT 'Transacción revertida — base sin cambios.';
END CATCH;
GO
