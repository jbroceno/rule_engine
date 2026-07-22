# Cache de configuración de parámetros

## Requisitos funcionales

El el sistema de Workflow las llamadas a *cfg_get_offers_and_params_json* serán constantes y llegará a ser bastante pesado porque el conjunto de reglas y parámetros es extenso. Aunque el propio servidor tenga cacheadas en memoria páginas de disco correspondiente a esos datos podemos mejorar la situación aportando un sistema propio de caché, con un tiempo de vida y tamaño de entrada configurable.

Las peticiones podemos agruparlas en dos perfiles diferentes:

- Genéricas: Son peticiones que se hacen sin indicar una fecha, devolverán siempre la que corresponda a las últimas entradas registradas. Serán muy frecuentes y con mucho impacto ya que todos los casos nuevos indicarán la fecha en blanco. Sí podrán diferir en el conjunto de ofertas para las que se desea la configuración.

- Históricas: Son peticiones que referencian una fecha además del conjunto de ofertas.

Una solución simple y efectiva sería usar una tabla para almacenar las respuestas de reglas y parámetros ya calculadas. Esta tabla se limpiaría cada vez que hubiera cambios en la configuración de reglas y parámetros, sobre todo para la caché Genérica donde no se indica fecha y podríamos tener resultados no válidos.

En esta tabla cache guardaríamos la fecha, el conjunto de ofertas (campos clave) y las respuestas de parámetros y reglas. Antes de calcular una petición, buscaríamos en la tabla cache si ya tenemos la respuesta calculada y en es caso devolveríamos la respuesta directamente sin más cálculos.

Una mejora importante sería, en lugar de guardar como clave la fecha de referencia, utilizar por una parte el id correspondiente MRO_MOTORFECHA para reglas y por otra el correspondiente a parámetros. Realmente sería la solución óptima ya que dos fechas distintoas indicarán la misma configuración si internamente los registros de MRO_MOTORFECHA son iguales.


## Requisitos no funcionales

- No podemos configurar en el servidor opciones OLTP