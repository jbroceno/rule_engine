# Especificación — Despliegue en Workflow

**Cambio**: workflow-deployment  
**Estado**: borrador  
**Fecha**: 2026-06-08 (actualizado: vigencia datetime)  
**Autor**: Análisis funcional Ofertas Hipotecarias

---

## 1. Resumen

Integración del motor de reglas de Ofertas Hipotecarias (POC) en la herramienta de Workflow. El cambio introduce cuatro bloques de trabajo:

1. **MOTOR_FECHAS** — gestión centralizada de períodos de vigencia de reglas y parámetros (con precisión de segundos, no solo días).
2. **Mejoras al sistema de snapshots** — restauración a POC o Workflow, snapshots del entorno Workflow.
3. **Publicación en Workflow** — transformación del modelo POC al modelo MRO_ de Workflow, con reemplazo exacto de períodos no-medianoche de la herramienta WF.
4. **Integración con el servicio Workflow** — endpoint adaptador y tests automáticos de comparación.

La migración del motor `rule_engine.js` al lenguaje propietario de Workflow (RT01) queda fuera de este ámbito y la completa un desarrollador especialista.

---

## 2. Alcance

### En scope

- Nueva tabla `MOTOR_FECHAS` y migración de `cfg_offer_rule` y `cfg_offer_param` para referenciarla.
- Vista de línea de tiempo de períodos en la UI del configurador.
- CRUD de períodos de vigencia desde la UI.
- Restauración de snapshots con destino seleccionable (POC | Workflow) y rango de fechas destino.
- Botón "Publicar en Workflow" con transformación de modelo POC → modelo MRO_.
- Generación de snapshots del entorno Workflow.
- Columna `entorno_cd` en la tabla de snapshots para distinguir POC vs Workflow.
- Endpoint `POST /api/workflow/condiciones-hipotecas` adaptador del contrato del servicio Workflow.
- Tests automáticos de comparación (fixture-based para CI + live opcionalmente por variable de entorno).
- Actualización de stored procedures POC para filtrar por fechas via JOIN a MOTOR_FECHAS.

### Fuera de scope

- Migración del motor `rule_engine.js` a Workflow (RT01).
- Scripts de BD del modelo Workflow ya existentes en `sql/workflow_deploy/` (RT02 — ya entregados, aplica solo si MOTOR_FECHAS requiere ajustes en MRO_).
- Validación del token de seguridad de Workflow (se asume validez del token recibido).
- Autenticación de usuarios de la UI del configurador.

### Supuestos

- Las tablas `MRO_MOTORREGLA` y `MRO_MOTORPARAM` conservan sus columnas `VIGENCIA_DESDE_DT`/`VIGENCIA_HASTA_DT` para compatibilidad con el procesamiento nativo de Workflow. Al publicar, esas columnas se populan desde `MOTOR_FECHAS`.
- El mapeo entre oferta POC y oferta Workflow es: `cfg_offer_ruleset.oferta_id = HIPO_OFERTA.OFERTA_ID`.
- Los IDs en tablas Workflow no son `IDENTITY`. Se calculan como `MAX(id) + 1` dentro de una transacción antes de insertar.
- Para tests automáticos CI, la fecha efectiva de resolución de reglas es `NULL` (reglas actualmente vigentes).
- El token del servicio Workflow en tests se lee de variable de entorno `WF_TOKEN`. Si no está definida, los tests live se omiten sin fallo.

---

## 3. Actores / Roles

| Actor | Descripción |
|-------|-------------|
| Administrador de reglas | Gestiona reglas (`cfg_offer_rule`) y sus períodos de vigencia. |
| Administrador de parámetros | Gestiona parámetros (`cfg_offer_param`) y sus períodos de vigencia. Puede ser un usuario diferente al de reglas. |
| Operador de configuración | Ejecuta publicaciones en Workflow, gestiona snapshots. Puede coincidir con los anteriores. |
| Motor de Workflow | Sistema externo que expone el endpoint `POST /ApiRest/GetOfertasHipotecas` y consume las tablas MRO_. |
| Sistema CI/CD | Ejecuta la suite de tests automatizados en cada build. |

---

## 2b. Restricciones invariantes (vigencia-datetime)

