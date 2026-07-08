# Exploración: rules-cache-motorfecha-key

> SDD · fase explore · proyecto `app-workflow` () · 2026-06-11
> Evolución directa del cambio archivado `db-rules-cache`.

## Problema

El caché de reglas actual (`db-rules-cache`) usa como clave la **fecha de referencia literal**
(`CONVERT(varchar(19), @date, 120)`, precisión de segundo) combinada con el conjunto de ofertas.
Esto es defectuoso para el perfil de ejecución continua de WF. Tres defectos confirmados:

- **D1 — Churn histórico.** Fechas distintas que resuelven al MISMO período `MRO_MOTORFECHA`
  generan filas de caché distintas y byte-idénticas. El FIFO de 50 entradas se llena de
  casi-duplicados → hit-rate ~0% en producción continua.
- **D2 — Staleness por activación futura.** La entrada `G` (`__CURRENT__`) solo se regenera al
  publicar. Una config con `DESDE_DT` futuro no es recogida por la caché hasta el siguiente
  publish, aunque `@DATE` ya la cubra.
- **D3 — El POC nunca envía NULL.** `config_service.js#parseAsOfDate()` devuelve `new Date()`
  (timestamp concreto) cuando no hay fecha → `@is_generic` siempre 0 → la distinción G/H es
  inoperante para ese cliente.

**Decisión ya tomada:** rehacer la clave para que sea un **fingerprint de los períodos
`MRO_MOTORFECHA` ganadores resueltos** (rules-winner + params-winner, por oferta), en lugar de la
fecha. Esto vuelve la caché **auto-invalidante** y mata D1, D2 y D3 de raíz.

## Hallazgos

### 1. Perfil de coste del SP base

Dos capas de coste separadas:

- **Capa ligera — resolución de ganadores** (`mf_rules_win`, `mf_params_win`): range-scan sobre
  `MRO_MOTORFECHA` + join con `MOTORFECHA_ID` distintos de `MRO_MOTORREGLA`/`MRO_MOTORPARAM` +
  `ROW_NUMBER()`. Barata — O(períodos activos).
- **Capa costosa — serialización `FOR JSON PATH` anidada**: subqueries correlacionadas por regla
  para CONDICIONES y ACCIONES → 2N executions con N reglas activas + construcción de strings JSON.
  Con 50–200 reglas es el **coste dominante**. Es lo que el caché evita.

**Consecuencia:** el valor del caché está casi íntegramente en evitar la serialización FOR JSON. La
resolución de ganadores (que alimenta el fingerprint) es barata y puede ejecutarse en cada request.
> Verificación live-DB recomendada para confirmar magnitudes (plan de ejecución real).

### 2. Composición del fingerprint multi-oferta

Cada oferta resuelve independientemente a `(MOTOROFERTA_ID, rules_MOTORFECHA_ID, params_MOTORFECHA_ID)`.
El fingerprint del request es el join ordenado de todas las tuplas activas.

- **Oferta sin período cubriente:** se representa como `(MOTOROFERTA_ID, 0, 0)` — distingue "sin
  período" de "no solicitada" y garantiza que al activar un período futuro el fingerprint cambia.
- **Determinismo:** `STRING_AGG(...) WITHIN GROUP (ORDER BY MOTOROFERTA_ID ASC)` → independiente del
  orden de `@offer_codes`. Disponible desde SQL Server 2017.

```sql
STRING_AGG(
    CAST(w.MOTOROFERTA_ID AS VARCHAR(10)) + ':' +
    CAST(ISNULL(w.rules_mfid,  0) AS VARCHAR(10)) + ':' +
    CAST(ISNULL(w.params_mfid, 0) AS VARCHAR(10)),
    '|'
) WITHIN GROUP (ORDER BY w.MOTOROFERTA_ID ASC)
```

Clave resultante: `<offer_codes_key>|FP:<fingerprint>` — p.ej. `__ALL__|FP:5:12:12|7:9:15`

> **Riesgo de longitud:** con >~25 ofertas la clave podría superar NVARCHAR(500). Hoy el dominio
> tiene 2 ofertas — riesgo bajo, pero confirmar el techo de producción (PH-5).

### 3. Restructuración del SP — dos opciones

- **Opción A (recomendada): SP auxiliar `cfg_resolve_mf_winners`.** Ejecuta solo los CTEs de
  resolución y devuelve ganadores + fingerprint. El wrapper lo llama primero. Pros: CTEs en un único
  lugar (DRY), testeable en aislamiento, útil para diagnóstico. Contra: un objeto SQL más.
