# Manual de Usuario — Motor de Reglas de Ofertas Hipotecarias

> Este manual está escrito para cualquier persona que vaya a **usar** la aplicación
> (comercial, analista de riesgos, administrador de producto, tester, etc.), **no**
> hace falta conocimiento previo de programación ni haber participado en el diseño
> del sistema. Si necesitas el detalle técnico exacto del JSON de configuración,
> consulta `rule_set/docs/CONFIGURACION_REGLAS.md`.

---

## 1. ¿Qué es esta aplicación?

Es una herramienta que decide, de forma automática, **qué oferta hipotecaria puede
ofrecerse a un cliente** (o si no puede ofrecerse ninguna) a partir de sus datos:
ingresos, edad, antigüedad laboral, importe de la vivienda, importe solicitado,
plazo, etc.

En vez de tener esas reglas de decisión "escritas a mano" dentro del código de un
programa, viven como **datos configurables** (un fichero/tabla de reglas). Esto
permite que, cuando cambian las condiciones comerciales de una oferta (por ejemplo,
"a partir de ahora admitimos hasta 45 años en vez de 40"), se pueda modificar sin
tocar ni una línea de código: se edita la regla o el parámetro correspondiente
desde el **Configurador** (una pantalla web) y se graba.

La aplicación evalúa la solicitud en **tres fases sucesivas**, cada vez con más
detalle, como un embudo:

```
        Todas las ofertas
              │
   ┌──────────▼───────────┐
   │   FASE 1 — INIT      │   filtro rápido: perfil básico del cliente
   └──────────┬───────────┘
              │  (solo pasan las ofertas que aceptan a este cliente)
   ┌──────────▼───────────┐
   │   FASE 2 — PRE       │   filtro de ingresos / solvencia
   └──────────┬───────────┘
              │  (solo pasan las ofertas cuyos ingresos mínimos se cumplen)
   ┌──────────▼───────────┐
   │   FASE 3 — FINAL     │   filtro con los datos definitivos de la operación
   └──────────┬───────────┘   (importe, plazo, LTV…)
              │
        Oferta ganadora
     (o "sin oferta posible")
```

Si en una fase **ninguna** oferta queda elegible, el proceso se detiene ahí: no
tiene sentido seguir preguntando por el importe o el plazo si el cliente ya no
califica para ninguna oferta con sus datos básicos.

Si en la fase final hay **más de una oferta elegible**, gana la de mayor
**ranking** (cada oferta tiene asignado un número de prioridad comercial).

---

## 2. Los cuatro conceptos que hay que entender

Toda la lógica de decisión se construye combinando cuatro piezas. Se explican aquí
con una analogía sencilla: **una regla es como un guardia de seguridad con una
lista de motivos de rechazo**. Revisa una condición; si se cumple, apunta el
motivo y actúa en consecuencia.

| Concepto | Analogía | Qué es en la aplicación |
|----------|----------|--------------------------|
| **Oferta** | Un producto del catálogo | Un tipo de hipoteca concreto (ej. `ALTO_RIESGO`, `LARGO_PLAZO`). Tiene su propio conjunto de reglas y sus propios parámetros. |
| **Regla** | Un guardia con una lista de comprobación | Una comprobación concreta ("¿la antigüedad laboral es suficiente?"). Tiene una **prioridad** (orden en que se revisa) y puede decir "con esto ya no hace falta seguir mirando más motivos" (`stop_processing`). |
| **Condición** | La pregunta que hace el guardia | La comparación en sí: "¿el importe es mayor que 45?", "¿la fecha está entre estas dos?", etc. |
| **Acción** | Lo que anota el guardia en su informe | Qué se escribe en el resultado si la condición se cumple: marcar como rechazado, anotar el motivo, fijar un límite, etc. |
| **Parámetro** | El número que puede cambiar sin rehacer las reglas | Un valor configurable por oferta (edad máxima, importe mínimo, lista de tipos admitidos…). Las reglas lo referencian, nunca lo llevan "a fuego". |

### 2.1 Importante: las reglas detectan **motivos de rechazo**, no motivos de aprobación

Este es el punto que más sorprende a quien no ha participado en el diseño: **una
regla no dice "si cumples esto, te acepto"**. Al revés: **dice "si se cumple
esto, te rechazo"**. Por eso casi todos los nombres de regla en el sistema
empiezan por *"Rechazo: …"*.

