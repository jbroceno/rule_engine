-- ================================================================
-- SEED: Ofertas Hipotecarias — Ofertas, Reglas, Condiciones y Parámetros
-- Fuente: doc/offers-settings.md
-- Fecha base de vigencia: 2026-01-01
--
-- Convenciones:
--   · LTV almacenado como ratio decimal (0.80 = 80 %)
--   · Plazo en AÑOS (5, 30, 31, 40)
--   · Ingresos: ingresosT1 = T1.Ingresos * T1.NumPagas / 14
--   · edadMax = max(edadT1, edadT2); edadT2=0 si numTitulares=1
--   · FIELD:<campo> referencia otro campo del contexto de entrada
--
-- Patrón de inversión (De Morgan):
--   Las reglas detectan RECHAZO, no elegibilidad.
--   Las condiciones positivas del spec se niegan para encodar el rechazo.
--
-- Ejecución: dos batches separados por GO.
--   Batch 1 — define procedimiento temporal #ins_joven_rules
--   Batch 2 — limpia, inserta ofertas/params y llama al procedimiento
-- ================================================================

-- ================================================================
-- BATCH 1: Procedimiento reutilizable para las 5 ofertas distintas de FIDELIZACION
--   (misma estructura de reglas, distintos parámetros)
-- ================================================================
CREATE OR ALTER PROCEDURE #ins_joven_rules
  @rs             INT,
  @offerCode      NVARCHAR(50),
  @offer_date_id  INT
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @rule_id INT;
  -- Fuerza la colación del contexto de ejecución (la BD destino) en el parámetro NVARCHAR.
  -- Sin esto, SQL Server lanza "Invalid comparison due to NO COLLATION" al insertar
  -- el parámetro de una #proc (creada en tempdb) en tablas de otra base de datos.
  DECLARE @code NVARCHAR(50) = @offerCode COLLATE DATABASE_DEFAULT;

  -- ──────────────────────────────────────────────────────
  -- FASE INIT — Reglas de rechazo
  -- ──────────────────────────────────────────────────────

  -- R1. neg. (antiguedadT1>MIN_ANT OR antiguedadT2>MIN_ANT OR domNominaT1 OR domNominaT2)
  --     Rechaza cuando NINGÚN titular cumple antigüedad ni domicilia nómina.
  INSERT INTO dbo.cfg_offer_rule (ruleset_id, name, priority, enabled, offer_date_id, stop_processing)
  VALUES (@rs, N'INIT Rechazo: neg. Antigüedad/Domiciliación', 1000, 1, @offer_date_id, 0);
  SET @rule_id = SCOPE_IDENTITY();
  INSERT INTO dbo.cfg_offer_rule_condition (rule_id, group_id, field, operator, value_type, value1, value2)
  VALUES
    (@rule_id, 0, 'stage',             'EQ',       'STRING', 'INIT',                  NULL),
    (@rule_id, 0, 'ANTIGUEDAD_T1_NM',      'LE',       'NUMBER', 'PARAM:MIN_ANTIGUEDAD',  NULL),
    (@rule_id, 0, 'ANTIGUEDAD_T2_NM',      'LE',       'NUMBER', 'PARAM:MIN_ANTIGUEDAD',  NULL),
    (@rule_id, 0, 'DOMICILIA_NOMINA_T1_FL', 'IS_FALSE', 'BOOL',   '',                     NULL),
    (@rule_id, 0, 'DOMICILIA_NOMINA_T2_FL', 'IS_FALSE', 'BOOL',   '',                     NULL);
  INSERT INTO dbo.cfg_offer_rule_action (rule_id, action_type, field, value, value_type)
  VALUES
    (@rule_id, 'SET',    'initRejected', 'true',                  'BOOL'),
    (@rule_id, 'APPEND', 'motivos',      '{"code":"ANTIGUEDAD"}',  'JSON');

  -- R2. tipoAlta NOT IN TIPO_ALTA_ADMITIDAS  →  stop (tipo incorrecto no tiene remedio)
  INSERT INTO dbo.cfg_offer_rule (ruleset_id, name, priority, enabled, offer_date_id, stop_processing)
  VALUES (@rs, N'INIT Rechazo: Tipo de alta no admitido', 970, 1, @offer_date_id, 1);
  SET @rule_id = SCOPE_IDENTITY();
  INSERT INTO dbo.cfg_offer_rule_condition (rule_id, group_id, field, operator, value_type, value1, value2)
  VALUES
    (@rule_id, 0, 'stage',    'EQ',     'STRING', 'INIT',                     NULL),
    (@rule_id, 0, 'TIPO_ALTA_CD', 'NOT_IN', 'STRING', 'PARAM:TIPO_ALTA_ADMITIDAS', NULL);
  INSERT INTO dbo.cfg_offer_rule_action (rule_id, action_type, field, value, value_type)
  VALUES
    (@rule_id, 'SET',    'initRejected', 'true',                 'BOOL'),
    (@rule_id, 'APPEND', 'motivos',      '{"code":"TIPO_ALTA"}',  'JSON');

  -- R3. finalidad <> 1 (primera vivienda habitual, código 01)  →  stop
  INSERT INTO dbo.cfg_offer_rule (ruleset_id, name, priority, enabled, offer_date_id, stop_processing)
  VALUES (@rs, N'INIT Rechazo: Finalidad ≠ 01 (no primera vivienda)', 960, 1, @offer_date_id, 1);
  SET @rule_id = SCOPE_IDENTITY();
  INSERT INTO dbo.cfg_offer_rule_condition (rule_id, group_id, field, operator, value_type, value1, value2)
  VALUES
    (@rule_id, 0, 'stage',    'EQ', 'STRING', 'INIT', NULL),
    (@rule_id, 0, 'FINALIDAD_CD', 'NE', 'NUMBER', '1',    NULL);
  INSERT INTO dbo.cfg_offer_rule_action (rule_id, action_type, field, value, value_type)
  VALUES
    (@rule_id, 'SET',    'initRejected', 'true',                  'BOOL'),
    (@rule_id, 'APPEND', 'motivos',      '{"code":"FINALIDAD"}',   'JSON');

  -- R4. primeraViviendaHabitual = 0 (no es primera vivienda habitual)
  INSERT INTO dbo.cfg_offer_rule (ruleset_id, name, priority, enabled, offer_date_id, stop_processing)
  VALUES (@rs, N'INIT Rechazo: No es primera vivienda habitual', 950, 1, @offer_date_id, 0);
  SET @rule_id = SCOPE_IDENTITY();
  INSERT INTO dbo.cfg_offer_rule_condition (rule_id, group_id, field, operator, value_type, value1, value2)
  VALUES
    (@rule_id, 0, 'stage',                    'EQ', 'STRING', 'INIT', NULL),
    (@rule_id, 0, 'PRIMERA_VIVIENDA_HABITUAL_FL',   'EQ', 'NUMBER', '0',    NULL);
  INSERT INTO dbo.cfg_offer_rule_action (rule_id, action_type, field, value, value_type)
  VALUES
    (@rule_id, 'SET',    'initRejected', 'true',                          'BOOL'),
    (@rule_id, 'APPEND', 'motivos',      '{"code":"NO_PRIMERA_VIVIENDA"}', 'JSON');

  -- R5. edadMax >= MAX_EDAD
  --     edadMax = max(edadT1, edadT2); con edadT2=0 cuando numTitulares=1
  INSERT INTO dbo.cfg_offer_rule (ruleset_id, name, priority, enabled, offer_date_id, stop_processing)
  VALUES (@rs, N'INIT Rechazo: edadMax >= MAX_EDAD', 940, 1, @offer_date_id, 0);
  SET @rule_id = SCOPE_IDENTITY();
  INSERT INTO dbo.cfg_offer_rule_condition (rule_id, group_id, field, operator, value_type, value1, value2)
  VALUES
    (@rule_id, 0, 'stage',   'EQ', 'STRING', 'INIT',           NULL),
    (@rule_id, 0, 'EDAD_MAX_NM', 'GE', 'NUMBER', 'PARAM:MAX_EDAD', NULL);
  INSERT INTO dbo.cfg_offer_rule_action (rule_id, action_type, field, value, value_type)
  VALUES
    (@rule_id, 'SET',    'initRejected', 'true',           'BOOL'),
    (@rule_id, 'APPEND', 'motivos',      '{"code":"EDAD"}', 'JSON');

  -- R6. importeVivienda < importeVentaCA (mínimo compra-venta por CCAA)
  --     importeVentaCA es campo pre-calculado en el input (lookup tabla CCAA).
  --     Usa prefijo FIELD: para comparación campo-a-campo.
  INSERT INTO dbo.cfg_offer_rule (ruleset_id, name, priority, enabled, offer_date_id, stop_processing)
  VALUES (@rs, N'INIT Rechazo: importeVivienda < importeVentaCA (mínimo CCAA)', 930, 1, @offer_date_id, 0);
  SET @rule_id = SCOPE_IDENTITY();
  INSERT INTO dbo.cfg_offer_rule_condition (rule_id, group_id, field, operator, value_type, value1, value2)
  VALUES
    (@rule_id, 0, 'stage',           'EQ', 'STRING', 'INIT',                 NULL),
    (@rule_id, 0, 'IMPORTE_VIVIENDA_NM', 'LT', 'NUMBER', 'FIELD:IMPORTE_VIVIENDA_CA_NM', NULL);
  INSERT INTO dbo.cfg_offer_rule_action (rule_id, action_type, field, value, value_type)
  VALUES
    (@rule_id, 'SET',    'initRejected', 'true',                      'BOOL'),
    (@rule_id, 'APPEND', 'motivos',      '{"code":"IMPORTE_VIVIENDA"}', 'JSON');

  -- R7. INIT Decisión — initEligible + límites (si no hubo rechazo)
  INSERT INTO dbo.cfg_offer_rule (ruleset_id, name, priority, enabled, offer_date_id, stop_processing)
  VALUES (@rs, N'INIT Decisión: initEligible + límites', 10, 1, @offer_date_id, 1);
  SET @rule_id = SCOPE_IDENTITY();
  INSERT INTO dbo.cfg_offer_rule_condition (rule_id, group_id, field, operator, value_type, value1, value2)
  VALUES
    (@rule_id, 0, 'stage',        'EQ',       'STRING', 'INIT', NULL),
    (@rule_id, 0, 'initRejected', 'IS_FALSE', 'BOOL',   '',     NULL);
  INSERT INTO dbo.cfg_offer_rule_action (rule_id, action_type, field, value, value_type)
  VALUES
    (@rule_id, 'SET', 'initEligible',      'true',                    'BOOL'),
    (@rule_id, 'SET', 'MIN_HIPOTECA',     'PARAM:MIN_HIPOTECA',      'NUMBER'),
    (@rule_id, 'SET', 'MAX_HIPOTECA',     'PARAM:MAX_HIPOTECA',      'NUMBER'),
    (@rule_id, 'SET', 'MIN_PLAZO',        'PARAM:MIN_PLAZO',         'NUMBER'),
    (@rule_id, 'SET', 'MAX_PLAZO',        'PARAM:MAX_PLAZO',         'NUMBER'),
    (@rule_id, 'SET', 'MIN_LTV_EXCLUSIVE','PARAM:MIN_LTV_EXCLUSIVE', 'NUMBER'),
    (@rule_id, 'SET', 'MAX_LTV',          'PARAM:MAX_LTV',           'NUMBER'),
    (@rule_id, 'SET', 'EDAD_PLAZO',       'PARAM:EDAD_PLAZO',        'NUMBER'),
    -- SOLICITAR_DATOS_INTERVINIENTES: la UI debe pedir datos de intervinientes
    (@rule_id, 'SET', 'SOLICITAR_DATOS_INTERVINIENTES', 'true', 'BOOL');

  -- ──────────────────────────────────────────────────────
  -- FASE PRE — Reglas de rechazo
  -- ──────────────────────────────────────────────────────

  -- R8. 1 titular: ingresosT1 < MIN_INGRESOS_1T
  --     ingresosT1 = T1.Ingresos * T1.NumPagas / 14
  INSERT INTO dbo.cfg_offer_rule (ruleset_id, name, priority, enabled, offer_date_id, stop_processing)
  VALUES (@rs, N'PRE Rechazo: 1T ingresosT1 < MIN_INGRESOS_1T', 900, 1, @offer_date_id, 0);
  SET @rule_id = SCOPE_IDENTITY();
  INSERT INTO dbo.cfg_offer_rule_condition (rule_id, group_id, field, operator, value_type, value1, value2)
  VALUES
    (@rule_id, 0, 'stage',        'EQ', 'STRING', 'PRE',                    NULL),
    (@rule_id, 0, 'NUM_TITULARES_NM', 'EQ', 'NUMBER', '1',                      NULL),
    (@rule_id, 0, 'INGRESO_T1_NM',   'LT', 'NUMBER', 'PARAM:MIN_INGRESOS_1T',  NULL);
  INSERT INTO dbo.cfg_offer_rule_action (rule_id, action_type, field, value, value_type)
  VALUES
    (@rule_id, 'SET',    'preRejected', 'true',               'BOOL'),
    (@rule_id, 'APPEND', 'motivos',     '{"code":"INGRESOS"}', 'JSON');

  -- R9. 2 titulares: ingresosTotales <= MIN_INGRESOS_2T
  --     El spec pide ingresosTotales > MIN_INGRESOS_2T → negación: <=
  --     ingresosTotales = ingresosT1 + ingresosT2
  INSERT INTO dbo.cfg_offer_rule (ruleset_id, name, priority, enabled, offer_date_id, stop_processing)
  VALUES (@rs, N'PRE Rechazo: 2T ingresosTotales ≤ MIN_INGRESOS_2T', 890, 1, @offer_date_id, 0);
  SET @rule_id = SCOPE_IDENTITY();
  INSERT INTO dbo.cfg_offer_rule_condition (rule_id, group_id, field, operator, value_type, value1, value2)
  VALUES
    (@rule_id, 0, 'stage',           'EQ', 'STRING', 'PRE',                    NULL),
    (@rule_id, 0, 'NUM_TITULARES_NM',    'EQ', 'NUMBER', '2',                      NULL),
    (@rule_id, 0, 'INGRESO_TOTAL_NM', 'LE', 'NUMBER', 'PARAM:MIN_INGRESOS_2T',  NULL);
  INSERT INTO dbo.cfg_offer_rule_action (rule_id, action_type, field, value, value_type)
  VALUES
    (@rule_id, 'SET',    'preRejected', 'true',               'BOOL'),
    (@rule_id, 'APPEND', 'motivos',     '{"code":"INGRESOS"}', 'JSON');

  -- R10. PRE Decisión — preEligible + límites de la oferta
  INSERT INTO dbo.cfg_offer_rule (ruleset_id, name, priority, enabled, offer_date_id, stop_processing)
  VALUES (@rs, N'PRE Decisión: preEligible + límites', 10, 1, @offer_date_id, 1);
  SET @rule_id = SCOPE_IDENTITY();
  INSERT INTO dbo.cfg_offer_rule_condition (rule_id, group_id, field, operator, value_type, value1, value2)
  VALUES
    (@rule_id, 0, 'stage',       'EQ',       'STRING', 'PRE', NULL),
    (@rule_id, 0, 'preRejected', 'IS_FALSE', 'BOOL',   '',    NULL);
  INSERT INTO dbo.cfg_offer_rule_action (rule_id, action_type, field, value, value_type)
  VALUES
    (@rule_id, 'SET', 'preEligible',       'true',                    'BOOL'),
    (@rule_id, 'SET', 'offerCode',        @code,                     'STRING'),
    (@rule_id, 'SET', 'MIN_HIPOTECA',     'PARAM:MIN_HIPOTECA',      'NUMBER'),
    (@rule_id, 'SET', 'MAX_HIPOTECA',     'PARAM:MAX_HIPOTECA',      'NUMBER'),
    (@rule_id, 'SET', 'MIN_PLAZO',        'PARAM:MIN_PLAZO',         'NUMBER'),
    (@rule_id, 'SET', 'MAX_PLAZO',        'PARAM:MAX_PLAZO',         'NUMBER'),
    (@rule_id, 'SET', 'MIN_LTV_EXCLUSIVE','PARAM:MIN_LTV_EXCLUSIVE', 'NUMBER'),
    (@rule_id, 'SET', 'MAX_LTV',          'PARAM:MAX_LTV',           'NUMBER'),
    (@rule_id, 'SET', 'EDAD_PLAZO',       'PARAM:EDAD_PLAZO',        'NUMBER'),
    -- SOLICITAR_DATOS_INTERVINIENTES: la UI debe pedir datos de intervinientes
    (@rule_id, 'SET', 'SOLICITAR_DATOS_INTERVINIENTES', 'true', 'BOOL');

  -- ──────────────────────────────────────────────────────
  -- FASE FINAL — Reglas de rechazo
  -- ──────────────────────────────────────────────────────

  -- R11. LTV fuera del rango (MIN_LTV_EXCLUSIVE, MAX_LTV]
  --      Rechaza si ltv <= MIN_LTV_EXCLUSIVE  OR  ltv > MAX_LTV
  --      Dos grupos (DNF): cada grupo lleva su guarda de stage.
  INSERT INTO dbo.cfg_offer_rule (ruleset_id, name, priority, enabled, offer_date_id, stop_processing)
  VALUES (@rs, N'FINAL Rechazo: LTV fuera de rango (MIN_LTV_EXCL, MAX_LTV]', 1000, 1, @offer_date_id, 0);
  SET @rule_id = SCOPE_IDENTITY();
  INSERT INTO dbo.cfg_offer_rule_condition (rule_id, group_id, field, operator, value_type, value1, value2)
  VALUES
    (@rule_id, 1, 'stage', 'EQ', 'STRING', 'FINAL',                   NULL),
    (@rule_id, 1, 'LTV_NM',   'LE', 'NUMBER', 'PARAM:MIN_LTV_EXCLUSIVE',  NULL),
    (@rule_id, 2, 'stage', 'EQ', 'STRING', 'FINAL',                   NULL),
    (@rule_id, 2, 'LTV_NM',   'GT', 'NUMBER', 'PARAM:MAX_LTV',            NULL);
  INSERT INTO dbo.cfg_offer_rule_action (rule_id, action_type, field, value, value_type)
  VALUES
    (@rule_id, 'SET',    'rejected', 'true',           'BOOL'),
    (@rule_id, 'APPEND', 'motivos',  '{"code":"LTV"}',  'JSON');

  -- R12. importeHipoteca fuera del rango [MIN_HIPOTECA, MAX_HIPOTECA]
  --      Rechaza si importeHipoteca < MIN_HIPOTECA  OR  importeHipoteca > MAX_HIPOTECA
  INSERT INTO dbo.cfg_offer_rule (ruleset_id, name, priority, enabled, offer_date_id, stop_processing)
  VALUES (@rs, N'FINAL Rechazo: importeHipoteca fuera de rango', 990, 1, @offer_date_id, 0);
  SET @rule_id = SCOPE_IDENTITY();
  INSERT INTO dbo.cfg_offer_rule_condition (rule_id, group_id, field, operator, value_type, value1, value2)
  VALUES
    (@rule_id, 1, 'stage',           'EQ', 'STRING', 'FINAL',              NULL),
    (@rule_id, 1, 'IMPORTE_HIPOTECA_NM', 'LT', 'NUMBER', 'PARAM:MIN_HIPOTECA', NULL),
    (@rule_id, 2, 'stage',           'EQ', 'STRING', 'FINAL',              NULL),
    (@rule_id, 2, 'IMPORTE_HIPOTECA_NM', 'GT', 'NUMBER', 'PARAM:MAX_HIPOTECA', NULL);
  INSERT INTO dbo.cfg_offer_rule_action (rule_id, action_type, field, value, value_type)
  VALUES
    (@rule_id, 'SET',    'rejected', 'true',                       'BOOL'),
    (@rule_id, 'APPEND', 'motivos',  '{"code":"IMPORTE_HIPOTECA"}', 'JSON');

  -- R13. plazo fuera del rango [MIN_PLAZO, MAX_PLAZO] (en años)
  --      Rechaza si plazo < MIN_PLAZO  OR  plazo > MAX_PLAZO
  INSERT INTO dbo.cfg_offer_rule (ruleset_id, name, priority, enabled, offer_date_id, stop_processing)
  VALUES (@rs, N'FINAL Rechazo: plazo fuera de rango (años)', 980, 1, @offer_date_id, 0);
  SET @rule_id = SCOPE_IDENTITY();
  INSERT INTO dbo.cfg_offer_rule_condition (rule_id, group_id, field, operator, value_type, value1, value2)
  VALUES
    (@rule_id, 1, 'stage', 'EQ', 'STRING', 'FINAL',           NULL),
    (@rule_id, 1, 'PLAZO_NM', 'LT', 'NUMBER', 'PARAM:MIN_PLAZO', NULL),
    (@rule_id, 2, 'stage', 'EQ', 'STRING', 'FINAL',           NULL),
    (@rule_id, 2, 'PLAZO_NM', 'GT', 'NUMBER', 'PARAM:MAX_PLAZO', NULL);
  INSERT INTO dbo.cfg_offer_rule_action (rule_id, action_type, field, value, value_type)
  VALUES
    (@rule_id, 'SET',    'rejected', 'true',              'BOOL'),
    (@rule_id, 'APPEND', 'motivos',  '{"code":"PLAZO"}',  'JSON');

  -- R14. edadMasPlazo > EDAD_PLAZO
  --      edadMasPlazo = max(edadT1,edadT2) + plazo_años  (pre-calculado en input FINAL)
  INSERT INTO dbo.cfg_offer_rule (ruleset_id, name, priority, enabled, offer_date_id, stop_processing)
  VALUES (@rs, N'FINAL Rechazo: edadMasPlazo > EDAD_PLAZO', 970, 1, @offer_date_id, 0);
  SET @rule_id = SCOPE_IDENTITY();
  INSERT INTO dbo.cfg_offer_rule_condition (rule_id, group_id, field, operator, value_type, value1, value2)
  VALUES
    (@rule_id, 0, 'stage',        'EQ', 'STRING', 'FINAL',            NULL),
    (@rule_id, 0, 'EDAD_MAS_PLAZO_NM', 'GT', 'NUMBER', 'PARAM:EDAD_PLAZO', NULL);
  INSERT INTO dbo.cfg_offer_rule_action (rule_id, action_type, field, value, value_type)
  VALUES
    (@rule_id, 'SET',    'rejected', 'true',                  'BOOL'),
    (@rule_id, 'APPEND', 'motivos',  '{"code":"EDAD_PLAZO"}',  'JSON');

  -- R15. FINAL Decisión — NO elegible (rejected=true)
  INSERT INTO dbo.cfg_offer_rule (ruleset_id, name, priority, enabled, offer_date_id, stop_processing)
  VALUES (@rs, N'FINAL Decisión: NO elegible', 10, 1, @offer_date_id, 1);
  SET @rule_id = SCOPE_IDENTITY();
  INSERT INTO dbo.cfg_offer_rule_condition (rule_id, group_id, field, operator, value_type, value1, value2)
  VALUES
    (@rule_id, 0, 'stage',    'EQ',      'STRING', 'FINAL', NULL),
    (@rule_id, 0, 'rejected', 'IS_TRUE', 'BOOL',   '',      NULL);
  INSERT INTO dbo.cfg_offer_rule_action (rule_id, action_type, field, value, value_type)
  VALUES
    (@rule_id, 'SET', 'eligible',      'false',     'BOOL'),
    (@rule_id, 'SET', 'selectedOffer', @code,  'STRING');

  -- R16. FINAL Decisión — ELEGIBLE (rejected=false/null)
  INSERT INTO dbo.cfg_offer_rule (ruleset_id, name, priority, enabled, offer_date_id, stop_processing)
  VALUES (@rs, N'FINAL Decisión: ELEGIBLE', 1, 1, @offer_date_id, 1);
  SET @rule_id = SCOPE_IDENTITY();
  INSERT INTO dbo.cfg_offer_rule_condition (rule_id, group_id, field, operator, value_type, value1, value2)
  VALUES
    (@rule_id, 0, 'stage',    'EQ',       'STRING', 'FINAL', NULL),
    (@rule_id, 0, 'rejected', 'IS_FALSE', 'BOOL',   '',      NULL);
  INSERT INTO dbo.cfg_offer_rule_action (rule_id, action_type, field, value, value_type)
  VALUES
    (@rule_id, 'SET', 'eligible',      'true',     'BOOL'),
    (@rule_id, 'SET', 'selectedOffer', @code, 'STRING'),
    -- SOLICITAR_DATOS_INTERVINIENTES: la UI debe pedir datos de intervinientes
    (@rule_id, 'SET', 'SOLICITAR_DATOS_INTERVINIENTES', 'true', 'BOOL');
