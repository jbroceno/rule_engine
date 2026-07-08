# Especificación delta — vigencia-datetime / workflow-deployment

**Cambio**: vigencia-datetime
**Estado**: borrador
**Fecha**: 2026-06-08
**Autor**: Análisis funcional Ofertas Hipotecarias

> **NOTA DE SUPERSESIÓN PARCIAL.** Los requisitos de este documento REEMPLAZAN los
> siguientes apartados de `openspec/changes/mro-snapshot-deploy/specs/workflow-deployment/spec.md`:
> - `RF-MRO-02.1`: la clave de identidad del upsert `MRO_MOTORFECHA` ahora se compara a
>   granularidad de **segundos** (no de días).  
> - `RF-MRO-04` (snapshot SP): los parámetros `@VIGENCIA_*` pasan a `DATETIME2`; el match
>   se hace a granularidad de segundos, eliminando cualquier `CAST(... AS DATE)`.
> - La invariante de idempotencia de deploy: ahora se garantiza por normalización a
>   segundo consistente (no por truncado a día).
>
> Todos los demás requisitos de `mro-snapshot-deploy` (`RF-MRO-01`, `RF-MRO-03`,
> `RF-MRO-05` a `RF-MRO-08`, generación de IDs, ENTORNO_CD, capacidades UI) permanecen
> sin cambio.

---

## Índice

