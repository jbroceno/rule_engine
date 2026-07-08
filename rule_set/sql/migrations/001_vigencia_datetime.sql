-- =============================================================================
-- Migration 001: cfg_offer_dates.valid_from / valid_to DATE → DATETIME2(0)
--
-- Purpose: Promote vigencia desde/hasta from DATE to DATETIME2(0) so that
--   exact second-precision period identity is possible. The WF tool creates
--   MRO_MOTORFECHA rows with non-midnight DESDE_DT; sql.Date midnight truncation
--   causes the upsert key to never match → orphan rows on every republish.
--   This migration is the schema foundation for the vigencia-datetime change.
--
-- Backward compatibility:
--   Existing DATE values are promoted to midnight DATETIME2(0) automatically
--   by SQL Server (implicit cast: '2026-01-01' → '2026-01-01 00:00:00').
--   No data is lost; all existing periods remain valid.
--
-- Idempotent: protected by DATA_TYPE check in INFORMATION_SCHEMA.COLUMNS.
--   Safe to re-run on instances that already have DATETIME2(0) columns.
--
-- Deploy order: run BEFORE deploying backend services that use sql.DateTime2(0)
--   bindings (ADR-006 sequencing). Old backend (sql.Date) still works after
--   this migration because DATE is implicitly cast by SQL Server.
--
-- Covers: RF-COD-06, INV-COD-02, CA-COD-001
-- =============================================================================

-- Step 1: Alter valid_from → DATETIME2(0) NOT NULL
-- Guard: only alter if the column is still DATE (idempotent re-run safety).
IF EXISTS (
  SELECT 1
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo'
    AND TABLE_NAME   = 'cfg_offer_dates'
    AND COLUMN_NAME  = 'valid_from'
    AND DATA_TYPE    = 'date'
)
BEGIN
  ALTER TABLE dbo.cfg_offer_dates
    ALTER COLUMN valid_from DATETIME2(0) NOT NULL;
  PRINT 'cfg_offer_dates.valid_from: DATE → DATETIME2(0) NOT NULL';
END
ELSE
BEGIN
  PRINT 'SKIP: cfg_offer_dates.valid_from ya es DATETIME2 o no existe';
END
GO

-- Step 2: Alter valid_to → DATETIME2(0) NULL
IF EXISTS (
  SELECT 1
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo'
    AND TABLE_NAME   = 'cfg_offer_dates'
    AND COLUMN_NAME  = 'valid_to'
    AND DATA_TYPE    = 'date'
)
BEGIN
  ALTER TABLE dbo.cfg_offer_dates
    ALTER COLUMN valid_to DATETIME2(0) NULL;
  PRINT 'cfg_offer_dates.valid_to: DATE → DATETIME2(0) NULL';
END
ELSE
BEGIN
  PRINT 'SKIP: cfg_offer_dates.valid_to ya es DATETIME2 o no existe';
END
GO

PRINT 'Migration 001 (vigencia_datetime) completada.';
GO