| ID | Restricción |
|----|-------------|
| INV-VDT-01 | El match de período en `upsertMotorFecha` DEBE usar `DESDE_DT = @desde` a granularidad de segundos. El sistema NO DEBE usar `CAST(DESDE_DT AS DATE) = CAST(@desde AS DATE)` ni ningún otro truncado a día en la llave de identidad de `MRO_MOTORFECHA`. |
| INV-VDT-02 | Toda escritura de `DESDE_DT`/`HASTA_DT` en `MRO_MOTORFECHA` DEBE normalizar al segundo antes del INSERT (sin sub-segundos). Esto previene la regresión de filas-huérfanas: un re-deploy al mismo segundo debe hit la misma fila. |
| INV-VDT-03 | Los parámetros `@VIGENCIA_DESDE` y `@VIGENCIA_HASTA` de `cfg_get_workflow_snapshot_json` DEBEN declararse como `DATETIME2` (no `DATE`). El match DEBE ser `DESDE_DT = @VIGENCIA_DESDE` sin ningún `CAST(... AS DATE)`. |
| INV-VDT-04 | Zona horaria: servidor-local / naive en toda la cadena (ninguna conversión UTC). Requerido para que los datetimes almacenados coincidan con los `DESDE_DT` de la herramienta WF externa, que usa `GETDATE()` (hora local). |
| INV-VDT-05 | Dos períodos con el mismo día de calendario pero distinta hora DEBEN tratarse como períodos DISTINTOS en todo el sistema. El sistema NO DEBE fusionarlos. |

---

## 4. Requisitos funcionales

### RF-001 — Tabla de períodos de vigencia (MOTOR_FECHAS) con precisión de segundos

El sistema DEBERÁ disponer de una tabla `MOTOR_FECHAS` (esquema `dbo`) con los siguientes campos:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `motor_fechas_id` | INT PK | Identificador. |
| `valid_from` | DATETIME2(0) NOT NULL | Inicio del período (inclusive, precisión de segundos). |
| `valid_to` | DATETIME2(0) NULL | Fin del período (inclusive, precisión de segundos). NULL = sin fin. |
| `descripcion` | NVARCHAR(200) NOT NULL | Texto descriptivo del período (ej: "Reglas iniciales", "Restricción ingresos"). |
| `tipo_cd` | VARCHAR(10) NOT NULL | Tipo: `REGLAS`, `PARAMS` o `AMBOS`. |
| `alta_usr` | NVARCHAR(100) NULL | Usuario creador. |
| `alta_dt` | DATETIME2(0) NOT NULL | Fecha de creación. |

**Reglas de integridad**:
- No pueden existir dos registros activos del mismo `tipo_cd` que se solapen en fechas. Un registro de tipo `AMBOS` solapa con `REGLAS` y con `PARAMS`.
- `valid_from` DEBE ser menor o igual que `valid_to` cuando `valid_to` no es NULL.
- Todos los valores de `valid_from` y `valid_to` DEBEN almacenarse sin sub-segundos (truncados a segundo, DATETIME2(0)).

### RF-002 — Identidad de período MRO_MOTORFECHA a granularidad de segundos

El sistema SHALL identificar un período `MRO_MOTORFECHA` existente comparando `DESDE_DT` al segundo exacto: `WHERE DESDE_DT = @desde AND HASTA_DT = @hasta AND TIPO_DS = @tipo`. El sistema SHALL eliminar cualquier uso de `CAST(DESDE_DT AS DATE)` en la clave de búsqueda del upsert.

**Requisito central**: El sistema SHALL ser capaz de sustituir (reemplazar) un período `MRO_MOTORFECHA` creado por la herramienta WF externa, cuya `DESDE_DT` es no-medianoche (hora arbitraria al segundo). Para ello, el sistema SHALL:
1. Recibir el `vigDesde` con precisión de segundos (formato `datetime-local`).
2. Enlazarlo como `sql.DateTime2` (o equivalente), sin truncado a día.
3. Hacer match `DESDE_DT = @desde` exacto en `MRO_MOTORFECHA`.
4. Si el match tiene éxito: reutilizar el `MOTORFECHA_ID` existente, borrar y reinsertar las filas dependientes.

El sistema NO SHALL crear una fila nueva en `MRO_MOTORFECHA` cuando ya existe un período con exactamente ese `DESDE_DT` al segundo.

### RF-003 — Período no coincidente crea fila nueva (sin sobreescritura silenciosa)

El sistema SHALL crear una nueva fila en `MRO_MOTORFECHA` cuando ninguna fila existente coincide exactamente con `(DESDE_DT, HASTA_DT, TIPO_DS)` al segundo. El sistema NO SHALL buscar el período más próximo ni realizar ningún match aproximado.

