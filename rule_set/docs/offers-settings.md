# Configuración de ofertas

Este documento enumera para cada oferta las reglas a aplicar. Tenemos estas ofertas:

Id Oferta|Cod Oferta|Ranking
-|-|-
12|FIDELIZACION|10
15|ALTO_RIESGO|90
16|PROMOCION|60
17|PROMOCION_HC|70
18|LARGO_PLAZO|80
19|ULTRA_ALTO_RIESGO|100

A continuación se definen las variables 


Variable|Tipo|Cálculo
-|-|-
TIPO_ALTA_CD|string|TIPO_ALTA_CD
PRIMERA_VIVIENDA_HABITUAL_FL|number|PRIMERA_VIVIENDA_HABITUAL_FL
FINALIDAD_CD|number|Finalidad de la vivienda
NUM_TITULARES_NM|number|Número de titulares
ANTIGUEDAD_T1_NM|number|Meses(T1.ANTIGUEDAD_CLIENTE_DT)
ANTIGUEDAD_T2_NM|number|Meses(T2.ANTIGUEDAD_CLIENTE_DT)
DOMICILIA_NOMINA_T1_FL|number|T1.DOMICILIA_NOMINA
DOMICILIA_NOMINA_T2_FL|number|T2.DOMICILIA_NOMINA
INGRESO_T1_NM|number|T1.Ingresos * T1.NumPagas / 14
INGRESO_T2_NM|number|T2.Ingresos * T2.NumPagas / 14
INGRESO_TOTAL_NM|number|(ingresosT1 + ingresosT2)
EDAD_T1_NM|number|CalculaEdad(T1.NACIMIENTO_DT)
EDAD_MAX_NM|number|Edad máx. de ambos titulares
EDAD_T2_NM|number|CalculaEdad(T2.NACIMIENTO_DT)
IMPORTE_VIVIENDA_CA_NM|number|lookup(importeVenta(COMUNIDAD_AUTONOMA_CD))
IMPORTE_HIPOTECA_NM|number|IMPORTE_HIPOTECA_NM
IMPORTE_VIVIENDA_NM|number|IMPORTE_VIVIENDA_NM
PLAZO_NM|number|PLAZO_NM
LTV_NM|number|LTV
EDAD_MAS_PLAZO_NM|number|(max. edad titulares)+PLAZO_NM

## FIDELIZACION

Esta oferta solo tiene fase INIT, por lo que las evaluaciones PRE y FINAL aplican también solo este criterio

### Reglas
Id Oferta|Fase|Regla|Condiciones
-|-|-|-
11|INIT|Antigüedad|(antiguedadT1>PARAM:MIN_ANTIGUEDAD) OR (antiguedadT2>PARAM:MIN_ANTIGUEDAD) OR (domiciliaNominaT1=1) OR (domiciliaNominaT2=1)

### Parámetros

Parámetro|tipo|valor
-|-|-
MIN_ANTIGUEDAD|number|12
MIN_PLAZO|number|3
MAX_PLAZO|number|35
MIN_HIPOTECA|number|20000
MAX_HIPOTECA|number|2000000
MAX_LTV|number|80
EDAD_PLAZO|number|75

Los límites son:
SET|MIN_HIPOTECA|PARAM:MIN_HIPOTECA
SET|MAX_HIPOTECA|PARAM:MAX_HIPOTECA
SET|MIN_PLAZO|PARAM:MIN_PLAZO
SET|MAX_PLAZO|PARAM:MAX_PLAZO
SET|MAX_LTV|PARAM:MAX_LTV
SET|EDAD_PLAZO|PARAM:EDAD_PLAZO
SET|SOLICITAR_DATOS_INTERVINIENTES|false


## Acciones de decisión INIT

Cuando una oferta supera todas las condiciones INIT (no se activa ningún rechazo), la regla
"INIT Decisión: initEligible + límites" activa la oferta y escribe los límites financieros en el dictamen:

Acción|Campo|Fuente
-|-|-
SET|initEligible|true
SET|MIN_HIPOTECA|PARAM:MIN_HIPOTECA
SET|MAX_HIPOTECA|PARAM:MAX_HIPOTECA
SET|MIN_PLAZO|PARAM:MIN_PLAZO
SET|MAX_PLAZO|PARAM:MAX_PLAZO
SET|MIN_LTV_EXCLUSIVE|PARAM:MIN_LTV_EXCLUSIVE
SET|MAX_LTV|PARAM:MAX_LTV
SET|EDAD_PLAZO|PARAM:EDAD_PLAZO
SET|SOLICITAR_DATOS_INTERVINIENTES|true

Esto permite que `uiLimits` quede poblado ya desde la fase INIT.
FIDELIZACION aplica el mismo patrón con sus propios límites (ver sección FIDELIZACION), salvo `MIN_LTV_EXCLUSIVE`, que no define porque no restringe el LTV por abajo.

Además, en la salida del motor:
- `initcheck().eligibleOffers` devuelve objetos completos de oferta evaluada (mismo shape que `all`, filtrado por `dictamen.initEligible=true`).
- En esas ofertas elegibles, los límites quedan en `dictamen` (`MIN_HIPOTECA`, `MAX_HIPOTECA`, `MIN_PLAZO`, `MAX_PLAZO`, `MIN_LTV_EXCLUSIVE`, `MAX_LTV`, `EDAD_PLAZO`).

---

## ALTO_RIESGO

