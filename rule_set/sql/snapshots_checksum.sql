-- Añade checksum HMAC-SHA256 (hex, 64 chars) a los snapshots. NULL = fila legada (no verificable).
-- Idempotente (patrón IF NOT EXISTS, como el resto de migraciones del repo).
-- Orden de despliegue: aplicar ESTE script ANTES de desplegar la API que escribe/lee checksum.
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.cfg_config_snapshot') AND name = 'checksum'
)
BEGIN
  ALTER TABLE dbo.cfg_config_snapshot ADD checksum NVARCHAR(64) NULL;
END;