END;
GO

-- ================================================================
-- BATCH 2: Limpieza, Ofertas, Parámetros y Reglas
-- ================================================================
SET NOCOUNT ON;
DECLARE @VF   DATE          = '2026-01-01';
DECLARE @rule_id INT;
DECLARE @offer_date_id INT;

-- ──────────────────────────────────────────────────────
-- 0. LIMPIEZA (orden respeta FKs)
-- ──────────────────────────────────────────────────────
DELETE FROM dbo.cfg_offer_rule_action;
DELETE FROM dbo.cfg_offer_rule_condition_value;
DELETE FROM dbo.cfg_offer_rule_condition;
DELETE FROM dbo.cfg_offer_rule;
DELETE FROM dbo.cfg_offer_param;
DELETE FROM dbo.cfg_offer_dates;
DELETE FROM dbo.cfg_offer_ruleset;

INSERT INTO dbo.cfg_offer_dates (valid_from, valid_to, descripcion, tipo_cd)
VALUES (@VF, NULL, N'Período base Ofertas Hipotecarias 2026', 'AMBOS');
SET @offer_date_id = SCOPE_IDENTITY();

-- ──────────────────────────────────────────────────────
-- 1. OFERTAS
--    Ranking determina ganador en FINAL si hay múltiples elegibles.
--    ULTRA_ALTO_RIESGO (100) tiene mayor prioridad; FIDELIZACION (10) la menor.
-- ──────────────────────────────────────────────────────
DECLARE @rid TABLE (code NVARCHAR(50), ruleset_id INT);

