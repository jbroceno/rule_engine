# Workflow deployment

Hasta ahora el motor de reglas se ha diseñado con un modelo de datos *provisional* para hacer una prueba de concepto POC en un sistema aislado.

Este motor debe integrarse en una herramienta de Workflow de la entidad.

Este documento recoge los cambios necesarios para el despliegue de la solución en la nueva herramienta de workflow.

## Requisitos funcionales

- No hay nuevos requisitos funcionales. El funcionamiento del motor, definición de reglas y parámetros es la misma.
## Requisitos no funcionales

### Requisitos técnicos

Requisito|Descripción
-|-
RT01|Migración del motor *rule_engine.js* a workflow
RT02|Migración de base de datos
RT03|Administración de reglas|Deben poder administrarse tanto con el modelo de la POC como en el de workflow
RT04|Ejecución del motor por sevicio|Más adelante se detalla el contrato del servicio en la sección *Integración con Workflow*

### RT01 - Migración del motor

El motor debe implementarse en el sistema de workflow. Se utiliza un lenguaje propietario del sistema de Workflow que es muy parecido a Javascript.
La migración la completará un desarrollador especialista en Workflow y queda fuera del ámbito de este cambio

### RT02 - Migración de base de datos

Scripts con las definiciones en  @rule_set/sql/workflow_deploy. Incluye:
- Nuevo modelo de datos debe cambiar para adaptarse a la nomenclatura de la nueva herramiente. En la tabla de reglas se han quitado los nombres de reglas ya que se definen en la tabla OFERTA. El campo que las relaciona es OFERTA_ID. La estructura de la tabla es:
~~~ sql
    CREATE TABLE [dbo].[OFERTA](
        [OFERTA_ID] [int] NOT NULL,
        [ALTA_USR] [int] NULL,
        [ALTA_DT] [datetime] NULL,
        [MOD_USR] [int] NULL,
        [MOD_DT] [datetime] NULL,
        [OFERTA_CD] [varchar](50) NULL,
        [OFERTA_DS] [varchar](100) NULL,
        [BANCO_CD] [varchar](20) NULL,
        [SUCURSAL_CD] [varchar](20) NULL,
        [PRODUCTO_CD] [varchar](20) NULL,
        [TIPO_PRODUCTO_SCORING_CD] [varchar](20) NULL,
    CONSTRAINT [PK_HIPO_OFERTA] PRIMARY KEY CLUSTERED 
    (
        [OFERTA_ID] ASC
    )WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
    ) ON [PRIMARY]
~~~

- Procedimientos almacenados
- Reglas de configuración para los tests ya migradas y adaptadas a los códigos de oferta de la herramienta de Workflow
 
### RT03 - Administración de reglas

En el modelo de datos (tanto POC como Workflow). Se incluye un *valid_from* y un *valid_to* en distintas tablas. Parece que falta algo que de coherencia a esas fechas de forma que sea sencillo saber en qué rangos de fechas tengo definiciones distintas de reglas y parámetros.

Tareas:

1) Añadir la funcionalidad para mostrar los períodos de validez en los que tengo reglas y parámetros. Algo como:

Desde|Hasta|Cambio
-|-|-
2026-02-01|2026-04-02|Reglas iniciales
2026-04-03|2026-05-02|Restricción en ingresos
2026-05-03|null|Nueva oferta a extranjeros

Creo que una buena solución sería añadir al modelo un "PARAMETROS_FECHAS" yun "REGLAS_FECHAS que tenga un *id*, un *valid_from*, un *valid_to* y una *descripción* (o una tabla MOTOR_FECHAS y añadir un campo que indique si aplica a parámetros o a reglas). Recordemos que parámetros y reglas los administran usuarios diferentes y podrían quere cambiar solo uno de los dos objetos sin afectar a los otros

2) Ampliar la funcionalidad de snapshot para poder elegir si restaurar un snapshot sobre POC o sobre Workflow.
2.1) Debería preguntar en que rango de fechas aplicar el conjunto de reglas (ojo con los identificadores para no sobreescribir reglas ya existentes en el entorno destino).
2.2) El spanshot tendrá reglas y/o parámetros, en desinto no habrá que hacer ningún campo en caso de que el objeto correspondiente no esté en el snapshot. Es decir, si solo hay reglas, solo deben escribirse reglas respetando los parámetros existentes. Tendría que borrar las reglas/parámetros de esas fechas y regenerarlas con nuevos Ids apartir del snapshot. En caso de que en desinto no exista el intervalo desde-hasta deberá crear ese registro.
   
3) Añadir un botón "Publicar en Workflow" que regenere el modelo cargado (se corresponderá con una fecha desde-hasta de POC) en el modelo de Workflow
3.1) Habrá que preguntar por el rango de fechas desde-hasta a aplicar. 
3.4) Si no existe el rango de fechas habrá que crear el registro correspondiente

