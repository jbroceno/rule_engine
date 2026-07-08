---
change: simulator-corrections
capability: simulator
date: 2026-05-26
---

# Especificación: Correcciones al simulador

## Contexto

Esta especificación describe los requisitos funcionales que el simulador web y el motor de reglas deben cumplir tras las correcciones del cambio `simulator-corrections`. Cada requisito incluye su escenario de validación en formato Given/When/Then.

---

## RF-001 — Campo `primeraViviendaHabitual`

**Descripción**: el campo `primeraViviendaHabitual` (tipo `NUMBER`, valores `0` o `1`) identifica si la vivienda objeto de la hipoteca es la primera vivienda habitual del solicitante. La regla de rechazo asociada se dispara cuando el campo vale `0`.

**Criterios**:
- El campo se llama exactamente `primeraViviendaHabitual` en motor, frontend, SQL, tests y documentación.
- El valor es numérico: `1` (sí es primera vivienda habitual) ó `0` (no lo es).
- La regla `INIT Rechazo: No es primera vivienda habitual` usa `field: "primeraViviendaHabitual", operator: "EQ", value1: 0` con motivo `NO_PRIMERA_VIVIENDA`.

**Escenario A — Solicitante con primera vivienda habitual (aceptado)**

```
Given un solicitante con primeraViviendaHabitual = 1
  And el resto de campos cumplen las condiciones de la oferta
When se ejecuta initcheck()
Then la oferta queda con dictamen.initEligible = true
  And no se registra el motivo NO_PRIMERA_VIVIENDA
```

**Escenario B — Solicitante que no es primera vivienda habitual (rechazado)**

```
Given un solicitante con primeraViviendaHabitual = 0
When se ejecuta initcheck()
Then la oferta queda con dictamen.initEligible = false
  And el motivo de rechazo incluye NO_PRIMERA_VIVIENDA
```

---

## RF-002 — Simulador INIT solo permite 1 titular

**Descripción**: el formulario INIT no debe permitir indicar dos titulares ni mostrar el fieldset Titular 2. La fase INIT del motor evalúa únicamente al solicitante principal.

**Criterios**:
- No existe selector de "número de titulares" en el HTML de `init-simulator-page.component.html`.
- No existe fieldset Titular 2 en el HTML.
- El método `submit()` envía `numTitulares: 1` hardcodeado y los campos T2 con valores neutros (`edadT2: 0`, `ingresosT2: 0`, `antiguedadLaboralT2: 0`, `domiciliaT2: false`, etc.).

**Escenario A — Envío desde el simulador INIT**

```
Given el usuario completa el formulario INIT con los datos del titular principal
When pulsa "Simular"
Then la request al endpoint /simulate/init contiene numTitulares = 1
  And todos los campos T2 valen 0 o false
  And el formulario no expone controles para Titular 2
```

---

## RF-003 — Tipos de alta admitidos

**Descripción**: los tres simuladores (INIT, PRE, FINAL) ofrecen únicamente los tipos de alta válidos para Ofertas: `CAPTACION`, `NOVACION`.

**Criterios**:
- El control `tipoAlta` del formulario es un `<select>` con esas cuatro opciones, en ese orden.
- El valor `NUEVA` (antiguo) ya no aparece en ningún formulario ni en el seed.
- El parámetro `TIPO_ALTA_ADMITIDAS` del seed SQL contiene `["CAPTACION","NOVACION"]` (SUBROGACION queda fuera de la lista de admitidas por las ofertas, pero se permite seleccionarla para que el motor la rechace explícitamente).

**Escenario A — Selección de tipo de alta**

```
Given un usuario abre cualquier simulador
When despliega el selector "Tipo de alta"
Then ve únicamente las opciones PROMOCION, NOVACION
  And la opción NUEVA no aparece en ningún caso
```

**Escenario B — Validación del motor**

```
Given un input con tipoAlta = "PROMOCION"
When se ejecuta initcheck() contra una oferta sembrada con TIPO_ALTA_ADMITIDAS = ["CAPTACION","NOVACION"]
Then la regla de tipo de alta no genera rechazo
```

---

## RF-004 — Finalidad por defecto = 1

**Descripción**: el valor por defecto del control `finalidad` en los simuladores es `1` (primera vivienda habitual), no `15`.

**Criterios**:
- El form group inicializa `finalidad: 1`.
- El seed SQL (condición R4) compara `finalidad NE 1` para rechazo (antes era `NE 15`).
- La documentación `offers-settings.md` refleja la condición R4 actualizada.

**Escenario A — Carga inicial del simulador**

```
Given el usuario abre el simulador INIT por primera vez
When inspecciona el campo "Finalidad"
Then el valor por defecto es 1
```

---

## RF-005 — Normalización de ingresos por número de pagas

**Descripción**: los simuladores PRE y FINAL capturan ingresos brutos mensuales del titular y el número de pagas anuales del contrato. Al enviar la simulación, el frontend convierte los ingresos a base 14 pagas.

**Fórmula**:
```
ingresosT1Norm   = ingresosT1 * pagasT1 / 14
ingresosT2Norm   = ingresosT2 * pagasT2 / 14
ingresosTotales  = ingresosT1Norm + ingresosT2Norm
```

**Criterios**:
- Los form groups PRE y FINAL incluyen `pagasT1` (required, default 14) y `pagasT2` (default 14).
- El label del campo de ingresos es "Ingresos T1/T2 (€/mes)".
- El campo de pagas muestra el hint "× pagas / 14 al enviar".
- El motor recibe los ingresos ya normalizados; no añade lógica de normalización.

**Escenario A — Titular con 14 pagas (sin cambio)**

```
Given ingresosT1 = 2500, pagasT1 = 14, ingresosT2 = 0, pagasT2 = 14
When se envía la simulación PRE
Then la request contiene ingresosT1 = 2500, ingresosT2 = 0, ingresosTotales = 2500
```

**Escenario B — Titular con 12 pagas (prorrateo)**

```
Given ingresosT1 = 3000, pagasT1 = 12, ingresosT2 = 0, pagasT2 = 14
When se envía la simulación PRE
Then la request contiene ingresosT1 = 3000 * 12 / 14 ≈ 2571.43
  And ingresosTotales = 2571.43
```

**Escenario C — Dos titulares con pagas distintas**

```
Given ingresosT1 = 2800, pagasT1 = 14, ingresosT2 = 2100, pagasT2 = 12
When se envía la simulación FINAL
Then ingresosT1 = 2800
  And ingresosT2 = 2100 * 12 / 14 = 1800
  And ingresosTotales = 4600
```

---

## RF-006 — Seed de reglas y parámetros sin errores de FK

**Descripción**: el script `rule_set/sql/seed_offers.sql` debe ejecutarse de extremo a extremo sin violaciones de clave foránea.

**Criterios**:
- El orden de los `DELETE` respeta las dependencias FK: primero las tablas hijas (`cfg_offer_rule_action`, `cfg_offer_rule_condition_value`, `cfg_offer_rule_condition`, `cfg_offer_rule`, `cfg_offer_param`), después `cfg_offer_dates`, finalmente `cfg_offer_ruleset`.

**Escenario A — Re-ejecución limpia del seed**

```
Given una base de datos con las tablas cfg_* creadas y datos previos
When se ejecuta rule_set/sql/seed_offers.sql
Then el script termina sin errores
  And cfg_offer_param contiene 5 filas con key TIPO_ALTA_ADMITIDAS = '["CAPTACION","NOVACION"]'
```