¿Por qué se hace así? Porque es mucho más fácil listar "motivos concretos de
exclusión" (antigüedad insuficiente, importe fuera de rango, edad+plazo excesivo…)
que enumerar todas las combinaciones posibles que sí serían válidas. Al final del
recorrido, si **ningún** motivo de rechazo se disparó, una última regla de
prioridad baja dice: "no ha saltado ningún rechazo → esta oferta es válida".

Esto es como un control de seguridad de aeropuerto: no hay una regla que diga "te
dejo pasar si...", hay una lista de motivos por los que **no** te dejan pasar
(objeto prohibido, documentación caducada…). Si no salta ninguno, pasas.

### 2.2 Condiciones agrupadas: cuándo se combinan con "Y" y cuándo con "O"

Cada condición pertenece a un **grupo** (`group_id`):

- Condiciones **del mismo grupo** → se exige que se cumplan **todas** (Y).
- Condiciones **de grupos distintos** → basta con que se cumpla **uno de los
  grupos** (O).

Ejemplo textual: *"se rechaza si (antigüedad de ambos titulares es baja Y ninguno
domicilia la nómina)"* es un único grupo con cuatro condiciones unidas por "Y".
*"se rechaza si el LTV es demasiado bajo O el LTV es demasiado alto"* son dos
grupos (cada uno con su propia condición), unidos por "O".

### 2.3 Los parámetros (`PARAM:`)

En vez de escribir "45" directamente dentro de una condición, las reglas suelen
escribir `PARAM:MAX_EDAD`. Esto significa: *"toma el valor que la oferta tenga
configurado para la clave `MAX_EDAD` en este momento"*. Así, cambiar el límite de
edad de una oferta es **editar un número en la pantalla de parámetros**, sin tocar
ninguna regla.

---

## 3. Ejemplo ilustrativo completo (con datos reales de la oferta `ALTO_RIESGO`)

Vamos a seguir una solicitud real, paso a paso, a través de las tres fases,
usando la configuración real de la oferta `ALTO_RIESGO` tal y como está en el
sistema (`rules.json`).

### 3.1 Parámetros configurados para `ALTO_RIESGO`

| Parámetro | Valor | Significado |
|-----------|-------|-------------|
| `MIN_ANTIGUEDAD` | 12 (meses) | Antigüedad laboral mínima para no depender de domiciliar la nómina |
| `MAX_EDAD` | 45 (años) | Edad máxima de cualquiera de los titulares |
| `EDAD_PLAZO` | 75 (años) | Edad del titular más mayor + plazo de la hipoteca no puede superar esto |
| `MIN_HIPOTECA` / `MAX_HIPOTECA` | 50.000 € / 1.500.000 € | Rango admitido del importe de la hipoteca |
| `MIN_PLAZO` / `MAX_PLAZO` | 3 / 35 (años) | Rango admitido del plazo |
| `MIN_LTV_EXCLUSIVE` / `MAX_LTV` | 0,80 / 1,00 | LTV admitido: **más de 0,80 y hasta 1,00 (100%)** |
| `MIN_INGRESOS_1T` | 2.700 € | Ingreso mínimo si hay un solo titular |
| `MIN_INGRESOS_2T` | 3.700 € | Ingreso mínimo conjunto si hay dos titulares |
| `TIPO_ALTA_ADMITIDAS` | `["NOVACION", "CAPTACION"]` | Tipos de alta que se admiten |

> `LTV` (*Loan To Value*) es el porcentaje del valor de la vivienda que se
> financia con la hipoteca: `LTV = importe de la hipoteca / valor de garantía`.
> Por ejemplo, financiar 153.000 € sobre una vivienda de 180.000 € da un
> LTV de 0,85 (85%).

### 3.2 Caso A — Solicitud que SÍ es aceptada

**Datos de la solicitud** (dos titulares):

| Dato | Titular 1 | Titular 2 |
|------|-----------|-----------|
| Antigüedad laboral | 24 meses | 20 meses |
| Domicilia la nómina | No | No |
| Edad | 35 | 33 |
| Ingreso mensual | 2.000 € | 2.300 € |

Datos generales: finalidad = *primera vivienda* (código 1), es primera vivienda
habitual, tipo de alta = `CAPTACION`, importe de la vivienda = 180.000 €
(por encima del mínimo exigido en su comunidad autónoma), importe de tasación =
180.000 €, importe de hipoteca solicitado = 153.000 €, plazo = 25 años.