4) Añadir la funcionalidad para generar un snapshot del entorno de Workflow (al existir los procedimientos que generar json no debería ser complicado). La tabla de snapshots podría tener una columna que indique si son de POC o de Workflow.

### RT04 - Servicio de integración con Workflow

La herramienta de workflow expone un endpoint POST {{servidor}}/ApiRest/GetOfertasHipotecas que recibe este request:

~~~ json
{
	"token":"{{tokenwf}}",
    "faseCd": "FINAL",
	"tokenExpCd": "fd9a342d-7cae-4e8f-825e-89229005291b",
	"finalidadCd": "15",
	"viviendaNuevaFl": false,
	"importeHipotecaNm": 74000,
	"importeViviendaNm": 110000,
	"plazoNm": 15,
	"tienecasaFl": false,
    "comunidadAutonomaCd": 11,
    "primeraViviendaHabitualFl": 1,
    "arrIntervinientes": [
        {
		    "ORDEN_NM":1,
			"NUM_CLIENTE_CD": "1951240",
			"ANTIGUEDAD_CLIENTE_DT": "2018-05-31",
			"NACIMIENTO_DT": "1999-03-25",
			"NUMERO_PAGAS_NM": 14,
			"INGRESOS_INTERV_NM": 3200
        },
        {
		    "ORDEN_NM":2,
			"NUM_CLIENTE_CD": null,
			"ANTIGUEDAD_CLIENTE_DT": "2025-06-12",
			"NACIMIENTO_DT": "2000-03-25",
			"NUMERO_PAGAS_NM": 12,
			"INGRESOS_INTERV_NM": 3000
        }
    ]
}
~~~

Y devuelve la respuesta:

~~~ json
{
    "RESULTADO": {
        "LIMITES": {},
        "OFERTAS_ELEGIBLES": [],
        "OFERTA_GANADORA": null
    }
}
~~~

Donde:

- *LIMITES*: objeto *uiLimits*
- *OFERTAS_ELEGIBLES*: Objeto *eligibleOffers* de la respuesta del motor
- *OFERTA_GANADORA*: Objeto *winner* de la respuesta del motor (solo estará en fase FINAL)

Para llamar al servicio es necesario añadir estos campos:

- *token*:  token de seguridad.
- *tokenExpCd*: Referencia al expediente en el sistema de workflow que queremos evaluar.

En el sistema de workflow, la fecha "desde" que aplicaría para localizar el conjunto de reglas y parámetros se obtiene de los atributos del expediente. Para la finalidad de las pruebas asumiremos que es "null" en la llamada al procedimiento almacenado para obtener así las reglas que estén vigentes en un momento dado.

## Implementación del prototipo (2026-05)

Esta sección documenta las decisiones de diseño y lo construido en el prototipo POC para dar soporte a los requisitos RT02, RT03 y RT04.

### Modelo de datos — MOTOR_FECHAS

Se creó la tabla `dbo.MOTOR_FECHAS` como entidad central que agrupa los períodos de vigencia, separando la gestión de reglas y parámetros:

```sql
CREATE TABLE [dbo].[MOTOR_FECHAS] (
    [motor_fechas_id] INT IDENTITY(1,1) PRIMARY KEY,
    [valid_from]      DATE NOT NULL,
    [valid_to]        DATE NULL,            -- NULL = abierto (sin fecha fin)
    [descripcion]     NVARCHAR(200) NOT NULL,
    [tipo_cd]         VARCHAR(10)  NOT NULL  -- 'REGLAS' | 'PARAMS' | 'AMBOS'
        CHECK ([tipo_cd] IN ('REGLAS','PARAMS','AMBOS')),
    [alta_usr]        NVARCHAR(100) NULL,
    [alta_dt]         DATETIME2(0) NOT NULL DEFAULT GETDATE()
);
```

Las tablas `cfg_offer_rule` y `cfg_offer_param` incorporan una FK opcional a este período:

```sql
ALTER TABLE dbo.cfg_offer_rule  ADD motor_fechas_id INT NULL REFERENCES dbo.MOTOR_FECHAS(motor_fechas_id);
ALTER TABLE dbo.cfg_offer_param ADD motor_fechas_id INT NULL REFERENCES dbo.MOTOR_FECHAS(motor_fechas_id);
```

Con `motor_fechas_id = NULL` la regla/parámetro no pertenece a ningún período gestionado y se devuelve siempre. Con valor, solo se devuelve cuando se filtra por ese período.

### API de administración de períodos

Se añadieron estos endpoints bajo `/api/admin/fechas`:

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET    | `/admin/fechas` | Listar todos los períodos |
| POST   | `/admin/fechas` | Crear período |
| PUT    | `/admin/fechas/:id` | Actualizar período |
| DELETE | `/admin/fechas/:id` | Eliminar período (bloqueado si tiene reglas/parámetros asociados) |