INSERT INTO dbo.cfg_offer_ruleset (oferta_id, offer_rank, code, name, enabled, published_version)
OUTPUT INSERTED.code, INSERTED.ruleset_id INTO @rid
VALUES
  (12,  10, 'FIDELIZACION',                     N'Ofertas Hipotecarias - Fidelización de Clientes',                1, 1),
  (15,  90, 'ALTO_RIESGO',               N'Ofertas Hipotecarias - Alto Riesgo',                1, 1),
  (16,  60, 'PROMOCION',           N'Ofertas Hipotecarias - Promoción',            1, 1),
  (17,  70, 'PROMOCION_HC',N'Ofertas Hipotecarias - Promoción H.C.', 1, 1),
  (18,  80, 'LARGO_PLAZO',             N'Ofertas Hipotecarias - Alto Plazo',              1, 1),
  (19, 100, 'ULTRA_ALTO_RIESGO',              N'Ofertas Hipotecarias - Alto riesgo',               1, 1);

DECLARE @rs_clientes        INT = (SELECT ruleset_id FROM @rid WHERE code = 'FIDELIZACION');
DECLARE @rs_alto_ltv        INT = (SELECT ruleset_id FROM @rid WHERE code = 'ALTO_RIESGO');
DECLARE @rs_mejor_precio    INT = (SELECT ruleset_id FROM @rid WHERE code = 'PROMOCION');
DECLARE @rs_alto_plazo      INT = (SELECT ruleset_id FROM @rid WHERE code = 'LARGO_PLAZO');
DECLARE @rs_combinada       INT = (SELECT ruleset_id FROM @rid WHERE code = 'ULTRA_ALTO_RIESGO');
DECLARE @rs_mejor_precio_av INT = (SELECT ruleset_id FROM @rid WHERE code = 'PROMOCION_HC');