### RF-004 — SP cfg_get_workflow_snapshot_json con parámetros DATETIME2

El stored procedure `cfg_get_workflow_snapshot_json` SHALL aceptar los parámetros `@VIGENCIA_DESDE` y `@VIGENCIA_HASTA` como tipo `DATETIME2` (no `DATE`). El match contra `MRO_MOTORFECHA.DESDE_DT` SHALL usarse sin ningún `CAST(... AS DATE)`.

### RF-005 — Normalización truncada-a-segundo en toda ruta de escritura

El sistema SHALL truncar al segundo (sin sub-segundos) cualquier valor datetime antes de insertarlo o usarlo como clave de búsqueda en `MRO_MOTORFECHA`. Esta normalización es la garantía que reemplaza al antiguo truncado-a-día: asegura que dos deploys del mismo período producen el mismo `DESDE_DT` en base de datos y por tanto hacen match.

### RF-006 — Asociación de reglas al período de vigencia

El sistema DEBERÁ modificar `cfg_offer_rule` para eliminar los campos `valid_from` y `valid_to` y añadir:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `motor_fechas_id` | INT NOT NULL | FK a `MOTOR_FECHAS.motor_fechas_id`. |

**Impacto**: el stored procedure `dbo.cfg_get_offers_and_params_json` DEBERÁ actualizarse para filtrar reglas vigentes mediante JOIN a `MOTOR_FECHAS` usando la fecha recibida como parámetro.

### RF-007 — Asociación de parámetros al período de vigencia

El sistema DEBERÁ modificar `cfg_offer_param` para eliminar los campos `valid_from` y `valid_to` y añadir `motor_fechas_id` INT NOT NULL (FK a `MOTOR_FECHAS`).

**Impacto**: el stored procedure DEBERÁ filtrar parámetros vigentes mediante JOIN a `MOTOR_FECHAS`.

### RF-008 — Vista de línea de tiempo en el configurador

El sistema DEBERÁ mostrar en la UI del configurador una tabla de períodos de vigencia con las columnas: ID, Desde, Hasta, Tipo, Descripción y acciones (editar, eliminar).

Los registros DEBERÁN ordenarse por `valid_from` descendente.

### RF-009 — CRUD de períodos de vigencia

El usuario DEBERÁ poder crear, editar y eliminar registros en `MOTOR_FECHAS` desde la UI.

- **Crear**: formulario con Desde, Hasta (opcional), Tipo y Descripción. Los campos de fecha DEBEN capturar precisión de segundos (`datetime-local` con `step=1`).
- **Editar**: formulario pre-rellenado preservando hora exacta. No se permitirá editar un período si tiene reglas o parámetros asociados en uso activo (se deberá mostrar error descriptivo).
- **Eliminar**: bloqueado si existen reglas o parámetros referenciando el registro (error 409).

### RF-010 — Selector de período al gestionar reglas y parámetros

Al crear o editar una regla o parámetro, el sistema DEBERÁ mostrar un selector desplegable de períodos `MOTOR_FECHAS` compatibles con el tipo del objeto:
- Para reglas: períodos de tipo `REGLAS` o `AMBOS`.
- Para parámetros: períodos de tipo `PARAMS` o `AMBOS`.

El selector DEBERÁ mostrar descripción y rango de fechas de cada opción.

### RF-012 — Columna de entorno en la tabla de snapshots

El sistema DEBERÁ añadir la columna `entorno_cd` VARCHAR(5) NOT NULL DEFAULT `'POC'` a `dbo.cfg_config_snapshot` para distinguir si el snapshot corresponde al entorno POC o al entorno Workflow.

Valores admitidos: `'POC'`, `'WF'`.

### RF-013 — Restauración de snapshot con destino seleccionable

Al restaurar un snapshot, el sistema DEBERÁ solicitar:

1. **Destino** (`POC` | `Workflow`).
2. **Período destino** (desplegable de `MOTOR_FECHAS` existentes o formulario para crear uno nuevo), únicamente si destino = Workflow.

El sistema DEBERÁ crear automáticamente un snapshot de seguridad del estado actual del destino antes de aplicar la restauración.

### RF-014 — Lógica de restauración de snapshot en Workflow

Cuando el destino es Workflow y el usuario confirma la operación:

