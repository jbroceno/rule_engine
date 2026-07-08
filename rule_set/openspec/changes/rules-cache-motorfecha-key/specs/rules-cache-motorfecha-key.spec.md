# Especificación — rules-cache-motorfecha-key

> **Tipo:** delta spec (supersede al cambio archivado `db-rules-cache`).
> Esta especificación describe el comportamiento observable que DEBE ser verdadero una vez aplicado el
> cambio. No describe implementación ni diseño — esos son responsabilidad de la fase de diseño.

---

## Propósito

El cambio `db-rules-cache` entregó una capa de caché para el SP de resolución de reglas. Su esquema
de clave era la fecha de referencia literal. Esta especificación cubre la evolución del esquema de
clave hacia un **fingerprint determinista de los períodos `MRO_MOTORFECHA` ganadores resueltos**
(winner de reglas + winner de parámetros, por oferta).

El caché resultante es **auto-invalidante**: dos fechas distintas que producen la misma configuración
comparten la misma entrada de caché, y un publish que introduce un período nuevo cambia el fingerprint
automáticamente, sin necesidad de operación de refresco explícita.

---

## Requisitos

### REQ-01 — Determinismo del fingerprint

Dos peticiones con fechas de referencia distintas que resuelven a los **mismos períodos ganadores**
(mismo winner de reglas y de parámetros para cada oferta en el conjunto) DEBEN producir el mismo
`cache_key`. La segunda petición DEBE ser un hit sin volver a ejecutar la capa costosa de
serialización del SP base.

#### Escenario A — Misma configuración, fechas distintas dentro del mismo período

- DADO que existe un período `MRO_MOTORFECHA` con `DESDE_DT = 2026-01-01` activo para las ofertas
  `[A, B]`
- Y no existe ningún período posterior activo para esas ofertas
- CUANDO se realiza una primera petición con fecha de referencia `2026-03-15` para `[A, B]`
- ENTONCES se produce un miss, se ejecuta el SP base y se almacena la entrada con el fingerprint
  resultante
- CUANDO se realiza una segunda petición con fecha `2026-05-22` para `[A, B]`
- ENTONCES los winners resueltos son idénticos a los de la primera petición
- Y la segunda petición obtiene un hit sin ejecutar el SP base
- Y las columnas de salida (`OFERTAS_JSON`, `PARAMETROS_JSON`) son idénticas en ambas respuestas

#### Escenario B — Mismo conjunto de ofertas, distinto período activo

- DADO que se ha publicado un período nuevo con `DESDE_DT = 2026-06-01` que desplaza al anterior
- CUANDO se realiza una petición con fecha de referencia `2026-07-01` para las mismas ofertas
- ENTONCES el fingerprint calculado difiere del de las peticiones anteriores al período nuevo
- Y se produce un miss controlado
- Y se almacena una nueva entrada con el fingerprint del período vigente

---

### REQ-02 — Independencia del orden de ofertas

El fingerprint DEBE ser el mismo independientemente del orden en que se suministren las ofertas en
la petición. Dos peticiones que solicitantes exactamente el mismo conjunto de ofertas con distinto
orden DEBEN generar el mismo `cache_key` y, si la primera fue un miss que pobló la caché, la segunda
DEBE ser un hit.

#### Escenario — Orden de ofertas permutado

- DADO que la caché contiene una entrada para las ofertas `[A, B]` con un fingerprint determinado
- CUANDO se realiza una petición para las mismas ofertas en orden `[B, A]` con la misma fecha de
  referencia
- ENTONCES el fingerprint calculado es idéntico al de la entrada existente
- Y la petición es un hit

---

### REQ-03 — Oferta sin período cubriente

Cuando una oferta del conjunto no tiene ningún período `MRO_MOTORFECHA` activo que cubra la fecha
de referencia, su contribución al fingerprint DEBE ser una marca distinta que represente "sin período
activo". Esta marca DEBE diferenciarse inequívocamente de cualquier identificador de período real.

La consecuencia DEBE ser que:

1. Una petición donde la oferta A no tiene período cubriente y la oferta B sí tiene período `P1`
   produce un fingerprint diferente al de una petición donde ambas ofertas tienen períodos activos.
2. En cuanto se activa un período para la oferta A que cubra la fecha solicitada, el fingerprint de
   la nueva petición cambia respecto al anterior → miss controlado → entrada fresca.

#### Escenario A — Oferta sin período en el fingerprint

