# Definición de tareas - Ofertas hipotecarias

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