**FASE 1 — INIT (perfil básico):**

| Regla (motivo de rechazo) | Se evalúa | ¿Se dispara? |
|---|---|---|
| Antigüedad baja **y** sin domiciliar (ambos titulares) | T1: 24 meses > 12 → **ya no cumple la condición de "antigüedad baja"** para T1 | No |
| Tipo de alta no admitido | `CAPTACION` está en la lista admitida | No |
| Finalidad distinta de "primera vivienda" | Finalidad = 1 | No |
| No es primera vivienda habitual | Sí lo es | No |
| Edad máxima ≥ 45 | Máxima de los dos = 35 | No |
| Importe de vivienda por debajo del mínimo de su CCAA | 180.000 ≥ mínimo exigido | No |

Ningún motivo de rechazo salta → se ejecuta la regla de decisión de prioridad
baja **"INIT Decisión: initEligible + límites"**, que:
- marca la oferta como `initEligible = true`
- deja grabados en el resultado los límites (importe mín/máx, plazo mín/máx, LTV
  mín/máx, edad+plazo) para que la pantalla los muestre al usuario desde ya.

> Nótese el detalle de la primera regla: aunque ninguno de los dos titulares
> domicilia la nómina, la condición completa exige que **también** la antigüedad
> de ambos sea baja. Como el titular 1 tiene 24 meses (por encima de los 12
> exigidos), el grupo entero de condiciones no se cumple y la regla no rechaza.
> Es decir: **con tener antigüedad suficiente en al menos un titular, ya no hace
> falta domiciliar la nómina.**

**FASE 2 — PRE (ingresos):**

| Regla (motivo de rechazo) | Se evalúa | ¿Se dispara? |
|---|---|---|
| Con 1 titular, ingreso del titular 1 < 2.700 € | No aplica (hay 2 titulares) | No |
| Con 2 titulares, ingreso conjunto ≤ 3.700 € | 2.000 + 2.300 = 4.300 € > 3.700 € | No |

Ningún rechazo → se ejecuta **"PRE Decisión: preEligible + límites"**: marca
`preEligible = true` y fija de nuevo los límites de la oferta.

**FASE 3 — FINAL (datos definitivos de la operación):**

Primero el motor calcula automáticamente:
- `baseGarantia = mín(importe de compraventa, importe de tasación) = 180.000 €`
- `LTV = 153.000 / 180.000 = 0,85`

| Regla (motivo de rechazo) | Se evalúa | ¿Se dispara? |
|---|---|---|
| LTV ≤ 0,80 **o** LTV > 1,00 | 0,85 no es ≤ 0,80 ni > 1,00 | No |
| Importe de hipoteca fuera de [50.000, 1.500.000] | 153.000 está dentro | No |
| Plazo fuera de [3, 35] años | 25 está dentro | No |
| Edad del mayor (35) + plazo (25) = 60 > 75 | 60 no supera 75 | No |

Ningún rechazo salta → se ejecuta **"FINAL Decisión: ELEGIBLE"**: la oferta
queda `eligible = true` y `selectedOffer = "ALTO_RIESGO"`.

**Resultado mostrado al usuario:** ✅ Oferta **ALTO_RIESGO** aprobada, con los
límites de importe/plazo/LTV visibles desde la fase INIT.

### 3.3 Caso B — La misma solicitud, pero con un LTV demasiado alto

Cambiamos un único dato: importe de hipoteca solicitado = 175.000 € (en vez de
153.000 €), manteniendo el resto igual.

- `LTV = 175.000 / 180.000 = 0,97` → sigue dentro de (0,80, 1,00], **no** seria
  rechazado por LTV.

Para forzar el rechazo, subimos el importe a **190.000 €** (por encima del valor
de la vivienda):

- `LTV = 190.000 / 180.000 = 1,055` → **supera el máximo de 1,00** → la regla
  *"FINAL Rechazo: LTV fuera de rango"* se dispara:
  - `SET rejected = true`
  - `APPEND motivos → {"code": "LTV"}`

Como `rejected = true`, se ejecuta la regla **"FINAL Decisión: NO elegible"**:
`eligible = false`. Si esta era la única oferta que había llegado a la fase
FINAL, el resultado global es: ❌ **sin oferta disponible**, con el motivo `LTV`
visible en el detalle para que el usuario entienda por qué.

