-- Migration: introduce MOTOR_FECHAS and replace valid_from/valid_to on cfg_offer_rule and cfg_offer_param.
-- Run on an existing database. Safe to re-run (idempotent checks included).

-- Step 1: Create MOTOR_FECHAS table if not exists
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'MOTOR_FECHAS' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.MOTOR_FECHAS (
    motor_fechas_id INT IDENTITY(1,1) PRIMARY KEY,
    valid_from      DATE          NOT NULL,
    valid_to        DATE          NULL,
    descripcion     NVARCHAR(200) NOT NULL,
    tipo_cd         VARCHAR(10)   NOT NULL,  -- REGLAS | PARAMS | AMBOS
    alta_usr        NVARCHAR(100) NULL,
    alta_dt         DATETIME2(0)  NOT NULL CONSTRAINT DF_MOTOR_FECHAS_alta_dt DEFAULT(SYSDATETIME())
  );
  PRINT 'MOTOR_FECHAS creada.';
END
GO

-- Step 2: Migrate distinct valid_from/valid_to combinations from cfg_offer_rule
INSERT INTO dbo.MOTOR_FECHAS (valid_from, valid_to, descripcion, tipo_cd, alta_usr)
SELECT DISTINCT
  ISNULL(r.valid_from, CAST(GETDATE() AS DATE)),
  r.valid_to,
  N'Período migrado automáticamente',
  'AMBOS',
  'migration'
FROM dbo.cfg_offer_rule r
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.MOTOR_FECHAS mf
  WHERE mf.valid_from = ISNULL(r.valid_from, CAST(GETDATE() AS DATE))
    AND (mf.valid_to = r.valid_to OR (mf.valid_to IS NULL AND r.valid_to IS NULL))
);

-- Migrate distinct combinations from cfg_offer_param
INSERT INTO dbo.MOTOR_FECHAS (valid_from, valid_to, descripcion, tipo_cd, alta_usr)
SELECT DISTINCT
  ISNULL(p.valid_from, CAST(GETDATE() AS DATE)),
  p.valid_to,
  N'Período migrado automáticamente',
  'AMBOS',
  'migration'
FROM dbo.cfg_offer_param p
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.MOTOR_FECHAS mf
  WHERE mf.valid_from = ISNULL(p.valid_from, CAST(GETDATE() AS DATE))
    AND (mf.valid_to = p.valid_to OR (mf.valid_to IS NULL AND p.valid_to IS NULL))
);
GO

-- Step 3: Add motor_fechas_id column (nullable initially)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.cfg_offer_rule') AND name = 'motor_fechas_id'
)
  ALTER TABLE dbo.cfg_offer_rule ADD motor_fechas_id INT NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.cfg_offer_param') AND name = 'motor_fechas_id'
)
  ALTER TABLE dbo.cfg_offer_param ADD motor_fechas_id INT NULL;
GO

-- Step 4: Populate motor_fechas_id from migrated MOTOR_FECHAS records
UPDATE r
SET r.motor_fechas_id = mf.motor_fechas_id
FROM dbo.cfg_offer_rule r
INNER JOIN dbo.MOTOR_FECHAS mf
  ON mf.valid_from = ISNULL(r.valid_from, CAST(GETDATE() AS DATE))
  AND (mf.valid_to = r.valid_to OR (mf.valid_to IS NULL AND r.valid_to IS NULL))
WHERE r.motor_fechas_id IS NULL;

UPDATE p
SET p.motor_fechas_id = mf.motor_fechas_id
FROM dbo.cfg_offer_param p
INNER JOIN dbo.MOTOR_FECHAS mf
  ON mf.valid_from = ISNULL(p.valid_from, CAST(GETDATE() AS DATE))
  AND (mf.valid_to = p.valid_to OR (mf.valid_to IS NULL AND p.valid_to IS NULL))
WHERE p.motor_fechas_id IS NULL;
GO

-- Step 5: Set NOT NULL
ALTER TABLE dbo.cfg_offer_rule  ALTER COLUMN motor_fechas_id INT NOT NULL;
ALTER TABLE dbo.cfg_offer_param ALTER COLUMN motor_fechas_id INT NOT NULL;
GO

-- Step 6: Drop valid_from / valid_to from cfg_offer_rule
IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.cfg_offer_rule') AND name = 'valid_from'
)
BEGIN
  ALTER TABLE dbo.cfg_offer_rule DROP COLUMN valid_from;
  ALTER TABLE dbo.cfg_offer_rule DROP COLUMN valid_to;
  PRINT 'valid_from/valid_to eliminados de cfg_offer_rule.';
END
GO

-- Step 7: Drop index that references valid_from/valid_to on cfg_offer_param
IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_cfg_offer_param_lookup' AND object_id = OBJECT_ID('dbo.cfg_offer_param')
)
  DROP INDEX IX_cfg_offer_param_lookup ON dbo.cfg_offer_param;
GO

-- Step 8: Drop valid_from / valid_to from cfg_offer_param
IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.cfg_offer_param') AND name = 'valid_from'
)
BEGIN
  ALTER TABLE dbo.cfg_offer_param DROP COLUMN valid_from;
  ALTER TABLE dbo.cfg_offer_param DROP COLUMN valid_to;
  PRINT 'valid_from/valid_to eliminados de cfg_offer_param.';
END
GO

-- Step 9: Add FK constraints
IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_cfg_offer_rule_mf'
)
  ALTER TABLE dbo.cfg_offer_rule ADD
    CONSTRAINT FK_cfg_offer_rule_mf FOREIGN KEY (motor_fechas_id)
    REFERENCES dbo.MOTOR_FECHAS(motor_fechas_id);

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_cfg_offer_param_mf'
)
  ALTER TABLE dbo.cfg_offer_param ADD
    CONSTRAINT FK_cfg_offer_param_mf FOREIGN KEY (motor_fechas_id)
    REFERENCES dbo.MOTOR_FECHAS(motor_fechas_id);

-- Step 10: Recreate index without old columns
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_cfg_offer_param_lookup' AND object_id = OBJECT_ID('dbo.cfg_offer_param')
)
  CREATE INDEX IX_cfg_offer_param_lookup
    ON dbo.cfg_offer_param (ruleset_id, param_key, enabled, motor_fechas_id);
GO

PRINT 'Migration MOTOR_FECHAS completada.';
