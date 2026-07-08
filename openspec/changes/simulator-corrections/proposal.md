---
change: simulator-corrections
type: bugfix+feature
status: implemented
date: 2026-05-26
---

# Propuesta: Correcciones al simulador de Ofertas Hipotecarias

## Resumen ejecutivo

Conjunto de correcciones al simulador web (Angular) y al motor de reglas para alinear el comportamiento del frontend con las reglas de negocio documentadas en `docs/offers-settings.md`. Incluye un renombrado de campo con impacto en motor + frontend + SQL + tests, ajustes a los formularios INIT/PRE/FINAL, normalización de ingresos por número de pagas y fixes al script de seed de ofertas.

## Motivación

Durante la validación funcional inicial del simulador surgieron cinco problemas que rompen la consistencia entre la especificación funcional y la implementación:

1. **Nombre ambiguo del campo de primera vivienda**: el flag se llamaba `tieneOtrasPropiedades` / `esPrimeraVivienda` según el archivo, con semánticas invertidas y comparaciones inconsistentes (`NE 0` vs. `EQ 0`). Esto generaba confusión al mantener reglas y al mapear desde el adaptador del workflow.
2. **Formulario INIT con campos no aplicables**: el simulador INIT exponía selector de número de titulares y fieldset de Titular 2, pero la fase INIT del motor sólo evalúa al solicitante principal. Los campos eran ruido para el operador y permitían introducir datos que el motor ignoraba.
3. **Tipos de alta desalineados**: las opciones del frontend (`NUEVA`) no coincidían con los valores que el motor espera y que el parámetro `TIPO_ALTA_ADMITIDAS` declara (`CAPTACION`, `NOVACION`).
4. **Ingresos sin normalización por pagas**: los simuladores PRE/FINAL recibían un único campo `ingresos` sin capturar el número de pagas, por lo que el motor evaluaba importes anuales heterogéneos (12 vs. 14 pagas) contra los mismos umbrales.
5. **Seed SQL con orden de DELETE incorrecto y `TIPO_ALTA_ADMITIDAS` con valores antiguos**: el script `seed_offers.sql` fallaba por violación de FK al intentar borrar `cfg_offer_dates` antes que las tablas hijas y, además, sembraba `TIPO_ALTA_ADMITIDAS` con `["CAPTACION","NOVACION"]`, valores que ningún simulador envía.

## Cambios propuestos (implementados)

### 1. Renombrado `primeraViviendaHabitual`

Se unifica el campo bajo el nombre `primeraViviendaHabitual` con tipo `NUMBER` (0 ó 1). La regla de rechazo se reformula con operador `EQ 0` (si NO es primera vivienda habitual, se rechaza) y motivo `NO_PRIMERA_VIVIENDA`.

Archivos afectados:
- `rule_set/rules.json` — Reglas actualizadas
- `rule_set/sql/seed_offers.sql` — condición R4 actualizada (finalidad NE '15' → NE '1')
- `rule_set/test/offer_scenarios.test.js`, `rule_set/test/rule_engine.test.js`, `rule_set/test/workflow_adapter.test.js`
- `rule_set/api/services/workflow_adapter.js` — mapeo `primeraViviendaHabitual: body.primeraViviendaHabitualFl ? 1 : 0`
- `rule_set/api/services/wf_compare_service.js` — `tienecasaFl: input.primeraViviendaHabitual ? 0 : 1`
- `rule_set/web/src/app/models/api.models.ts`
- `rule_set/docs/offers-settings.md`
- `rule_set/offer_rule_engine.js`

### 2. Simulador INIT — 1 titular

Eliminados selector de número de titulares y fieldset Titular 2. `submit()` hardcodea `numTitulares: 1` y los campos T2 a `0/false`. Defaults actualizados: `tipoAlta = "NOVACION"`, `finalidad = 1`. El checkbox `primeraViviendaHabitual` reemplaza a `tieneOtrasPropiedades`.

Archivos: `init-simulator-page.component.ts`, `init-simulator-page.component.html`.

### 3. Simuladores PRE/FINAL — número de pagas

Añadidos campos `pagasT1` (required, default 14) y `pagasT2` (default 14). La normalización se hace en el frontend en `submit()`:

```
ingresosT1Norm = ingresosT1 * pagasT1 / 14
ingresosT2Norm = ingresosT2 * pagasT2 / 14
ingresosTotales = ingresosT1Norm + ingresosT2Norm
```

El motor recibe los ingresos ya normalizados a 14 pagas, sin lógica adicional en el backend.

Archivos: `pre-simulator-page.component.ts/.html`, `final-simulator-page.component.ts/.html`.

### 4. Fixes al seed SQL

- Reordenado el bloque de DELETE: primero `cfg_offer_rule`, `cfg_offer_param`, etc., luego `cfg_offer_dates`, finalmente `cfg_offer_ruleset`.
- `TIPO_ALTA_ADMITIDAS` actualizado a`'["CAPTACION","NOVACION"]'` para las ofertas distintas a `FIDELIZACION`

## Impacto en la evaluación del motor

- **Sin cambio de contrato del motor**: `rule_engine.js` no se modifica. Sólo se mueven datos al nombre correcto y se ajustan operadores en las reglas.
- **Inversión De Morgan documentada**: la regla de rechazo expresa la negación del requisito positivo (`primeraViviendaHabitual = 1 → eligible`), aplicando el patrón de inversión ya establecido en el motor.
- **Normalización en frontend**: el motor mantiene su semántica de "ingresos sobre 14 pagas". Toda la conversión queda en el formulario, garantizando que el contrato del endpoint `POST /simulate/*` no cambia.
- **Compatibilidad de datos sembrados**: el seed reflejado en SQL queda alineado con los rangos que los simuladores envían realmente, eliminando rechazos espurios por `TIPO_ALTA_ADMITIDAS`.

## Alcance

**Dentro de alcance**:
- Renombrado del campo y actualización transversal (motor, frontend, SQL, tests, docs)
- Ajustes a los tres formularios de simulación
- Normalización de ingresos por pagas en frontend
- Fixes al script de seed

**Fuera de alcance**:
- Cambios en el contrato del API REST (`/simulate/*`, `/admin/*`)
- Nuevas reglas de negocio
- Migración de datos en bases productivas (esto es una corrección sobre el seed local)

## Riesgos

- **Compatibilidad con datos preexistentes**: si alguna BD tiene parámetros con el nombre viejo, hará falta una migración manual. En el entorno de prototipo basta con re-ejecutar el seed.
- **Frontend bloqueante**: la normalización en el frontend implica que un cliente que llame al endpoint directamente debe enviar ingresos ya normalizados. Documentado en `offers-settings.md`.

## Estado

Implementado el 2026-05-26. Tests en verde. Pendiente únicamente el registro SDD (este documento y sus artefactos hermanos).