Esto ilustra el patrón completo: **las reglas de rechazo van anotando motivos
concretos, y solo al final una regla de baja prioridad decide si, con todo lo
acumulado, la oferta es o no es viable.**

---

## 4. Catálogo de ofertas disponibles (seed)

| Código de oferta | Ranking (desempate) | Notas |
|---|---|---|
| `ULTRA_ALTO_RIESGO` | 100 | La de mayor prioridad si varias ofertas son elegibles a la vez. |
| `ALTO_RIESGO` | 90 | Ver ejemplo completo en la sección 3. |
| `LARGO_PLAZO` | 80 | Mismas reglas que `ALTO_RIESGO`, con parámetros propios (plazos más largos permitidos). |
| `PROMOCION_HC` | 70 | Mismas reglas que `ALTO_RIESGO`, parámetros propios. |
| `PROMOCION` | 60 | Mismas reglas que `ALTO_RIESGO`, parámetros propios (más permisiva en general). |
| `FIDELIZACION` | 10 | Caso especial: **solo tiene reglas de fase INIT** (un único criterio de antigüedad/domiciliación). Al no definir reglas propias de PRE ni FINAL, se comporta con el mismo criterio en las tres fases. |

> El **ranking** (`offer_rank`) solo entra en juego cuando, en la fase FINAL, más
> de una oferta resulta elegible para el mismo cliente: gana la de ranking más
> alto.

---

## 5. Tour por el resto de la aplicación

Además del motor de decisión, la aplicación ofrece varias pantallas web para
probar, configurar y auditar la configuración.

### 5.1 Simuladores (`/simulador-init`, `/simulador-pre`, `/simulador-final`)

Formularios donde se introducen los datos de un cliente hipotético y se ve, al
instante, qué ofertas quedarían elegibles en cada fase — exactamente como en el
ejemplo de la sección 3, pero de forma interactiva.

- El simulador **PRE** muestra también el resultado de INIT (encadenado), y el
  simulador **FINAL** muestra el de INIT + PRE, de modo que se ve el recorrido
  completo de la solicitud, no solo el resultado de la última fase.
- Si una fase se queda sin ofertas elegibles, el simulador lo indica y no sigue
  a la fase siguiente (igual que en producción).

### 5.2 Configurador (`/configurador`)

Pantalla de administración de la configuración, dividida en tres bloques:

**Ofertas** — crear, editar, activar/desactivar y eliminar ofertas (código,
nombre, ranking). No se puede eliminar una oferta que ya tenga reglas asociadas.

**Reglas** — crear, editar, activar/desactivar, eliminar y **reordenar
prioridades** de las reglas de cada oferta, con filtros por oferta, fase y texto
libre.

**Parámetros** — crear, editar y eliminar (borrado lógico) los valores
configurables de cada oferta.

**Exportar / Importar / Grabar configuración** — flujo pensado para hacer
cambios masivos de forma segura:
1. **Exportar** descarga un fichero JSON con todas las reglas y parámetros
   actuales.
2. Ese fichero se edita fuera de la aplicación (o se genera desde otra fuente) y
   se **importa** de nuevo; la pantalla muestra un aviso de "pendiente de
   grabar" hasta confirmar.
3. Al pulsar **Grabar**, se abre un diálogo que primero calcula y muestra una
   **vista previa del impacto** (qué ofertas se ven afectadas, cuántas reglas y
   parámetros se van a borrar e insertar) — el botón de confirmar permanece
   deshabilitado hasta que esa vista previa termina de calcularse. Hay que
   indicar un **motivo** del cambio (obligatorio) y, opcionalmente, el usuario
   que lo realiza. Antes de aplicar el cambio, el sistema **guarda
   automáticamente una copia de seguridad** (snapshot) del estado anterior.

### 5.3 Snapshots (`/snapshots`)

Historial de copias de seguridad de la configuración. Cada vez que se graba una
configuración importada o se restaura un snapshot, se crea automáticamente una
copia previa — así ningún cambio masivo es "sin red".

- Se puede buscar por rango de fechas, texto libre (nombre/usuario/motivo) y
  entorno (POC / WF).
- **Restaurar** un snapshot reemplaza la configuración activa por la guardada en
  ese momento, previa confirmación (y, de nuevo, con una copia de seguridad
  automática antes de restaurar).