-- ──────────────────────────────────────────────────────
-- 2. PARÁMETROS
--    Ámbito: por oferta (sin stage).
--    LTV en decimal; Plazo en años; Ingresos en €/mes normalizados.
-- ──────────────────────────────────────────────────────
INSERT INTO dbo.cfg_offer_param (ruleset_id, param_key, value_type, value, offer_date_id, enabled)
VALUES

-- ── FIDELIZACION ────────────────────────────────────────────────────────────────
--    Mínimo de antigüedad como cliente (meses) + límites financieros propios
--    para poder devolverlos en dictamen/uiLimits como el resto de ofertas.
--    Sin MIN_LTV_EXCLUSIVE: FIDELIZACION no restringe LTV por abajo.
(@rs_clientes, 'MIN_ANTIGUEDAD', 'NUMBER', '12',                    @offer_date_id, 1),
(@rs_clientes, 'MIN_PLAZO', 'NUMBER', '3',                    @offer_date_id, 1),
(@rs_clientes, 'MAX_PLAZO', 'NUMBER', '35',                   @offer_date_id, 1),
(@rs_clientes, 'MIN_HIPOTECA', 'NUMBER', '20000',                @offer_date_id, 1),
(@rs_clientes, 'MAX_HIPOTECA', 'NUMBER', '2000000',              @offer_date_id, 1),
(@rs_clientes, 'MAX_LTV',             'NUMBER', '0.80',                 @offer_date_id, 1),
(@rs_clientes, 'EDAD_PLAZO', 'NUMBER', '75',                   @offer_date_id, 1),

