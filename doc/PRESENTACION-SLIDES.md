# Guion de presentación (slides) — TFM

> **Cómo usar este documento:** cada bloque `## Slide N` es una diapositiva. El **título** y las
> **viñetas** van en la diapositiva; la **nota del ponente** es lo que cuentas en voz (no se
> proyecta). Pensado para ~16 diapositivas y una defensa de 8–10 min. Volcable a Google Slides,
> PowerPoint o Canva.
>
> **Hilo conductor:** el valor no está en la complejidad del motor, sino en *madurar una idea real*
> y en *cómo se ha usado la IA para construirla*. Que ese mensaje aparezca pronto y se repita al cierre.

---

## Slide 1 — Portada

**Motor de Reglas de Ofertas Hipotecarias**
Trabajo Fin de Máster · Máster en Desarrollo de Software potenciado con IA — BIG School

- Autor: Jesús M. Broceño
- Junio 2026

> Nota: "Os presento mi TFM: un motor de reglas que decide qué oferta hipotecaria asignar a un
> cliente. Pero el foco de hoy no es el motor en sí, sino cómo lo he construido con IA."

---

## Slide 2 — El problema de negocio

**Un banco quiere ofrecer precios diferenciados**

- Cada perfil de cliente tiene derecho a una oferta distinta (LTV, plazo, importe, edad, ingresos…)
- El precio debe calcularse **antes** de pre-aprobar la hipoteca
- Cada oferta se identifica de forma diferenciada ante el motor de riesgos
- Las condiciones cambian con el tiempo → hay que **historificar** y poder simular

> Nota: contexto real. No es un ejercicio inventado: nace de una necesidad concreta de negocio.

---

## Slide 3 — La idea: un motor de reglas configurable

**Dado un conjunto de reglas (una por oferta) y parámetros → devuelve ofertas elegibles y límites**

- Sin recompilar ni tocar código: todo es **configuración**
- Reglas para perfil técnico · parámetros para perfil de negocio
- Versionado por vigencias: "qué reglas aplicaban en tal fecha"

> Nota: la clave de diseño es separar la lógica (reglas) de los valores (parámetros) y que ambos
> sean editables y datados.

---

## Slide 4 — El pipeline de 3 fases

**INIT → PRE → FINAL** (cada fase recibe su propio input completo, sin estado compartido)

| Fase | Decide | Con qué datos |
|------|--------|---------------|
| INIT | Elegibilidad inicial | Datos mínimos |
| PRE | Pre-elegibilidad + límites del simulador | Simulación inicial |
| FINAL | Oferta ganadora | Datos definitivos del préstamo |

- La oferta ganadora = la elegible con mayor `offer_rank`

> Nota: reproduce el flujo real del simulador hipotecario, de menos a más datos.

---

## Slide 5 — ⭐ El valor del proyecto

**No está en la complejidad del motor (que es modesta)**

Está en:
1. **Madurar una idea de negocio** hasta una solución completa y usable
2. **Usar la IA como herramienta de ingeniería** en todo el ciclo de construcción

> Nota: este es el mensaje central del TFM. Decirlo con claridad y sin rodeos.

---

## Slide 6 — ⭐ Dónde está (y dónde NO) la IA

**El motor NO usa ningún LLM en tiempo de ejecución**

- Decisiones **deterministas y reproducibles**: lógica DNF pura sobre JSON
- No hay consultas a un modelo para decidir qué oferta gana

**La IA construyó y probó el sistema; el sistema funciona sin IA**

> Nota: honestidad técnica. En un máster de IA es fácil sobrevender "uso IA en todo". Lo valioso es
> distinguir la IA-herramienta-de-construcción de la IA-en-producción.

---

## Slide 7 — Cómo usé la IA (el ciclo completo)

**De la documentación al código, con IA en cada paso**

1. **Análisis funcional** de los requisitos a partir de la documentación de negocio
2. **Diseño** del motor DNF, su contrato y su modelo de datos
3. **Generación de las reglas** (`rules.json`) traduciendo el documento funcional
4. **Construcción del frontend** de configuración (la parte compleja)
5. **Generación de la batería de pruebas** y del modelo de evidencias

> Nota: enseñar `prompts/prompts.md` y `.opencode/prompts/dnf-engine.md` como prueba de que los
> prompts están versionados, no improvisados.

---

## Slide 8 — SDD: incorporar funcionalidades con método

**Spec-Driven Development, no "vibe-coding"**

