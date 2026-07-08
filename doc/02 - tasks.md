# Definición de tareas - Ofertas hipotecarias

## Definición de Productos

Los productos tendrán configurado un TIN y, para tramos variables un DIFERENCIAL.

Contamos con estos productos:

OpenFija: Hipoteca fija. La cuota se establece por el TIN
OpenVariable: Hipoteca variable, con el primer año a un TIN fijo. El reso con Euribor + DIFERENCIAL
OpenMixta: Hipoteca mixta, con el X años a un TIN fijo (X serán distintos valores en función de la configuración de precios). El resto de años con Euribor + DIFERENCIAL

## Definición de variables

Se definen las siguientes variables que en el resto del documento hacen referencia a datos de entrada y/o calculados

Variable|Tipo|Descripción|Cálculo
-|-|-|-
tipoAlta|string|Tipo de alta del expediente (vivienda nueva, novación, etc)|TIPO_ALTA_CD
primeraViviendaHabitual|number|¿es la primera vivienda habitual que compra el cliente?|PRIMERA_VIVIENDA_HABITUAL_FL
finalidad|number|Primera o segunda vivienda?|Finalidad de la vivienda
numTitulares|number|Número de titulares|Número de titulares
antiguedadT1|number|En meses, la antigüedad del T1|Meses(T1.ANTIGUEDAD_CLIENTE_DT)
antiguedadT2|number|En meses, la antigüedad del T2|Meses(T2.ANTIGUEDAD_CLIENTE_DT)
domiciliaNominaT1|number|Flag de nómina domiciliada del T1 (0/1)|T1.DOMICILIA_NOMINA
domiciliaNominaT2|number|Flag de nómina domiciliada del T2 (0/1)|T2.DOMICILIA_NOMINA
ingresosT1|number|Ingresos mensuales T1 prorrateados a 14 meses|T1.Ingresos * T1.NumPagas / 14
ingresosT2|number|Ingresos mensuales T2 prorrateados a 14 meses|T2.Ingresos * T2.NumPagas / 14
ingresosTotales|number|Ingresos mensuales totales prorrateados a 14 meses|(ingresosT1 + ingresosT2)
edadT1|number|Edad del T1|CalculaEdad(T1.NACIMIENTO_DT)
edadT2|number|Edad del T2|CalculaEdad(T2.NACIMIENTO_DT)
importeMinimoCcaa|number|Importe mínimo de compra para la comunidad autónoma del expediente|lookup(importeVenta(COMUNIDAD_AUTONOMA_CD))
importeHipoteca|number|Importe del préstamo|IMPORTE_HIPOTECA_NM
importeVivienda|number|Importe de compra|IMPORTE_VIVIENDA_NM
plazo|number|Plazo (en años)|PLAZO_NM
ltv|number|LTV|LTV
edadMasPlazo|number|Edad del mayor titular + plazo|(max. edad titulares)+PLAZO_NM
importeTasacion|number|valor de tasación|Importe de la suma de las tasaciones de los bienes incluidos en la hipoteca
tipoVivienda|number|Vivienda nueva o de segunda mano|Código del tipo de vivienda
comunidadAutonoma|number|Comunidad autónoma de la vivienda a comprar|COMUNIDAD_AUTONOMA_CD

## Cambios en pantalla de alta de expedientes

En la pantalla de alta, además de solicitar el Número de cliente se debe preguntar por las variables:

- tipoAlta
- Finalidad
- primeraViviendaHabitual
- tipoVivienda
- comunidadAutonoma
- ¿tienes elegida ya la vivienda?

Además, se consultará
- Servicio CRS: Se obtendrá edadT1
- Fichero de riesgos: Se obtendrá domicilaNominaT1 y PARTENON.ANTIGUEDAD_DT del T1 para calcular la antiguedad en meses

Para continuar, se evaluará la operación con el motor de reglas en fase INIT que determinará:

- Las ofertas elegibles
- Qué límites han de aplicarse a importes/plazos/ltv
- Si en la pantalla del simulador deben pedirse datos económicos de los titulares

## Cambios en simulador de alta de expediente

Se mostrará un bloque de solo lectura para los datos de vivienda (finalidad, comunidad autónoma, etc.) e intervinientes (pagas, etc.). Ambos bloques tendrán un botón que abrirá un pop-up para la edición. Tras cerrar el pop-up se volverá a evaluar el motor de reglas para actualizar ofertas elegibles y límites.

