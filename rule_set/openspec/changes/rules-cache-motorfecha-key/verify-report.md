# Verify Report - rules-cache-motorfecha-key

Cambio: rules-cache-motorfecha-key
Fecha: 2026-06-12
Modo: Standard (sin Strict TDD)

---

## Completitud de Tareas

| Metrica | Valor |
|---------|-------|
| Tareas totales | 22 (17 fases 1-4 + 5 fase 5 manual) |
| Tareas completadas | 17 |
| Tareas pendientes | 5 (Fase 5: verificacion manual/live-DB) |

Las 5 tareas pendientes (5.1-5.5) son verificaciones manuales contra BD real, marcadas [MANUAL / LIVE-DB] y explicitamente diferidas de CI. No constituyen incumplimiento.

---

## Build y Ejecucion de Tests

Tests: 223 total / 221 pasados / 0 fallidos / 2 omitidos

Los 2 SKIP son CA-013 (tests live workflow_service con credenciales reales), pre-existentes e independientes de este cambio. Esperados por diseno.

Los 25 tests nuevos de config_cache.test.js pasaron todos (5 para 3.1-3.3 + 10 para FP-01..FP-07).

Cobertura: No disponible.

---

## Matriz de Cumplimiento de Spec

| Requisito | Escenario | Test | Resultado |
|-----------|-----------|------|-----------|
| REQ-01 Determinismo fingerprint | Esc.A: mismas winners fechas distintas -> mismo FP | FP-01: mismas winners con fechas distintas producen el mismo fingerprint | COMPLIANT |
| REQ-01 Determinismo fingerprint | Esc.A: segunda peticion no invoca SP base | FP-01: misma clave implica hit sin invocar el SP base | COMPLIANT |
| REQ-01 Determinismo fingerprint | Esc.B: nuevo periodo -> FP distinto -> miss | FP-02: publicar un nuevo periodo cambia el fingerprint | COMPLIANT |
| REQ-01 Determinismo fingerprint | Esc.B: primera peticion post-publish es miss | FP-02: la primera peticion post-publish es un miss controlado | COMPLIANT |
| REQ-02 Independencia orden ofertas | FP invariante al orden de winners | FP-04: el fingerprint es independiente del orden de los winners | COMPLIANT |
| REQ-02 Independencia orden ofertas | Segunda peticion con CSV permutado es hit | FP-04: parte FP identica; offer_codes_key puede diferir si CSV varia | PARTIAL |
| REQ-03 Oferta sin periodo contribuye :0:0 | Contribucion :0:0 en fingerprint | FP-03: oferta sin periodo cubriente contribuye :0:0 | COMPLIANT |
| REQ-03 Oferta sin periodo contribuye :0:0 | Activar periodo invalida entrada anterior | FP-03: activar un periodo cambia el fingerprint | COMPLIANT |
| REQ-04 Auto-invalidacion por publish | Nuevo periodo -> FP distinto -> miss | FP-02 (equivalente funcional del escenario) | COMPLIANT |
| REQ-04 Auto-invalidacion por publish | No requiere refresco explicito | admin_service.js: 0 referencias a cfg_refresh_rules_cache tras tx.commit() | COMPLIANT |
| REQ-05 Activacion futura sin evento externo | Config DESDE_DT futuro recogida automaticamente | Estructural: TVF scope LEFT JOIN + FP-03 (0->N cambia FP) | PARTIAL |
| REQ-06 Cache igual con NULL o timestamp | Dos timestamps distintos mismo periodo -> hit | FP-01 (mismos winners -> mismo FP independiente de fecha recibida) | COMPLIANT |
| REQ-06 Cache igual con NULL o timestamp | Una sola logica de clave, sin rama G/H | Estatico: ISNULL(@DATE, SYSDATETIME()); sin condicional cache_type | COMPLIANT |
| REQ-07 Anti-stampede en miss | Segundo request re-checkea tras lock -> hit | FP-06: segundo request re-checkea y produce hit sin invocar SP base | COMPLIANT |
| REQ-07 Anti-stampede en miss | FP distintos no se bloquean entre si | FP-06: dos requests con FP distintos no se bloquean | COMPLIANT |
| REQ-08 Eviccion acotada por cap | Cap respetado; entrada mas antigua eliminada | FP-05: eviccion FIFO respeta max_history_size | COMPLIANT |
| REQ-08 Eviccion acotada por cap | Entradas de distintos conjuntos no se mezclan | FP-05: eviccion no afecta entradas de otro offer_codes_key | COMPLIANT |
| REQ-09 TTL como gestion de almacenamiento | Entrada expirada -> miss | FP-07: entrada con created_at anterior al cutoff no produce hit | COMPLIANT |
| REQ-09 TTL como gestion de almacenamiento | Entrada no expirada -> hit | FP-07: entrada no expirada produce hit | COMPLIANT |
| REQ-09 TTL como gestion de almacenamiento | Borrado oportunista en path de miss | FP-07: borrado oportunista elimina entradas expiradas | COMPLIANT |
| REQ-10 Estabilidad de firma wrapper | Node no requiere cambios de interfaz | Firma identica; @ttl_days al final con default invisible para Node | COMPLIANT |
| REQ-10 Estabilidad de firma wrapper | max_history_size sigue siendo parametro | 3.2: simulateConfigServiceRequest passes max_history_size = 50 | COMPLIANT |
| REQ-11 Ausencia de refresco tras applyConfig | applyConfig no invoca cache | admin_service.js l.1498: tx.commit() directo; 0 ref a cfg_refresh_rules_cache | COMPLIANT |
| REQ-11 Ausencia de refresco tras applyConfig | Correccion emerge del fingerprint | REQ-04 + TVF: FP distinto post-publish -> miss -> config fresca sin refresco | COMPLIANT |