- Caso especial — **restaurar un snapshot de WF (Workflow) hacia POC**: hay que
  indicar además la fecha de inicio del período destino; si no existe un
  período con esa fecha, se crea uno nuevo automáticamente cerrando el período
  abierto anterior en la fecha justo anterior.

### 5.4 Períodos de vigencia (`/offer-dates`)

Gestión de los periodos de tiempo (fechas "desde/hasta") en los que una
configuración de reglas o parámetros está activa, para poder tener, por
ejemplo, una campaña con condiciones distintas en un rango de fechas concreto.

### 5.5 Vista de configuración (`/configuracion`)

Vista de solo lectura de la configuración activa (útil para revisar rápidamente
qué reglas y parámetros están vigentes sin entrar en modo edición).

### 5.6 Publicación a Workflow (WF)

Además del entorno de pruebas interno (POC), existe un flujo para **publicar la
configuración a Workflow**, el sistema externo de producción: se genera una
instantánea (snapshot) de las ofertas/reglas/parámetros vigentes en un rango de
fechas y se envía al entorno WF. Aparte, existe un endpoint de **consulta de
elegibilidad en tiempo real** (`condiciones-hipotecas`) equivalente a los
simuladores, pero pensado para integrarse desde Workflow.

### 5.7 Acceso y permisos

La aplicación requiere iniciar sesión para las acciones de administración.

- **Roles**: `admin` (acceso completo, incluida la edición de ofertas/reglas/
  parámetros y la restauración de snapshots) y `viewer` (puede entrar con su
  usuario y consultar, pero no puede modificar nada).
- **Modo de acceso**: según cómo esté configurado el entorno, la consulta de
  la configuración y los simuladores pueden ser navegables **sin iniciar
  sesión** (modo permisivo, pensado por ejemplo para demostraciones), mientras
  que **cualquier acción de escritura** (crear, editar, borrar, grabar,
  restaurar, publicar a Workflow) siempre exige haber iniciado sesión como
  `admin`, sin excepción, en cualquier modo.
- Únicamente las pantallas de **Ofertas** y **Snapshots** exigen inicio de
  sesión para poder entrar a verlas, en cualquier modo de acceso.

---

## 6. Glosario rápido

| Término | Significado |
|---|---|
| **Dictamen** | El resultado que el motor va construyendo para una oferta a medida que evalúa reglas (elegible/rechazado, motivos, límites…). |
| **Motivos** (`motivos`) | Lista de códigos que explican por qué una oferta ha sido rechazada (ej. `LTV`, `EDAD`, `INGRESOS`). |
| **LTV** (*Loan To Value*) | Porcentaje del valor de la vivienda financiado por la hipoteca. |
| **`uiLimits`** | Límites (importe, plazo, LTV…) consolidados entre todas las ofertas elegibles de una fase, para mostrarlos en pantalla al usuario. |
| **Ranking / `offer_rank`** | Prioridad comercial de una oferta; se usa para desempatar cuando varias ofertas son elegibles a la vez en la fase final. |
| **Snapshot** | Copia de seguridad de toda la configuración (reglas + parámetros) en un momento dado. |
| **POC** | Entorno de pruebas interno de la aplicación. |
| **WF (Workflow)** | Sistema externo de producción al que se puede publicar la configuración. |

---

## 7. Preguntas frecuentes

**¿Qué pasa si dos ofertas son elegibles al mismo tiempo en la fase final?**
Gana la de mayor `offer_rank` (ranking).

**¿Puedo deshacer un cambio de configuración si me equivoco?**
Sí: cada vez que se graba una configuración o se restaura un snapshot, se crea
automáticamente una copia de seguridad previa, disponible en la pantalla de
Snapshots.

**¿Puedo ver qué reglas tiene una oferta sin riesgo de modificarlas sin
querer?**
Sí, la pantalla de **Configuración** (`/configuracion`) es de solo lectura.

**¿Quién puede cambiar reglas o parámetros?**
Solo los usuarios con rol `admin`. Un usuario `viewer` puede navegar y consultar
pero no ve habilitados los botones de creación/edición/borrado.

**¿Por qué el nombre de muchas reglas empieza por "Rechazo"?**
Porque, como se explica en la sección 2.1, el motor funciona detectando motivos
de exclusión, no motivos de aprobación. Si ningún "Rechazo" se dispara, una
regla final de baja prioridad declara la oferta como válida.