- **Opción B: query inline en el wrapper.** CTEs duplicados dentro del wrapper. Pro: menos objetos.
  Contra: duplica la lógica de resolución del SP base — al evolucionar el base (ya pasó con
  `mro-snapshot-deploy`) hay que sincronizar dos sitios.

**Recomendación: A.** La duplicación de B es el coste clave dado que el SP base ya evolucionó.

### 4. Invalidación y `cfg_refresh_rules_cache`

Con clave-fingerprint la invalidación es **automática**: un publish introduce nueva
`MRO_MOTORFECHA` → la próxima petición resuelve otro fingerprint → miss → nueva entrada. La entrada
anterior queda huérfana pero **no incorrecta** (sigue válida para fechas que resuelven a ese winner).

`cfg_refresh_rules_cache` pierde su función de corrección; la distinción G/H se vuelve obsoleta.
Opciones: **eliminarlo** (más limpio; primer request post-publish = miss controlado) o
**reconvertirlo en `cfg_purge_stale_cache_entries`** (borra fingerprints ya no activos; valor
operativo de control de tamaño, más complejidad). → PH-2.

### 5. Rol del TTL

Con fingerprint, el TTL pasa de mecanismo de **corrección** a mecanismo de **gestión de
almacenamiento**: evita acumulación indefinida de entradas huérfanas. No necesita ser corto (días o
semanas). El requisito del doc `04 - config-cache.md` (TTL + tamaño configurables) sigue vigente
pero con semántica de almacenamiento, no de staleness.

### 6. Impacto Node.js

- **`config_service.js`:** sin cambios de interfaz si el wrapper conserva la firma
  `(@offer_codes, @DATE, @max_history_size)`. `parseAsOfDate()` sigue correcta.
- **`admin_service.js`:** la llamada a `cfg_refresh_rules_cache` tras `applyConfig` pierde utilidad
  → eliminar (con comentario) según PH-2.

### 7. Impacto en tests (`config_cache.test.js`)

| Test | Estado |
|------|--------|
| 3.1 nombre SP / 3.2 max_history_size / 3.3 SP no encontrado | Siguen válidos |
| 3.4 refresh tras commit / 3.5 refresh failure swallowed | Reescribir o eliminar (PH-2) |

Nuevos (~5–6): dos fechas mismo período → mismo fingerprint → hit; publish → fingerprint distinto →
miss; oferta sin período → `0`; evicción FIFO de fingerprints antiguos; `sp_getapplock` sigue
previniendo stampede en fingerprint-miss.

## Preguntas abiertas (decisión humana)

| ID | Prioridad | Pregunta | Recomendación |
|----|-----------|----------|---------------|
| PH-1 | ALTA | SP auxiliar (A) vs query inline (B) | A |
| PH-2 | ALTA | Eliminar `cfg_refresh_rules_cache` o reconvertir en purge de huérfanos | Eliminar (+ purge opcional futuro) |
| PH-3 | MEDIA | Eliminar columna `cache_type` (G/H) o mantenerla como `'F'` | Decidir en diseño |
| PH-4 | MEDIA | ¿Warm-up explícito post-publish? | No (perfil WF tolera el primer miss) |
| PH-5 | BAJA | Techo de ofertas en producción (afecta longitud de clave) | Confirmar; si >25 → hash SHA2_256 |

## Áreas afectadas

| Fichero | Cambio |
|---------|--------|
| `rule_set/sql/workflow_deploy/wf_sp_cfg_rules_cache.sql` | Rediseño: tabla (posible ALTER), SP auxiliar (A), wrapper reescrito, refresh eliminado/reconvertido |
| `rule_set/api/services/config_service.js` | Sin cambio de interfaz en caso nominal |
| `rule_set/api/services/admin_service.js` | Eliminar llamada a `cfg_refresh_rules_cache` |
| `rule_set/test/config_cache.test.js` | 3.4–3.5 reescritos; ~5–6 tests de fingerprint nuevos |

## Recomendación para la propuesta

Enfoque A completo: crear `cfg_resolve_mf_winners`, reescribir el wrapper (resolve → lookup →
hit/miss, preservando `sp_getapplock`), eliminar lógica G/H y la llamada de refresh, reescribir los
tests. Resolver PH-1, PH-2 y PH-5 antes del spec.