Resumen: 22/24 COMPLIANT, 2/24 PARTIAL, 0/24 UNTESTED, 0/24 FAILING

---

## Correccion Estatica (Evidencia Estructural)

| Decision | Estado | Evidencia |
|----------|--------|-----------|
| DROP INDEX IX_cfg_rules_cache_evict (ADR-003) | IMPLEMENTADO | wf_sp_cfg_rules_cache.sql l.38 |
| DROP TABLE dbo.cfg_rules_cache (ADR-003) | IMPLEMENTADO | wf_sp_cfg_rules_cache.sql l.46 |
| CREATE TABLE sin cache_type ni CHECK (ADR-003) | IMPLEMENTADO | wf_sp_cfg_rules_cache.sql l.52-61 |
| CREATE INDEX (offer_codes_key, created_at) INCLUDE (cache_key) | IMPLEMENTADO | wf_sp_cfg_rules_cache.sql l.69-71 |
| TVF cfg_resolve_mf_winners con firma correcta (ADR-002) | IMPLEMENTADO | wf_sp_cfg_rules_cache.sql l.101-208 |
| CTEs mf_rules_win / mf_params_win copiados del SP base | IMPLEMENTADO | l.125-167: REGLAS/AMBOS y PARAMS/AMBOS; mismo ROW_NUMBER PARTITION BY |
| scope: LEFT JOIN desde MRO_MOTOROFERTA (no EXISTS) | IMPLEMENTADO | wf_sp_cfg_rules_cache.sql l.175-184 |
| winners: LEFT JOIN con ISNULL(...,0) para ausencia (:0:0) | IMPLEMENTADO | wf_sp_cfg_rules_cache.sql l.191-198 |
| STRING_AGG WITHIN GROUP (ORDER BY MOTOROFERTA_ID ASC) | IMPLEMENTADO | wf_sp_cfg_rules_cache.sql l.200-207 |
| Wrapper: @ttl_days al final con default 14 (ADR-006, ADR-007) | IMPLEMENTADO | wf_sp_cfg_rules_cache.sql l.232-237 |
| Paso 1: fingerprint via TVF + ISNULL + cache_key | IMPLEMENTADO | wf_sp_cfg_rules_cache.sql l.252-255 |
| Paso 2: fast path TTL-aware (created_at >= @cutoff) | IMPLEMENTADO | wf_sp_cfg_rules_cache.sql l.258-267 |
| Paso 3: sp_getapplock en TODOS los miss sin rama cache_type (ADR-005) | IMPLEMENTADO | wf_sp_cfg_rules_cache.sql l.270-279 |
| Paso 4: re-check tras lock con clausula TTL | IMPLEMENTADO | wf_sp_cfg_rules_cache.sql l.284-296 |
| Paso 5: EXEC SP base en tabla temporal @tmp | IMPLEMENTADO | wf_sp_cfg_rules_cache.sql l.300-304 |
| Paso 6: DELETE expirada + TRY/CATCH supresion 2627/2601 | IMPLEMENTADO | wf_sp_cfg_rules_cache.sql l.309-320 |
| Paso 7: borrado oportunista TTL solo en miss (ADR-006) | IMPLEMENTADO | wf_sp_cfg_rules_cache.sql l.322-324 |
| Paso 8: eviccion FIFO CTE ranked por offer_codes_key sin cache_type | IMPLEMENTADO | wf_sp_cfg_rules_cache.sql l.327-334 |
| Paso 9: sp_releaseapplock + SELECT OFERTAS_JSON, PARAMETROS_JSON FROM @tmp | IMPLEMENTADO | wf_sp_cfg_rules_cache.sql l.337-340 |
| DROP PROCEDURE cfg_refresh_rules_cache (ADR-004) | IMPLEMENTADO | wf_sp_cfg_rules_cache.sql l.351 |
| Bloque cfg_refresh_rules_cache eliminado de admin_service.js | IMPLEMENTADO | grep: 0 ocurrencias en admin_service.js |
| Tests 3.4/3.5 y runCacheRefresh eliminados de config_cache.test.js | IMPLEMENTADO | Cabecera lista 3.1-3.3 + FP-01..FP-07 |
| FP-01..FP-07 presentes y pasados | IMPLEMENTADO | 25 tests nuevos, todos ok |

