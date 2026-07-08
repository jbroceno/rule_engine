-- Snapshots de configuracion (historial de cambios antes de cada "Grabar")
CREATE TABLE dbo.cfg_config_snapshot (
  snapshot_id    INT IDENTITY(1,1) PRIMARY KEY,
  snapshot_name  NVARCHAR(200)   NOT NULL,
  comment        NVARCHAR(1000)  NULL,
  created_by     NVARCHAR(100)   NULL,
  created_at     DATETIME2(0)    NOT NULL CONSTRAINT DF_cfg_snapshot_at DEFAULT (SYSDATETIME()),
  entorno_cd     VARCHAR(5)      NOT NULL CONSTRAINT DF_cfg_snapshot_entorno DEFAULT ('POC'),  -- POC | WF
  rules_json     NVARCHAR(MAX)   NOT NULL,
  params_json    NVARCHAR(MAX)   NOT NULL
);

CREATE INDEX IX_cfg_config_snapshot_created_at
  ON dbo.cfg_config_snapshot (created_at DESC);
