-- El contexto de base de datos lo fija quien ejecuta el script
-- (p. ej. `sqlcmd -d <BD>`), no se hardcodea aquí.

-- 1) Conjunto de reglas (ruleset)
CREATE TABLE cfg_offer_ruleset (
  ruleset_id INT IDENTITY(1,1) PRIMARY KEY,
  oferta_id INT NOT NULL,
  offer_rank INT NOT NULL CONSTRAINT DF_cfg_offer_ruleset_offer_rank DEFAULT(0),
  code NVARCHAR(50) NOT NULL UNIQUE,         -- ej: 'ALTO_RIESGO'
  name NVARCHAR(200) NOT NULL,
  enabled BIT NOT NULL DEFAULT 1,
  published_version INT NOT NULL DEFAULT 1
--  CONSTRAINT FK_oferta_id FOREIGN KEY (oferta_id) REFERENCES HIPO_OFERTA(oferta_id)
);

-- 1b) Períodos de vigencia centralizados
CREATE TABLE dbo.cfg_offer_dates (
  offer_date_id INT IDENTITY(1,1) PRIMARY KEY,
  valid_from      DATETIME2(0)  NOT NULL,
  valid_to        DATETIME2(0)  NULL,        -- NULL = sin fin
  descripcion     NVARCHAR(200) NOT NULL,
  tipo_cd         VARCHAR(10)   NOT NULL,    -- REGLAS | PARAMS | AMBOS
  alta_usr        NVARCHAR(100) NULL,
  alta_dt         DATETIME2(0)  NOT NULL CONSTRAINT DF_cfg_offer_dates_alta_dt DEFAULT(SYSDATETIME())
);

-- 2) Reglas
CREATE TABLE cfg_offer_rule (
  rule_id         INT IDENTITY(1,1) PRIMARY KEY,
  ruleset_id      INT NOT NULL,
  name            NVARCHAR(200) NOT NULL,
  priority        INT NOT NULL,              -- mayor = se evalúa antes
  enabled         BIT NOT NULL DEFAULT 1,
  offer_date_id INT NOT NULL,              -- FK a cfg_offer_dates
  stop_processing BIT NOT NULL DEFAULT 1,
--  CONSTRAINT FK_cfg_offer_rule_ruleset FOREIGN KEY (ruleset_id) REFERENCES cfg_offer_ruleset(ruleset_id)
--  CONSTRAINT FK_cfg_offer_rule_mf FOREIGN KEY (offer_date_id) REFERENCES dbo.cfg_offer_dates(offer_date_id)
);

-- 3) Condiciones (predicados)
CREATE TABLE cfg_offer_rule_condition (
  cond_id INT IDENTITY(1,1) PRIMARY KEY,
  rule_id INT NOT NULL,
  group_id INT NOT NULL DEFAULT 0,           -- OR dentro del mismo group_id
  field NVARCHAR(100) NOT NULL,              -- ej: 'edadMax'
  operator NVARCHAR(20) NOT NULL,            -- EQ, NE, LT, LE, GT, GE, BETWEEN, IN, NOT_IN, IS_TRUE, IS_FALSE
  value_type NVARCHAR(20) NOT NULL,          -- NUMBER, STRING, BOOL, DATE
  value1 NVARCHAR(200) NULL,
  value2 NVARCHAR(200) NULL,
--  CONSTRAINT FK_cfg_offer_rule_condition_rule FOREIGN KEY (rule_id) REFERENCES cfg_offer_rule(rule_id)
);

-- 4) Valores para IN/NOT_IN
CREATE TABLE cfg_offer_rule_condition_value (
  cond_value_id INT IDENTITY(1,1) PRIMARY KEY,
  cond_id INT NOT NULL,
  value NVARCHAR(200) NOT NULL,
--  CONSTRAINT FK_cfg_offer_rule_condition_value_cond FOREIGN KEY (cond_id) REFERENCES cfg_offer_rule_condition(cond_id)
);

-- 5) Acciones (resultado)
CREATE TABLE cfg_offer_rule_action (
  action_id INT IDENTITY(1,1) PRIMARY KEY,
  rule_id INT NOT NULL,
  action_type NVARCHAR(20) NOT NULL,         -- SET, ADD, APPEND
  field NVARCHAR(100) NOT NULL,
  value NVARCHAR(4000) NULL,
  value_type NVARCHAR(20) NOT NULL,          -- NUMBER, STRING, BOOL, JSON
--  CONSTRAINT FK_cfg_offer_rule_action_rule FOREIGN KEY (rule_id) REFERENCES cfg_offer_rule(rule_id)
);

