# Tasks: rules-cache-motorfecha-key

## Review Workload Forecast

| Campo | Valor |
|-------|-------|
| Líneas estimadas cambiadas | ~290–320 |
| Riesgo de presupuesto 400 líneas | Bajo |
| PRs encadenados recomendados | No |
| Split sugerido | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

**Desglose estimado:**
- `wf_sp_cfg_rules_cache.sql` (rewrite): ~250 líneas (DDL tabla+índice ~15, TVF inline ~55, wrapper reescrito ~100, eliminación del SP refresh + seed ~10; fichero completo reemplaza ~70 líneas anteriores → neto ~+180)
- `admin_service.js` (eliminación del bloque try/catch): ~−6 líneas neto
- `config_cache.test.js` (eliminar 3.4/3.5 + helper + añadir ~6 tests): ~+60 líneas neto

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Bajo

### Unidades de trabajo sugeridas

| Unidad | Objetivo | PR probable | Notas |
|--------|----------|-------------|-------|
| 1 | SQL + Node + tests | PR 1 (main) | Cambio cohesivo; ~290–320 líneas totales |

---

## Fase 1: Objetos SQL — tabla, índice y TVF

> Dependencia: ninguna. Punto de partida del grafo de dependencias.
> Todos los objetos de esta fase deben estar en `rule_set/sql/workflow_deploy/wf_sp_cfg_rules_cache.sql`.

- [x] 1.1 **Drop del índice de evicción existente** — añadir al inicio del script:
  `DROP INDEX IF EXISTS IX_cfg_rules_cache_evict ON dbo.cfg_rules_cache;`
  (Diseño §5a, ADR-003. Satisface: REQ-08)

- [x] 1.2 **Drop de la tabla existente** — añadir a continuación:
  `DROP TABLE IF EXISTS dbo.cfg_rules_cache;`
  Esto elimina la columna `cache_type` y el `CHECK CK_cfg_rules_cache_type` de forma atómica.
  (Diseño §5b, ADR-003. Satisface: REQ-01, REQ-06, REQ-08)

- [x] 1.3 **Recrear `dbo.cfg_rules_cache` sin `cache_type`** — DDL exacto de diseño §4.1:
  columnas `cache_key NVARCHAR(500) PK`, `offer_codes_key NVARCHAR(500)`, `ofertas_json NVARCHAR(MAX)`,
  `parametros_json NVARCHAR(MAX)`, `created_at DATETIME2(0) DEFAULT SYSDATETIME()`.
  Sin columna `cache_type` ni `CHECK`. Separar con `GO`.
  (Diseño §4.1, §5c, ADR-003. Satisface: REQ-01, REQ-06, REQ-08, REQ-09)

- [x] 1.4 **Recrear índice de evicción `IX_cfg_rules_cache_evict`** sin `cache_type` en la clave:
  `ON dbo.cfg_rules_cache (offer_codes_key, created_at) INCLUDE (cache_key)`.
  Separar con `GO`.
  (Diseño §4.1, §5d, ADR-003. Satisface: REQ-08)

- [x] 1.5 **Crear TVF inline `dbo.cfg_resolve_mf_winners`** — `CREATE OR ALTER FUNCTION` con la firma
  `(@offer_codes NVARCHAR(MAX), @DATE DATETIME) RETURNS TABLE AS RETURN (…)` usando el esqueleto
  completo de diseño §4.2: CTEs `filter_codes`, `mf_rules_win`, `mf_params_win`, `scope` (LEFT JOIN
  desde `MRO_MOTOROFERTA`), `winners` (LEFT JOIN con ISNULL → 0), y el `STRING_AGG … WITHIN GROUP
  (ORDER BY MOTOROFERTA_ID ASC)` que produce la columna `fingerprint`.
  Incluir comentario en el cuerpo explicando la diferencia intencional con el SP base (scope con
  LEFT JOIN vs EXISTS del SP base). Separar con `GO`.
  (Diseño §4.2, ADR-002. Satisface: REQ-01, REQ-02, REQ-03, REQ-04, REQ-05, REQ-06)

---

## Fase 2: Objeto SQL — wrapper reescrito

> Dependencia: Fase 1 completa (el wrapper referencia la tabla y la TVF).