1. El sistema DEBERÁ localizar y eliminar las reglas (`MRO_MOTORREGLA` con sus condiciones, valores y acciones) y parámetros (`MRO_MOTORPARAM`) del entorno Workflow cuya `VIGENCIA_DESDE_DT` y `VIGENCIA_HASTA_DT` coincidan exactamente (segundo a segundo) con el rango destino indicado.
2. Transformar y escribir las reglas y parámetros del snapshot en el modelo MRO_, populando `VIGENCIA_DESDE_DT` y `VIGENCIA_HASTA_DT` con el rango destino indicado (con precisión de segundos, truncado a segundo).
3. Los IDs de nuevos registros DEBERÁN calcularse como `MAX(id) + 1` dentro de una transacción antes de cada inserción para evitar colisiones.
4. Si el snapshot contiene solo reglas (sin parámetros), la restauración no DEBE tocar los parámetros del período destino, y viceversa.

> **Nota de diseño**: La tabla `MRO_MOTOR_FECHAS` (equivalente Workflow de `MOTOR_FECHAS`) está pendiente de diseño por el equipo de Workflow. Hasta que esté disponible, los períodos de vigencia en MRO_ se gestionan directamente mediante `VIGENCIA_DESDE_DT`/`VIGENCIA_HASTA_DT`. Cuando se defina `MRO_MOTOR_FECHAS`, esta lógica DEBERÁ actualizarse.

### RF-016 — Publicación en Workflow ("Publicar en Workflow")

El configurador DEBERÁ ofrecer la acción "Publicar en Workflow" que:

1. Solicite al usuario el período `MOTOR_FECHAS` origen (del entorno POC) a publicar.
2. Solicite el rango de fechas destino en Workflow (desde-hasta con precisión de segundos). Este rango poblará `VIGENCIA_DESDE_DT`/`VIGENCIA_HASTA_DT` en las tablas MRO_.
3. Cree automáticamente un snapshot de seguridad del estado actual del entorno Workflow antes de aplicar.
4. Aplique la misma lógica de RF-014 (eliminar datos del período destino si existen con match exacto segundo-a-segundo, y escribir desde el origen POC).

### RF-017 — Snapshot del entorno Workflow

El sistema DEBERÁ permitir generar un snapshot del estado actual de las tablas Workflow (`MRO_MOTORREGLA`, `MRO_MOTORPARAM` y objetos relacionados) mediante un stored procedure equivalente al de POC.

El snapshot generado DEBERÁ almacenarse en `cfg_config_snapshot` con `entorno_cd = 'WF'`.

La UI DEBERÁ permitir filtrar la lista de snapshots por entorno.

### RF-019 — Endpoint adaptador del servicio Workflow

El sistema DEBERÁ exponer el endpoint:

```
POST /api/workflow/condiciones-hipotecas
```

que adapte el contrato del servicio de Workflow al motor de reglas POC:

**Request** — contrato del servicio Workflow más campo adicional `domiciliaNomina` requerido por el adaptador:
```json
{
  "token": "...",
  "faseCd": "INIT | PRE | FINAL",
  "tokenExpCd": "...",
  "tipoAltaCd": "NUEVA",
  "finalidadCd": "15",
  "viviendaNuevaFl": false,
  "importeHipotecaNm": 74000,
  "importeViviendaNm": 110000,
  "plazoNm": 15,
  "tienecasaFl": false,
  "comunidadAutonomaCd": 11,
  "primeraViviendaHabitualFl": 1,
  "domiciliaNomina": false,
  "arrIntervinientes": [
    {
      "ORDEN_NM": 1,
      "NUM_CLIENTE_CD": "1951240",
      "ANTIGUEDAD_CLIENTE_DT": "2018-05-31",
      "NACIMIENTO_DT": "1999-03-25",
      "NUMERO_PAGAS_NM": 14,
      "INGRESOS_INTERV_NM": 3200
    }
  ]
}
```

> **`domiciliaNomina`** es un campo adicional respecto al contrato nativo de Workflow. Workflow calcula la domiciliación internamente pero no la expone en el servicio. El adaptador DEBE requerirlo para poder comparar resultados con el motor POC. Con que un titular domicilie es suficiente para cumplir el requisito (`domiciliaNomina: true` → `domiciliaNominaT1 = true`, `domiciliaNominaT2 = true` en el motor).

**Response**:
```json
{
  "RESULTADO": {
    "LIMITES": {},
    "OFERTAS_ELEGIBLES": [],
    "OFERTA_GANADORA": null
  }
}
```

Mapeo:
- `LIMITES` ← `uiLimits` del motor.
- `OFERTAS_ELEGIBLES` ← `eligibleOffers` del motor.
- `OFERTA_GANADORA` ← `winner` del motor (solo en fase FINAL; null en INIT y PRE).