-- 6) Parámetros
CREATE TABLE dbo.cfg_offer_param (
    param_id        INT IDENTITY(1,1) PRIMARY KEY,
    ruleset_id      INT           NOT NULL,   -- FK a cfg_offer_ruleset.ruleset_id
    param_key       NVARCHAR(100) NOT NULL,   -- p.ej. 'MAX_LTV', 'MIN_HIPOTECA'
    value_type      NVARCHAR(10)  NOT NULL,   -- 'NUMBER'/'BOOL'/'STRING'
    value           NVARCHAR(200) NULL,
    offer_date_id INT           NOT NULL,   -- FK a cfg_offer_dates
    enabled         BIT           NOT NULL CONSTRAINT DF_cfg_param_enabled DEFAULT(1),
    updated_at      DATETIME2(0)  NOT NULL CONSTRAINT DF_cfg_param_updated_at DEFAULT(SYSDATETIME()),
    CONSTRAINT FK_cfg_offer_param_ruleset FOREIGN KEY (ruleset_id) REFERENCES cfg_offer_ruleset(ruleset_id)
--  CONSTRAINT FK_cfg_offer_param_mf FOREIGN KEY (offer_date_id) REFERENCES dbo.cfg_offer_dates(offer_date_id)
  );

CREATE INDEX IX_cfg_offer_param_lookup
    ON dbo.cfg_offer_param (ruleset_id, param_key, enabled, offer_date_id);
GO

-- CREATE/ALTER PROCEDURE debe ser la primera sentencia de su batch.
CREATE OR ALTER PROCEDURE dbo.cfg_get_offers_and_params_json
  @offer_codes NVARCHAR(MAX) = NULL  -- CSV opcional
  ,@DATE DATETIME
AS
BEGIN
  SET NOCOUNT ON;

  ;WITH filter_codes AS (
    SELECT LTRIM(RTRIM(value)) AS code
    FROM STRING_SPLIT(ISNULL(@offer_codes,''), ',')
    WHERE LTRIM(RTRIM(value)) <> ''
  ),
  rs AS (
    SELECT s.ruleset_id, s.code AS offerCode, s.oferta_id, s.offer_rank
    FROM dbo.cfg_offer_ruleset s
    WHERE s.enabled = 1
      AND (
        @offer_codes IS NULL OR @offer_codes = '' OR
        EXISTS (SELECT 1 FROM filter_codes f WHERE f.code = s.code)
      )
      AND EXISTS (
        SELECT 1 FROM dbo.cfg_offer_rule r
        INNER JOIN dbo.cfg_offer_dates mf ON mf.offer_date_id = r.offer_date_id
        WHERE r.ruleset_id = s.ruleset_id
          AND r.enabled = 1
          AND mf.valid_from <= @DATE
          AND (mf.valid_to IS NULL OR mf.valid_to > @DATE)
      )
  ),
  rules AS (
    SELECT r.ruleset_id, r.rule_id, r.name, r.priority, r.stop_processing
    FROM dbo.cfg_offer_rule r
    INNER JOIN dbo.cfg_offer_dates mf ON mf.offer_date_id = r.offer_date_id
    WHERE r.ruleset_id IN (SELECT ruleset_id FROM rs)
      AND r.enabled = 1
      AND mf.valid_from <= @DATE
      AND (mf.valid_to IS NULL OR mf.valid_to > @DATE)
  ),
  params AS (
    SELECT rs.offerCode AS offer_code, p.param_key, p.value_type, p.value
    FROM dbo.cfg_offer_param p
    INNER JOIN rs ON rs.ruleset_id = p.ruleset_id
    INNER JOIN dbo.cfg_offer_dates mf ON mf.offer_date_id = p.offer_date_id
    WHERE p.enabled = 1
      AND mf.valid_from <= @DATE
      AND (mf.valid_to IS NULL OR mf.valid_to > @DATE)
  )
  SELECT
    offers_json =
    (
      SELECT
        rs.offerCode,
        rs.offer_rank,
        rs.oferta_id,
        rules =
        (
          SELECT
            ru.rule_id,
            ru.name,
            ru.priority,
            ru.stop_processing,
            conditions =
            (
              SELECT
                c.cond_id,
                c.group_id,
                c.field,
                c.operator,
                c.value_type,
                c.value1,
                c.value2,
                in_values = JSON_QUERY('[]')
              FROM dbo.cfg_offer_rule_condition c
              WHERE c.rule_id = ru.rule_id
              FOR JSON PATH
            ),
            actions =
            (
              SELECT
                a.action_id,
                a.action_type,
                a.field,
                a.value,
                a.value_type
              FROM dbo.cfg_offer_rule_action a
              WHERE a.rule_id = ru.rule_id
              FOR JSON PATH
            )
          FROM rules ru
          WHERE ru.ruleset_id = rs.ruleset_id
          ORDER BY ru.priority DESC, ru.rule_id ASC
          FOR JSON PATH
        )
      FROM rs
      ORDER BY rs.offer_rank DESC, rs.offerCode ASC
      FOR JSON PATH
    ),
    params_json =
    (
      SELECT
        offerCode = p.offer_code,
        params =
        (
          SELECT
            param_key,
            value_type,
            value
          FROM params p2
          WHERE p2.offer_code = p.offer_code
          FOR JSON PATH
        )
      FROM (SELECT DISTINCT offer_code FROM params) p
      FOR JSON PATH
    );
END