---

## Coherencia con el Diseno

| Decision / ADR | Seguida | Notas |
|----------------|---------|-------|
| ADR-001: clave = offer_codes_key + pipe-FP: + fingerprint | SI | |
| ADR-001: fingerprint crudo sin hash | SI | STRING_AGG de tuplas MOTOROFERTA_ID:rules_mfid:params_mfid |
| ADR-002: TVF inline (no SP auxiliar) | SI | CREATE OR ALTER FUNCTION ... RETURNS TABLE AS RETURN |
| ADR-003: drop+recreate tabla (no ALTER DROP COLUMN) | SI | Secuencia correcta en SQL |
| ADR-004: eliminar cfg_refresh_rules_cache | SI | DROP PROCEDURE + bloque JS eliminado |
| ADR-005: applock en todos los miss sin rama is_generic | SI | |
| ADR-006: TTL filtro en lookup + borrado oportunista en miss | SI | |
| ADR-006: @ttl_days al final con default 14 | SI | |
| ADR-007: conservar nombre @max_history_size con comentario | SI | Comentario en el SP |
| Diseno 4.2: scope LEFT JOIN vs EXISTS del SP base (diferencia intencional) | SI | Comentado en TVF l.88-95 |
| Diseno 4.2: ISNULL(@fingerprint, vacío) para winners vacio | SI | Presente en el wrapper |
| Diseno 7: tests 3.1/3.2/3.3 sin cambio | SI | |
| Diseno 7: tests 3.4/3.5 eliminados | SI | |
| Diseno 2: config_service.js y SP base sin cambios | SI | |

---

## Evaluacion Independiente: Orden del CSV en offer_codes_key