El campo `faseCd` determina qué función del motor invocar: `initcheck`, `precheck` o `finalize`.

La resolución de reglas activas usará `fecha = NULL` (vigentes en el momento de la llamada) para las llamadas de test. La resolución a partir de `tokenExpCd` queda fuera de scope de esta especificación.

### RF-020 — Tests automáticos de comparación

El sistema DEBERÁ incluir un fichero de tests `test/workflow_service.test.js` con dos modalidades:

**Modalidad fixture (CI — siempre ejecuta)**:
- Fixtures JSON con pares request/response pre-grabados del servicio Workflow.
- El test invoca el endpoint `/api/workflow/condiciones-hipotecas` con el mismo input y verifica que la respuesta coincide con el fixture.
- No requiere conectividad de red ni token real.

**Modalidad live (opcional — solo si hay variables de entorno)**:
- Se activa si las variables `WF_TOKEN` y `WF_BASE_URL` están definidas.
- Llama al servicio Workflow real y al endpoint POC con el mismo input.
- Compara los resultados campo a campo (`LIMITES`, `OFERTAS_ELEGIBLES`, `OFERTA_GANADORA`).
- Si las variables no están definidas, el test se omite con `skip` (no fallo).

---

## 5. Casos de uso

### CU-01 — Definir un período de vigencia

**Actor**: Administrador de reglas / parámetros  
**Precondición**: Usuario autenticado en el configurador.  
**Disparador**: El usuario accede a la sección "Períodos de vigencia" y pulsa "Nuevo período".  
**Flujo principal**:
1. El sistema muestra el formulario con campos Desde, Hasta (opcional), Tipo y Descripción.
2. El usuario completa los campos y confirma.
3. El sistema valida que no haya solapamiento con períodos existentes del mismo tipo.
4. El sistema crea el registro en `MOTOR_FECHAS` y lo muestra en la tabla.

**Flujo alternativo — Solapamiento detectado**:
- 3a. El sistema muestra error: "Ya existe un período de tipo [X] que solapa con las fechas indicadas."

**Postcondición**: Nuevo período disponible para asignar a reglas/parámetros.

---

### CU-02 — Asignar período de vigencia al crear una regla

**Actor**: Administrador de reglas  
**Precondición**: Existen períodos MOTOR_FECHAS de tipo REGLAS o AMBOS.  
**Disparador**: El usuario crea o edita una regla en el configurador.  
**Flujo principal**:
1. El formulario de regla muestra un selector "Período de vigencia" con opciones de MOTOR_FECHAS compatibles.
2. El usuario selecciona el período deseado.
3. El sistema guarda la regla con `motor_fechas_id`.

**Postcondición**: La regla queda asociada al período seleccionado.

---

### CU-03 — Publicar configuración en Workflow

**Actor**: Operador de configuración  
**Precondición**: Existe al menos un período MOTOR_FECHAS con reglas y/o parámetros en POC.  
**Disparador**: El usuario pulsa "Publicar en Workflow" en el configurador.  
**Flujo principal**:
1. El sistema solicita el período MOTOR_FECHAS origen (POC) a publicar.
2. El sistema solicita el rango de fechas destino en Workflow (desde, hasta).
3. El sistema muestra resumen de la operación y solicita confirmación.
4. El sistema genera snapshot de seguridad del estado actual de Workflow (`entorno_cd = 'WF'`).
5. Si existe MOTOR_FECHAS en Workflow con el rango destino: elimina reglas/parámetros asociados.
6. Si no existe: crea MOTOR_FECHAS en Workflow con el rango indicado.
7. El sistema transforma y escribe las reglas y parámetros del período origen en las tablas MRO_, asignando IDs calculados como MAX+1.
8. El sistema notifica éxito con el `snapshot_id` de seguridad generado.

**Flujo alternativo — Error de colisión de IDs**:
- 7a. Si la transacción falla por violación de PK, el sistema deshace la operación y notifica el error.

**Postcondición**: Las reglas y parámetros del período origen son accesibles desde el entorno Workflow en el rango de fechas destino.

---

### CU-04 — Restaurar snapshot en Workflow