- DADO que la oferta `A` no tiene ningún período `MRO_MOTORFECHA` activo para la fecha `2026-03-15`
- Y la oferta `B` tiene el período `P1` activo para esa fecha
- CUANDO se calcula el fingerprint para `[A, B]` con fecha `2026-03-15`
- ENTONCES la contribución de `A` al fingerprint es la marca de "sin período activo"
- Y la contribución de `B` al fingerprint incluye el identificador de `P1`
- Y el fingerprint difiere del fingerprint que se obtendría si `A` tuviera algún período activo

#### Escenario B — Activación de un período futuro invalida la entrada

- DADO que existe una entrada de caché con fingerprint `FP1` para ofertas `[A, B]` donde `A` no
  tenía período cubriente
- CUANDO se activa (publica) un período para `A` con `DESDE_DT <= fecha de la petición siguiente`
- ENTONCES la siguiente petición calcula un fingerprint `FP2 ≠ FP1`
- Y se produce un miss controlado y se almacena una nueva entrada `FP2`
- Y `FP1` queda como entrada huérfana (válida históricamente, no incorrecta)

---

### REQ-04 — Auto-invalidación por publish (nuevo período activo)

Cuando se publica un nuevo período `MRO_MOTORFECHA` que cubre la fecha de referencia de una
petición posterior, la siguiente petición DEBE producir un miss controlado y obtener la configuración
fresca. El sistema NO DEBE requerir ninguna operación de refresco o purga explícita para que esto
ocurra.

#### Escenario — Publish introduce nuevo período

- DADO que la caché contiene una entrada para el fingerprint `FP1` correspondiente al período `P1`
- CUANDO se publica un período nuevo `P2` con `DESDE_DT <= fecha_siguiente_petición`
- Y `P2` desplaza a `P1` como winner para las ofertas del conjunto
- ENTONCES la siguiente petición calcula el fingerprint `FP2` (basado en `P2`)
- Y `FP2 ≠ FP1` → miss
- Y el SP base se ejecuta y produce una entrada fresca con los datos de `P2`
- Y en ningún momento se invoca ningún SP ni función de refresco explícito de caché

---

### REQ-05 — Auto-invalidación por activación de configuración futura

Un período `MRO_MOTORFECHA` con fecha de inicio futura DEBE ser recogido por la caché en cuanto una
petición use una fecha de referencia que lo cubra. No DEBE ser necesario esperar a un evento externo
(publish, purga, expiración de TTL) para que la entrada fresca sea servida.

#### Escenario — Config con DESDE_DT futuro se recoge automáticamente

- DADO que existe un período `P_futuro` con `DESDE_DT = 2026-09-01` ya creado en la base de datos
- Y hoy la fecha es anterior a `2026-09-01`, de modo que ninguna petición con fecha actual lo activa
- CUANDO una petición llega con fecha de referencia `2026-09-15`
- ENTONCES el fingerprint calculado incluye los identificadores de `P_futuro` como winner
- Y si la caché no contiene ese fingerprint → miss → entrada fresca con la config de `P_futuro`
- Y si la caché ya contiene ese fingerprint → hit → misma config fresca devuelta
- Y ningún evento externo fue necesario entre la creación de `P_futuro` y la obtención de su config

---

### REQ-06 — Beneficio del caché independiente de si la fecha es NULL o concreta

El funcionamiento del caché DEBE ser equivalente tanto cuando la fecha de referencia es un valor
concreto (timestamp) como cuando se usa la fecha efectiva del momento de la petición. El
comportamiento correcto NO DEBE depender de que el cliente envíe `NULL` como fecha.

#### Escenario — Cliente con timestamp concreto obtiene hits

- DADO que un cliente siempre suministra una fecha concreta como timestamp (no NULL) en cada petición
- Y dos peticiones consecutivas del mismo cliente llegan con timestamps distintos pero dentro del
  mismo período activo
- CUANDO ambas peticiones se procesan
- ENTONCES el fingerprint de ambas es idéntico (mismo winner)
- Y la segunda petición es un hit
- Y el cliente obtiene la misma respuesta que obtendría si enviara NULL

#### Escenario — Ausencia de ruta de caché específica para NULL

- DADO cualquier petición
- CUANDO el sistema calcula el `cache_key`
- ENTONCES el proceso de construcción del fingerprint es el mismo independientemente de si la fecha
  era NULL o un timestamp concreto (la fecha efectiva de resolución es la que importa)
- Y no existen dos ramas de clave distintas (una "genérica" y una "histórica") — solo una

---

### REQ-07 — Anti-stampede en miss

Cuando múltiples peticiones concurrentes llegan con el mismo fingerprint y ninguna de ellas encuentra
la entrada en caché (miss simultáneo), el SP base DEBE ejecutarse **exactamente una vez** para ese
fingerprint. Las demás peticiones concurrentes DEBEN esperar y reutilizar la entrada que inserta la
primera.