La cache_key es: offer_codes_key + |FP: + fingerprint
donde offer_codes_key = ISNULL(@offer_codes, __ALL__) -- texto crudo recibido.

El fingerprint es order-independent (STRING_AGG ORDER BY MOTOROFERTA_ID ASC). Sin embargo,
si dos peticiones usan el mismo conjunto de ofertas con distinto orden de CSV (PRO,RES vs
RES,PRO), el offer_codes_key difiere en texto y las cache_keys son distintas, aunque el
fingerprint sea identico. El hit prometido por REQ-02 no se produce en ese caso.

(1) Violacion de REQ-02: El fingerprint SI es identico -- cumple el texto del requisito.
El escenario de REQ-02 exige ademas que la peticion sea un hit, condicion que falla si
los CSV difieren en texto. Violacion de la postcondicion del escenario. Calificacion: parcial.

(2) Impacto en produccion (perfil dominante WF): @offer_codes = NULL -> offer_codes_key = __ALL__.
Sin CSV, sin permutacion posible. El problema no existe para el perfil dominante.
Solo afecta a clientes que pasen CSV explicitamente con orden variable (simuladores).
El impacto es entradas redundantes en el cap, no datos incorrectos.

(3) Regresion respecto a db-rules-cache: NO. db-rules-cache tambien usaba el texto crudo
de @offer_codes como offer_codes_key. Este cambio no introduce ninguna regresion.

(4) Clasificacion: WARNING. La correctitud de datos no esta comprometida.
Impacto operativo nulo en el perfil dominante.

Correccion minimal si se decide abordar:
- Opcion A (en el wrapper): normalizar el CSV via la TVF split y reconstruirlo con STRING_AGG
  ORDER BY code ASC antes de asignar @offer_codes_key. Requiere SELECT adicional en el wrapper.
- Opcion C (diferir, documentar): la normalizacion del CSV es responsabilidad del llamador.
  El test FP-04 ya incluye el comentario explicativo. Aceptar como limitacion conocida de v1.

Recomendacion para v1: opcion C (diferir). Si se detecta contaminacion del cap por entradas
redundantes en produccion, escalar a opcion A.

---

## Problemas Encontrados

CRITICAL: Ninguno.

WARNING:

W-01: Violacion parcial de REQ-02 (postcondicion hit con CSV permutado).
El fingerprint es order-independent, pero offer_codes_key usa el texto crudo del CSV recibido.
Dos peticiones con el mismo conjunto de ofertas pero CSV en distinto orden producen cache_keys
distintas. Impacto nulo en el perfil dominante (NULL -> __ALL__). No es regresion.
Recomendacion: documentar como limitacion conocida de v1; diferir normalizacion al llamador.

W-02: Fase 5 (verificacion live-DB) pendiente.
Las 5 tareas 5.1-5.5 estan diferidas a entorno con BD real. La cadena completa
TVF -> wrapper -> SP base -> cache no ha sido verificada con datos reales.
Ejecutar antes de pasar a produccion.

SUGGESTION:

S-01: Elevar el comentario de FP-04 sobre la normalizacion del CSV al cuerpo del SP wrapper
(junto a SET @offer_codes_key) para visibilidad de futuros mantenedores del SP.

S-02: La tarea 5.3 (plan de ejecucion de la TVF) es la unica verificacion del supuesto
estructural de rendimiento. Priorizarla en la sesion de Fase 5 antes de carga de produccion.

---

## Veredicto

PASS WITH WARNINGS

0 CRITICAL / 2 WARNINGS / 2 SUGGESTIONS

223 tests ejecutados, 221 pasados, 0 fallidos, 2 skips esperados. Fases 1-4 completas e
implementadas fielmente segun todos los ADR (001-007). La preocupacion sobre el orden del
CSV es real pero clasificada como WARNING: no compromete la correctitud de datos, no es
regresion, e impacto nulo en el perfil dominante de produccion (NULL -> __ALL__).
