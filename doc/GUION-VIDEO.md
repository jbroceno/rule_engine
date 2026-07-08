# Guion del vídeo explicativo — TFM

> **Formato exigido por el TFM:** vídeo con tu explicación y **captura de pantalla obligatoria**
> mientras explicas (mostrar tu rostro con cámara es opcional). Súbelo a YouTube/Drive y añade la
> URL pública al README.
>
> **Duración objetivo:** 9–10 minutos. **Tono:** cercano y directo, en primera persona.
>
> La columna *Pantalla* indica qué se ve; la columna *Narración* es lo que dices (puedes leerlo o
> usarlo de apoyo). Prepara los datos de ejemplo y las pestañas **antes** de grabar.

---

## Preparativos (antes de grabar)

- [ ] API arrancada (`npm run api:start`) con SQL Server accesible, y frontend (`npm run web:start`) en `http://localhost:4200`.
- [ ] Pestañas/ventanas abiertas y ordenadas: **README**, **simulador PRE**, **simulador FINAL**, **configurador**, **snapshots**, editor con `rule_engine.js`, `rules.json`, `prompts/prompts.md` y el árbol de `openspec/changes/archive/` (con un cambio expandido).
- [ ] Datos de simulación de ejemplo copiados a mano para pegarlos rápido (ver guion del README, "Ejemplo de ejecución").
- [ ] Terminal lista para `npm test` con la fuente grande y legible.
- [ ] Silenciar notificaciones. Zoom de navegador al 110–125 %.

---

## Escaleta

| # | Tiempo | Pantalla | Narración (lo que dices) |
|---|--------|----------|--------------------------|
| 1 | 0:00–0:40 | Tu cara o la portada de las slides | "Hola, soy Jesús Broceño. Este es mi Trabajo Fin de Máster del máster de desarrollo potenciado con IA de BIG School. Voy a enseñaros un motor de reglas para asignar ofertas hipotecarias, pero sobre todo voy a contaros **cómo lo he construido con IA**, que es donde está el valor del proyecto." |
| 2 | 0:40–1:40 | Slide del problema / README §1 | "El problema: un banco quiere dar precios diferenciados según el perfil del cliente. Antes de pre-aprobar una hipoteca hay que calcular qué oferta le toca, y cada oferta tiene sus propios límites de LTV, plazo, importe, edad e ingresos. Mi solución es un motor de reglas **configurable**: dado un conjunto de reglas y parámetros, te devuelve las ofertas elegibles y los límites a aplicar, sin tocar código." |
| 3 | 1:40–2:30 | Diagrama de 3 fases (slide) | "La evaluación tiene tres fases: INIT, PRE y FINAL, que reproducen el flujo real del simulador, de menos a más datos. En INIT compruebo elegibilidad básica; en PRE obtengo las ofertas pre-elegibles y los límites que restringen el simulador; y en FINAL, con los datos definitivos del préstamo, elijo la oferta ganadora, que es la de mayor ranking." |
| 4 | 2:30–4:00 | **Demo: simulador PRE → FINAL** | "Vamos a verlo funcionando. En el simulador PRE introduzco los datos iniciales… y aquí tengo las ofertas elegibles con sus límites. Ahora paso al simulador FINAL, añado importe y plazo… y el motor me da la oferta ganadora **con la traza completa**: qué reglas se evaluaron y cuáles pasaron o fallaron. Esta trazabilidad es clave para auditar decisiones." |
| 5 | 4:00–5:00 | **Demo: configurador + snapshot** | "Y esto es lo potente: si cambio un parámetro —por ejemplo el LTV máximo de una oferta— en el configurador y vuelvo a simular, el resultado cambia, sin tocar una línea de código. Cada cambio genera un **snapshot** automático, así que la configuración está versionada y puedo restaurar cualquier estado anterior. Este frontend de configuración es la parte realmente compleja del proyecto." |
| 6 | 5:00–6:15 | Editor: `rule_engine.js`, `rules.json` | "Por dentro, el motor es lógica **DNF**: condiciones en AND dentro de un grupo, grupos en OR. Un detalle no obvio: las reglas son **detectores de rechazo**, no de elegibilidad. Las condiciones positivas del documento funcional las **niego** aplicando las leyes de De Morgan antes de codificarlas. Y aquí está el punto importante para este máster: **el motor no usa ningún LLM en ejecución**. Las decisiones son deterministas y reproducibles. La IA no decide qué oferta gana." |
| 7 | 6:15–7:15 | `prompts/prompts.md`, `.opencode/prompts/dnf-engine.md` | "¿Dónde está entonces la IA? En **toda la construcción**. Con prompts versionados —que podéis ver aquí— usé la IA para: hacer el análisis funcional a partir de la documentación de negocio; diseñar el motor y su modelo de datos; **generar las reglas** traduciendo el documento funcional, incluida la inversión de De Morgan de decenas de condiciones; construir el frontend a partir del modelo de datos; y generar la batería de pruebas. En resumen: **la IA construyó y probó el sistema, pero el sistema funciona sin IA.**" |
| 8 | 7:15–8:00 | Carpeta `openspec/changes/archive/` y, dentro de un cambio, `proposal.md` → `spec.md` → `verify-report.md` | "Y no fue improvisando. Las funcionalidades se incorporaron con **SDD, desarrollo dirigido por especificación**: cada cambio pasa por explorar, proponer, especificar, diseñar, trocear en tareas, implementar en TDD estricto y verificar contra la spec. Todo el rastro queda versionado aquí, en `openspec`. Estos son **10 cambios completados de extremo a extremo** —despliegue a workflow, snapshots, vigencias, el panel del simulador…—. La IA ejecuta el flujo, pero el criterio queda escrito y es auditable." |
| 9 | 8:00–8:45 | Terminal: `npm test` corriendo | "La calidad se apoya en un modelo de pruebas dirigido por escenarios: los tests y el informe de evidencias para cliente consumen las **mismas** definiciones, así que nunca pueden divergir. Aquí ejecuto la suite… 251 tests, 226 en verde, cero fallos. Los 25 omitidos son tests *live* que necesitan la base de datos real del banco." |
| 10 | 8:45–9:30 | Slides de cierre / tu cara | "Como conclusión: lo que me llevo es que la IA acelera muchísimo la **traducción de documentación a código**, pero el criterio de ingeniería sigue siendo humano: qué pedir, qué validar y qué rechazar. Separar la lógica determinista de la IA-herramienta, y trabajar con método (SDD), da un sistema fiable y auditable. Tenéis el repositorio, las slides y el enlace en el README. Gracias por vuestro tiempo." |

---

## Notas de grabación

- Si una demo falla en directo, sigue y coméntalo con naturalidad — un tribunal valora ver el sistema real, no un montaje perfecto.
- Habla mirando lo que muestras; evita silencios largos mientras tecleas (narra lo que vas haciendo).
- Mantén cada bloque dentro de su tiempo: el bloque 6–7 (el papel de la IA) es el más importante, no lo recortes.
- Cierra siempre mostrando el README con los enlaces de entrega visibles.