#### Escenario — Miss concurrente con mismo fingerprint

- DADO que la caché no contiene la entrada para el fingerprint `FP1`
- CUANDO dos peticiones `R1` y `R2` llegan simultáneamente con el mismo fingerprint `FP1`
- ENTONCES una de ellas adquiere el bloqueo de serialización y ejecuta el SP base
- Y la otra espera hasta que el bloqueo se libera
- Y tras liberar el bloqueo, la segunda petición re-verifica la caché y encuentra la entrada ya
  insertada por la primera → no re-ejecuta el SP base
- Y ambas peticiones devuelven la misma respuesta correcta

#### Escenario — Miss concurrente en fingerprints distintos no se bloquean entre sí

- DADO que dos peticiones concurrentes `R1` (fingerprint `FP1`) y `R2` (fingerprint `FP2`) son ambas
  un miss
- ENTONCES cada una adquiere su propio bloqueo de serialización de forma independiente
- Y ambas pueden ejecutar el SP base en paralelo sin interferirse

---

### REQ-08 — Evicción acotada por tamaño máximo configurable

El número de entradas almacenadas en la caché DEBE mantenerse por debajo o igual a un **tamaño
máximo configurable** (cap). Cuando se inserta una nueva entrada y el número total de entradas para
el mismo conjunto de ofertas supera el cap, la entrada más antigua (por orden de creación) DEBE
eliminarse.

#### Escenario — El cap se respeta al insertar más allá del límite

- DADO que el tamaño máximo configurable es `N`
- Y la caché ya contiene `N` entradas para el conjunto de ofertas `[A, B]`
- CUANDO llega una petición con un fingerprint nuevo para `[A, B]` que produce un miss
- ENTONCES se inserta la nueva entrada
- Y el total de entradas para `[A, B]` vuelve a ser exactamente `N`
- Y la entrada eliminada es la más antigua de las `N` anteriores

#### Escenario — Entradas de distintos conjuntos de ofertas no se mezclan en la evicción

- DADO que la caché contiene `N` entradas para el conjunto `[A, B]` y `M` entradas para `[A, B, C]`
- CUANDO se inserta una nueva entrada para `[A, B]` que supera el cap
- ENTONCES solo se eliminan entradas del conjunto `[A, B]`
- Y las entradas de `[A, B, C]` permanecen intactas

---

### REQ-09 — TTL configurable como gestión de almacenamiento

Las entradas de caché DEBEN expirar tras un tiempo de vida configurable (TTL). La expiración es un
mecanismo de **gestión de almacenamiento** — evita la acumulación indefinida de entradas huérfanas
— y NO es un mecanismo de corrección de staleness. Una entrada expirada produce un miss que obtiene
la config actual; una entrada no expirada que ya no sea el período activo sigue siendo una entrada
huérfana válida pero no incorrecta (produce un miss por fingerprint distinto, no por TTL).

#### Escenario — Entrada expirada produce miss

- DADO que existe una entrada de caché con un `created_at` anterior al umbral de TTL configurable
- CUANDO llega una petición cuyo fingerprint coincide con esa entrada
- ENTONCES la entrada se considera expirada
- Y el resultado es un miss (se ejecuta el SP base y se obtiene la config actualizada)

#### Escenario — Entrada no expirada sigue siendo hit

- DADO que existe una entrada de caché con `created_at` dentro del TTL configurable
- CUANDO llega una petición con el mismo fingerprint
- ENTONCES es un hit sin ejecutar el SP base

---

### REQ-10 — Estabilidad de la firma del wrapper y del contrato de salida

La firma del wrapper cacheado (nombre del SP y parámetros de entrada) DEBE ser compatible con la que
consume el servicio Node.js actual. Las columnas de salida (`OFERTAS_JSON`, `PARAMETROS_JSON`) y
la estructura del JSON devuelto NO DEBEN cambiar.

#### Escenario — El consumidor Node no requiere cambios de interfaz

- DADO que el servicio Node.js llama al SP cacheado con los mismos parámetros que antes de este cambio
  (conjunto de ofertas, fecha de referencia, tamaño máximo de entradas)
- CUANDO el wrapper procesa la petición (hit o miss)
- ENTONCES la respuesta contiene exactamente las columnas `OFERTAS_JSON` y `PARAMETROS_JSON`
- Y el formato y estructura del JSON de las columnas es idéntico al que devolvería el SP base
- Y el servicio Node no requiere ningún cambio de código para adaptarse al nuevo comportamiento

