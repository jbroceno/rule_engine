# Especificación: `cfg_offer_dates` — Renombrado de `MOTOR_FECHAS`

## Resumen

Esta especificación define los requisitos del renombrado de la tabla `MOTOR_FECHAS` a `cfg_offer_dates` en todos los módulos del sistema. El cambio es nominal: no altera la lógica de negocio ni los datos almacenados, solo unifica la nomenclatura técnica.

## Actores

- **Desarrollador backend** — consume la nueva nomenclatura en servicios y validadores Node.js.
- **Desarrollador frontend** — consume los nuevos nombres de campo en interfaces TypeScript y componentes Angular.
- **DBA / Operador de despliegue** — ejecuta el script de migración idempotente sobre instancias existentes.
- **Sistema motor de reglas** — sigue consultando la tabla renombrada de forma transparente vía stored procedures.

## Requisitos funcionales

### RF-001 — Tipo datetime en cfg_offer_dates

El sistema SHALL almacenar `valid_from` y `valid_to` de `dbo.cfg_offer_dates` con tipo `DATETIME2(0)`, soportando valores no-medianoche (por ejemplo `2026-03-15 14:32:07`). La tabla `cfg_offer_dates` está alineada con el prefijo `cfg_` del resto de tablas del módulo de configuración.

#### Escenario: Período con hora no-medianoche creado desde la API

- **Given** la tabla `dbo.cfg_offer_dates` con columnas `DATETIME2(0)`
- **When** se envía `POST /api/admin/offer-dates` con `valid_from = "2026-03-15T14:32:07"` y `valid_to = null`
- **Then** la fila se crea con `valid_from = 2026-03-15 14:32:07` en la base de datos
- **And** la columna `valid_from` del tipo `DATETIME2` NO muestra milisegundos (precisión = 0)

#### Escenario: Período con medianoche — compatibilidad hacia atrás

- **Given** registros preexistentes con `valid_from = 2026-01-01 00:00:00` (migrados desde `DATE`)
- **When** se consulta `GET /api/admin/offer-dates`
- **Then** esos registros se devuelven con la hora `00:00:00` intacta
- **And** el endpoint NO convierte ni trunca el valor de hora

#### Escenario: Creación inicial del esquema (compatibilidad)

- **Given** un entorno SQL Server limpio sin esquema previo
- **When** se ejecuta `rule_set/sql/data_model.sql`
- **Then** la tabla `dbo.cfg_offer_dates` queda creada con columnas `valid_from` y `valid_to` de tipo `DATETIME2(0)`
- **And** la tabla contiene las columnas `offer_date_id` (PK, INT IDENTITY), `descripcion`, `tipo_cd`, `alta_usr`, `alta_dt` y demás atributos definidos
- **And** no existe ninguna tabla `dbo.MOTOR_FECHAS` en el esquema

---

### RF-002 — Validación de solapamiento a granularidad de segundos

El sistema SHALL detectar solapamiento de períodos comparando `valid_from` y `valid_to` a granularidad de segundos. Dos períodos se solapan si sus intervalos `[valid_from, valid_to)` se intersectan en al menos un segundo.

#### Escenario: Período adyacente (sin solapamiento al segundo)

- **Given** un período existente `P1` con `valid_from = 2026-01-01 00:00:00` y `valid_to = 2026-06-01 08:00:00`
- **When** se crea un nuevo período `P2` con `valid_from = 2026-06-01 08:00:00`
- **Then** el sistema acepta la creación de `P2` (límites contiguos, sin solapamiento)
- **And** la validación de solapamiento NO devuelve error

#### Escenario: Solapamiento de un segundo

- **Given** un período existente `P1` con `valid_from = 2026-01-01 00:00:00` y `valid_to = 2026-06-01 08:00:01`
- **When** se intenta crear un período `P2` con `valid_from = 2026-06-01 08:00:00`
- **Then** el sistema rechaza la creación con error de solapamiento
- **And** no se crea ninguna fila en `dbo.cfg_offer_dates`

#### Escenario: Solapamiento que solo sería visible al segundo (no al día)