-- ── ALTO_RIESGO (oferta_id 15, rank 90) ──────────────────────────────────
--    LTV alto (0.80, 0.95]; plazo estándar (5-30 años); edad ≤ 40; ingresos medios
(@rs_alto_ltv, 'MIN_ANTIGUEDAD',      'NUMBER', '12',                   @offer_date_id, 1),
(@rs_alto_ltv, 'MAX_EDAD', 'NUMBER', '45',                   @offer_date_id, 1),
(@rs_alto_ltv, 'MIN_PLAZO', 'NUMBER', '3',                    @offer_date_id, 1),
(@rs_alto_ltv, 'MAX_PLAZO', 'NUMBER', '35',                   @offer_date_id, 1),
(@rs_alto_ltv, 'MIN_LTV_EXCLUSIVE',   'NUMBER', '0.80',                 @offer_date_id, 1),
(@rs_alto_ltv, 'MAX_LTV', 'NUMBER', '1.00',                 @offer_date_id, 1),
(@rs_alto_ltv, 'MIN_HIPOTECA', 'NUMBER', '50000',                @offer_date_id, 1),
(@rs_alto_ltv, 'MAX_HIPOTECA', 'NUMBER', '1500000',              @offer_date_id, 1),
(@rs_alto_ltv, 'MIN_INGRESOS_1T', 'NUMBER', '2700',                 @offer_date_id, 1),
(@rs_alto_ltv, 'MIN_INGRESOS_2T', 'NUMBER', '3700',                 @offer_date_id, 1),
(@rs_alto_ltv, 'EDAD_PLAZO', 'NUMBER', '75',                   @offer_date_id, 1),
(@rs_alto_ltv, 'TIPO_ALTA_ADMITIDAS', 'JSON', '["NOVACION","CAPTACION"]', @offer_date_id, 1),