#### Escenario — El tamaño máximo de entradas sigue siendo un parámetro del wrapper

- DADO que el servicio Node pasa el tamaño máximo de entradas como parámetro al invocar el wrapper
- CUANDO el wrapper gestiona la evicción
- ENTONCES usa ese valor recibido como límite (no un valor fijo interno)

---

### REQ-11 — Ausencia de refresco explícito tras applyConfig

El sistema NO DEBE invocar ninguna operación de caché (refresco, purga, warm-up) como parte del
flujo de `applyConfig`. La corrección del caché tras un publish NO DEBE depender de ningún paso
explícito post-commit.

#### Escenario — applyConfig no invoca operaciones de caché

- DADO que un operador ejecuta `applyConfig` para publicar una nueva configuración
- CUANDO el commit a base de datos finaliza correctamente
- ENTONCES el servicio Node no llama a ningún SP ni función de caché como parte del mismo flujo
- Y la respuesta de `applyConfig` no está condicionada por el éxito o fracaso de ninguna operación
  de caché

#### Escenario — La corrección tras publish emerge del fingerprint, no del refresco

- DADO que se acaba de publicar una nueva configuración que introduce el período `P_nuevo`
- CUANDO llega la siguiente petición al wrapper con una fecha cubierta por `P_nuevo`
- ENTONCES el fingerprint calculado incluye los identificadores de `P_nuevo`
- Y si ese fingerprint no está en caché → miss → entrada fresca con la nueva config
- Y la corrección se obtiene sin haber invocado ninguna operación explícita de refresco

---

## Preguntas abiertas (no resueltas en spec; delegadas a diseño)

| ID | Pregunta | Impacto en spec |
|----|----------|----------------|
| PH-3 | ¿Eliminar por completo la columna que distinguía los dos perfiles de clave anteriores, o mantenerla nullable/constante? | No afecta al comportamiento observable especificado. Decisión de esquema. |
| PH-TTL | ¿Cuál es el valor por defecto del TTL configurable y cómo se expone (parámetro de SP, columna calculada, job de limpieza)? | REQ-09 especifica la semántica; el valor concreto y el mecanismo de exposición son decisiones de diseño. |
| PH-CAP | ¿Conviene renombrar el parámetro de tamaño máximo de entradas para reflejar la nueva semántica (sin perfiles G/H)? | REQ-08 y REQ-10 especifican el comportamiento; el nombre exacto del parámetro es decisión de diseño. El contrato con Node debe preservarse (REQ-10). |

---

## Cobertura respecto a `db-rules-cache` (REQ anteriores)

| REQ anterior | Estado en este cambio |
|---|---|
| REQ-01 (G-hit fast-path sin llamar al SP original) | Eliminado: la distinción G/H desaparece. Sustituido por REQ-01/02/06 (fingerprint único para todos los perfiles). |
| REQ-02 (G-miss almacena con clave `__CURRENT__`) | Eliminado: no existe clave `__CURRENT__`. Sustituido por REQ-01. |
| REQ-03 (H-hit fast-path correcto) | Sustituido: ya no hay rama H. REQ-01 cubre el hit-path unificado. |
| REQ-04 (H-miss con sp_getapplock, double-check, insert) | Sustituido por REQ-07 (anti-stampede aplica a todo miss, no solo a la rama H). |
| REQ-05 (Stampede prevention) | Sustituido y extendido por REQ-07. |
| REQ-06 (FIFO eviction acotado por cap y offer_codes) | Mantenido y refinado en REQ-08. |
| REQ-07 (Refresh reconstruye entrada G atómicamente) | Eliminado: no existe operación de refresco. Sustituido por REQ-04 y REQ-11. |
| REQ-08 (Refresh failure aislado; applyConfig no se bloquea) | Sustituido por REQ-11 (sin refresco → no hay failure que aislar). |
| REQ-09 (config_service llama al SP cacheado con max_history_size) | Mantenido como REQ-10 (firma estable). |
| REQ-10 (admin_service llama a refresh tras commit; failure no se propaga) | Eliminado y negado por REQ-11. |
| — | **NUEVO** REQ-02 (independencia del orden de ofertas) |
| — | **NUEVO** REQ-03 (oferta sin período cubriente → marca distinta) |
| — | **NUEVO** REQ-05 (activación futura se recoge sin evento externo) |
| — | **NUEVO** REQ-06 (fingerprint no depende de NULL vs. timestamp concreto) |
| — | **NUEVO** REQ-09 (TTL como gestión de almacenamiento, no de corrección) |