- **Given** un período existente `P1` con `valid_from = 2026-06-01 00:00:00` y `valid_to = 2026-06-01 12:30:00`
- **When** se intenta crear un período `P2` con `valid_from = 2026-06-01 12:00:00`
- **Then** el sistema rechaza la creación (los rangos se solapan entre las 12:00 y las 12:30)
- **And** la validación no habría detectado el solapamiento si solo comparase la parte de fecha

---

### RF-003 — Edición preserva componente de hora

El sistema SHALL preservar el componente de hora de `valid_from` y `valid_to` al editar un período de vigencia existente. La operación de edición no debe truncar ni descartar la porción de hora del valor original.

#### Escenario: Edición de descripción preserva hora exacta

- **Given** un período existente con `valid_from = 2026-03-15 14:32:07` y `valid_to = 2026-12-31 23:59:59`
- **When** el operador actualiza únicamente el campo `descripcion` del período y confirma
- **Then** `valid_from` permanece `2026-03-15 14:32:07` en la base de datos
- **And** `valid_to` permanece `2026-12-31 23:59:59` en la base de datos
- **And** NO se aplica ningún truncado `substring(0,10)` ni conversión a medianoche

#### Escenario: Edición de valid_to envía datetime completo

- **Given** el formulario de edición del período con `valid_from = 2026-03-15 14:32:07`
- **When** el operador establece `valid_to = 2026-09-30 18:00:00` y confirma
- **Then** la API recibe el valor `"2026-09-30T18:00:00"` (no `"2026-09-30"`)
- **And** la base de datos almacena `valid_to = 2026-09-30 18:00:00`

---

### RF-004 — Comparación temporal, no léxica

El validador del backend SHALL comparar `valid_to` vs `valid_from` usando comparación temporal de datetime, no comparación léxica de strings.

#### Escenario: valid_to menor que valid_from en datetime — rechazado

- **Given** una petición de creación de período con `valid_from = "2026-06-01T10:00:00"` y `valid_to = "2026-06-01T09:59:59"`
- **When** el validador procesa la petición
- **Then** devuelve error de validación (400): `valid_to` no puede ser anterior a `valid_from`
- **And** no se crea ninguna fila

#### Escenario: valid_to igual a valid_from — rechazado

- **Given** una petición con `valid_from = "2026-06-01T10:00:00"` y `valid_to = "2026-06-01T10:00:00"`
- **When** el validador procesa la petición
- **Then** devuelve error de validación (400): el período no puede ser de duración cero
- **And** no se crea ninguna fila

#### Escenario: valid_to posterior a valid_from — aceptado

- **Given** una petición con `valid_from = "2026-06-01T10:00:00"` y `valid_to = "2026-06-01T10:00:01"`
- **When** el validador procesa la petición
- **Then** la validación pasa y se crea la fila

#### Escenario: Comparación no se confunde con orden lexicográfico

- **Given** `valid_from = "2026-10-01T00:00:00"` y `valid_to = "2026-09-30T23:59:59"` (valid_to < valid_from en datetime pero ambos strings comparten el mismo año)
- **When** el validador procesa la petición
- **Then** devuelve error de validación (400)
- **And** esto prueba que la comparación es temporal, no un compare de strings que pudiera dar resultado distinto

---

### RF-005 — Frontend datetime-local con step=1

El sistema SHALL usar `<input type="datetime-local" step="1">` para todos los campos de fecha de vigencia en la interfaz de usuario. Los campos NO deben usar `type="date"`.

La UI SHALL mostrar los valores de `valid_from` y `valid_to` con el formato `dd/MM/yyyy HH:mm:ss` en modo de solo lectura (columnas de tabla y vistas de detalle).

#### Escenario: Input captura segundos

- **Given** el formulario de creación de un período de vigencia
- **When** el operador introduce `2026-06-01T14:32:07` en el campo `Desde`
- **Then** el valor enviado al backend en el body del request es `"2026-06-01T14:32:07"`
- **And** NO se trunca a `"2026-06-01"`