Los endpoints de reglas y parámetros aceptan ahora el query param `motorFechasId` (integer, opcional). Cuando se informa, el backend añade `WHERE r.motor_fechas_id = @motorFechasId` a la consulta, filtrando exclusivamente las reglas/parámetros de ese período.

### Endpoint "Publicar en Workflow"

```
POST /api/admin/workflow/publicar
{
  "motorFechasId": 3,
  "rangoDestino": { "vigDesde": "2026-06-01", "vigHasta": null },
  "createdBy": "usuario.gestor"
}
```

Copia las reglas y parámetros del período indicado al modelo Workflow (tablas `MRO_*`) con el rango de vigencia destino especificado.

### Snapshots con soporte entorno POC / WF

La tabla `cfg_config_snapshot` y el endpoint de restore se han extendido para soportar destinos distintos:

- **Filtro de entorno**: la lista de snapshots acepta `?entorno=POC|WF` para filtrar por origen.
- **Restore a WF**: `POST /admin/snapshots/:id/restore` acepta `destino: "WF"` y `rangoDestino: { vigDesde, vigHasta }`, que publica las reglas/parámetros del snapshot en el modelo Workflow con las fechas indicadas.
- **Restore a POC** (comportamiento anterior): `destino: "POC"` restaura directamente sobre las tablas `cfg_offer_rule` y `cfg_offer_param`.

### Angular — página Motor de Fechas

Página principal de la aplicación (`/motor-fechas`, ruta por defecto). Permite:

- **CRUD completo** de registros `MOTOR_FECHAS`.
- **Activar período de Reglas**: botón por fila (visible cuando `tipo_cd = REGLAS | AMBOS`). Hace toggle: si el período ya está activo, lo desactiva. El período activo se persiste en `localStorage` mediante `ActivePeriodService`.
- **Activar período de Parámetros**: ídem para `tipo_cd = PARAMS | AMBOS`.
- **Duplicar período**: botón ⧉ por fila. Solicita la nueva fecha de inicio. Si el período origen tiene `valid_to = null`, lo cierra automáticamente con `valid_to = nueva_fecha - 1 día`, y crea el nuevo período con `valid_from = nueva_fecha`, `valid_to = null`, misma descripción y tipo.
- **Indicador de períodos activos**: barra en la cabecera de la página muestra los períodos activos de reglas y parámetros en tiempo real.
- **Resaltado de filas**: `.row-active-rules` (fondo verde claro) y `.row-active-params` (fondo azul claro).

### Angular — servicio ActivePeriodService

Servicio `providedIn: 'root'` con dos signals:

```typescript
readonly activePeriodRules  = signal<AdminFechaItem | null>(...);
readonly activePeriodParams = signal<AdminFechaItem | null>(...);
```

Persiste el objeto `AdminFechaItem` completo en `localStorage` (claves `activePeriod.rules` y `activePeriod.params`) para que el indicador del header funcione sin llamadas adicionales al arrancar la app.

### Angular — indicador global en el topbar

El `AppComponent` muestra dos chips en el header:

- **R:** → período activo de reglas (verde si activo, gris si no hay ninguno).
- **P:** → período activo de parámetros.

El primer link de navegación es **Períodos** (`/motor-fechas`).

### Angular — banner en el Configurador

La página `/configurador` muestra un banner en la parte superior indicando los períodos activos de reglas y parámetros, con un enlace directo "Cambiar períodos" → `/motor-fechas`. Cuando no hay período activo el banner cambia a fondo amarillo advirtiendo que se muestran todas las reglas/parámetros sin filtro de vigencia.

El filtrado en el Configurador es **backend** (no client-side), garantizando consistencia con la paginación del servidor.

### Angular — selector de período en formularios

Los formularios de creación/edición de reglas y parámetros incluyen un selector `motor_fechas_id` opcional, filtrado según el tipo:

- Formulario de regla: muestra períodos con `tipo_cd = REGLAS | AMBOS`.
- Formulario de parámetro: muestra períodos con `tipo_cd = PARAMS | AMBOS`.

## Test del motor

El motor de la POC ya ha sido probado y no tendrá cambios. Al haber migrado el motor en Workflow con los mismos resultados en la respuesta será fácil comparar el resultado del motor POC con lo que devuelve el servicio.
Sería conveniente poder definir casos de uso que realicen la llamada al servicio web (habrá que incluir de alguna forma el los scripts de test el token de seguridad y el token del expediente o sacarlos de un fichero de entorno) y comparen el resultado con lo devuelto por el motor de la POC

¿Sería buena idea? propón si lo ves conveniente otro tipo de solución.