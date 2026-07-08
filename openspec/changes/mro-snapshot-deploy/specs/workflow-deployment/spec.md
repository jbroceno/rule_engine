# Especificación delta — mro-snapshot-deploy

**Cambio**: mro-snapshot-deploy  
**Estado**: aprobado (listo para diseño)  
**Fecha**: 2026-06-02  
**Autor**: Análisis funcional Ofertas Hipotecarias

> **NOTA DE SUPERSESIÓN.** Este documento REEMPLAZA Y ANULA el contrato de despliegue de:
> - `openspec/specs/workflow-deployment/spec.md` (inline-VIGENCIA model)  
> - `openspec/changes/archive/2026-05-26-workflow-deployment/` (ídem)  
> - `openspec/changes/wf-offer-mapping/` (capabilidad oferta-mapping asumía VIGENCIA_*)  
>
> A partir de este cambio la vigencia en las tablas MRO_ se gestiona **exclusivamente** por la FK `MOTORFECHA_ID` hacia `MRO_MOTORFECHA`. Las columnas `VIGENCIA_DESDE_DT` / `VIGENCIA_HASTA_DT` se eliminan del modelo y **NO DEBEN escribirse**.

---

## Índice

1. [Alcance del delta](#1-alcance-del-delta)
2. [Restricciones invariantes](#2-restricciones-invariantes)
3. [RF-MRO-01 — SP de lectura del motor (cfg_get_offers_and_params_json)](#3-rf-mro-01--sp-de-lectura-del-motor)
4. [RF-MRO-02 — Upsert de MRO_MOTORFECHA (escritura)](#4-rf-mro-02--upsert-de-mro_motorfecha)
5. [RF-MRO-03 — Generación de IDs](#5-rf-mro-03--generaci%C3%B3n-de-ids)
6. [RF-MRO-04 — Capacidad 1: Tomar snapshot WF](#6-rf-mro-04--capacidad-1-tomar-snapshot-wf)
7. [RF-MRO-05 — Capacidad 2: Publicar config actual a WF](#7-rf-mro-05--capacidad-2-publicar-config-actual-a-wf)
8. [RF-MRO-06 — Capacidad 3: Publicar snapshot POC a WF](#8-rf-mro-06--capacidad-3-publicar-snapshot-poc-a-wf)
9. [RF-MRO-07 — Capacidad 4: Desplegar snapshot WF a POC](#9-rf-mro-07--capacidad-4-desplegar-snapshot-wf-a-poc)
10. [RF-MRO-08 — ENTORNO_CD](#10-rf-mro-08--entorno_cd)
11. [Escenarios de aceptación (Given/When/Then)](#11-escenarios-de-aceptaci%C3%B3n)
12. [Requisitos no funcionales](#12-requisitos-no-funcionales)

---

## 1. Alcance del delta

### Lo que cambia (IN SCOPE)

| # | Capacidad web | Estado actual |
|---|---------------|---------------|
| 1 | Tomar snapshot de WF — capturar estado vivo MRO_ → `cfg_config_snapshot` | SP lee `VIGENCIA_*` inline → debe migrar a `MOTORFECHA_ID` |
| 2 | Publicar configuración actual a WF (UI) | Endpoint existe; falta botón en UI; escritura usa `VIGENCIA_*` |
| 3 | Publicar snapshot POC registrado a WF | Por implementar sobre el path MRO |
| 4 | Desplegar snapshot de origen WF a POC | Deploy-a-POC hoy solo acepta origen POC |

Workstream SQL transversal (riesgo principal):

| Objeto SQL | Cambio requerido |
|------------|-----------------|
| `cfg_get_offers_and_params_json` | Reescribir: resolución por `TIPO_DS` + most-recent-wins |
| `cfg_get_workflow_snapshot_json` | Migrar de `VIGENCIA_*` inline a `MOTORFECHA_ID` JOIN |

### Fuera de alcance (explícito)

- `MRO_MOTORSNAPSHOT` como catálogo (el catálogo permanece en `dbo.cfg_config_snapshot`).
- Columnas `VIGENCIA_DESDE_DT` / `VIGENCIA_HASTA_DT` (se eliminan; no se migran ni se mantienen).
- Feature `BORRAR_VIGENCIA_*` (concepto distinto, no abordado aquí).
- Lógica de evaluación DNF / inversión en `rule_engine.js` más allá de consumir la salida ya resuelta de la SP corregida.
- Endpoints de comparación con el servicio Workflow (`/api/workflow/condiciones-hipotecas`): fuera del scope de este cambio.

---

## 2. Restricciones invariantes

| ID | Restricción |
|----|-------------|
| INV-01 | Las columnas `VIGENCIA_DESDE_DT` y `VIGENCIA_HASTA_DT` de `MRO_MOTORREGLA` y `MRO_MOTORPARAM` **NO DEBEN** ser escritas por ningún path de deploy/publish. |
| INV-02 | Toda fila de `MRO_MOTORREGLA` o `MRO_MOTORPARAM` creada por un deploy/publish **DEBE** tener `MOTORFECHA_ID` NOT NULL, apuntando a un registro existente en `MRO_MOTORFECHA`. |
| INV-03 | `ENTORNO_CD` en `cfg_config_snapshot` **DEBE** ser uno de: `'POC'`, `'WF'`. Ningún otro valor es admitido. |
| INV-04 | `TIPO_DS` en `MRO_MOTORFECHA` **DEBE** ser uno de: `'REGLAS'`, `'PARAMS'`, `'AMBOS'`. |
| INV-05 | Los IDs en tablas MRO_ no son IDENTITY. **DEBEN** calcularse como `MAX(id) + 1` dentro de la misma transacción que la inserción. |
| INV-06 | El `MAX(MOTORFECHA_ID)` (y todos los MAX de ids dependientes) **DEBE** capturarse **ANTES** de ejecutar cualquier borrado de la misma transacción. |

---

## 3. RF-MRO-01 — SP de lectura del motor

> **Objeto**: `dbo.cfg_get_offers_and_params_json` (archivo `wf_sp_cfg_get_offers_and_params_json.sql`).  
> **Precondición necesaria**: la SP puede recibir un parámetro de fecha `@DATE` (fecha de evaluación). Si es NULL, usa la fecha del sistema.

### Requisitos

**RF-MRO-01.1** Para una fecha dada `@DATE`, la SP DEBE devolver las reglas de cada oferta leyendo únicamente los periodos `MRO_MOTORFECHA` cuyo `TIPO_DS IN ('REGLAS', 'AMBOS')` y cuyo rango `[DESDE_DT, HASTA_DT]` cubre `@DATE` (HASTA_DT NULL equivale a "sin fin").

**RF-MRO-01.2** Para la misma fecha `@DATE`, la SP DEBE devolver los parámetros de cada oferta leyendo únicamente los periodos `MRO_MOTORFECHA` cuyo `TIPO_DS IN ('PARAMS', 'AMBOS')` y cuyo rango cubre `@DATE`.

**RF-MRO-01.3** Cuando múltiples periodos elegibles (según RF-MRO-01.1 o RF-MRO-01.2) cubren la misma fecha para la misma oferta y el mismo tipo de objeto, la SP DEBE seleccionar únicamente el periodo con el mayor `DESDE_DT` (most-recent-wins). El resultado NO DEBE contener filas duplicadas procedentes de periodos solapados.

**RF-MRO-01.4** Cuando un periodo `TIPO_DS = 'AMBOS'` y otro posterior `TIPO_DS = 'PARAMS'` se solapan para la misma oferta y la misma fecha, los parámetros DEBEN proceder del periodo `PARAMS` (mayor `DESDE_DT`) y las reglas del periodo `AMBOS`.

**RF-MRO-01.5** Si para una oferta y una fecha no existe ningún periodo elegible de tipo reglas, la SP DEBE devolver cero reglas para esa oferta (no error).

**RF-MRO-01.6** La SP NO DEBE referenciar ni leer las columnas `VIGENCIA_DESDE_DT` / `VIGENCIA_HASTA_DT`.

---

## 4. RF-MRO-02 — Upsert de MRO_MOTORFECHA (escritura)

> Aplica a los flujos de deploy/publish (Capacidades 2, 3, y el path de escritura de la Capacidad 1 en la SP de snapshot).

### Requisitos

**RF-MRO-02.1** Antes de insertar reglas/params en MRO_, el sistema DEBE resolver o crear un `MOTORFECHA_ID` ejecutando un upsert con clave `(DESDE_DT, HASTA_DT, TIPO_DS)`:

| Condición | Resultado |
|-----------|-----------|
| Existe fila en `MRO_MOTORFECHA` con exactamente los mismos `DESDE_DT`, `HASTA_DT` y `TIPO_DS` | Reutilizar el `MOTORFECHA_ID` existente; borrar las filas dependientes del tipo cubierto; reinsertar. |
| No existe coincidencia exacta | Crear nueva fila en `MRO_MOTORFECHA` con `MAX(MOTORFECHA_ID) + 1`; insertar dependientes. |

**RF-MRO-02.2** El borrado de filas dependientes en el path de re-uso DEBE realizarse por JOIN a `MOTORFECHA_ID`, acotado a los tipos de objeto que cubre el periodo:
- `TIPO_DS = 'REGLAS'` → borra solo `MRO_MOTORREGLA` (+ dependientes: condiciones, valores, acciones) con ese `MOTORFECHA_ID`.
- `TIPO_DS = 'PARAMS'` → borra solo `MRO_MOTORPARAM` con ese `MOTORFECHA_ID`.
- `TIPO_DS = 'AMBOS'` → borra ambos.

**RF-MRO-02.3** Los periodos con distintos rangos de fechas o distinto `TIPO_DS` DEBEN coexistir en `MRO_MOTORFECHA` sin borrado cruzado. El sistema NO DEBE eliminar periodos de distinto rango o tipo como efecto secundario de un deploy.

**RF-MRO-02.4** Las columnas `VIGENCIA_DESDE_DT` / `VIGENCIA_HASTA_DT` en `MRO_MOTORREGLA` y `MRO_MOTORPARAM` NO DEBEN ser escritas. Si las columnas aún existen en el esquema, el INSERT debe omitirlas explícitamente.

**RF-MRO-02.5** Todo el upsert MOTORFECHA + borrado de dependientes + inserción de nuevas filas DEBE ocurrir dentro de una única transacción SQL. Cualquier fallo DEBE provocar rollback completo.

---

## 5. RF-MRO-03 — Generación de IDs

**RF-MRO-03.1** Los IDs de toda tabla MRO_ (incluyendo `MRO_MOTORFECHA`) DEBEN calcularse como `MAX(id) + 1` para esa tabla, dentro de la misma transacción que la inserción.

**RF-MRO-03.2** `getMaxIds` (en `admin_workflow_service.js`) DEBE incluir `MAX(MOTORFECHA_ID)` de `MRO_MOTORFECHA` además de los MAX ya existentes.

**RF-MRO-03.3** El MAX de cada id DEBE capturarse ANTES de que se ejecute cualquier borrado en la misma transacción. La numeración continúa desde ese high-water mark (nunca reutiliza ids liberados por borrado).

**RF-MRO-03.4** En el path de re-uso de `MOTORFECHA_ID` (coincidencia exacta), el `MOTORFECHA_ID` reutilizado es el existente en la BD; los ids de las filas dependientes nuevas se calculan como MAX + 1 capturado ANTES del borrado de dependientes.

---

## 6. RF-MRO-04 — Capacidad 1: Tomar snapshot WF

**RF-MRO-04.1** La SP `cfg_get_workflow_snapshot_json` DEBE leer el estado actual de las tablas MRO_ mediante JOIN a `MRO_MOTORFECHA` por `MOTORFECHA_ID`. NO DEBE leer `VIGENCIA_DESDE_DT` / `VIGENCIA_HASTA_DT`.

**RF-MRO-04.2** El snapshot resultante DEBE capturar el estado completo de todas las ofertas activas: reglas, condiciones, valores de condición, acciones y parámetros en el momento de la captura, incluyendo la información del periodo `MRO_MOTORFECHA` (DESDE_DT, HASTA_DT, TIPO_DS) de cada registro.

**RF-MRO-04.3** El registro de catálogo generado en `cfg_config_snapshot` DEBE tener `ENTORNO_CD = 'WF'`.

**RF-MRO-04.4** La UI (página de snapshots) DEBE permitir filtrar por `ENTORNO_CD` para separar snapshots POC de snapshots WF.

---

## 7. RF-MRO-05 — Capacidad 2: Publicar configuración actual a WF

**RF-MRO-05.1** El configurador DEBE exponer una acción "Publicar a WF" que invoque `POST /api/admin/workflow/publicar` (endpoint ya existente).

**RF-MRO-05.2** Antes de aplicar el deploy, el sistema DEBE generar automáticamente un snapshot de seguridad del estado actual de WF (`ENTORNO_CD = 'WF'`) en `cfg_config_snapshot`.

**RF-MRO-05.3** El deploy DEBE seguir el path descrito en RF-MRO-02 (upsert MOTORFECHA + insert dependientes con FK, sin escribir `VIGENCIA_*`).

**RF-MRO-05.4** La respuesta de la API DEBE incluir el `snapshot_id` del snapshot de seguridad generado.

---

## 8. RF-MRO-06 — Capacidad 3: Publicar snapshot POC a WF

**RF-MRO-06.1** La UI DEBE ofrecer la acción "Publicar a WF" sobre filas del listado de snapshots cuyo `ENTORNO_CD = 'POC'`.

**RF-MRO-06.2** El backend DEBE extraer `rules_json` / `params_json` del snapshot POC seleccionado en `cfg_config_snapshot` y enrutar al mismo path de inserción MRO (RF-MRO-02).

**RF-MRO-06.3** El deploy del snapshot POC a WF DEBE seguir las mismas invariantes de RF-MRO-02 y RF-MRO-03 (upsert MOTORFECHA, captura MAX antes de borrado, sin escritura inline).

**RF-MRO-06.4** Antes de aplicar, el sistema DEBE generar automáticamente un snapshot de seguridad del estado WF actual (`ENTORNO_CD = 'WF'`).

---

## 9. RF-MRO-07 — Capacidad 4: Desplegar snapshot WF a POC

**RF-MRO-07.1** El sistema DEBE aceptar la restauración a POC de un snapshot cuyo `ENTORNO_CD = 'WF'` (actualmente solo acepta `ENTORNO_CD = 'POC'`).

**RF-MRO-07.2** La transformación del payload WF → POC DEBE incluir:

| Paso | Descripción |
|------|-------------|
| Resolución de oferta | Mapear cada oferta WF a su código POC usando la FK `cfg_offer_ruleset.oferta_id = MRO_MOTORFECHA.OFERTA_ID` (o equivalente). |
| Deduplicación de params | Si el snapshot WF contiene params de múltiples periodos `MRO_MOTORFECHA` para la misma clave de parámetro, retener únicamente el registro con mayor `DESDE_DT` (last-wins). |
| Mapeo de periodos a POC | Los rangos de fechas MRO (`DESDE_DT`, `HASTA_DT`) del snapshot WF DEBEN mapearse al periodo POC destino indicado por el usuario en el campo `pocFechaDesde`. |

**RF-MRO-07.3** La lógica de creación/selección de periodo POC destino (`cfg_offer_dates`) descrita en la especificación existente del sistema de deploy-a-POC PERMANECE SIN CAMBIO y aplica igualmente a origen WF.

**RF-MRO-07.4** Antes de aplicar, el sistema DEBE generar automáticamente un snapshot de seguridad del estado POC actual (`ENTORNO_CD = 'POC'`).

---

## 10. RF-MRO-08 — ENTORNO_CD

**RF-MRO-08.1** La columna `ENTORNO_CD` en `cfg_config_snapshot` DEBE aceptar únicamente los valores `'POC'` y `'WF'`. El sistema DEBE rechazar (error de validación) cualquier otro valor.

**RF-MRO-08.2** Todo snapshot creado por operaciones POC (apply, restore a POC) DEBE llevar `ENTORNO_CD = 'POC'`.

**RF-MRO-08.3** Todo snapshot creado por operaciones WF (tomar snapshot WF, snapshot de seguridad pre-deploy-a-WF) DEBE llevar `ENTORNO_CD = 'WF'`.

---

## 11. Escenarios de aceptación

> Formato: **Dado** (estado inicial) / **Cuando** (acción) / **Entonces** (resultado observable).

---

### Escenario 01 — Resolución most-recent-wins: periodo AMBOS + periodo PARAMS posterior

**Dado** que existe en `MRO_MOTORFECHA`:
- Periodo A: `TIPO_DS = 'AMBOS'`, `DESDE_DT = 2026-01-01`, `HASTA_DT = 2026-12-31`
- Periodo B: `TIPO_DS = 'PARAMS'`, `DESDE_DT = 2026-03-01`, `HASTA_DT = 2026-12-31`

**Cuando** se llama a `cfg_get_offers_and_params_json` con `@DATE = '2026-06-01'`

**Entonces**:
- Las reglas DEBEN provenir del Periodo A (único elegible para REGLAS).
- Los parámetros DEBEN provenir del Periodo B (mayor `DESDE_DT` entre A y B para PARAMS).
- El resultado NO DEBE contener filas duplicadas.

---

### Escenario 02 — Resolución most-recent-wins: un único periodo AMBOS

**Dado** que existe un único periodo `TIPO_DS = 'AMBOS'` cubriendo `@DATE`

**Cuando** se invoca la SP con esa fecha

**Entonces** tanto reglas como parámetros DEBEN proceder de ese periodo, sin duplicados.

---

### Escenario 03 — Sin periodo aplicable

**Dado** que no existe ningún periodo `MRO_MOTORFECHA` que cubra `@DATE` para una oferta dada

**Cuando** se invoca la SP con esa fecha

**Entonces** la SP DEBE devolver cero reglas y cero params para esa oferta sin lanzar error.

---

### Escenario 04 — Deploy a WF: periodo inexistente (creación de MOTORFECHA nuevo)

**Dado** que no existe en `MRO_MOTORFECHA` ninguna fila con `DESDE_DT = D1`, `HASTA_DT = D2`, `TIPO_DS = 'AMBOS'`

**Cuando** se ejecuta el deploy con ese rango y tipo

**Entonces**:
- DEBE crearse una nueva fila en `MRO_MOTORFECHA` con `MOTORFECHA_ID = MAX_previo + 1`.
- Las reglas y params DEBEN insertarse con FK `MOTORFECHA_ID` apuntando a la nueva fila.
- `VIGENCIA_DESDE_DT` y `VIGENCIA_HASTA_DT` NO DEBEN aparecer en las filas insertadas.

---

### Escenario 05 — Deploy a WF: periodo exacto ya existente (re-uso de MOTORFECHA_ID)

**Dado** que existe en `MRO_MOTORFECHA` una fila con exactamente `DESDE_DT = D1`, `HASTA_DT = D2`, `TIPO_DS = 'AMBOS'` y `MOTORFECHA_ID = 42`

**Cuando** se re-publica el mismo periodo (mismo rango y tipo)

**Entonces**:
- `MOTORFECHA_ID = 42` DEBE reutilizarse (no crearse fila nueva).
- Los `MRO_MOTORREGLA` y `MRO_MOTORPARAM` anteriores del `MOTORFECHA_ID = 42` DEBEN haber sido borrados antes de la inserción de los nuevos.
- Los ids de los nuevos registros dependientes DEBEN calcularse desde `MAX capturado ANTES del borrado + 1` (sin reciclar ids borrados).
- Los registros dependientes nuevos DEBEN tener `MOTORFECHA_ID = 42`.

---

### Escenario 06 — Deploy a WF: no afecta periodos de distinto rango/tipo

**Dado** que existen en `MRO_MOTORFECHA` dos periodos:
- Periodo X: `TIPO_DS = 'REGLAS'`, rango `[2026-01-01, 2026-03-31]`
- Periodo Y: `TIPO_DS = 'PARAMS'`, rango `[2026-04-01, 2026-12-31]`

**Cuando** se re-publica el Periodo X (coincidencia exacta)

**Entonces**:
- Solo las filas `MRO_MOTORREGLA` del Periodo X DEBEN borrarse y reinsertarse.
- Las filas `MRO_MOTORPARAM` del Periodo Y NO DEBEN verse afectadas.
- El Periodo Y DEBE permanecer intacto en `MRO_MOTORFECHA`.

---

### Escenario 07 — Deploy TIPO_DS = 'PARAMS': no borra MOTORREGLA

**Dado** un periodo existente con `TIPO_DS = 'PARAMS'`

**Cuando** se re-publica ese periodo

**Entonces**:
- Solo `MRO_MOTORPARAM` con ese `MOTORFECHA_ID` DEBEN borrarse y reinsertarse.
- Ninguna fila de `MRO_MOTORREGLA` DEBE ser afectada, aunque tenga el mismo `MOTORFECHA_ID`.

---

### Escenario 08 — Generación de IDs: high-water mark antes de borrado

**Dado** que `MAX(REGLA_ID) = 100` antes del deploy y el deploy re-usa un `MOTORFECHA_ID` existente con 5 reglas (IDs 96–100)

**Cuando** se ejecuta el deploy (borra IDs 96–100 y reinserta reglas nuevas)

**Entonces**:
- Los nuevos IDs DEBEN ser 101, 102, 103, … (no 96–100, aunque esos IDs estén libres tras el borrado).

---

### Escenario 09 — Tomar snapshot WF

**Dado** que `MRO_MOTORREGLA` y `MRO_MOTORPARAM` tienen datos con `MOTORFECHA_ID` asignado

**Cuando** el operador ejecuta la acción "Tomar snapshot WF"

**Entonces**:
- DEBE crearse un registro en `cfg_config_snapshot` con `ENTORNO_CD = 'WF'`.
- El JSON del snapshot DEBE contener las reglas, condiciones, acciones y parámetros, incluyendo `DESDE_DT`, `HASTA_DT` y `TIPO_DS` del periodo correspondiente.
- El snapshot NO DEBE contener referencias a `VIGENCIA_DESDE_DT` / `VIGENCIA_HASTA_DT` como información de vigencia.

---

### Escenario 10 — Snapshot de seguridad automático antes de deploy

**Dado** que existe configuración activa en WF

**Cuando** el operador inicia cualquier deploy/publish a WF (Capacidad 2, 3 o 4 → WF)

**Entonces**:
- DEBE crearse un snapshot de seguridad en `cfg_config_snapshot` con `ENTORNO_CD = 'WF'` ANTES de aplicar los cambios.
- La respuesta de la API DEBE incluir el `snapshot_id` de ese snapshot de seguridad.
- Si el deploy falla, el rollback SQL DEBE dejar la BD en el estado capturado por el snapshot de seguridad.

---

### Escenario 11 — Publicar snapshot POC a WF

**Dado** un snapshot en `cfg_config_snapshot` con `ENTORNO_CD = 'POC'` que contiene `rules_json` y `params_json`

**Cuando** el operador elige "Publicar a WF" sobre esa fila

**Entonces**:
- El backend DEBE leer `rules_json` / `params_json` del snapshot y ejecutar el path de inserción MRO (RF-MRO-02).
- El resultado DEBE ser idéntico a si se hubiera publicado la config POC directamente (Capacidad 2).
- Se aplican todas las invariantes de RF-MRO-02 y RF-MRO-03.

---

### Escenario 12 — Desplegar snapshot WF a POC: deduplicación de params last-wins

**Dado** un snapshot WF que contiene params de dos periodos `MRO_MOTORFECHA`:
- Periodo P1: `DESDE_DT = 2026-01-01`, param `TASA_MIN = 0.025`
- Periodo P2: `DESDE_DT = 2026-04-01`, param `TASA_MIN = 0.022`

**Cuando** el operador despliega ese snapshot a POC

**Entonces**:
- Solo DEBE insertarse el valor `TASA_MIN = 0.022` (de P2, mayor `DESDE_DT`).
- `TASA_MIN = 0.025` NO DEBE aparecer en POC.

---

### Escenario 13 — ENTORNO_CD: valor inválido rechazado

**Dado** una petición a la API que intenta crear un snapshot con `ENTORNO_CD = 'PRE'`

**Cuando** se procesa la petición

**Entonces**:
- El sistema DEBE devolver un error de validación (4xx).
- NO DEBE crearse ningún registro en `cfg_config_snapshot`.

---

### Escenario 14 — Filtrado de snapshots por entorno

**Dado** que existen snapshots con `ENTORNO_CD = 'POC'` y otros con `ENTORNO_CD = 'WF'`

**Cuando** el usuario filtra la lista de snapshots por `ENTORNO_CD = 'WF'`

**Entonces** SOLO DEBEN aparecer los snapshots WF en el resultado paginado.

---

### Escenario 15 — Regresión de simulación tras reescritura de SP

**Dado** que la SP `cfg_get_offers_and_params_json` ha sido reescrita con el nuevo modelo MOTORFECHA

**Cuando** se ejecuta el test suite `npm test` con fixtures de periodos solapados y por tipo

**Entonces**:
- Todos los tests existentes de simulación (INIT, PRE, FINAL) DEBEN pasar.
- Los tests de periodos solapados DEBEN verificar que el resultado contiene cero filas duplicadas.
- Los dictámenes (eligible/rejected) DEBEN coincidir exactamente con los valores pre-migración registrados en los fixtures.

---

## 12. Requisitos no funcionales

| ID | Requisito | Descripción |
|----|-----------|-------------|
| RNF-MRO-01 | Transaccionalidad | Todo deploy/publish DEBE ejecutarse en una sola transacción SQL. Fallo → rollback completo. |
| RNF-MRO-02 | Sin duplicados | La SP de lectura DEBE devolver exactamente cero filas duplicadas por (oferta, campo) ante periodos solapados. Verificable con query `GROUP BY ... HAVING COUNT(*) > 1`. |
| RNF-MRO-03 | Sin escritura inline | En producción no DEBE existir ningún INSERT/UPDATE que asigne `VIGENCIA_DESDE_DT` o `VIGENCIA_HASTA_DT` en tablas MRO_. Verificable por revisión de código. |
| RNF-MRO-04 | Regresión del motor | El test suite del motor JS (`npm test`) DEBE estar en verde tras la reescritura de la SP. Bloqueante para merge. |
| RNF-MRO-05 | Idempotencia de deploy | Ejecutar el mismo deploy dos veces consecutivas DEBE producir el mismo estado final en las tablas MRO_. No se acumulan filas duplicadas. |
| RNF-MRO-06 | Snapshot completo | Un snapshot WF DEBE capturar reglas, condiciones, valores de condición, acciones y parámetros de todas las ofertas activas con la información de periodo (`DESDE_DT`, `HASTA_DT`, `TIPO_DS`). |