- [x] 2.1 **Reescribir `dbo.cfg_get_offers_and_params_json_cached`** como `CREATE OR ALTER PROCEDURE`
  con la firma completa de diseño §4.3:
  `@offer_codes NVARCHAR(MAX) = NULL, @DATE DATETIME = NULL, @max_history_size INT = 50, @ttl_days INT = 14`.
  Incluir comentario en el parámetro `@max_history_size` indicando que el nombre es legado (ADR-007).
  Separar con `GO`.
  (Diseño §4.3, ADR-001, ADR-005, ADR-006, ADR-007. Satisface: REQ-01, REQ-06, REQ-07, REQ-08, REQ-09, REQ-10)

  Pasos internos a verificar dentro del cuerpo del SP (sub-ítems de revisión, no tareas separadas):
  - Paso 1: `SELECT @fingerprint = ISNULL(fingerprint, N'') FROM dbo.cfg_resolve_mf_winners(…)` → `@cache_key = @offer_codes_key + N'|FP:' + @fingerprint`
  - Paso 2 (fast path): lookup `WHERE cache_key = @cache_key AND created_at >= @cutoff` → retorno inmediato si hit
  - Paso 3: `sp_getapplock` keyed en `@cache_key` en **todos** los misses (sin rama `@is_generic`)
  - Paso 4: re-check tras lock con la misma cláusula TTL
  - Paso 5: `INSERT … EXEC dbo.cfg_get_offers_and_params_json` en tabla temporal `@tmp`
  - Paso 6: borrado de la fila expirada por clave antes de insertar la refrescada + `BEGIN TRY/CATCH` con supresión de errores 2627/2601
  - Paso 7: borrado oportunista global de expiradas (`DELETE … WHERE created_at < @cutoff`) — solo en miss
  - Paso 8: evicción FIFO con CTE `ranked` acotada por `@max_history_size` y `offer_codes_key` (sin filtro por `cache_type`)
  - Paso 9: `sp_releaseapplock` + `SELECT OFERTAS_JSON, PARAMETROS_JSON FROM @tmp`

- [x] 2.2 **Eliminar `dbo.cfg_refresh_rules_cache` y su `EXEC` de seed** — añadir al final del script
  (antes del último `GO`):
  `DROP PROCEDURE IF EXISTS dbo.cfg_refresh_rules_cache;`
  Eliminar también cualquier línea `EXEC dbo.cfg_refresh_rules_cache` que existiera como seed
  en el script anterior. Separar con `GO`.
  (Diseño §2, §5g-h, ADR-004. Satisface: REQ-04, REQ-11)

---

## Fase 3: Node.js — eliminar wiring de refresco

> Dependencia: independiente de Fase 1 y Fase 2 (cambio de capa Node, sin dependencia SQL en tiempo de desarrollo). Puede ejecutarse en paralelo con las fases 1–2.

- [x] 3.1 **`rule_set/api/services/admin_service.js`** — localizar el bloque `try { … cfg_refresh_rules_cache … } catch` situado tras la llamada a `tx.commit()` en `applyConfig` (~líneas 1500-1505) y eliminarlo por completo. El resto del cuerpo de `applyConfig` permanece intacto.
  Verificar que no quedan referencias a `cfg_refresh_rules_cache` en el fichero.
  (Diseño §2, ADR-004. Satisface: REQ-11)

---

## Fase 4: Tests unitarios

> Dependencia: las fases 1–3 deben estar finalizadas (o al menos acordadas en pseudo-código) para poder escribir los tests de fingerprint con coherencia. Los tests 3.1–3.3 existentes no se tocan.

- [x] 4.1 **`rule_set/test/config_cache.test.js` — limpiar artefactos obsoletos**:
  - Eliminar el helper `runCacheRefresh` por completo.
  - Eliminar los tests `3.4` (refresh tras commit) y `3.5` (refresh failure swallowed).
  - Actualizar el bloque de comentario en la cabecera del fichero para reflejar que los tests van de `3.1` a `3.3` (existentes) más los nuevos de fingerprint; eliminar cualquier mención a `3.4`/`3.5`.
  (Diseño §7, ADR-004. Satisface: REQ-11)

- [x] 4.2 **Test FP-01 — Dos fechas mismo período → mismo `cache_key` → hit**:
  Dado un set de winners fijo (mock), dos `@DATE` distintas producen idéntico fingerprint → clave idéntica.
  Patrón: mock de `cfg_resolve_mf_winners` retornando el mismo fingerprint; verificar que el segundo `EXEC` del wrapper no invoca el SP base.
  (Diseño §7 test 1. Satisface: REQ-01, escenario A)

- [x] 4.3 **Test FP-02 — Publish (nuevo período) → fingerprint distinto → miss**:
  Cambiar `rules_mfid` de una oferta en el mock de winners → clave distinta → miss.
  (Diseño §7 test 2. Satisface: REQ-01 escenario B, REQ-04)

