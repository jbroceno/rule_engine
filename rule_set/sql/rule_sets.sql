-- El contexto de base de datos lo fija quien ejecuta el script
-- (p. ej. `sqlcmd -d <BD>`), no se hardcodea aquí.

TRUNCATE TABLE dbo.cfg_offer_rule_condition_value
TRUNCATE TABLE dbo.cfg_offer_rule_action
TRUNCATE TABLE dbo.cfg_offer_rule_condition
TRUNCATE TABLE dbo.cfg_offer_rule
TRUNCATE TABLE dbo.cfg_offer_ruleset

DECLARE @VALID_FROM DATE = '2026-01-01';

/* Crear rulesets */
  INSERT INTO dbo.cfg_offer_ruleset(code, name, enabled, oferta_id, published_version, offer_rank)
  VALUES
    ('OFERTA_RESTRICTIVA', 'Elegibilidad Restrictiva (params)', 1, 11, 1, 100),
    ('OFERTA_PERMISIVA',   'Elegibilidad Permisiva (params)', 1, 12, 1, 10);

  DECLARE @rsRestr INT = (SELECT ruleset_id FROM dbo.cfg_offer_ruleset WHERE code='OFERTA_RESTRICTIVA');
  DECLARE @rsPerm  INT = (SELECT ruleset_id FROM dbo.cfg_offer_ruleset WHERE code='OFERTA_PERMISIVA');

  DECLARE @r INT;

  /* =======================
     OFERTA_RESTRICTIVA - PRE
     ======================= */

  -- PRE Rechazo: no habitual
  INSERT INTO dbo.cfg_offer_rule(ruleset_id,name,priority,enabled,valid_from,valid_to,stop_processing)
  VALUES (@rsRestr,'PRE Rechazo: No vivienda habitual',1000,1,@VALID_FROM,NULL,0);
  SET @r = SCOPE_IDENTITY();

  INSERT INTO dbo.cfg_offer_rule_condition(rule_id,group_id,field,operator,value_type,value1)
  VALUES
    (@r,0,'stage','EQ','STRING','PRE'),
    (@r,0,'esViviendaHabitual','IS_FALSE','BOOL',NULL);

  INSERT INTO dbo.cfg_offer_rule_action(rule_id,action_type,field,value,value_type)
  VALUES
    (@r,'SET','preRejected','true','BOOL'),
    (@r,'APPEND','motivos','{"code":"NO_HABITUAL"}','JSON');

  -- PRE Rechazo: primera vivienda requerida (param REQUIERE_PRIMERA_VIVIENDA)
  -- Si requiere=true y esPrimeraVivienda=false => rechazo.
  -- Esto lo modelamos con 2 condiciones AND:
  --   REQUIERE_PRIMERA_VIVIENDA IS_TRUE (v�a PARAM) y esPrimeraVivienda IS_FALSE
  INSERT INTO dbo.cfg_offer_rule(ruleset_id,name,priority,enabled,valid_from,valid_to,stop_processing)
  VALUES (@rsRestr,'PRE Rechazo: No es primera vivienda (si requerida)',980,1,@VALID_FROM,NULL,0);
  SET @r = SCOPE_IDENTITY();

  INSERT INTO dbo.cfg_offer_rule_condition(rule_id,group_id,field,operator,value_type,value1)
  VALUES
    (@r,0,'stage','EQ','STRING','PRE'),
    (@r,0,'PARAM:REQUIERE_PRIMERA_VIVIENDA','IS_TRUE','BOOL',NULL),  -- ojo: usamos "field" especial PARAM:...
    (@r,0,'esPrimeraVivienda','IS_FALSE','BOOL',NULL);

  INSERT INTO dbo.cfg_offer_rule_action(rule_id,action_type,field,value,value_type)
  VALUES
    (@r,'SET','preRejected','true','BOOL'),
    (@r,'APPEND','motivos','{"code":"NO_PRIMERA_VIVIENDA"}','JSON');

  -- PRE Rechazo: edadMax > PARAM:MAX_EDAD
  INSERT INTO dbo.cfg_offer_rule(ruleset_id,name,priority,enabled,valid_from,valid_to,stop_processing)
  VALUES (@rsRestr,'PRE Rechazo: EdadMax > MAX_EDAD',950,1,@VALID_FROM,NULL,0);
  SET @r = SCOPE_IDENTITY();

  INSERT INTO dbo.cfg_offer_rule_condition(rule_id,group_id,field,operator,value_type,value1)
  VALUES
    (@r,0,'stage','EQ','STRING','PRE'),
    (@r,0,'edadMax','GT','NUMBER','PARAM:MAX_EDAD');

  INSERT INTO dbo.cfg_offer_rule_action(rule_id,action_type,field,value,value_type)
  VALUES
    (@r,'SET','preRejected','true','BOOL'),
    (@r,'APPEND','motivos','{"code":"EDAD"}','JSON');

  -- PRE Rechazo ingresos 1T: ingresoTotal14 < PARAM:MIN_INGRESOS_1T
  INSERT INTO dbo.cfg_offer_rule(ruleset_id,name,priority,enabled,valid_from,valid_to,stop_processing)
  VALUES (@rsRestr,'PRE Rechazo: 1T ingresos < MIN_INGRESOS_1T',900,1,@VALID_FROM,NULL,0);
  SET @r = SCOPE_IDENTITY();

  INSERT INTO dbo.cfg_offer_rule_condition(rule_id,group_id,field,operator,value_type,value1)
  VALUES
    (@r,0,'stage','EQ','STRING','PRE'),
    (@r,0,'numTitulares','EQ','NUMBER','1'),
    (@r,0,'ingresoTotal14','LT','NUMBER','PARAM:MIN_INGRESOS_1T');

  INSERT INTO dbo.cfg_offer_rule_action(rule_id,action_type,field,value,value_type)
  VALUES
    (@r,'SET','preRejected','true','BOOL'),
    (@r,'APPEND','motivos','{"code":"INGRESOS"}','JSON');

  -- PRE Rechazo ingresos 2T: ingresoTotal14 < PARAM:MIN_INGRESOS_2T
  INSERT INTO dbo.cfg_offer_rule(ruleset_id,name,priority,enabled,valid_from,valid_to,stop_processing)
  VALUES (@rsRestr,'PRE Rechazo: 2T ingresos < MIN_INGRESOS_2T',890,1,@VALID_FROM,NULL,0);
  SET @r = SCOPE_IDENTITY();

  INSERT INTO dbo.cfg_offer_rule_condition(rule_id,group_id,field,operator,value_type,value1)
  VALUES
    (@r,0,'stage','EQ','STRING','PRE'),
    (@r,0,'numTitulares','EQ','NUMBER','2'),
    (@r,0,'ingresoTotal14','LT','NUMBER','PARAM:MIN_INGRESOS_2T');

  INSERT INTO dbo.cfg_offer_rule_action(rule_id,action_type,field,value,value_type)
  VALUES
    (@r,'SET','preRejected','true','BOOL'),
    (@r,'APPEND','motivos','{"code":"INGRESOS"}','JSON');

  -- PRE Decisi�n + l�mites (actions con PARAM)
  INSERT INTO dbo.cfg_offer_rule(ruleset_id,name,priority,enabled,valid_from,valid_to,stop_processing)
  VALUES (@rsRestr,'PRE Decisi�n: preEligible + l�mites (params)',10,1,@VALID_FROM,NULL,1);
  SET @r = SCOPE_IDENTITY();

  INSERT INTO dbo.cfg_offer_rule_condition(rule_id,group_id,field,operator,value_type,value1)
  VALUES
    (@r,0,'stage','EQ','STRING','PRE'),
    (@r,0,'preRejected','IS_FALSE','BOOL',NULL);

  INSERT INTO dbo.cfg_offer_rule_action(rule_id,action_type,field,value,value_type)
  VALUES
    (@r,'SET','preEligible','true','BOOL'),
    (@r,'SET','offerCode','OFERTA_RESTRICTIVA','STRING'),
    (@r,'SET','minHipoteca','PARAM:MIN_HIPOTECA','NUMBER'),
    (@r,'SET','maxHipoteca','PARAM:MAX_HIPOTECA','NUMBER'),
    (@r,'SET','minPlazoMeses','PARAM:MIN_PLAZO_MESES','NUMBER'),
    (@r,'SET','maxPlazoMeses','PARAM:MAX_PLAZO_MESES','NUMBER'),
    (@r,'SET','maxLtvRatio','PARAM:MAX_LTV','NUMBER'),
    (@r,'SET','requierePrimeraVivienda','PARAM:REQUIERE_PRIMERA_VIVIENDA','BOOL');

  /* =========================
     OFERTA_RESTRICTIVA - FINAL
     ========================= */

  -- FINAL Rechazo: LTV > PARAM:MAX_LTV
  INSERT INTO dbo.cfg_offer_rule(ruleset_id,name,priority,enabled,valid_from,valid_to,stop_processing)
  VALUES (@rsRestr,'FINAL Rechazo: LTV > MAX_LTV',1000,1,@VALID_FROM,NULL,0);
  SET @r = SCOPE_IDENTITY();

  INSERT INTO dbo.cfg_offer_rule_condition(rule_id,group_id,field,operator,value_type,value1)
  VALUES
    (@r,0,'stage','EQ','STRING','FINAL'),
    (@r,0,'ltv','GT','NUMBER','PARAM:MAX_LTV');

  INSERT INTO dbo.cfg_offer_rule_action(rule_id,action_type,field,value,value_type)
  VALUES
    (@r,'SET','rejected','true','BOOL'),
    (@r,'APPEND','motivos','{"code":"LTV"}','JSON');

  -- FINAL Rechazo: plazo > PARAM:MAX_PLAZO_MESES
  INSERT INTO dbo.cfg_offer_rule(ruleset_id,name,priority,enabled,valid_from,valid_to,stop_processing)
  VALUES (@rsRestr,'FINAL Rechazo: plazoMeses > MAX_PLAZO_MESES',950,1,@VALID_FROM,NULL,0);
  SET @r = SCOPE_IDENTITY();

  INSERT INTO dbo.cfg_offer_rule_condition(rule_id,group_id,field,operator,value_type,value1)
  VALUES
    (@r,0,'stage','EQ','STRING','FINAL'),
    (@r,0,'plazoMeses','GT','NUMBER','PARAM:MAX_PLAZO_MESES');

  INSERT INTO dbo.cfg_offer_rule_action(rule_id,action_type,field,value,value_type)
  VALUES
    (@r,'SET','rejected','true','BOOL'),
    (@r,'APPEND','motivos','{"code":"PLAZO"}','JSON');

  -- FINAL Decisi�n NO/YES
  INSERT INTO dbo.cfg_offer_rule(ruleset_id,name,priority,enabled,valid_from,valid_to,stop_processing)
  VALUES (@rsRestr,'FINAL Decisi�n: NO elegible (rejected==true)',10,1,@VALID_FROM,NULL,1);
  SET @r = SCOPE_IDENTITY();
  INSERT INTO dbo.cfg_offer_rule_condition(rule_id,group_id,field,operator,value_type,value1)
  VALUES
    (@r,0,'stage','EQ','STRING','FINAL'),
    (@r,0,'rejected','IS_TRUE','BOOL',NULL);
  INSERT INTO dbo.cfg_offer_rule_action(rule_id,action_type,field,value,value_type)
  VALUES
    (@r,'SET','eligible','false','BOOL'),
    (@r,'SET','selectedOffer','OFERTA_RESTRICTIVA','STRING');

  INSERT INTO dbo.cfg_offer_rule(ruleset_id,name,priority,enabled,valid_from,valid_to,stop_processing)
  VALUES (@rsRestr,'FINAL Decisi�n: ELEGIBLE (rejected!=true)',1,1,@VALID_FROM,NULL,1);
  SET @r = SCOPE_IDENTITY();
  INSERT INTO dbo.cfg_offer_rule_condition(rule_id,group_id,field,operator,value_type,value1)
  VALUES
    (@r,0,'stage','EQ','STRING','FINAL'),
    (@r,0,'rejected','IS_FALSE','BOOL',NULL);
  INSERT INTO dbo.cfg_offer_rule_action(rule_id,action_type,field,value,value_type)
  VALUES
    (@r,'SET','eligible','true','BOOL'),
    (@r,'SET','selectedOffer','OFERTA_RESTRICTIVA','STRING');

  /* =======================
     OFERTA_PERMISIVA - PRE
     ======================= */

  -- STAGE Tipo de ALTA [NOVACION, CAPTACION]
  INSERT INTO dbo.cfg_offer_rule(ruleset_id,name,priority,enabled,valid_from,valid_to,stop_processing)
  VALUES (@rsRestr,'STAGE: Tipo de ALTA',1000,1,@VALID_FROM,NULL,0);
  SET @r = SCOPE_IDENTITY();

  INSERT INTO dbo.cfg_offer_rule_condition(rule_id,group_id,field,operator,value_type,value1)
  VALUES
    (@r,0,'stage','EQ','STRING','PRE'),
    (@r,0,'tipoALta','IN','STRING','PARAM:TIPO_ALTA_ADMITIDAS');

  INSERT INTO dbo.cfg_offer_rule_action(rule_id,action_type,field,value,value_type)
  VALUES
    (@r,'SET','rejected','true','BOOL'),
    (@r,'APPEND','motivos','{"code":"TIPO_ALTA"}','JSON');

  INSERT INTO dbo.cfg_offer_rule(ruleset_id,name,priority,enabled,valid_from,valid_to,stop_processing)
  VALUES (@rsPerm,'PRE Rechazo: No vivienda habitual',1000,1,@VALID_FROM,NULL,0);
  SET @r = SCOPE_IDENTITY();
  INSERT INTO dbo.cfg_offer_rule_condition(rule_id,group_id,field,operator,value_type,value1)
  VALUES
    (@r,0,'stage','EQ','STRING','PRE'),
    (@r,0,'esViviendaHabitual','IS_FALSE','BOOL',NULL);
  INSERT INTO dbo.cfg_offer_rule_action(rule_id,action_type,field,value,value_type)
  VALUES
    (@r,'SET','preRejected','true','BOOL'),
    (@r,'APPEND','motivos','{"code":"NO_HABITUAL"}','JSON');

  -- Edad con param MAX_EDAD
  INSERT INTO dbo.cfg_offer_rule(ruleset_id,name,priority,enabled,valid_from,valid_to,stop_processing)
  VALUES (@rsPerm,'PRE Rechazo: EdadMax > MAX_EDAD',950,1,@VALID_FROM,NULL,0);
  SET @r = SCOPE_IDENTITY();
  INSERT INTO dbo.cfg_offer_rule_condition(rule_id,group_id,field,operator,value_type,value1)
  VALUES
    (@r,0,'stage','EQ','STRING','PRE'),
    (@r,0,'edadMax','GT','NUMBER','PARAM:MAX_EDAD');
  INSERT INTO dbo.cfg_offer_rule_action(rule_id,action_type,field,value,value_type)
  VALUES
    (@r,'SET','preRejected','true','BOOL'),
    (@r,'APPEND','motivos','{"code":"EDAD"}','JSON');

  -- Ingresos 2T con param MIN_INGRESOS_2T
  INSERT INTO dbo.cfg_offer_rule(ruleset_id,name,priority,enabled,valid_from,valid_to,stop_processing)
  VALUES (@rsPerm,'PRE Rechazo: 2T ingresos < MIN_INGRESOS_2T',890,1,@VALID_FROM,NULL,0);
  SET @r = SCOPE_IDENTITY();
  INSERT INTO dbo.cfg_offer_rule_condition(rule_id,group_id,field,operator,value_type,value1)
  VALUES
    (@r,0,'stage','EQ','STRING','PRE'),
    (@r,0,'numTitulares','EQ','NUMBER','2'),
    (@r,0,'ingresoTotal14','LT','NUMBER','PARAM:MIN_INGRESOS_2T');
  INSERT INTO dbo.cfg_offer_rule_action(rule_id,action_type,field,value,value_type)
  VALUES
    (@r,'SET','preRejected','true','BOOL'),
    (@r,'APPEND','motivos','{"code":"INGRESOS"}','JSON');

  -- PRE Decisi�n + l�mites (params)
  INSERT INTO dbo.cfg_offer_rule(ruleset_id,name,priority,enabled,valid_from,valid_to,stop_processing)
  VALUES (@rsPerm,'PRE Decisi�n: preEligible + l�mites (params)',10,1,@VALID_FROM,NULL,1);
  SET @r = SCOPE_IDENTITY();
  INSERT INTO dbo.cfg_offer_rule_condition(rule_id,group_id,field,operator,value_type,value1)
  VALUES
    (@r,0,'stage','EQ','STRING','PRE'),
    (@r,0,'preRejected','IS_FALSE','BOOL',NULL);
  INSERT INTO dbo.cfg_offer_rule_action(rule_id,action_type,field,value,value_type)
  VALUES
    (@r,'SET','preEligible','true','BOOL'),
    (@r,'SET','offerCode','OFERTA_PERMISIVA','STRING'),
    (@r,'SET','minHipoteca','PARAM:MIN_HIPOTECA','NUMBER'),
    (@r,'SET','maxHipoteca','PARAM:MAX_HIPOTECA','NUMBER'),
    (@r,'SET','minPlazoMeses','PARAM:MIN_PLAZO_MESES','NUMBER'),
    (@r,'SET','maxPlazoMeses','PARAM:MAX_PLAZO_MESES','NUMBER'),
    (@r,'SET','maxLtvRatio','PARAM:MAX_LTV','NUMBER'),
    (@r,'SET','requierePrimeraVivienda','PARAM:REQUIERE_PRIMERA_VIVIENDA','BOOL');

  /* =========================
     OFERTA_PERMISIVA - FINAL
     Rango: (MIN_LTV_EXCLUSIVE, MAX_LTV]
     Rechazo si (ltv <= MIN_LTV_EXCLUSIVE) OR (ltv > MAX_LTV)
     ========================= */

  INSERT INTO dbo.cfg_offer_rule(ruleset_id,name,priority,enabled,valid_from,valid_to,stop_processing)
  VALUES (@rsPerm,'FINAL Rechazo: LTV fuera de rango (MIN_EXCL,MAX]',1000,1,@VALID_FROM,NULL,0);
  SET @r = SCOPE_IDENTITY();

  -- Grupo 1: FINAL + ltv <= PARAM:MIN_LTV_EXCLUSIVE
  INSERT INTO dbo.cfg_offer_rule_condition(rule_id,group_id,field,operator,value_type,value1)
  VALUES
    (@r,1,'stage','EQ','STRING','FINAL'),
    (@r,1,'ltv','LE','NUMBER','PARAM:MIN_LTV_EXCLUSIVE');

  -- Grupo 2: FINAL + ltv > PARAM:MAX_LTV
  INSERT INTO dbo.cfg_offer_rule_condition(rule_id,group_id,field,operator,value_type,value1)
  VALUES
    (@r,2,'stage','EQ','STRING','FINAL'),
    (@r,2,'ltv','GT','NUMBER','PARAM:MAX_LTV');

  INSERT INTO dbo.cfg_offer_rule_action(rule_id,action_type,field,value,value_type)
  VALUES
    (@r,'SET','rejected','true','BOOL'),
    (@r,'APPEND','motivos','{"code":"LTV"}','JSON');

  -- FINAL Decisi�n NO/YES
  INSERT INTO dbo.cfg_offer_rule(ruleset_id,name,priority,enabled,valid_from,valid_to,stop_processing)
  VALUES (@rsPerm,'FINAL Decisi�n: NO elegible (rejected==true)',10,1,@VALID_FROM,NULL,1);
  SET @r = SCOPE_IDENTITY();
  INSERT INTO dbo.cfg_offer_rule_condition(rule_id,group_id,field,operator,value_type,value1)
  VALUES
    (@r,0,'stage','EQ','STRING','FINAL'),
    (@r,0,'rejected','IS_TRUE','BOOL',NULL);
  INSERT INTO dbo.cfg_offer_rule_action(rule_id,action_type,field,value,value_type)
  VALUES
    (@r,'SET','eligible','false','BOOL'),
    (@r,'SET','selectedOffer','OFERTA_PERMISIVA','STRING');

  INSERT INTO dbo.cfg_offer_rule(ruleset_id,name,priority,enabled,valid_from,valid_to,stop_processing)
  VALUES (@rsPerm,'FINAL Decisi�n: ELEGIBLE (rejected!=true)',1,1,@VALID_FROM,NULL,1);
  SET @r = SCOPE_IDENTITY();
  INSERT INTO dbo.cfg_offer_rule_condition(rule_id,group_id,field,operator,value_type,value1)
  VALUES
    (@r,0,'stage','EQ','STRING','FINAL'),
    (@r,0,'rejected','IS_FALSE','BOOL',NULL);
  INSERT INTO dbo.cfg_offer_rule_action(rule_id,action_type,field,value,value_type)
  VALUES
    (@r,'SET','eligible','true','BOOL'),
    (@r,'SET','selectedOffer','OFERTA_PERMISIVA','STRING');