**Actor**: Operador de configuración  
**Precondición**: Existe al menos un snapshot con `entorno_cd` = 'POC' o 'WF'.  
**Disparador**: El usuario pulsa "Restaurar" sobre un snapshot en la lista.  
**Flujo principal**:
1. El sistema solicita el destino: POC o Workflow.
2. Si destino = Workflow: el sistema solicita el período destino (MOTOR_FECHAS existente o nuevo).
3. El sistema muestra resumen y solicita confirmación.
4. El sistema genera snapshot de seguridad del estado actual del destino.
5. El sistema aplica la lógica definida en RF-009.
6. El sistema notifica éxito.

**Postcondición**: El entorno destino refleja el estado del snapshot restaurado en el rango indicado.

---

### CU-05 — Ejecutar test de comparación live

**Actor**: Sistema CI/CD (o desarrollador)  
**Precondición**: Variables `WF_TOKEN` y `WF_BASE_URL` definidas en entorno.  
**Disparador**: `npm test` o `npm run test:file -- test/workflow_service.test.js`.  
**Flujo principal**:
1. El test lee credenciales de las variables de entorno.
2. Para cada caso del fixture, envía la misma petición al endpoint Workflow real y al endpoint POC.
3. Compara los resultados campo a campo.
4. El test pasa si todos los campos coinciden.

**Flujo alternativo — Variables no definidas**:
- 1a. Los tests live se marcan como `skip`; los tests de fixture continúan.

---

## 6. Reglas de negocio

| ID | Regla |
|----|-------|
| BR-001 | No pueden coexistir dos períodos MOTOR_FECHAS del mismo tipo con fechas solapadas. El tipo `AMBOS` solapa con `REGLAS` y con `PARAMS`. |
| BR-002 | Una regla o parámetro DEBE estar asociado a exactamente un período MOTOR_FECHAS. |
| BR-003 | No se puede eliminar un período MOTOR_FECHAS si existen reglas o parámetros referenciándolo. |
| BR-004 | Antes de cualquier operación destructiva sobre configuración (publicar, restaurar) el sistema DEBE generar automáticamente un snapshot de seguridad del estado actual del entorno destino. |
| BR-005 | Al restaurar un snapshot en Workflow con un período destino existente, se DEBEN eliminar únicamente las reglas/parámetros de ese período, sin afectar datos de otros períodos. |
| BR-006 | Si un snapshot contiene solo reglas (no parámetros), la restauración no DEBE tocar los parámetros del período destino, y viceversa. |
| BR-007 | Los IDs de nuevos registros en tablas Workflow DEBEN calcularse como `MAX(id) + 1` dentro de una transacción, antes de insertar. |
| BR-008 | El campo `OFERTA_GANADORA` en la respuesta del endpoint Workflow DEBE ser `null` para las fases INIT y PRE. |
| BR-009 | Los tests automáticos de fixture DEBEN ejecutarse en CI sin requerir conectividad de red ni variables de entorno externas. |
| BR-010 | Los tests live DEBEN omitirse sin error si `WF_TOKEN` o `WF_BASE_URL` no están definidas. |

---

## 7. Requisitos de información

### MOTOR_FECHAS

| Campo | Tipo | Requerido | Validación |
|-------|------|-----------|------------|
| `motor_fechas_id` | INT | Sí (PK) | Autoincremental o MAX+1 |
| `valid_from` | DATE | Sí | — |
| `valid_to` | DATE | No | ≥ valid_from si informado |
| `descripcion` | NVARCHAR(200) | Sí | No vacío |
| `tipo_cd` | VARCHAR(10) | Sí | `REGLAS` \| `PARAMS` \| `AMBOS` |
| `alta_usr` | NVARCHAR(100) | No | — |
| `alta_dt` | DATETIME2(0) | Sí | Default SYSDATETIME() |

### cfg_config_snapshot (columna añadida)

| Campo | Tipo | Requerido | Validación |
|-------|------|-----------|------------|
| `entorno_cd` | VARCHAR(5) | Sí | `'POC'` \| `'WF'`. Default `'POC'`. |

### Mapeo de campos — Servicio Workflow → Motor POC