- Cada cambio sigue: explore → proposal → spec → design → tasks → apply → verify → archive
- Specs en *Given/When/Then* + RFC 2119 · implementación en **TDD estricto**
- Todo el rastro **versionado en `openspec/`** · **10 cambios completados de extremo a extremo**
- La IA ejecuta el flujo; el **criterio de ingeniería** queda explícito y auditable

> Nota: en la demo, abrir `openspec/changes/archive/` y enseñar el rastro real de un cambio
> (proposal → spec → design → tasks → verify). Es la prueba tangible de que no es *vibe-coding*.

---

## Slide 9 — El patrón de inversión (lo no-obvio)

**Las reglas son *detectores de rechazo*, no de elegibilidad**

- Condición positiva del documento → se **niega** (leyes de De Morgan) antes de codificarla
- `NOT (A AND B)` → `(NOT A) OR (NOT B)` → un grupo por cada forma de fallar
- El nombre de cada regla documenta la condición original (`neg.: …`)

> Nota: ejemplo concreto donde la IA ayudó de verdad — aplicar De Morgan de forma sistemática y
> sin errores al traducir decenas de condiciones.

---

## Slide 10 — El frontend de configuración (la pieza compleja)

**Generado a partir de la documentación y del modelo de datos SQL**

- CRUD de ofertas, reglas, condiciones, acciones y parámetros
- Simuladores de las 3 fases con **traza visual** de la decisión
- Import/export de configuración + **snapshots** automáticos y restauración
- Gestión de **vigencias** (periodos de configuración)

> Nota: aquí sí hay complejidad real. Mostrar el configurador en la demo.

---

## Slide 11 — Validación dual contra el banco

**Mismo input → motor local + sistema de workflow del banco → comparar**

- Contrasta el resultado del motor de la PoC con el del sistema real
- Adaptador de publicación de la configuración al workflow

> Nota: cierra el círculo: no es un juguete aislado, se integra y se contrasta con producción.

---

## Slide 12 — Calidad: escenarios dirigidos por datos

**Los tests y el informe para cliente consumen las MISMAS definiciones → nunca divergen**

- *Golden* generado por el motor y revisado a mano contra el cuadro de decisión
- El *freeze* falla si el ganador calculado ≠ ganador esperado de negocio
- Estado de la suite: **251 tests · 226 pass · 0 fail · 25 skipped**

> Nota: los 25 *skipped* son tests *live* que necesitan SQL Server real; se omiten por diseño.

---

## Slide 13 — Stack tecnológico

| Capa | Tecnología |
|------|------------|
| Motor | Node.js (ESM), funciones puras, **sin dependencias** |
| API | Express 4 · mssql 11 |
| BD | SQL Server (tablas + SP) |
| Frontend | Angular 20 · RxJS · TypeScript |
| Pruebas | `node:test` · Karma/Jasmine |
| IA | Claude Code / OpenCode con prompts versionados |

> Nota: destacar que el núcleo del motor no tiene dependencias — fácil de migrar al workflow.

---

## Slide 14 — Demo

**(Captura de pantalla en vivo)**

1. Simulador PRE: introduzco datos → veo ofertas elegibles y límites
2. Simulador FINAL: añado importe/plazo → veo la oferta ganadora y la traza
3. Configurador: cambio un parámetro (p. ej. `MAX_LTV`) y re-simulo
4. Snapshots: muestro el versionado de configuración

> Nota: tener los datos de ejemplo preparados de antemano. Ver guion de vídeo para el detalle.

---

## Slide 15 — Aprendizajes

**Qué me llevo del TFM**

- La IA acelera enormemente la **traducción de documentación a código** (reglas, frontend, tests)
- El criterio de ingeniería sigue siendo humano: **qué pedir, qué validar y qué rechazar**
- Separar lógica determinista de la IA-herramienta da un sistema **fiable y auditable**
- Versionar los prompts es tan importante como versionar el código

> Nota: reflexión personal honesta — es lo que más valora un tribunal.

---

## Slide 16 — Cierre y enlaces

**¡Gracias!**

- Repositorio: `github.com/jbroceno/rule_engine` <!-- TODO: confirmar público -->
- Despliegue: _pendiente_ <!-- TODO -->
- Slides y vídeo: _enlaces en el README_ <!-- TODO -->
- Jesús M. Broceño · TFM BIG School · 2026

> Nota: dejar la portada de contacto unos segundos para preguntas.