-- ── PROMOCION (oferta_id 16, rank 60) ──────────────────────────────
--    Sin restricción de antigüedad ni ingresos; edad ≤ 45; importe máx mayor (3M)
(@rs_mejor_precio, 'MIN_ANTIGUEDAD',      'NUMBER', '0',                    @offer_date_id, 1),
(@rs_mejor_precio, 'MAX_EDAD',            'NUMBER', '45',                   @offer_date_id, 1),
(@rs_mejor_precio, 'MIN_PLAZO', 'NUMBER', '3',                    @offer_date_id, 1),
(@rs_mejor_precio, 'MAX_PLAZO', 'NUMBER', '35',                   @offer_date_id, 1),
(@rs_mejor_precio, 'MIN_LTV_EXCLUSIVE',   'NUMBER', '0',                    @offer_date_id, 1),
(@rs_mejor_precio, 'MAX_LTV',             'NUMBER', '0.80',                 @offer_date_id, 1),
(@rs_mejor_precio, 'MIN_HIPOTECA', 'NUMBER', '50000',                @offer_date_id, 1),
(@rs_mejor_precio, 'MAX_HIPOTECA', 'NUMBER', '2000000',              @offer_date_id, 1),
(@rs_mejor_precio, 'MIN_INGRESOS_1T',     'NUMBER', '0',                    @offer_date_id, 1),
(@rs_mejor_precio, 'MIN_INGRESOS_2T',     'NUMBER', '0',                    @offer_date_id, 1),
(@rs_mejor_precio, 'EDAD_PLAZO', 'NUMBER', '75',                   @offer_date_id, 1),
(@rs_mejor_precio, 'TIPO_ALTA_ADMITIDAS', 'JSON', '["NOVACION","CAPTACION"]', @offer_date_id, 1),

-- ── LARGO_PLAZO (oferta_id 18, rank 80) ────────────────────────────────
--    LTV bajo (0, 0.80]; plazo largo (31-40 años); edad ≤ 40; edad+plazo ≤ 75
(@rs_alto_plazo, 'MIN_ANTIGUEDAD',      'NUMBER', '12',                   @offer_date_id, 1),
(@rs_alto_plazo, 'MAX_EDAD',            'NUMBER', '40',                   @offer_date_id, 1),
(@rs_alto_plazo, 'MIN_PLAZO', 'NUMBER', '36',                   @offer_date_id, 1),
(@rs_alto_plazo, 'MAX_PLAZO', 'NUMBER', '45',                   @offer_date_id, 1),
(@rs_alto_plazo, 'MIN_LTV_EXCLUSIVE',   'NUMBER', '0',                    @offer_date_id, 1),
(@rs_alto_plazo, 'MAX_LTV',             'NUMBER', '0.80',                 @offer_date_id, 1),
(@rs_alto_plazo, 'MIN_HIPOTECA', 'NUMBER', '50000',                @offer_date_id, 1),
(@rs_alto_plazo, 'MAX_HIPOTECA', 'NUMBER', '1500000',              @offer_date_id, 1),
(@rs_alto_plazo, 'MIN_INGRESOS_1T', 'NUMBER', '2500',                 @offer_date_id, 1),
(@rs_alto_plazo, 'MIN_INGRESOS_2T', 'NUMBER', '3500',                 @offer_date_id, 1),
(@rs_alto_plazo, 'EDAD_PLAZO', 'NUMBER', '80',                   @offer_date_id, 1),
(@rs_alto_plazo, 'TIPO_ALTA_ADMITIDAS', 'JSON', '["NOVACION","CAPTACION"]', @offer_date_id, 1),

-- ── ULTRA_ALTO_RIESGO (oferta_id 19, rank 100 — mayor prioridad) ──────────────
--    LTV alto (0.80, 0.95]; plazo largo (31-40 años); edad ≤ 40
(@rs_combinada, 'MIN_ANTIGUEDAD',      'NUMBER', '12',                   @offer_date_id, 1),
(@rs_combinada, 'MAX_EDAD',            'NUMBER', '40',                   @offer_date_id, 1),
(@rs_combinada, 'MIN_PLAZO', 'NUMBER', '36',                   @offer_date_id, 1),
(@rs_combinada, 'MAX_PLAZO',           'NUMBER', '40',                   @offer_date_id, 1),
(@rs_combinada, 'MIN_LTV_EXCLUSIVE',   'NUMBER', '0.80',                 @offer_date_id, 1),
(@rs_combinada, 'MAX_LTV',             'NUMBER', '0.90',                 @offer_date_id, 1),
(@rs_combinada, 'MIN_HIPOTECA', 'NUMBER', '50000',                @offer_date_id, 1),
(@rs_combinada, 'MAX_HIPOTECA', 'NUMBER', '1500000',              @offer_date_id, 1),
(@rs_combinada, 'MIN_INGRESOS_1T', 'NUMBER', '2700',                 @offer_date_id, 1),
(@rs_combinada, 'MIN_INGRESOS_2T', 'NUMBER', '3700',                 @offer_date_id, 1),
(@rs_combinada, 'EDAD_PLAZO',          'NUMBER', '75',                   @offer_date_id, 1),
(@rs_combinada, 'TIPO_ALTA_ADMITIDAS', 'JSON', '["NOVACION","CAPTACION"]', @offer_date_id, 1),