| Campo Workflow | Campo motor POC | Transformación |
|----------------|-----------------|----------------|
| `tipoAltaCd` | `tipoAlta` | Rename directo. |
| `importeHipotecaNm` | `importeHipoteca` | Rename directo. |
| `importeViviendaNm` | `importeVivienda` | Rename directo. |
| `plazoNm` | `plazo` | Rename directo (años). |
| `finalidadCd` | `finalidad` | `parseInt(finalidadCd)`. |
| `tienecasaFl` | `tieneOtrasPropiedades` | `tienecasaFl ? 1 : 0`. |
| `domiciliaNomina` | `domiciliaNominaT1`, `domiciliaNominaT2` | Ambos campos del motor reciben el mismo valor boolean. |
| `arrIntervinientes.length` | `numTitulares` | Directo. |
| `NACIMIENTO_DT` (todos los intervinientes) | `edadMax` | `max(edad_en_años_completos(NACIMIENTO_DT))` a fecha de la llamada. |
| `arrIntervinientes[ORDEN_NM=1].ANTIGUEDAD_CLIENTE_DT` | `antiguedadT1` | Meses completos desde `ANTIGUEDAD_CLIENTE_DT` hasta la fecha de la llamada. |
| `arrIntervinientes[ORDEN_NM=2].ANTIGUEDAD_CLIENTE_DT` | `antiguedadT2` | Ídem para el segundo titular. `0` si `numTitulares = 1`. |
| `arrIntervinientes[ORDEN_NM=1].INGRESOS_INTERV_NM` × `NUMERO_PAGAS_NM` / 14 | `ingresosT1` | Normalización a 14 pagas. |
| Suma de todos los intervinientes | `ingresosTotales` | `sum(INGRESOS_INTERV_NM_i * NUMERO_PAGAS_NM_i) / 14`. |

**Campos sin uso en las reglas actuales** (se incluyen en el input del motor para uso futuro):

| Campo Workflow | Campo motor | Observación |
|----------------|-------------|-------------|
| `viviendaNuevaFl` | `viviendaNueva` | Ninguna regla actual lo evalúa. |
| `comunidadAutonomaCd` | `comunidadAutonoma` | Ninguna regla actual lo evalúa. |
| `primeraViviendaHabitualFl` | `primeraViviendaHabitual` | `finalidad=15` ya codifica este dato. Normalizar 0/1 a boolean. |
| `NUM_CLIENTE_CD` | `numClienteOB` | Indica si es cliente existente, no equivale a domiciliación. |
| `tokenExpCd` | — | Referencia al expediente en Workflow. Se propaga al log, no al motor. |

---

## 8. Permisos y control de acceso

> Los permisos específicos de la UI quedan fuera del scope de este cambio. Se asume que cualquier usuario autenticado en el configurador puede ejecutar todas las operaciones descritas.

El endpoint `/api/workflow/condiciones-hipotecas` DEBERÁ requerir el campo `token` en el body del request. La validación del token queda delegada al sistema Workflow (Workflow) y fuera del scope de la POC.

---

## 9. Integraciones / Dependencias

| Sistema | Dirección | Descripción |
|---------|-----------|-------------|
| Workflow | Outbound (llamada desde tests) | Endpoint `POST /ApiRest/GetOfertasHipotecas` para tests live. |
| Workflow | Inbound (Workflow lee tablas MRO_) | Workflow consume directamente las tablas `MRO_MOTORREGLA`, `MRO_MOTORPARAM` etc. No hay llamada API — acceso directo a BD compartida. |
| SQL Server (BD compartida) | Lectura/escritura | Ambos modelos (cfg_ y MRO_) conviven en la misma BD. MOTOR_FECHAS es una tabla nueva en ese mismo esquema. |

---

## 10. Requisitos no funcionales

| ID | Requisito | Descripción |
|----|-----------|-------------|
| RNF-001 | Transaccionalidad | Las operaciones de publicación y restauración en Workflow DEBEN ejecutarse en una transacción SQL. Cualquier fallo DEBE provocar rollback completo. |
| RNF-002 | Idempotencia de IDs | El cálculo de IDs mediante MAX+1 DEBE realizarse dentro de la misma transacción que la inserción para evitar colisiones por concurrencia. |
| RNF-003 | Tests en CI | Los tests de fixture DEBEN pasar en un entorno sin conectividad externa. Tiempo de ejecución total < 30s. |
| RNF-004 | Compatibilidad Workflow | Las columnas `VIGENCIA_DESDE_DT`/`VIGENCIA_HASTA_DT` de las tablas MRO_ DEBEN mantenerse y popularse correctamente con precisión de segundos (truncadas a segundo) en toda operación de escritura para no romper el procesamiento nativo de Workflow. |
| RNF-005 | Consistencia de snapshots | Un snapshot de Workflow DEBE capturar el estado completo (reglas, condiciones, valores de condición, acciones y parámetros) de todas las ofertas en el momento de la captura. |
| RNF-VDT-01 | Sin filas huérfanas | Después de N deploys al mismo `(DESDE_DT, HASTA_DT, TIPO_DS)`, `COUNT(*) FROM MRO_MOTORFECHA WHERE CAST(DESDE_DT AS DATE) = @dia` DEBE ser igual al número de períodos distintos para ese día (no al número de deploys). |
| RNF-VDT-02 | Truncado a segundo | Ninguna fila de `MRO_MOTORFECHA` DEBE tener sub-segundos en `DESDE_DT` o `HASTA_DT`. Verificable: `SELECT COUNT(*) FROM MRO_MOTORFECHA WHERE DATEPART(ms, DESDE_DT) > 0` = 0. |
| RNF-VDT-03 | Idempotencia de deploy | Ejecutar el mismo deploy dos veces consecutivas DEBE producir el mismo estado en `MRO_MOTORFECHA` y dependientes. Verificable por comparación de snapshots pre y post segundo deploy. |
| RNF-VDT-04 | Timezone naive | Ninguna capa DEBE convertir los valores datetime a UTC ni aplicar offsets. La validación PUEDE incluir un test que verifica que el valor almacenado `DESDE_DT` coincide byte-a-byte con el valor enviado desde el frontend (sin offset). |

