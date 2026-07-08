# Especificación: `cfg_offer_dates` — Renombrado de `MOTOR_FECHAS`

## Resumen

Esta especificación define los requisitos del renombrado de la tabla `MOTOR_FECHAS` a `cfg_offer_dates` en todos los módulos del sistema. El cambio es nominal: no altera la lógica de negocio ni los datos almacenados, solo unifica la nomenclatura técnica.

## Actores

- **Desarrollador backend** — consume la nueva nomenclatura en servicios y validadores Node.js.
- **Desarrollador frontend** — consume los nuevos nombres de campo en interfaces TypeScript y componentes Angular.
- **DBA / Operador de despliegue** — ejecuta el script de migración idempotente sobre instancias existentes.
- **Sistema motor de reglas** — sigue consultando la tabla renombrada de forma transparente vía stored procedures.

## Requisitos funcionales

### RF-001 — La tabla de períodos de vigencia debe llamarse `dbo.cfg_offer_dates`

La tabla que almacena los períodos de vigencia (fechas `alta_dt` / `baja_dt`) asociados a ofertas, reglas y parámetros debe llamarse `dbo.cfg_offer_dates`, alineada con el prefijo `cfg_` del resto de tablas del módulo de configuración.

#### Escenario: Creación inicial del esquema

- **Given** un entorno SQL Server limpio sin esquema previo
- **When** se ejecuta `rule_set/sql/data_model.sql`
- **Then** la tabla `dbo.cfg_offer_dates` queda creada con las columnas `offer_date_id` (PK, INT IDENTITY), `alta_dt`, `baja_dt` y demás atributos definidos
- **And** la constraint de default sobre `alta_dt` se llama `DF_cfg_offer_dates_alta_dt`
- **And** no existe ninguna tabla `dbo.MOTOR_FECHAS` en el esquema

#### Escenario: Consulta del catálogo de tablas

- **Given** el esquema desplegado con el nuevo nombre
- **When** se consulta `sys.tables` filtrando por nombres del módulo de configuración
- **Then** todas las tablas del módulo comparten el prefijo `cfg_` (`cfg_offer_ruleset`, `cfg_offer_rule`, `cfg_offer_param`, `cfg_offer_dates`, `cfg_config_snapshot`)

---

### RF-002 — La clave primaria debe llamarse `offer_date_id`

La columna PK de la tabla renombrada debe llamarse `offer_date_id`, sustituyendo el nombre anterior `motor_fechas_id`. Las FK que la referencian (en `cfg_offer_rule` y `cfg_offer_param`) deben usar este mismo nombre de columna.

#### Escenario: Verificación de la PK en `cfg_offer_dates`

- **Given** la tabla `dbo.cfg_offer_dates` creada
- **When** se consulta `INFORMATION_SCHEMA.COLUMNS` para la tabla
- **Then** existe una columna `offer_date_id` marcada como PK
- **And** no existe ninguna columna `motor_fechas_id` en la tabla

#### Escenario: FK en `cfg_offer_rule`

- **Given** las tablas `cfg_offer_dates` y `cfg_offer_rule` creadas
- **When** se inserta una regla referenciando un `offer_date_id` existente
- **Then** la FK valida correctamente la integridad referencial
- **And** la columna `offer_date_id` aparece en el INSERT como nombre de la FK

#### Escenario: FK en `cfg_offer_param`

- **Given** las tablas `cfg_offer_dates` y `cfg_offer_param` creadas
- **When** se inserta un parámetro referenciando un `offer_date_id` existente
- **Then** la FK valida correctamente la integridad referencial

---

### RF-003 — Todos los módulos (API, Angular, SQL, tests) deben usar el nuevo nombre

Ningún archivo del repositorio activo (excluyendo el script de migración) puede contener referencias a `MOTOR_FECHAS` o `motor_fechas_id`. El renombrado debe propagarse de forma consistente a:

- Backend Node.js: servicios (`admin_fechas_service.js`, `admin_service.js`, `admin_workflow_service.js`), validadores (`admin_validator.js`) y controladores (`admin_snapshots_controller.js`).
- Frontend Angular: modelos (`admin.models.ts`), servicios (`admin-api.service.ts`), componentes (`configurator-page.*`, `motor-fechas-page.*`, `app.html`).
- SQL: `data_model.sql`, `sp_rules_params.sql` (6 JOINs actualizados), `seed_offers.sql`.
- Documentación: `CONFIGURACION_REGLAS.md` (secciones 4 y 9).
- Tests: `motor_fechas.test.js`.

#### Escenario: Búsqueda global de `MOTOR_FECHAS` en código activo

- **Given** el repositorio con el cambio aplicado
- **When** se busca la cadena `MOTOR_FECHAS` en archivos `.sql`, `.js` y `.ts` (excluyendo el script de migración)
- **Then** no se encuentran resultados

