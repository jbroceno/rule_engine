-- =============================================================================
-- Migración: MOTOR_FECHAS → cfg_offer_dates
-- Aplica sobre instancias existentes que todavía usan el nombre original.
-- Ejecutar una sola vez. Es idempotente: comprueba existencia antes de actuar.
-- =============================================================================

-- 1. Renombrar la tabla
IF OBJECT_ID('dbo.MOTOR_FECHAS') IS NOT NULL
    AND OBJECT_ID('dbo.cfg_offer_dates') IS NULL
BEGIN
    EXEC sp_rename 'dbo.MOTOR_FECHAS', 'cfg_offer_dates';
    PRINT 'Tabla renombrada: MOTOR_FECHAS → cfg_offer_dates';
END
ELSE
BEGIN
    PRINT 'SKIP: tabla MOTOR_FECHAS no existe o cfg_offer_dates ya existe';
END
GO

-- 2. Renombrar la columna PK (motor_fechas_id → offer_date_id)
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.cfg_offer_dates')
      AND name = 'motor_fechas_id'
)
BEGIN
    EXEC sp_rename 'dbo.cfg_offer_dates.motor_fechas_id', 'offer_date_id', 'COLUMN';
    PRINT 'Columna renombrada: motor_fechas_id → offer_date_id';
END
ELSE
BEGIN
    PRINT 'SKIP: columna motor_fechas_id no existe en cfg_offer_dates';
END
GO

-- 3. Renombrar la FK en cfg_offer_rule (motor_fechas_id → offer_date_id)
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.cfg_offer_rule')
      AND name = 'motor_fechas_id'
)
BEGIN
    EXEC sp_rename 'dbo.cfg_offer_rule.motor_fechas_id', 'offer_date_id', 'COLUMN';
    PRINT 'Columna renombrada en cfg_offer_rule: motor_fechas_id → offer_date_id';
END
GO

-- 4. Renombrar la FK en cfg_offer_param (motor_fechas_id → offer_date_id)
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.cfg_offer_param')
      AND name = 'motor_fechas_id'
)
BEGIN
    EXEC sp_rename 'dbo.cfg_offer_param.motor_fechas_id', 'offer_date_id', 'COLUMN';
    PRINT 'Columna renombrada en cfg_offer_param: motor_fechas_id → offer_date_id';
END
GO

-- 5. Renombrar constraint de default si existe con el nombre antiguo
IF EXISTS (
    SELECT 1 FROM sys.default_constraints
    WHERE name = 'DF_MOTOR_FECHAS_alta_dt'
)
BEGIN
    EXEC sp_rename 'DF_MOTOR_FECHAS_alta_dt', 'DF_cfg_offer_dates_alta_dt', 'OBJECT';
    PRINT 'Constraint renombrado: DF_MOTOR_FECHAS_alta_dt → DF_cfg_offer_dates_alta_dt';
END
GO

PRINT 'Migración completada.';
GO