---

## 10b. Remapeo de IDs de oferta en publicación (Cambio: wf-offer-mapping)

Cada vez que el operador publica configuración en Workflow (RF-016) o restaura un snapshot a Workflow (RF-013), tiene la opción de proporcionar un mapa temporal `ofertaIdOverrides: Record<offerCode, number>` para reasignar los IDs de oferta en `dbo.HIPO_OFERTA` si el entorno destino (ej: PRE) posee IDs diferentes al origen (ej: PRO).

Este mapa es **efímero** — no se persiste entre publicaciones. El backend resuelve el ID efectivo como `overrides[offerCode] ?? oferta_id` antes de escribir en las tablas MRO_.

Véase `openspec/changes/archive/2026-05-26-wf-offer-mapping/` para especificación y diseño completo.

---

## 11. Criterios de aceptación

| ID | Área | Descripción | Condiciones | Resultado esperado |
|----|------|-------------|-------------|-------------------|
| CA-001 | MOTOR_FECHAS | Crear período sin solapamiento | valid_from y valid_to válidos, tipo REGLAS | Registro creado, visible en tabla |
| CA-002 | MOTOR_FECHAS | Crear período con solapamiento | Mismo tipo, fechas que se solapan con existente | Error descriptivo, no se crea |
| CA-003 | MOTOR_FECHAS | Eliminar período con reglas | Período referenciado por ≥1 regla | Error 409, período no eliminado |
| CA-004 | Reglas | Asignar período al crear regla | Selector muestra solo REGLAS y AMBOS | Regla guardada con motor_fechas_id correcto |
| CA-005 | SP | Filtro por fecha via MOTOR_FECHAS | Llamada con fecha dentro de período | Devuelve reglas del período; no devuelve reglas de otro período |
| CA-006 | Publicación | Publicar en Workflow (período nuevo) | Período destino no existe en Workflow | Se crea MOTOR_FECHAS + reglas/params en MRO_, snapshot seguridad generado |
| CA-007 | Publicación | Publicar en Workflow (período existente) | Período destino existe en Workflow | Se eliminan reglas/params del período y se recrean desde POC |
| CA-008 | Snapshot | Snapshot Workflow | Acción "Snapshot Workflow" | Registro en cfg_config_snapshot con entorno_cd = 'WF' y JSON de MRO_ |
| CA-009 | Snapshot | Restaurar en Workflow | Snapshot POC, destino Workflow, período destino nuevo | Datos en MRO_ reflejan el snapshot; snapshot seguridad previo generado |
| CA-010 | Endpoint | POST /api/workflow/condiciones-hipotecas fase INIT | Request válido con faseCd=INIT | Respuesta con LIMITES, OFERTAS_ELEGIBLES, OFERTA_GANADORA=null |
| CA-011 | Endpoint | POST /api/workflow/condiciones-hipotecas fase FINAL | Request válido con faseCd=FINAL | Respuesta con OFERTA_GANADORA no null si elegible |
| CA-012 | Tests | Tests fixture en CI | npm test sin WF_TOKEN ni WF_BASE_URL | Tests pasan; tests live marcados skip |
| CA-013 | Tests | Tests live con credenciales | WF_TOKEN y WF_BASE_URL definidas | Resultado POC coincide con respuesta Workflow real |
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