#### Escenario: Búsqueda global de `motor_fechas_id` en código activo

- **Given** el repositorio con el cambio aplicado
- **When** se busca la cadena `motor_fechas_id` en archivos `.sql`, `.js` y `.ts` (excluyendo el script de migración)
- **Then** no se encuentran resultados

#### Escenario: Endpoint de listado de reglas devuelve el nuevo nombre

- **Given** la API corriendo contra una BD con esquema renombrado
- **When** se invoca `GET /api/admin/rules`
- **Then** cada regla en la respuesta incluye el campo `offer_date_id`
- **And** ninguna regla incluye el campo `motor_fechas_id`

#### Escenario: Interfaz TypeScript refleja el nuevo nombre

- **Given** el modelo `AdminRuleItem` en `admin.models.ts`
- **When** se compila el frontend Angular
- **Then** el modelo declara `offer_date_id: number | null`
- **And** el modelo no declara `motor_fechas_id`

---

### RF-004 — Debe existir script de migración idempotente para instancias existentes

Para instancias que ya tienen desplegado el esquema anterior (`MOTOR_FECHAS`), debe existir un script `rule_set/sql/migration_rename_cfg_offer_dates.sql` que realice el renombrado usando `sp_rename` (preservando datos y constraints) y que pueda ejecutarse múltiples veces sin error.

#### Escenario: Primera ejecución sobre esquema antiguo

- **Given** una instancia SQL Server con la tabla `dbo.MOTOR_FECHAS` poblada y la columna `motor_fechas_id`
- **When** se ejecuta `migration_rename_cfg_offer_dates.sql`
- **Then** la tabla pasa a llamarse `dbo.cfg_offer_dates`
- **And** la columna PK pasa a llamarse `offer_date_id`
- **And** la constraint default se renombra a `DF_cfg_offer_dates_alta_dt`
- **And** los datos preexistentes (filas y valores de PK) se mantienen intactos
- **And** las FK desde `cfg_offer_rule` y `cfg_offer_param` siguen siendo válidas

#### Escenario: Segunda ejecución sobre esquema ya migrado (idempotencia)

- **Given** una instancia SQL Server con la tabla ya renombrada a `dbo.cfg_offer_dates`
- **When** se ejecuta `migration_rename_cfg_offer_dates.sql` por segunda vez
- **Then** el script termina sin error
- **And** no se realiza ningún cambio en el esquema
- **And** los datos permanecen intactos

#### Escenario: Ejecución sobre instancia limpia

- **Given** una instancia SQL Server sin la tabla `MOTOR_FECHAS` ni `cfg_offer_dates`
- **When** se ejecuta `migration_rename_cfg_offer_dates.sql`
- **Then** el script termina sin error (no hay nada que renombrar)
- **And** no se crea ninguna tabla (la creación es responsabilidad de `data_model.sql`)

## Requisitos no funcionales

- **Compatibilidad de datos**: el renombrado preserva 100% de los registros y sus valores de PK. Cero pérdida de información.
- **Compatibilidad de rutas HTTP**: las rutas de la API (`/api/admin/rules`, `/api/admin/params`, etc.) mantienen su path. Solo cambian nombres de campos internos en payloads.
- **Idempotencia del script de migración**: el script puede ejecutarse N veces sin efectos colaterales.

## Criterios de aceptación

| ID | Área | Descripción | Condiciones | Resultado esperado |
|----|------|-------------|-------------|---------------------|
| CA-001 | SQL | La tabla figura como `cfg_offer_dates` | Ejecutar `SELECT name FROM sys.tables WHERE name LIKE 'cfg_%'` | La lista incluye `cfg_offer_dates` y NO incluye `MOTOR_FECHAS` |
| CA-002 | SQL | La PK figura como `offer_date_id` | Inspeccionar columnas de `cfg_offer_dates` | Existe `offer_date_id`, no existe `motor_fechas_id` |
| CA-003 | Backend | Servicios usan el nuevo nombre | `grep -r 'motor_fechas' rule_set/api/` | Sin resultados |
| CA-004 | Frontend | Modelos TS usan el nuevo nombre | `grep -r 'motor_fechas_id' rule_set/web/src/` | Sin resultados |
| CA-005 | Tests | El test renombrado pasa | Ejecutar `npm test -- --test-name-pattern "cfg_offer_dates"` | Test verde |
| CA-006 | Migración | Script idempotente sobre BD migrada | Ejecutar `migration_rename_cfg_offer_dates.sql` dos veces consecutivas | Sin error en la segunda ejecución |
| CA-007 | UI | Labels actualizadas | Abrir `/configurador` y revisar el panel de períodos | El label dice "Período de vigencia" (no "Período (MOTOR_FECHAS)") |