#### Escenario: Tabla lista muestra hora completa

- **Given** un período almacenado con `valid_from = 2026-06-01 14:32:07`
- **When** se visualiza la lista de períodos en la UI
- **Then** la columna "Desde" muestra `01/06/2026 14:32:07`
- **And** no muestra solo `01/06/2026`

---

### RF-006 — Migración de esquema DATE → DATETIME2(0)

El sistema SHALL incluir un script de migración `rule_set/sql/migrations/001_vigencia_datetime.sql` que altere las columnas `valid_from` y `valid_to` de `dbo.cfg_offer_dates` de `DATE` a `DATETIME2(0)`. La migración es idempotente y backward-compatible: los valores `DATE` existentes se convierten a la hora `00:00:00` (medianoche).

#### Escenario: Migración sobre instancia con valores DATE existentes

- **Given** la tabla `dbo.cfg_offer_dates` con columnas `DATE` y filas con `valid_from = 2026-01-01`
- **When** se ejecuta `migrations/001_vigencia_datetime.sql`
- **Then** las columnas pasan a tipo `DATETIME2(0)`
- **And** el valor `valid_from` de la fila existente es `2026-01-01 00:00:00` (midnight)
- **And** todos los datos preexistentes se conservan

#### Escenario: Migración idempotente (segunda ejecución)

- **Given** la tabla `dbo.cfg_offer_dates` ya con columnas `DATETIME2(0)`
- **When** se ejecuta `migrations/001_vigencia_datetime.sql` por segunda vez
- **Then** el script termina sin error
- **And** no se modifica ningún dato

## Restricciones invariantes

| ID | Restricción |
|----|-------------|
| INV-COD-01 | `valid_from` y `valid_to` en `dbo.cfg_offer_dates` DEBEN almacenarse como `DATETIME2(0)` (precisión de segundos, sin sub-segundos). |
| INV-COD-02 | Toda escritura de `valid_from` o `valid_to` DEBE truncar al segundo antes del INSERT/UPDATE (sin milisegundos residuales). |
| INV-COD-03 | La zona horaria es servidor-local / naive. NO se realiza ninguna conversión UTC en ninguna capa. |
| INV-COD-04 | El período de cierre de un período existente se establece con `valid_to = valid_from_del_nuevo_período` (límite exclusivo superior), alineado con la semántica `<= @DATE / > @DATE` de los stored procedures de lectura. |
| INV-COD-05 | Ningún código del backend DEBE enlazar `valid_from` o `valid_to` como `sql.Date`. El tipo de enlace debe ser `sql.DateTime2` (o `sql.DateTime` con truncado-a-segundo garantizado). |

## Requisitos no funcionales

| ID | Requisito | Descripción |
|----|-----------|-------------|
| RNF-COD-01 | Precisión consistente | Toda escritura de vigencia DEBE truncar al segundo. Ninguna fila DEBE contener sub-segundos residuales. Verificable por `SELECT * FROM cfg_offer_dates WHERE DATEPART(ms, valid_from) > 0`. |
| RNF-COD-02 | Compatibilidad de datos | La migración `DATE → DATETIME2(0)` DEBE preservar el 100% de las filas. Verificable por comparación de `COUNT(*)` pre/post. |
| RNF-COD-03 | Sin regresión de validación | El endpoint `POST /api/admin/offer-dates` DEBE rechazar tanto `valid_to < valid_from` como `valid_to = valid_from`. Verificable por test unitario del validador. |
| RNF-COD-04 | Idempotencia del script | El script de migración puede ejecutarse N veces sin error ni efecto colateral. |

## Escenarios de aceptación

---

### Escenario A — Cierre de período al crear uno nuevo (valid_to = valid_from del siguiente)

**Given** que existe el período `P1` con `valid_from = 2026-01-01 00:00:00` y `valid_to = NULL`

**When** se crea el período `P2` con `valid_from = 2026-06-15 09:45:00`

