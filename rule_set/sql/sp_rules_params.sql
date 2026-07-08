CREATE OR ALTER PROCEDURE dbo.cfg_get_rules_json
  @offer_codes NVARCHAR(MAX) = NULL
AS
BEGIN
  SET NOCOUNT ON;

  ;WITH filter_codes AS (
    SELECT LTRIM(RTRIM(value)) AS code
    FROM STRING_SPLIT(ISNULL(@offer_codes,''), ',')
    WHERE LTRIM(RTRIM(value)) <> ''
  ),
  rs AS (
    SELECT s.ruleset_id, s.code AS offerCode, s.offer_rank, s.oferta_id
    FROM dbo.cfg_offer_ruleset s
    WHERE s.enabled = 1
      AND (
        @offer_codes IS NULL OR @offer_codes = '' OR
        EXISTS (SELECT 1 FROM filter_codes f WHERE f.code = s.code)
      )
  )
  SELECT rules_json =
  (
    SELECT
      offers = JSON_QUERY(
        (
          SELECT
            rs.offerCode,
            rs.offer_rank,
            rs.oferta_id,
            rules = JSON_QUERY(
              (
                SELECT
                  r.rule_id,
                  r.name,
                  r.priority,
                  r.stop_processing,
                  conditions = JSON_QUERY(
                    (
                      SELECT
                        c.cond_id,
                        c.group_id,
                        c.field,
                        c.operator,
                        c.value_type,
                        c.value1,
                        c.value2,
                        in_values = JSON_QUERY(
                    ISNULL(
                      (
                        SELECT '[' + STRING_AGG('"' + STRING_ESCAPE(cv.value, 'json') + '"', ',')
                               WITHIN GROUP (ORDER BY cv.cond_value_id) + ']'
                        FROM dbo.cfg_offer_rule_condition_value AS cv
                        WHERE cv.cond_id = c.cond_id
                        HAVING COUNT(*) > 0
                      ),
                      '[]'
                    )
                  )
                      FROM dbo.cfg_offer_rule_condition AS c
                      WHERE c.rule_id = r.rule_id
                      FOR JSON PATH
                    )
                  ),
                  actions = JSON_QUERY(
                    (
                      SELECT
                        a.action_id,
                        a.action_type,
                        a.field,
                        a.value,
                        a.value_type
                      FROM dbo.cfg_offer_rule_action AS a
                      WHERE a.rule_id = r.rule_id
                      FOR JSON PATH
                    )
                  )
                FROM dbo.cfg_offer_rule AS r
                INNER JOIN dbo.cfg_offer_dates mf ON mf.offer_date_id = r.offer_date_id
                WHERE r.ruleset_id = rs.ruleset_id
                  AND r.enabled = 1
                  AND mf.valid_from <= GETDATE()
                  AND (mf.valid_to IS NULL OR mf.valid_to > GETDATE())
                ORDER BY r.priority DESC, r.rule_id ASC
                FOR JSON PATH
              )
            )
          FROM rs
          ORDER BY rs.offer_rank DESC, rs.offerCode ASC
          FOR JSON PATH
        )
      ),
      params = JSON_QUERY(
        (
          SELECT
            p.offerCode,
            paramValues = JSON_QUERY(
              (
                SELECT
                  [key] = p2.param_key,
                  p2.value_type,
                  p2.value
                FROM dbo.cfg_offer_param p2
                INNER JOIN dbo.cfg_offer_dates mf ON mf.offer_date_id = p2.offer_date_id
                WHERE p2.ruleset_id = p.ruleset_id
                  AND p2.enabled    = 1
                  AND mf.valid_from <= GETDATE()
                  AND (mf.valid_to IS NULL OR mf.valid_to > GETDATE())
                FOR JSON PATH
              )
            )
          FROM (
            SELECT DISTINCT rs2.ruleset_id, rs2.offerCode
            FROM dbo.cfg_offer_param op
            INNER JOIN dbo.cfg_offer_dates mf ON mf.offer_date_id = op.offer_date_id
            INNER JOIN rs rs2 ON rs2.ruleset_id = op.ruleset_id
            WHERE op.enabled = 1
              AND mf.valid_from <= GETDATE()
              AND (mf.valid_to IS NULL OR mf.valid_to > GETDATE())
          ) AS p
          ORDER BY p.offerCode
          FOR JSON PATH
        )
      )
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
  );
END
GO

exec dbo.cfg_get_rules_json
GO

-- Primary SP called by the API. Accepts @offer_codes filter and @DATE for point-in-time evaluation.
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
      -- Solo incluir ofertas que tengan al menos una regla vigente en @DATE
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
    -- Join al CTE rs (no a la tabla): hereda el filtro de fecha y de offer_codes
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