Para estos bloques se mostrará la información que ya se capturó en la pantalla de alta (o que exista en el expediente si es una edición de datos financieros posterior):

- tipoAlta
- Finalidad
- primeraViviendaHabitual
- tipoVivienda
- comunidadAutonoma
- Fecha Nacimiento T1

Si el motor de reglas indica que deben solicitarse datos económicos mostrará un panel para introducir, de cada titular:

- Fecha Nacimiento (y se mostrará edad calculada)
- Ingresos netos mensuales
- Número de pagas

Tras editar los datos se llamará al motor de reglas en fase PRE para determinar:
- Las ofertas elegibles
- Qué límites han de aplicarse a importes/plazos/ltv

Se pedirán los datos del préstamo. Los valores de importes/plazos se validarán contra los límites aplicables devueltos por el motor de reglas

- importeHipoteca
- importeVivienda
- plazo
- plazo fijo (para OpenVariable y OpenMixta)


En el botón calcular, se evaluará la operación con el motor de reglas en fase FINAL que determinará:

- La oferta ganadora
- Las ofertas elegibles
- Qué límites han de aplicarse a importes/plazos/ltv

Siempre que tengamos ofertas elegibles se mostrarán en una tabla en la parte inferior del simulador marcando visualmente la ganadora

Si hay datos introducidos y tras cambiar algún valor y evaluar el motor de reglas hay un cambio en las ofertas elegibles, el importeHipoteca y el plazo deben ajustarse para no superar los límites. Ej: Si se indica un límite del 80% de LTV y la operación está en un 87%, deberá reducirse el importeHipoteca para quedar al 80. Si hay un plazo de 33 años y el nuevo límite son 30, deberá bajarse a 30.

Si se indica que la finalidad es segunda vivienda, el plazo máximo serán 25 años y el LTV máximo 75 (estos valores se leen de la configuración del sistema)

Las ofertas elegibles no se considerarán si no hay ningún precio fijado para esas ofertas en el sistema. Esto puede controlarse a la hora de llamar al motor de reglas, para no facilitarle ofertas que no aplican.

## Pantalla de pre-aprobación

- Se añadirá para cada interviniente la captura del Número de pagas
- Antes de evaluar la pre-aprobación, se consultará con el motor de reglas la operación. Si la oferta pre-seleccionada ya no es válida se informará al usuario y se trasladará a la pantalla de simulación para visualizar las nuevas ofertas aplicables y la nueva cuota
  
## Motor de reglas

El motor de reglas es una función que evalúa los datos de entrada en base a un cojunto de reglas (determinan distintas condiciones y cómo actuar si se cumplen así como fijar límites en las operaciones). La definición y el diseño del motor es una caja negra que ya está construida y no forma parte de este desarrollo.

### Histórico de reglas y parámetros
Lo que sí debemos controlar es qué reglas y parámetros deben aplicarse en cada momento.

Las reglas y los parámetros son editables y el período de vigencia de cada valor estará historificado. Así se mantiene un histórico y podemos aplicar los registros que correspondan según una determinada fecha. Para facilitar la administración, se separan parámetros (son más fáciles de cambiar para el usuario) y las reglas (más para un perfil técnico). Los cambios aplicados no impactarán en los expedientes en gestión.

Para saber qué reglas y parámetros consultar según la fecha, cuando se asigne una oferta a un expediente se asignará también la FECHA_APLICACION_OFERTA. Se habilitará un parámetro de configuración "Meses validez parámetros" para que, al actualizar los datos de entrada de un préstamo, se usen los parámetros/reglas de la FECHA_APLICACION_OFERTA si esta es posterior a HOY()-"Meses validez parámetros". Si ha caducado la fecha se utilizarán los parámetros vigentes y además se reasignará el campo FECHA_APLICACIÓN_OFERTA a la fecha del sistema

## Desactivación de ofertas
Será posible desactivar ofertas. Esto aplicará **SOLO** a expedientes nuevos, los existentes la mantendrán. Si hay que recalcular las ofertas y si están desactivadas, para el cliente que ya haya tenido una oferta se seguirán considerando. Esto obligará a tener un campo en el expediente que indique MANTENER_OFERTA_FL de forma que aunque la oferta se pierda, si más adelante las condiciones del expediente permiten ofrecerla se tengan en cuenta aunque estén desactivadas. Las ofertas tendrán dos nuevos campos:

- Activa_fl: Indica si la oferta está activa o no
- Mantener_oferta_fl: Indica que esa oferta se podrá dar a expedientes que tienen marcado el flag de mantener oferta aunque la oferta esté desactivada. Si el expediente tiene el flag MANTIENE_OFERTA (porque la oferta lo tenía) al resimular, debemos considerar las ofertas activas y las no activas que tengan el campo MANTIENE_OFERTA_FL = 1. Si tras la simulación pasa a tener una oferta que no tiene MANTIENE_OFERTA_FL, el expediente también perderá el flag

El expediente tiene el atributo "fecha aplicación de precios" que define qué tarifas y ofertas se aplican en esa fecha. Si cambia la fecha de aplicación de precios y como consecuencia hay cambio de tarifas se anulará la oferta que tuviera y se recalculará con la ejecución del motor de reglas en fase FINAL.

## Pantalla de datos del expediente

- Se mostrará el nuevo campo primeraViviendaHabitual

## Modificación del préstamo (simulador tras el alta)

- Se usará la misma pantalla que en el alta si bien, en el caso de oferta con LTV limitado, el gestor del expediente podrá pasarse de ese límite hasta un límite superior fijado por configuración

Por lo demás aplican las mismas reglas que en la pantalla de alta

## Nuevo campo CTO_BIZUM en fichero de riesgos

Se recibirá un nuevo campo en el fichero

Campo: **CTO_BIZUM**
Valores:

Valor|Descripción
-|-
S|Si tiene contrato de BIZUM vigente
A|Si tiene contrato de BIZUM vigente con movimientos en los últimos 30 días
N|No tiene contrato de BIZUM vigente   

## Pantalla de intervinientes

- En la tabla de intervinientes se mostrará la nueva columna "BIZUM" con los valores de CTO_BIZUM recibidos por fichero de riesgos
- En el interviniente se mostrará el campo "Número de pagas"

## Revisión Diferencia INGRESOS en datos observados

Tras pasar la validación conjunta hay que aplicar esta regla

- Si el cliente es trabajador por cuenta ajena:
  * Para cada interviniente Obtener la media del sumatorio del importe neto de todas las nóminas (puede haber distinto pagador) agrupando por mes para las nóminas de antigüedad inferior o igual a X meses (configurable?)
  * INGRESOS_OBS_MENSUALES = Suma de la media de cada interviniente
  * Para la ejecución de este cálculo, se debe ignorar la nómina de junio y diciembre, porque es el mes en el que se suele tener la paga extra y distorsionaría los cálculos

~~~
Ejemplo (1titular, 2 pagadores):
 1-1-26: Emprea A : 2300EUR
 5-1-26: Emprea B: 800EUR
 1-2-26: Emprea A: 2300EUR
 4-2-26: Emprea B: 700EUR
 
Agrupando:
 Enero: 3100EUR
 Febrero: 3000EUR
 
* Media: 3050EUR
~~~

- Si el cliente es un trabajador por cuenta propia, pensionista o rentista, el cálculo  de  “media de ingresos observados de los últimos {{X}} meses” INGRESOS_OBS_MENSUALES se hará sumando BASE_IMPONIBLE/14 de cada interviniente

- Se creará una nueva tarea en el BPM del expediente (con mail al gestor del expediente) tras la validación conjunta para validar Si INGRESOS_OBS_MENSUALES < PARAM:MINIMO_INGRESOS (con X margen configurable). Esta tarea debe mostrar:
  * En dicha tarea se podrá visualizar la “media de ingresos observados de los últimos X meses” de cada titular el dato de “media de ingresos observados de los últimos X meses de todos los titulares”, así como el valor de “ingresos mínimos observados necesarios para ofertas” para una solicitud de un titular y de dos titulares  
  * Asimismo, podrá ver el nuevo precio que le va a corresponder según el cálculo hecho por WF  
  * La decisión única "Avanzar" que aplicará la oferta que corresponda y avanzará el flujo (llamadal motor de scoring)
  * **Esta tarea NO se ejecutará si el expediente ya ha pasado por fase de firma PROC@FIRMA**