**Then**:
- `P1.valid_to` DEBE actualizarse a `2026-06-15 09:45:00` (el `valid_from` exacto de `P2`)
- NO se aplica ningún ajuste de `-1 día` ni `-1 segundo`
- `P2.valid_from = 2026-06-15 09:45:00` y `P2.valid_to = NULL`

---

### Escenario B — Sin gap ni solapamiento en lectura SP tras cierre

**Given** que `P1.valid_to = 2026-06-15 09:45:00` y `P2.valid_from = 2026-06-15 09:45:00`

**When** la SP de lectura evalúa `@DATE = '2026-06-15 09:44:59'`

**Then** el stored procedure DEVUELVE el período `P1` (`P1.valid_from <= @DATE` y `P1.valid_to > @DATE`)

**When** la SP de lectura evalúa `@DATE = '2026-06-15 09:45:00'`

**Then** el stored procedure DEVUELVE el período `P2` (`P2.valid_from <= @DATE` y `P2.valid_to IS NULL`)

**And** ningún @DATE devuelve ambos períodos simultáneamente (sin solapamiento) ni ninguno (sin gap)

---

### Escenario C — Round-trip completo de datetime con segundos

**Given** el sistema con `cfg_offer_dates` en `DATETIME2(0)`

**When** se crea un período con `valid_from = "2026-03-15T14:32:07"` via `POST /api/admin/offer-dates`

**And** se consulta inmediatamente via `GET /api/admin/offer-dates`

**Then** el valor devuelto en `valid_from` es `"2026-03-15T14:32:07"` (o equivalente ISO-8601 con la misma hora)
**And** NO se ha truncado a `"2026-03-15T00:00:00"` ni a `"2026-03-15"`

---

### Escenario D — Ningún binding sql.Date en admin_fechas_service.js

**Given** el cambio aplicado

**When** se inspecciona el código de `admin_fechas_service.js`

**Then** ninguna línea enlaza `valid_from` o `valid_to` con `sql.Date`
**And** los bindings usan `sql.DateTime2` (o `sql.DateTime` con truncado explícito a segundos)

---

## Criterios de aceptación

| ID | Área | Descripción | Condiciones | Resultado esperado |
|----|------|-------------|-------------|-------------------|
| CA-COD-001 | SQL | Tipo de columna DATETIME2(0) | `SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='cfg_offer_dates' AND COLUMN_NAME='valid_from'` | `datetime2` |
| CA-COD-002 | SQL | Sin sub-segundos | `SELECT COUNT(*) FROM cfg_offer_dates WHERE DATEPART(ms, valid_from) > 0` | 0 |
| CA-COD-003 | Backend | Sin binding sql.Date | Inspección de `admin_fechas_service.js`, `admin_workflow_service.js`, `admin_service.js` | Sin referencias a `sql.Date` para campos de vigencia |
| CA-COD-004 | Validador | Rechaza valid_to <= valid_from | `npm test --test-name-pattern "validator.*valid_to"` | Tests verdes; invalid cases rechazados con 400 |
| CA-COD-005 | API | Round-trip con segundos | POST con `valid_from=T14:32:07`, GET posterior | Respuesta incluye la hora `14:32:07` |
| CA-COD-006 | UI | Input datetime-local | Abrir `/offer-dates` y revisar los inputs de fecha | `type="datetime-local"` con `step="1"`; ningún `type="date"` |
| CA-COD-007 | UI | Pipe muestra HH:mm:ss | Abrir lista de períodos con datos no-medianoche | Columnas "Desde" y "Hasta" muestran `dd/MM/yyyy HH:mm:ss` |
| CA-COD-008 | Migración | Idempotente | Ejecutar `migrations/001_vigencia_datetime.sql` dos veces | Sin error en la segunda ejecución |
| CA-COD-009 | Solapamiento | Adyacentes aceptados | Crear P2 con `valid_from = P1.valid_to` exacto | Creación exitosa |
| CA-COD-010 | Cierre de período | valid_to = valid_from nuevo | Crear P2 con `valid_from = T09:45:00` cuando P1.valid_to=NULL | P1.valid_to actualizado a `T09:45:00` sin ajuste de día |