- [x] 4.4 **Test FP-03 — Oferta sin período cubriente contribuye `:0:0`**:
  `ISNULL(rules_mfid, 0)` produce `MOTOROFERTA_ID:0:0`; al activar un período (0→N) el fingerprint cambia → miss controlado.
  (Diseño §7 test 3. Satisface: REQ-03)

- [x] 4.5 **Test FP-04 — Determinismo independiente del orden de `@offer_codes`**:
  `STRING_AGG … WITHIN GROUP (ORDER BY MOTOROFERTA_ID)` → misma clave para `'A,B'` y `'B,A'` con los mismos winners.
  (Diseño §7 test 4. Satisface: REQ-02)

- [x] 4.6 **Test FP-05 — Evicción FIFO de fingerprints antiguos**:
  Insertar `@max_history_size + 1` entradas distintas para el mismo `offer_codes_key`; verificar que solo quedan `@max_history_size` entradas y que la eliminada es la más antigua. Sin filtro por `cache_type`.
  (Diseño §7 test 5. Satisface: REQ-08)

- [x] 4.7 **Test FP-06 — `sp_getapplock` previene stampede en miss de fingerprint**:
  Segundo hilo re-checkea tras lock, encuentra la fila insertada por el primero, no invoca el SP base.
  Patrón: mismo patrón helper del test 3.1 (mock de request object, sin live-DB).
  (Diseño §7 test 6. Satisface: REQ-07)

- [x] 4.8 **Test FP-07 (opcional) — TTL: entrada expirada no produce hit y se regenera**:
  Mock de `created_at` anterior al umbral `@cutoff`; verificar que el lookup TTL-aware produce miss y que el borrado oportunista se dispara.
  (Diseño §7 opcional test 7. Satisface: REQ-09)

---

## Fase 5: Verificación manual / live-DB (no cubierta por CI)

> Estas tareas requieren acceso a un entorno con la BD desplegada. No son automatizables con el runner de tests unitarios actual.

- [ ] 5.1 **[MANUAL / LIVE-DB] Verificar clave compartida entre dos fechas del mismo período**:
  Ejecutar el wrapper con dos fechas dentro del mismo período activo; confirmar que ambas peticiones producen el mismo `cache_key` en `dbo.cfg_rules_cache` y que la segunda no invoca el SP base (SQL Profiler / Extended Events: sin llamada a `cfg_get_offers_and_params_json`).
  (Diseño §5 paso 4. Satisface: REQ-01, REQ-06)

- [ ] 5.2 **[MANUAL / LIVE-DB] Verificar miss controlado tras publish con `DESDE_DT` futuro**:
  Publicar un período con `DESDE_DT` en el futuro; enviar una petición con esa fecha futura; confirmar que el fingerprint difiere del anterior y se genera una entrada fresca en caché.
  (Diseño §5 paso 4. Satisface: REQ-04, REQ-05)

- [ ] 5.3 **[MANUAL / LIVE-DB] Verificar plan de ejecución de la TVF**:
  Ejecutar `SELECT * FROM dbo.cfg_resolve_mf_winners(@offer_codes, GETDATE())` con `SET STATISTICS IO ON`; confirmar que el coste de resolución es despreciable frente al `FOR JSON` del SP base (supuesto estructural de diseño §1 y §8).
  (Diseño §5 paso 4, §8 riesgo "Coste estructural". Satisface: NFR implícito de rendimiento)

- [ ] 5.4 **[MANUAL / LIVE-DB] Confirmar ausencia de `cfg_refresh_rules_cache` post-deploy**:
  Ejecutar `applyConfig` desde la UI o la API; verificar en los logs del servidor Node que no se registra ningún intento de llamada a `cfg_refresh_rules_cache`; verificar en la BD que el SP ya no existe (`SELECT OBJECT_ID('dbo.cfg_refresh_rules_cache')`).
  (Diseño §5 paso 4. Satisface: REQ-11)

- [ ] 5.5 **[MANUAL / LIVE-DB] Ejecutar la suite de tests tras el deploy para confirmar 0 fallos**:
  Desde `rule_set/`: `npm test`. Confirmar que los tests 3.1, 3.2, 3.3 y FP-01..FP-07 pasan y que no existen referencias rotas a `runCacheRefresh` ni a los tests 3.4/3.5 eliminados.
  (Diseño §7. Satisface: todos los REQ)