### Reglas
Id Oferta|Fase|Regla|Condiciones
-|-|-|-
12|INIT|Antigüedad|(antiguedadT1>PARAM:MIN_ANTIGUEDAD) OR (antiguedadT2>PARAM:MIN_ANTIGUEDAD) OR (domiciliaNominaT1=1) OR (domiciliaNominaT2=1)
12|INIT|Edad máxima|edadT1<PARAM:MAX_EDAD AND edadT2<PARAM:MAX_EDAD
12|INIT|Finalidad|finalidad=01
12|INIT|Primera Vivienda Habitual|primeraViviendaHabitual=1
12|INIT|Min vivienda|importeVivienda>=importeVentaCA
12|INIT|Tipo Alta|tipoAlta in PARAM:TIPO_ALTA_ADMITIDAS
12|INIT|Decisión|SET initEligible + límites (ver sección "Acciones de decisión INIT")
12|PRE|Ingresos|(numTitulares=1 and ingresosT1>=PARAM:MIN_INGRESOS_1T) OR (num_titulares=2 and ingresosTotales>PARAM:MIN_INGRESOS_2T)
12|FINAL|Importe Hipoteca|importeHipoteca >= PARAM:MIN_HIPOTECA and importeHipoteca <= PARAM:MAX_HIPOTECA
12|FINAL|Plazo|plazo >= PARAM:MIN_PLAZO and plazo <= PARAM:MAX_PLAZO
12|FINAL|LTV|ltv > PARAM:MIN_LTV and ltv <= PARAM:MAX_LTV
12|FINAL|Edad + Plazo|edadMasPlazo<=PARAM:EDAD_PLAZO

### Parámetros
Parámetro|tipo|valor
-|-|-
MIN_ANTIGUEDAD|number|12
MAX_EDAD|number|45
MIN_PLAZO|number|3
MAX_PLAZO|number|35
MIN_LTV|number|80
MAX_LTV|number|100
MIN_HIPOTECA|number|50000
MAX_HIPOTECA|number|1500000
MIN_INGRESOS_1T|number|2700
MIN_INGRESOS_2T|number|3700
EDAD_PLAZO|number|75
TIPO_ALTA_ADMITIDAS|JSON|["NOVACION","CAPTACION"]

## PROMOCION

## Reglas
Se definirán las mismas reglas que en ALTO_RIESGO. Solo cambian los parámetros

### Parámetros
Parámetro|tipo|valor
-|-|-
MIN_ANTIGUEDAD|number|0
MAX_EDAD|number|45
MIN_PLAZO|number|3
MAX_PLAZO|number|35
MIN_LTV|number|0
MAX_LTV|number|80
MIN_HIPOTECA|number|50000
MAX_HIPOTECA|number|2000000
MIN_INGRESOS_1T|number|0
MIN_INGRESOS_2T|number|0
EDAD_PLAZO|number|75
TIPO_ALTA_ADMITIDAS|JSON|[,"CAPTACION"]

## LARGO_PLAZO

## Reglas
Se definirán las mismas reglas que en ALTO_RIESGO. Solo cambian los parámetros

### Parámetros
Parámetro|tipo|valor
-|-|-
MIN_ANTIGUEDAD|number|12
MAX_EDAD|number|40
MIN_PLAZO|number|36
MAX_PLAZO|number|45
MIN_LTV|number|0
MAX_LTV|number|80
MIN_HIPOTECA|number|50000
MAX_HIPOTECA|number|1500000
MIN_INGRESOS_1T|number|2500
MIN_INGRESOS_2T|number|3500
EDAD_PLAZO|number|80
TIPO_ALTA_ADMITIDAS|JSON|["NOVACION","CAPTACION"]

## ULTRA_ALTO_RIESGO

## Reglas
Se definirán las mismas reglas que en ALTO_RIESGO. Solo cambian los parámetros

### Parámetros
Parámetro|tipo|valor
-|-|-
MIN_ANTIGUEDAD|number|12
MAX_EDAD|number|40
MIN_PLAZO|number|36
MAX_PLAZO|number|40
MIN_LTV|number|80
MAX_LTV|number|90
MIN_HIPOTECA|number|50000
MAX_HIPOTECA|number|1500000
MIN_INGRESOS_1T|number|2700
MIN_INGRESOS_2T|number|3700
EDAD_PLAZO|number|75
TIPO_ALTA_ADMITIDAS|JSON|[,"CAPTACION"]

## PROMOCION_HC

## Reglas
Se definirán las mismas reglas que en ALTO_RIESGO. Solo cambian los parámetros

### Parámetros
Parámetro|tipo|valor
-|-|-
MIN_ANTIGUEDAD|number|12
MAX_EDAD|number|45
MIN_PLAZO|number|5
MAX_PLAZO|number|35
MIN_LTV|number|0
MAX_LTV|number|80
MIN_HIPOTECA|number|50000
MAX_HIPOTECA|number|2000000
MIN_INGRESOS_1T|number|2500
MIN_INGRESOS_2T|number|3500
EDAD_PLAZO|number|75
TIPO_ALTA_ADMITIDAS|JSON|["NOVACION","CAPTACION"]

---

## Notas de salida por fase

### INIT
- Se evalúan todas las ofertas habilitadas.
- La regla de decisión INIT deja límites financieros en `dictamen`.
- `eligibleOffers` contiene objetos completos de oferta (no proyección reducida).

### PRE
- `eligibleOffers` contiene objetos completos de oferta con el resultado PRE en `dictamen`.

### FINAL
- `eligibleOffers` contiene objetos completos de oferta finalistas (`dictamen.eligible=true`).
- Los límites financieros siguen disponibles en `dictamen` (por configuración actual ya se informan en INIT, y FINAL no requiere reconstruir una proyección de límites).