Debe crearse un aviso para el gestor con el títlo *PDTE DEFINIR* y en el aviso debe mostrarse el valor declarado y el valor calculado INGRESOS_OBS_MENSUALES
- En la pantalla del interviniente, a la derecha de sus ingresos mensuales declarados debe mostrarse el campo "media de ingresos observados de los últimos {{X}} meses: {{INGRESOS_OBS_MENSUALES}}"


## Llamadas al motor de scoring

### Primera Vivienda habitual
Se enviará el campo PRIMERA_VIVIENDA_HABITUAL_FL

### Ingresos declarados 

- IngNetAnDec: Ingresos mensuales * Num pagas. 
- IngNetAnActLabDec: Ingresos mensuales * Num pagas
- NumPagasDec: Num pagas
-Si no tenemos el dato *Num pagas* (ejem. expediente sin oferta joven) se usará 14.

### Total años trabajados

En la validación conjunta se captura el total de años/meses trabajados (unidades en meses totales). Se solicita añadir la información al motor de scoring.

Campo motor de scoring|Cálculo
-|-
vidaLaboralObs|total_anyo_trabajado_nm*12 + total_meses_trabajado_nm

El nuevo valor debe viajar en el fichero RiesgosScoringLlamadas por lo que se deben añadir los campos en la tabla de entrada de datos de intervinientes.


## Cambios en servicios

### Expone WF

#### Modificaciones

- AltaHipoteca: Añadir el campo primeraViviendaHabitual
- GetDatosEntradaPrestamo, GetDatosAdicionalesPreAprob: Añadir el campo primeraViviendaHabitual a la salida
- GuardarDatosAdicionalesPreAprob: Añadir el campo a la entrada primeraViviendaHabitual

#### Nuevos
- GetOfertasHipotecas: Consulta de límites de la operación (elegible para ofertas)

## Export ExpedientesProducto

Al fichero que se genera diariamente deben añadirse estos campos:

 - INGRESOS_DECLARADOS_T1
 - INGRESOS_OBSERVADOS_T1
 - NUM_PAGAS_T1
 - INGRESOS_DECLARADOS_T2
 - INGRESOS_OBSERVADOS_T2
 - NUM_PAGAS_T2
 - Edad del titular mayor (ya está la edad del menor)
 - TIN (real, incluye los cambios por precio personalizado)
 - DIFERENCIAL (real, incluye los cambios por precio personalizado)
 - PRIMERA_VIVIENDA_HABITUAL_FL
 
 
## Export RiesgoScoringLlamadas

Al fichero que se genera diariamente deben añadirse estos campos:

- Valor vidaLaboralObs de cada interviniente
- Valor PRIMERA_VIVIENDA_HABITUAL_FL

# CAMBIOS PARA GENERAR DOCUMENTOS

## Servicio web Generar-Documento

Se añaden estas nuevas variables en el objeto "cabecera" entregado al servicio:

- Edad Máxima: Saldrá del parámetro asociado a la oferta en el motor de reglas. Requiere nuevo campo en servicio **edadMaxima** de tipo string con el valor de la edad máxima configurada en los parámetros de la oferta
- Edad+Plazo: Saldrá del parámetro asociado a la oferta en el motor de reglas. Nuevo campo **edadMasPlazo** de tipo string. Si no existe se usará el que figure en constantes/productos/intereses/EdadMaxPrimeraVivienda o EdadMaxSegundaVivienda (revisar campos del servicio, debemos enviarlo ya actualmente)
- Importe Mínimo por CCAA: Saldrá del parámetro asociado a la oferta en el motor de reglas. Nuevo campo **importeMinimoCcaa** de tipo string que tendrá el importe formateado con separador de miles "." y decimal "," con dos decimales.

Cambio en parámetros (no requiere modificación de código):

- Valor inmueble del ejemplo: Está en producto-fecha, "Valor ejemplo inmueble". Solo hay que cambiar el valor por el que solicitan
- LTV Máximo: Ya debemos enviarlo, será el máximo del rango LTV asociado al expediente. 
- Importe máximo del ejemplo: LTV Máximo * Valor inmueble del ejemplo. Podríamos reutilizar los campos del servicio usados en FIPRE

## Servicio web carta de Pre-Aprobación

Se añaden estas nuevas variables la raíz del objeto entregado al servicio:

- Edad+Plazo: Mismo comportamiento que en Servicio Generar-Documento. Nuevo campo **edadMasPlazo**
- Edad Máxima: Mismo comportamiento que en Servicio Generar-Documento. Nuevo campo **edadMaxima**

