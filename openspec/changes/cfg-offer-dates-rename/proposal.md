---
change: cfg-offer-dates-rename
type: technical-debt
status: implemented
date: 2026-05-26
---

# Propuesta: Renombrar `MOTOR_FECHAS` a `cfg_offer_dates`

## Resumen

Renombrar la tabla `dbo.MOTOR_FECHAS` a `dbo.cfg_offer_dates` y su clave primaria `motor_fechas_id` a `offer_date_id` en todos los módulos del proyecto (SQL, backend Node.js, frontend Angular, documentación y tests). Cambio puramente nominal: sin alteración de datos, lógica de negocio, contratos de API ni comportamiento funcional.

## Motivación

El nombre `MOTOR_FECHAS` se acuñó durante el diseño inicial como término funcional descriptivo del rol que cumple la tabla (gestionar períodos de vigencia para ofertas). Con el módulo de configuración ya estabilizado, ese nombre quedó como deuda técnica porque:

1. **Rompe la convención del prefijo `cfg_`** que aplica a todas las demás tablas del módulo de configuración (`cfg_offer_ruleset`, `cfg_offer_rule`, `cfg_offer_param`, `cfg_config_snapshot`, etc.).
2. **Mezcla idiomas**: la mayoría de los identificadores técnicos están en inglés (`offer_code`, `rule_id`, `param_id`); `MOTOR_FECHAS` y `motor_fechas_id` son los únicos casos en español.
3. **No describe la naturaleza técnica**: la tabla almacena "fechas de vigencia por oferta", no es un "motor". El nombre `cfg_offer_dates` es más preciso y autoexplicativo.

Mantener el nombre antiguo dificulta la lectura de queries, la búsqueda en el código y la incorporación de nuevos desarrolladores al proyecto.

## Alcance

### Incluido

- Renombrar la tabla `dbo.MOTOR_FECHAS` → `dbo.cfg_offer_dates` y la columna PK `motor_fechas_id` → `offer_date_id` en el modelo de datos.
- Actualizar todos los `JOIN`, FKs, constraints y referencias en stored procedures (`sp_rules_params.sql`).
- Actualizar el seed de datos (`seed_offers.sql`).
- Generar un script de migración idempotente (`migration_rename_cfg_offer_dates.sql`) usando `sp_rename` para instancias ya desplegadas.
- Refactorizar todos los servicios, controladores y validators del backend Node.js para usar el nuevo nombre de tabla/columna.
- Actualizar interfaces TypeScript, services y componentes Angular (modelos, query params, templates).
- Actualizar la documentación funcional (`CONFIGURACION_REGLAS.md`).
- Actualizar los tests existentes para reflejar el nuevo nombre.

### Excluido

- **No** se modifica ningún dato existente — los registros conservan sus valores y relaciones.
- **No** se modifica la lógica de negocio del motor de reglas (`rule_engine.js`) ni la semántica de evaluación.
- **No** se cambian las rutas HTTP de la API (`/api/admin/...` se mantienen idénticas).
- **No** se cambia el comportamiento funcional ni el contrato de respuesta de los endpoints (solo cambian nombres de campos internos en payloads donde el campo era `motor_fechas_id` → ahora `offer_date_id`).
- **No** se altera la estructura del simulador (INIT/PRE/FINAL) ni la lógica de elegibilidad.

### Supuestos

- Las instancias en entornos pre-productivos y productivos correrán el script `migration_rename_cfg_offer_dates.sql` antes del despliegue del nuevo backend.
- Los consumidores externos de la API (si los hubiere) deberán adaptarse al cambio de nombre de campo en los payloads que referencian `offer_date_id`.

## Impacto

| Área | Archivos afectados | Naturaleza |
|------|--------------------|------------|
| SQL | 4 archivos (`data_model.sql`, `sp_rules_params.sql`, `seed_offers.sql`, `migration_rename_cfg_offer_dates.sql` nuevo) | Rename DDL + script idempotente |
| Backend | 5 archivos (`admin_fechas_service.js`, `admin_service.js`, `admin_workflow_service.js`, `admin_validator.js`, `admin_snapshots_controller.js`) | Reemplazo masivo |
| Frontend | 7 archivos (`admin.models.ts`, `admin-api.service.ts`, `app.html`, `configurator-page.*`, `motor-fechas-page.*`) | Reemplazo masivo + labels UI |
| Docs | 1 archivo (`CONFIGURACION_REGLAS.md`) | Reescritura de secciones 4 y 9 |
| Tests | 1 archivo (`motor_fechas.test.js`) | Actualización de descriptores |

**Total estimado**: ~300 líneas tocadas. **Riesgo**: Medio (cambio amplio en superficie pero mecánico y sin alteración de comportamiento). **Estrategia de entrega**: single PR.