-- ── PROMOCION_HC (oferta_id 17, rank 70) ───────────────────
--    LTV bajo (0, 0.80]; plazo estándar (5-30 años); edad ≤ 45; importe máx mayor (3M)
(@rs_mejor_precio_av, 'MIN_ANTIGUEDAD',      'NUMBER', '12',                   @offer_date_id, 1),
(@rs_mejor_precio_av, 'MAX_EDAD',            'NUMBER', '45',                   @offer_date_id, 1),
(@rs_mejor_precio_av, 'MIN_PLAZO',           'NUMBER', '5',                    @offer_date_id, 1),
(@rs_mejor_precio_av, 'MAX_PLAZO', 'NUMBER', '35',                   @offer_date_id, 1),
(@rs_mejor_precio_av, 'MIN_LTV_EXCLUSIVE',   'NUMBER', '0',                    @offer_date_id, 1),
(@rs_mejor_precio_av, 'MAX_LTV',             'NUMBER', '0.80',                 @offer_date_id, 1),
(@rs_mejor_precio_av, 'MIN_HIPOTECA', 'NUMBER', '50000',                @offer_date_id, 1),
(@rs_mejor_precio_av, 'MAX_HIPOTECA', 'NUMBER', '2000000',              @offer_date_id, 1),
(@rs_mejor_precio_av, 'MIN_INGRESOS_1T', 'NUMBER', '2500',                 @offer_date_id, 1),
(@rs_mejor_precio_av, 'MIN_INGRESOS_2T', 'NUMBER', '3500',                 @offer_date_id, 1),
(@rs_mejor_precio_av, 'EDAD_PLAZO', 'NUMBER', '75',                   @offer_date_id, 1),
(@rs_mejor_precio_av, 'TIPO_ALTA_ADMITIDAS', 'JSON', '["NOVACION","CAPTACION"]', @offer_date_id, 1);

-- ──────────────────────────────────────────────────────
-- 3. REGLAS — FIDELIZACION
--    Solo fase INIT tiene rechazo.
--    PRE y FINAL solo tienen regla de decisión (pasan siempre si INIT pasó).
--    Las decisiones INIT y PRE escriben los límites financieros en dictamen
--    (como el resto de ofertas), salvo MIN_LTV_EXCLUSIVE que no aplica.
-- ──────────────────────────────────────────────────────

-- INIT R1. neg. (ant1>MIN_ANT OR ant2>MIN_ANT OR domNom1 OR domNom2)
INSERT INTO dbo.cfg_offer_rule (ruleset_id, name, priority, enabled, offer_date_id, stop_processing)
VALUES (@rs_clientes, N'INIT Rechazo: neg. Antigüedad/Domiciliación', 1000, 1, @offer_date_id, 0);
SET @rule_id = SCOPE_IDENTITY();
INSERT INTO dbo.cfg_offer_rule_condition (rule_id, group_id, field, operator, value_type, value1, value2)
VALUES
  (@rule_id, 0, 'stage',             'EQ',       'STRING', 'INIT',                 NULL),
  (@rule_id, 0, 'ANTIGUEDAD_T1_NM',      'LE',       'NUMBER', 'PARAM:MIN_ANTIGUEDAD', NULL),
  (@rule_id, 0, 'ANTIGUEDAD_T2_NM',      'LE',       'NUMBER', 'PARAM:MIN_ANTIGUEDAD', NULL),
  (@rule_id, 0, 'DOMICILIA_NOMINA_T1_FL', 'IS_FALSE', 'BOOL',   '',                    NULL),
  (@rule_id, 0, 'DOMICILIA_NOMINA_T2_FL', 'IS_FALSE', 'BOOL',   '',                    NULL);
INSERT INTO dbo.cfg_offer_rule_action (rule_id, action_type, field, value, value_type)
VALUES
  (@rule_id, 'SET',    'initRejected', 'true',                 'BOOL'),
  (@rule_id, 'APPEND', 'motivos',      '{"code":"ANTIGUEDAD"}', 'JSON');

-- INIT R2. Decisión: initEligible + límites
INSERT INTO dbo.cfg_offer_rule (ruleset_id, name, priority, enabled, offer_date_id, stop_processing)
VALUES (@rs_clientes, N'INIT Decisión: initEligible + límites', 10, 1, @offer_date_id, 1);
SET @rule_id = SCOPE_IDENTITY();
INSERT INTO dbo.cfg_offer_rule_condition (rule_id, group_id, field, operator, value_type, value1, value2)
VALUES
  (@rule_id, 0, 'stage',        'EQ',       'STRING', 'INIT', NULL),
  (@rule_id, 0, 'initRejected', 'IS_FALSE', 'BOOL',   '',     NULL);
INSERT INTO dbo.cfg_offer_rule_action (rule_id, action_type, field, value, value_type)
VALUES
  (@rule_id, 'SET', 'initEligible',  'true',               'BOOL'),
  (@rule_id, 'SET', 'MIN_HIPOTECA',  'PARAM:MIN_HIPOTECA', 'NUMBER'),
  (@rule_id, 'SET', 'MAX_HIPOTECA',  'PARAM:MAX_HIPOTECA', 'NUMBER'),
  (@rule_id, 'SET', 'MIN_PLAZO',     'PARAM:MIN_PLAZO',    'NUMBER'),
  (@rule_id, 'SET', 'MAX_PLAZO',     'PARAM:MAX_PLAZO',    'NUMBER'),
  (@rule_id, 'SET', 'MAX_LTV',       'PARAM:MAX_LTV',      'NUMBER'),
  (@rule_id, 'SET', 'EDAD_PLAZO',    'PARAM:EDAD_PLAZO',   'NUMBER'),
  -- SOLICITAR_DATOS_INTERVINIENTES: la UI debe pedir datos de intervinientes
  (@rule_id, 'SET', 'SOLICITAR_DATOS_INTERVINIENTES', 'false', 'BOOL');

-- PRE R3. Decisión: preEligible + límites (no hay reglas de rechazo PRE para FIDELIZACION)
INSERT INTO dbo.cfg_offer_rule (ruleset_id, name, priority, enabled, offer_date_id, stop_processing)
VALUES (@rs_clientes, N'PRE Decisión: preEligible + límites', 10, 1, @offer_date_id, 1);
SET @rule_id = SCOPE_IDENTITY();
INSERT INTO dbo.cfg_offer_rule_condition (rule_id, group_id, field, operator, value_type, value1, value2)
VALUES
  (@rule_id, 0, 'stage',       'EQ',       'STRING', 'PRE', NULL),
  (@rule_id, 0, 'preRejected', 'IS_FALSE', 'BOOL',   '',    NULL);