1. [Alcance del delta](#1-alcance-del-delta)
2. [Restricciones invariantes](#2-restricciones-invariantes)
3. [RF-VDT-01 — Identidad de período a granularidad de segundos en upsertMotorFecha](#3-rf-vdt-01)
4. [RF-VDT-02 — Reemplazar período creado por herramienta WF externa](#4-rf-vdt-02)
5. [RF-VDT-03 — Período no coincidente crea fila nueva (sin sobreescritura silenciosa)](#5-rf-vdt-03)
6. [RF-VDT-04 — SP cfg_get_workflow_snapshot_json con parámetros DATETIME2](#6-rf-vdt-04)
7. [RF-VDT-05 — Normalización truncada-a-segundo en toda ruta de escritura](#7-rf-vdt-05)
8. [RF-VDT-06 — Snapshot de seguridad no afectado](#8-rf-vdt-06)
9. [Escenarios de aceptación](#9-escenarios-de-aceptacion)
10. [Requisitos no funcionales](#10-requisitos-no-funcionales)
11. [Criterios de aceptación (tabla)](#11-criterios-de-aceptacion)

---

## 1. Alcance del delta

### Lo que cambia (MODIFIED)

| Requisito base (mro-snapshot-deploy) | Cambio |
|--------------------------------------|--------|
| `RF-MRO-02.1`: clave upsert `(DESDE_DT, HASTA_DT, TIPO_DS)` comparada vía `CAST(DESDE_DT AS DATE)` | MODIFICADO → comparación exacta `DESDE_DT = @desde` a granularidad de segundos |
| `RF-MRO-04.1`: SP `cfg_get_workflow_snapshot_json` con parámetros `DATE` | MODIFICADO → parámetros `DATETIME2`; match exacto a segundo |
| Backend binding para `vigDesde`/`vigHasta` en `admin_workflow_service.js` | MODIFICADO → `sql.DateTime2` (era `sql.Date`) |
| Invariante idempotencia de deploy (dos deploys = mismo resultado) | MODIFICADO → garantizado por normalización a segundo, no por truncado a día |

### Lo que NO cambia

- Semántica del upsert (reutilizar `MOTORFECHA_ID` si clave existe, crear fila nueva si no).
- Captura de MAX ids antes del borrado (`RF-MRO-03`).
- Borrado acotado por `TIPO_DS` (`RF-MRO-02.2`).
- No escritura de `VIGENCIA_DESDE_DT`/`VIGENCIA_HASTA_DT` en tablas MRO_ (`INV-01`).
- Generación de snapshots de seguridad antes de todo deploy.
- Capacidades de UI (publicar a WF, snapshot WF, restaurar snapshot WF a POC).
- `ENTORNO_CD` en `cfg_config_snapshot`.

---

## 2. Restricciones invariantes

| ID | Restricción |
|----|-------------|
| INV-VDT-01 | El match de período en `upsertMotorFecha` DEBE usar `DESDE_DT = @desde` a granularidad de segundos. El sistema NO DEBE usar `CAST(DESDE_DT AS DATE) = CAST(@desde AS DATE)` ni ningún otro truncado a día en la llave de identidad de `MRO_MOTORFECHA`. |
| INV-VDT-02 | Toda escritura de `DESDE_DT`/`HASTA_DT` en `MRO_MOTORFECHA` DEBE normalizar al segundo antes del INSERT (sin sub-segundos). Esto previene la regresión de filas-huérfanas: un re-deploy al mismo segundo debe hit la misma fila. |
| INV-VDT-03 | Los parámetros `@VIGENCIA_DESDE` y `@VIGENCIA_HASTA` de `cfg_get_workflow_snapshot_json` DEBEN declararse como `DATETIME2` (no `DATE`). El match DEBE ser `DESDE_DT = @VIGENCIA_DESDE` sin ningún `CAST(... AS DATE)`. |
| INV-VDT-04 | Zona horaria: servidor-local / naive en toda la cadena (ninguna conversión UTC). Requerido para que los datetimes almacenados coincidan con los `DESDE_DT` de la herramienta WF externa, que usa `GETDATE()` (hora local). |
| INV-VDT-05 | Dos períodos con el mismo día de calendario pero distinta hora DEBEN tratarse como períodos DISTINTOS en todo el sistema. El sistema NO DEBE fusionarlos. |

---

## 3. RF-VDT-01 — Identidad de período a granularidad de segundos en upsertMotorFecha

El sistema SHALL identificar un período `MRO_MOTORFECHA` existente comparando `DESDE_DT`
al segundo exacto: `WHERE DESDE_DT = @desde AND HASTA_DT = @hasta AND TIPO_DS = @tipo`.
El sistema SHALL eliminar cualquier uso de `CAST(DESDE_DT AS DATE)` en la clave de
búsqueda del upsert.

#### Scenario: Match exacto al segundo — reutiliza MOTORFECHA_ID

- **Given** que existe en `MRO_MOTORFECHA` la fila con `DESDE_DT = 2026-06-01 14:32:07`, `HASTA_DT = 2026-12-31 23:59:59`, `TIPO_DS = 'AMBOS'` y `MOTORFECHA_ID = 55`
- **When** se ejecuta un deploy con `vigDesde = "2026-06-01T14:32:07"`, `vigHasta = "2026-12-31T23:59:59"` y `TIPO_DS = 'AMBOS'`
- **Then** el sistema reutiliza `MOTORFECHA_ID = 55` (no crea fila nueva en `MRO_MOTORFECHA`)
- **And** las filas dependientes (`MRO_MOTORREGLA`, `MRO_MOTORPARAM`) del `MOTORFECHA_ID = 55` son borradas y reinsertadas

#### Scenario: Misma fecha, hora distinta — NO hace match (crea fila nueva)

- **Given** que existe en `MRO_MOTORFECHA` la fila con `DESDE_DT = 2026-06-01 14:32:07`, `MOTORFECHA_ID = 55`
- **When** se ejecuta un deploy con `vigDesde = "2026-06-01T09:00:00"` (mismo día, hora distinta)
- **Then** el sistema NO reutiliza `MOTORFECHA_ID = 55`
- **And** se crea una nueva fila en `MRO_MOTORFECHA` con `MOTORFECHA_ID = MAX_previo + 1` y `DESDE_DT = 2026-06-01 09:00:00`
- **And** las filas de `MOTORFECHA_ID = 55` permanecen intactas

---

## 4. RF-VDT-02 — Reemplazar período creado por herramienta WF externa

> **Este es el requisito central del cambio.**

El sistema SHALL ser capaz de sustituir (reemplazar) un período `MRO_MOTORFECHA` creado
por la herramienta WF externa, cuya `DESDE_DT` es no-medianoche (hora arbitraria al segundo).

Para ello, el sistema SHALL:
1. Recibir el `vigDesde` con precisión de segundos (formato `datetime-local`).
2. Enlazarlo como `sql.DateTime2` (o equivalente), sin truncado a día.
3. Hacer match `DESDE_DT = @desde` exacto en `MRO_MOTORFECHA`.
4. Si el match tiene éxito: reutilizar el `MOTORFECHA_ID` existente, borrar y reinsertar las filas dependientes.

El sistema NO SHALL crear una fila nueva en `MRO_MOTORFECHA` cuando ya existe un período
con exactamente ese `DESDE_DT` al segundo.

#### Scenario: Reemplazar período WF-tool no-medianoche (caso central)

- **Given** que la herramienta WF externa ha creado en `MRO_MOTORFECHA` el período con `DESDE_DT = 2026-04-10 11:07:22`, `HASTA_DT = NULL`, `TIPO_DS = 'AMBOS'` y `MOTORFECHA_ID = 99`
- **And** ese período tiene reglas asociadas en `MRO_MOTORREGLA` (ids 201, 202, 203)
- **When** el operador republica a WF con `vigDesde = "2026-04-10T11:07:22"` y `vigHasta = null`
- **Then** el sistema reconoce `MOTORFECHA_ID = 99` como el período exacto
- **And** borra las filas `MRO_MOTORREGLA` con `MOTORFECHA_ID = 99` (ids 201, 202, 203)
- **And** inserta las nuevas reglas con `MOTORFECHA_ID = 99` (ids continuados desde MAX capturado antes del borrado)
- **And** NO existe una segunda fila en `MRO_MOTORFECHA` con `DESDE_DT = 2026-04-10 11:07:22` (no se crea fila huérfana)
- **And** el `COUNT(*) WHERE DESDE_DT = '2026-04-10 11:07:22'` en `MRO_MOTORFECHA` es exactamente 1

#### Scenario: Verificación de ausencia de fila huérfana tras republicación

- **Given** el escenario anterior aplicado
- **When** se consulta `SELECT COUNT(*) FROM MRO_MOTORFECHA WHERE CAST(DESDE_DT AS DATE) = '2026-04-10'`
- **Then** el resultado es 1 (exactamente una fila para ese día — la original, reutilizada)
- **And** NO existe una segunda fila con `DESDE_DT = 2026-04-10 00:00:00` (la que habría creado el binding `sql.Date`)

---

## 5. RF-VDT-03 — Período no coincidente crea fila nueva (sin sobreescritura silenciosa)

El sistema SHALL crear una nueva fila en `MRO_MOTORFECHA` cuando ninguna fila existente
coincide exactamente con `(DESDE_DT, HASTA_DT, TIPO_DS)` al segundo. El sistema NO SHALL
buscar el período más próximo ni realizar ningún match aproximado.

#### Scenario: Datetime distinto en un segundo — crea período nuevo

- **Given** que existe en `MRO_MOTORFECHA` la fila con `DESDE_DT = 2026-04-10 11:07:22` y `MOTORFECHA_ID = 99`
- **When** se ejecuta un deploy con `vigDesde = "2026-04-10T11:07:23"` (un segundo posterior)
- **Then** el sistema crea una nueva fila en `MRO_MOTORFECHA` con `DESDE_DT = 2026-04-10 11:07:23`
- **And** el `MOTORFECHA_ID` nuevo es `MAX_previo + 1` (distinto de 99)
- **And** la fila con `MOTORFECHA_ID = 99` permanece intacta

#### Scenario: Datetime coincide excepto en HASTA_DT — crea período nuevo

- **Given** que existe en `MRO_MOTORFECHA` la fila con `DESDE_DT = 2026-04-10 11:07:22`, `HASTA_DT = NULL` y `MOTORFECHA_ID = 99`
- **When** se ejecuta un deploy con `vigDesde = "2026-04-10T11:07:22"` pero `vigHasta = "2026-12-31T23:59:59"` (HASTA_DT diferente)
- **Then** el sistema crea una nueva fila en `MRO_MOTORFECHA` (la clave `(DESDE_DT, HASTA_DT, TIPO_DS)` no coincide exactamente)
- **And** `MOTORFECHA_ID = 99` permanece intacto

---

## 6. RF-VDT-04 — SP cfg_get_workflow_snapshot_json con parámetros DATETIME2

El stored procedure `cfg_get_workflow_snapshot_json` SHALL aceptar los parámetros
`@VIGENCIA_DESDE` y `@VIGENCIA_HASTA` como tipo `DATETIME2` (no `DATE`). El match
contra `MRO_MOTORFECHA.DESDE_DT` SHALL usarse sin ningún `CAST(... AS DATE)`.

#### Scenario: SP encuentra período no-medianoche con parámetros DATETIME2

- **Given** un período en `MRO_MOTORFECHA` con `DESDE_DT = 2026-04-10 11:07:22` y `HASTA_DT = NULL`
- **When** se invoca `cfg_get_workflow_snapshot_json` con `@VIGENCIA_DESDE = '2026-04-10 11:07:22'` y `@VIGENCIA_HASTA = NULL`
- **Then** la SP devuelve el snapshot correspondiente a ese período
- **And** el resultado NO está vacío

#### Scenario: SP con fecha exacta tipo DATE no encuentra período no-medianoche

> Este escenario es negativo: documenta el comportamiento ANTERIOR que DEBE desaparecer.

- **Given** un período en `MRO_MOTORFECHA` con `DESDE_DT = 2026-04-10 11:07:22`
- **When** se invoca la SP con `@VIGENCIA_DESDE` de tipo `DATE` (o `'2026-04-10 00:00:00'` truncado a medianoche)
- **Then** la SP NO encuentra el período (el match falla porque `11:07:22 ≠ 00:00:00`)
- **And** el resultado está vacío — esto ilustra el bug que RF-VDT-04 cierra

#### Scenario: Backend pasa parámetros como sql.DateTime2 — no sql.Date

- **Given** el cambio aplicado en `admin_workflow_service.js` / `createWorkflowSnapshot`
- **When** se inspecciona el código fuente de la función que llama a `cfg_get_workflow_snapshot_json`
- **Then** los parámetros `@VIGENCIA_DESDE` y `@VIGENCIA_HASTA` se enlazan con `sql.DateTime2` (o `sql.DateTime`)
- **And** NO existen llamadas con `sql.Date` para esos parámetros

---

## 7. RF-VDT-05 — Normalización truncada-a-segundo en toda ruta de escritura

El sistema SHALL truncar al segundo (sin sub-segundos) cualquier valor datetime antes
de insertarlo o usarlo como clave de búsqueda en `MRO_MOTORFECHA`. Esta normalización
es la garantía que reemplaza al antiguo truncado-a-día: asegura que dos deploys del
mismo período producen el mismo `DESDE_DT` en base de datos y por tanto hacen match.

#### Scenario: Sub-segundos no persisten en MRO_MOTORFECHA

- **Given** que el backend recibe un `vigDesde` con componente de mili/microsegundos (por ejemplo, desde un Date.now() con ms)
- **When** se ejecuta el upsert en `MRO_MOTORFECHA`
- **Then** el valor almacenado en `DESDE_DT` tiene milisegundos = 0 (DATETIME2(0) o truncado explícito)
- **And** un segundo upsert con el mismo segundo pero diferente componente ms hace match con la fila existente

#### Scenario: Idempotencia — dos deploys del mismo período

- **Given** que se ha ejecutado un deploy con `vigDesde = "2026-06-01T14:32:07"` y `MRO_MOTORFECHA` tiene `DESDE_DT = 2026-06-01 14:32:07`
- **When** se ejecuta exactamente el mismo deploy por segunda vez
- **Then** el `COUNT(*) FROM MRO_MOTORFECHA WHERE DESDE_DT = '2026-06-01 14:32:07'` es 1 (no se duplica)
- **And** las reglas/params del período son las de la segunda ejecución (las de la primera fueron reemplazadas)

---

## 8. RF-VDT-06 — Snapshot de seguridad no afectado

El comportamiento de generación de snapshots de seguridad (automático antes de todo
deploy) SHALL permanecer inalterado. Este requisito documenta que el cambio de
granularidad NO modifica la lógica de snapshots.

#### Scenario: Snapshot de seguridad generado antes de deploy con hora no-medianoche

- **Given** que el operador inicia un deploy con `vigDesde = "2026-04-10T11:07:22"`
- **When** se procesa el request
- **Then** se crea un snapshot de seguridad en `cfg_config_snapshot` con `ENTORNO_CD = 'WF'` ANTES de cualquier modificación en `MRO_MOTORFECHA`
- **And** la respuesta de la API incluye el `snapshot_id` de ese snapshot
- **And** si el deploy falla, el rollback SQL deja la BD en el estado capturado

---

## 9. Escenarios de aceptación

---

### Escenario 01 — Caso raíz: herramienta WF externa crea período, nosotros lo reemplazamos

**Dado** que la herramienta WF externa ha creado en `MRO_MOTORFECHA`:
- `DESDE_DT = 2026-04-10 11:07:22`
- `HASTA_DT = NULL`
- `TIPO_DS = 'AMBOS'`
- `MOTORFECHA_ID = 99`
- Con reglas en `MRO_MOTORREGLA` ids: 500, 501, 502

**Y** el sistema actual tendría `sql.Date` → truncado a `2026-04-10 00:00:00` → match falla → crea fila nueva (bug)

**Cuando** se republica el período con el sistema corregido: `vigDesde = "2026-04-10T11:07:22"`, `vigHasta = null`, `TIPO_DS = 'AMBOS'`

**Entonces**:
- `SELECT COUNT(*) FROM MRO_MOTORFECHA WHERE CAST(DESDE_DT AS DATE) = '2026-04-10'` = **1** (no 2)
- `MOTORFECHA_ID` del registro es **99** (reutilizado, no un id nuevo)
- Las reglas 500, 501, 502 han sido borradas y reinsertadas con ids `MAX_before_delete + 1, +2, +3`
- La respuesta de la API NO indica error

---

### Escenario 02 — Match exacto con período propio (non-WF-tool, medianoche)

**Dado** que existe un período creado por nuestro sistema con `DESDE_DT = 2026-01-01 00:00:00` y `MOTORFECHA_ID = 10`

**Cuando** se republica con `vigDesde = "2026-01-01T00:00:00"` (medianoche)

**Entonces**:
- El sistema reutiliza `MOTORFECHA_ID = 10` (match exacto al segundo — la hora es `00:00:00` en ambos)
- El comportamiento es idéntico al anterior (compatibilidad hacia atrás)

---

### Escenario 03 — Deploy a datetime diferente no toca el período existente

**Dado** que existe en `MRO_MOTORFECHA` `DESDE_DT = 2026-04-10 11:07:22`, `MOTORFECHA_ID = 99`

**Cuando** se ejecuta un deploy con `vigDesde = "2026-04-10T00:00:00"` (medianoche del mismo día)

**Entonces**:
- Se crea una NUEVA fila en `MRO_MOTORFECHA` con `DESDE_DT = 2026-04-10 00:00:00` y `MOTORFECHA_ID = MAX_previo + 1`
- La fila con `MOTORFECHA_ID = 99` y `DESDE_DT = 11:07:22` permanece intacta
- `COUNT(*) FROM MRO_MOTORFECHA WHERE CAST(DESDE_DT AS DATE) = '2026-04-10'` = 2 (dos períodos distintos)

---

### Escenario 04 — SP snapshot con DESDE_DT no-medianoche

**Dado** que existe en `MRO_MOTORFECHA` `DESDE_DT = 2026-04-10 11:07:22`, `MOTORFECHA_ID = 99` con reglas y params

**Cuando** se llama a `cfg_get_workflow_snapshot_json` con `@VIGENCIA_DESDE = '2026-04-10 11:07:22'` (DATETIME2)

**Entonces**:
- La SP devuelve un JSON no vacío con las reglas y params del período 99
- El campo `DESDE_DT` en el JSON es `2026-04-10T11:07:22` (no `2026-04-10T00:00:00`)

---

### Escenario 05 — Regresión: no existen filas huérfanas tras 3 deploys repetidos

**Dado** que se ejecuta el deploy con `vigDesde = "2026-04-10T11:07:22"` exactamente 3 veces consecutivas

**Cuando** se consulta `MRO_MOTORFECHA`

**Entonces**:
- `COUNT(*) WHERE CAST(DESDE_DT AS DATE) = '2026-04-10'` = 1 (no 3)
- Solo existe un único `MOTORFECHA_ID` para ese `DESDE_DT`
- El estado final de reglas/params es el de la tercera ejecución

---

### Escenario 06 — Ningún binding sql.Date en admin_workflow_service.js

**Dado** el cambio aplicado

**Cuando** se inspecciona el código de `admin_workflow_service.js` y `admin_service.js`

**Entonces**:
- Ninguna línea enlaza `DESDE_DT`, `HASTA_DT`, `vigDesde`, `vigHasta`, `pocFechaDesde` o campos equivalentes de vigencia con `sql.Date`
- Los bindings usan `sql.DateTime2` (o `sql.DateTime`)

---

## 10. Requisitos no funcionales

| ID | Requisito | Descripción |
|----|-----------|-------------|
| RNF-VDT-01 | Sin filas huérfanas | Después de N deploys al mismo `(DESDE_DT, HASTA_DT, TIPO_DS)`, `COUNT(*) FROM MRO_MOTORFECHA WHERE CAST(DESDE_DT AS DATE) = @dia` DEBE ser igual al número de períodos distintos para ese día (no al número de deploys). |
| RNF-VDT-02 | Truncado a segundo | Ninguna fila de `MRO_MOTORFECHA` DEBE tener sub-segundos en `DESDE_DT` o `HASTA_DT`. Verificable: `SELECT COUNT(*) FROM MRO_MOTORFECHA WHERE DATEPART(ms, DESDE_DT) > 0` = 0. |
| RNF-VDT-03 | Idempotencia de deploy | Ejecutar el mismo deploy dos veces consecutivas DEBE producir el mismo estado en `MRO_MOTORFECHA` y dependientes. Verificable por comparación de snapshots pre y post segundo deploy. |
| RNF-VDT-04 | Transaccionalidad | Todo el upsert (match/insert MOTORFECHA + borrado dependientes + insert dependientes) DEBE ocurrir en una única transacción SQL. Fallo → rollback completo. (Invariante heredada de `mro-snapshot-deploy`; se confirma aquí como aplicable también al nuevo path.) |
| RNF-VDT-05 | Timezone naive | Ninguna capa DEBE convertir los valores datetime a UTC ni aplicar offsets. La validación PUEDE incluir un test que verifica que el valor almacenado `DESDE_DT` coincide byte-a-byte con el valor enviado desde el frontend (sin offset). |

---

## 11. Criterios de aceptación

| ID | Área | Descripción | Condiciones | Resultado esperado |
|----|------|-------------|-------------|-------------------|
| CA-VDT-001 | SQL | Sin filas huérfanas tras re-deploy | Ejecutar el mismo deploy 3 veces; `SELECT COUNT(*) FROM MRO_MOTORFECHA WHERE CAST(DESDE_DT AS DATE) = @dia` | Cuenta = 1 (no 3) |
| CA-VDT-002 | SQL | MOTORFECHA_ID reutilizado en re-deploy | Deploy a `DESDE_DT = T11:07:22`; re-deploy mismo datetime; comparar `MOTORFECHA_ID` | El mismo id antes y después |
| CA-VDT-003 | SQL | Deploy hora distinta crea fila nueva | Deploy a `T11:07:22`, luego deploy a `T11:07:23`; contar filas para ese día | 2 filas distintas |
| CA-VDT-004 | SP | cfg_get_workflow_snapshot_json con DATETIME2 | Llamar SP con `@VIGENCIA_DESDE = T11:07:22` (tipo DATETIME2) | Resultado no vacío para período existente con esa hora |
| CA-VDT-005 | Backend | Sin binding sql.Date en rutas de vigencia | Inspección de `admin_workflow_service.js`, `admin_service.js` | Sin referencias `sql.Date` para campos de vigencia WF |
| CA-VDT-006 | Backend | Parámetro SP es sql.DateTime2 | Inspección de la llamada a `cfg_get_workflow_snapshot_json` | Parámetros `@VIGENCIA_*` enlazados como `sql.DateTime2` o `sql.DateTime` |
| CA-VDT-007 | API | Round-trip DESDE_DT non-midnight | Deploy con `vigDesde = "2026-04-10T11:07:22"`; snapshot posterior; extraer `DESDE_DT` del JSON | `DESDE_DT = 2026-04-10T11:07:22` (sin truncado) |
| CA-VDT-008 | Regresión | Compatibilidad con períodos medianoche | Deploy con `vigDesde = "2026-01-01T00:00:00"`; match contra fila existente `00:00:00` | MOTORFECHA_ID reutilizado (no fila nueva) |
| CA-VDT-009 | Snapshot seguridad | No afectado por cambio | Deploy con hora no-medianoche | `cfg_config_snapshot` con `ENTORNO_CD = 'WF'` creado antes del deploy; `snapshot_id` en respuesta |
| CA-VDT-010 | Tests | Suite completa verde | `npm test` tras aplicar el cambio | 0 tests rojos; tests de regresión de deploy pasan |