INSERT INTO dbo.cfg_offer_rule_action (rule_id, action_type, field, value, value_type)
VALUES
  (@rule_id, 'SET', 'preEligible',   'true',               'BOOL'),
  (@rule_id, 'SET', 'offerCode',     'FIDELIZACION',           'STRING'),
  (@rule_id, 'SET', 'MIN_HIPOTECA',  'PARAM:MIN_HIPOTECA', 'NUMBER'),
  (@rule_id, 'SET', 'MAX_HIPOTECA',  'PARAM:MAX_HIPOTECA', 'NUMBER'),
  (@rule_id, 'SET', 'MIN_PLAZO',     'PARAM:MIN_PLAZO',    'NUMBER'),
  (@rule_id, 'SET', 'MAX_PLAZO',     'PARAM:MAX_PLAZO',    'NUMBER'),
  (@rule_id, 'SET', 'MAX_LTV',       'PARAM:MAX_LTV',      'NUMBER'),
  (@rule_id, 'SET', 'EDAD_PLAZO',    'PARAM:EDAD_PLAZO',   'NUMBER'),
  -- SOLICITAR_DATOS_INTERVINIENTES: la UI debe pedir datos de intervinientes
  (@rule_id, 'SET', 'SOLICITAR_DATOS_INTERVINIENTES', 'false', 'BOOL');

-- FINAL R4. Decisión: NO elegible
INSERT INTO dbo.cfg_offer_rule (ruleset_id, name, priority, enabled, offer_date_id, stop_processing)
VALUES (@rs_clientes, N'FINAL Decisión: NO elegible', 10, 1, @offer_date_id, 1);
SET @rule_id = SCOPE_IDENTITY();
INSERT INTO dbo.cfg_offer_rule_condition (rule_id, group_id, field, operator, value_type, value1, value2)
VALUES
  (@rule_id, 0, 'stage',    'EQ',      'STRING', 'FINAL', NULL),
  (@rule_id, 0, 'rejected', 'IS_TRUE', 'BOOL',   '',      NULL);
INSERT INTO dbo.cfg_offer_rule_action (rule_id, action_type, field, value, value_type)
VALUES
  (@rule_id, 'SET', 'eligible',      'false',     'BOOL'),
  (@rule_id, 'SET', 'selectedOffer', 'FIDELIZACION',  'STRING');

-- FINAL R5. Decisión: ELEGIBLE
INSERT INTO dbo.cfg_offer_rule (ruleset_id, name, priority, enabled, offer_date_id, stop_processing)
VALUES (@rs_clientes, N'FINAL Decisión: ELEGIBLE', 1, 1, @offer_date_id, 1);
SET @rule_id = SCOPE_IDENTITY();
INSERT INTO dbo.cfg_offer_rule_condition (rule_id, group_id, field, operator, value_type, value1, value2)
VALUES
  (@rule_id, 0, 'stage',    'EQ',       'STRING', 'FINAL', NULL),
  (@rule_id, 0, 'rejected', 'IS_FALSE', 'BOOL',   '',      NULL);
INSERT INTO dbo.cfg_offer_rule_action (rule_id, action_type, field, value, value_type)
VALUES
  (@rule_id, 'SET', 'eligible',      'true',     'BOOL'),
  (@rule_id, 'SET', 'selectedOffer', 'FIDELIZACION', 'STRING'),
  -- SOLICITAR_DATOS_INTERVINIENTES: la UI debe pedir datos de intervinientes
  (@rule_id, 'SET', 'SOLICITAR_DATOS_INTERVINIENTES', 'false', 'BOOL');

-- ──────────────────────────────────────────────────────
-- 4. REGLAS — Ofertas distintas de FIDELIZACION (16 reglas por oferta)
--    Se usa el procedimiento temporal #ins_joven_rules.
-- ──────────────────────────────────────────────────────

EXEC #ins_joven_rules @rs_alto_ltv,        'ALTO_RIESGO',                @offer_date_id;
EXEC #ins_joven_rules @rs_mejor_precio,    'PROMOCION',            @offer_date_id;
EXEC #ins_joven_rules @rs_alto_plazo,      'LARGO_PLAZO',              @offer_date_id;
EXEC #ins_joven_rules @rs_combinada,       'ULTRA_ALTO_RIESGO',               @offer_date_id;
EXEC #ins_joven_rules @rs_mejor_precio_av, 'PROMOCION_HC', @offer_date_id;

-- ──────────────────────────────────────────────────────
-- 5. VERIFICACIÓN RÁPIDA
--    Se usan subconsultas independientes para evitar el producto cartesiano
--    que producen los LEFT JOIN entre condiciones, acciones y parámetros.
--
--    Valores esperados:
--      ULTRA_ALTO_RIESGO              100  16  43  45  12
--      ALTO_RIESGO                90  16  43  45  12
--      LARGO_PLAZO              80  16  43  45  12
--      PROMOCION_HC 70  16  43  45  12
--      PROMOCION            60  16  43  45  12
--      FIDELIZACION                      10   5  13  21   7
-- ──────────────────────────────────────────────────────
SELECT
  rs.code       AS oferta,
  rs.offer_rank AS rank,
  (SELECT COUNT(*) FROM dbo.cfg_offer_rule r
   WHERE r.ruleset_id = rs.ruleset_id)                                         AS num_reglas,
  (SELECT COUNT(*) FROM dbo.cfg_offer_rule_condition c
   JOIN dbo.cfg_offer_rule r ON r.rule_id = c.rule_id
   WHERE r.ruleset_id = rs.ruleset_id)                                         AS num_condiciones,
  (SELECT COUNT(*) FROM dbo.cfg_offer_rule_action a
   JOIN dbo.cfg_offer_rule r ON r.rule_id = a.rule_id
   WHERE r.ruleset_id = rs.ruleset_id)                                         AS num_acciones,
  (SELECT COUNT(*) FROM dbo.cfg_offer_param p
   WHERE p.ruleset_id = rs.ruleset_id)                                         AS num_params
FROM dbo.cfg_offer_ruleset rs
ORDER BY rs.offer_rank DESC;
