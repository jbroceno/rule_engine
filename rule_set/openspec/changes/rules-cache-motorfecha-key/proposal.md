# Proposal — rules-cache-motorfecha-key

> Evolución directa del cambio archivado `db-rules-cache`. **Supersede** su esquema de clave
> (fecha literal → fingerprint de períodos `MRO_MOTORFECHA` ganadores).

## Intent

Rehacer la **clave** del caché de reglas para que deje de ser la fecha de referencia literal y pase
a ser un **fingerprint determinista de los períodos `MRO_MOTORFECHA` ganadores resueltos** (winner de
reglas + winner de params, por oferta). El caché pasa a ser **auto-invalidante**: dos fechas distintas
que resuelven a la misma configuración comparten entrada, y un publish que introduce un nuevo período
cambia el fingerprint automáticamente — sin refresh ni purga explícita.

### Problema

El caché actual (`db-rules-cache`) construye la clave como `offer_codes_key | <fecha>` donde la fecha
es `CONVERT(varchar(19), @effective_date, 120)` (precisión de segundo), o el literal `__CURRENT__` para
las peticiones genéricas (entrada `G`). Para el perfil de ejecución **continua** de Workflow esto tiene
tres defectos confirmados:

- **D1 — Churn histórico.** Fechas distintas que resuelven al **mismo** período `MRO_MOTORFECHA`
  generan filas de caché distintas y **byte-idénticas**. El cap FIFO (`@max_history_size = 50`) se llena
  de casi-duplicados → en producción continua el hit-rate tiende a ~0%. El caché no cachea nada útil.
- **D2 — Staleness por activación futura.** La entrada genérica `G` (`__CURRENT__`) solo se regenera al
  publicar (vía `cfg_refresh_rules_cache`). Una config con `DESDE_DT` futuro **no** es recogida por el
  caché hasta el siguiente publish, aunque la `@DATE` de la petición ya la cubra → se sirve config vieja.
- **D3 — El POC nunca envía NULL.** `config_service.js#parseAsOfDate()` devuelve `new Date()` (timestamp
  concreto) cuando no hay fecha, de modo que `@DATE` nunca llega NULL desde ese cliente → `@is_generic`
  siempre vale 0 → toda la maquinaria de la entrada `G` (`__CURRENT__`, `cfg_refresh_rules_cache`) es
  **inoperante** para el POC. Solo se ejercita la rama histórica `H`, que sufre D1.

La causa raíz común es que la clave codifica **la pregunta** (qué fecha se preguntó) en vez de **la
respuesta** (qué configuración resuelve esa fecha). El doc funcional `04 - config-cache.md` ya anticipa
la solución óptima: *"en lugar de guardar como clave la fecha de referencia, utilizar el id
correspondiente `MRO_MOTORFECHA` para reglas y por otra el correspondiente a parámetros... dos fechas
distintas indicarán la misma configuración si internamente los registros de `MRO_MOTORFECHA` son iguales."*

### Why now

- El caché entregado en `db-rules-cache` está **funcionalmente completo y testeado** pero, según el
  análisis del perfil real de WF, su esquema de clave no rinde: el caso dominante (POC, peticiones
  continuas con timestamp) cae siempre en la rama `H` con churn → hit-rate degradado.
- El SP base `cfg_get_offers_and_params_json` **ya resuelve** los winners por oferta en dos CTEs
  (`mf_rules_win`, `mf_params_win`) que exponen `MOTOROFERTA_ID` + `MOTORFECHA_ID`. El fingerprint se
  construye con la información que el motor ya calcula — no hay que inventar lógica nueva.
- El cambio es localizado en la capa SQL del caché (wrapper + objetos auxiliares) y deja **intactos**
  tanto el SP base como la interfaz Node.js, por lo que el riesgo de regresión funcional es bajo.

### Success criteria

1. Dos peticiones con **fechas distintas** que resuelven a los mismos períodos ganadores producen el
   **mismo `cache_key`** → la segunda es un hit (mata D1).
2. Un publish que introduce un período `MRO_MOTORFECHA` con `DESDE_DT` futuro cambia el fingerprint en
   cuanto una petición lo cubre → miss controlado → entrada fresca, **sin** depender de un refresh (mata D2).
3. El POC (que envía siempre timestamp concreto) se beneficia del caché igual que cualquier cliente:
   el fingerprint no depende de si `@DATE` es NULL (mata D3).
4. La firma del wrapper `cfg_get_offers_and_params_json_cached(@offer_codes, @DATE, @max_history_size)`
   se mantiene **estable** → `config_service.js` no requiere cambio de interfaz.
5. La invalidación es automática: **no** existe `cfg_refresh_rules_cache` ni se llama nada de caché tras
   `applyConfig`. Las entradas huérfanas se limpian por cap de tamaño + TTL.
6. La clave queda **legible** en producción (fingerprint crudo, sin hash) para diagnóstico directo.

## Scope

### In scope

- **Objetos SQL del caché** (`rule_set/sql/workflow_deploy/wf_sp_cfg_rules_cache.sql`)
  - **SP auxiliar nuevo `dbo.cfg_resolve_mf_winners(@offer_codes, @DATE)`** (Opción A): ejecuta
    únicamente los CTEs de resolución de winners (los mismos `mf_rules_win` / `mf_params_win` del SP
    base) y devuelve, por oferta, `(MOTOROFERTA_ID, rules_mfid, params_mfid)` más el **fingerprint**
    agregado y determinista. Única fuente de la lógica de resolución para el caché (DRY).
  - **Wrapper `cfg_get_offers_and_params_json_cached` reescrito**: flujo `resolve winners → construir
    cache_key (fingerprint) → lookup → hit/miss`. Conserva `sp_getapplock` para anti-stampede en miss,
    el cómputo vía SP base y la evicción acotada. Firma estable.
  - **Eliminar `cfg_refresh_rules_cache`** y su `EXEC` de seed inicial (PH-2): con clave-fingerprint el
    refresh pierde su función de corrección. Las huérfanas no son incorrectas (siguen válidas para las
    fechas que resuelven a ese winner); las limpia el cap + TTL.
  - **Eliminar la distinción G/H** (columna `cache_type`, CHECK asociado): ya no hay dos perfiles de
    clave (PH-3 — el tratamiento exacto de la columna se confirma en diseño).
- **Backend Node.js**
  - `api/services/admin_service.js` — eliminar la llamada best-effort a `cfg_refresh_rules_cache` tras
    el commit de `applyConfig` (líneas ~1500-1505) y su try/catch (PH-2).
- **Tests** (`rule_set/test/config_cache.test.js`)
  - Reescribir 3.4 (refresh tras commit) y 3.5 (refresh failure swallowed) — quedan obsoletos.
  - Añadir ~5-6 tests de fingerprint: dos fechas mismo período → mismo fingerprint → hit; publish →
    fingerprint distinto → miss; oferta sin período cubriente → contribuye `:0:0`; evicción FIFO de
    fingerprints antiguos; `sp_getapplock` sigue previniendo stampede en miss de fingerprint.

### Out of scope

- **Modificar el SP base `cfg_get_offers_and_params_json`.** Permanece intacto: el caché lo sigue
  invocando para serializar (capa costosa `FOR JSON`). El SP auxiliar **reutiliza** la misma lógica de
  winners, pero no toca el base.
- **Cambios de interfaz en Node.js.** `config_service.js#parseAsOfDate()` y la firma del wrapper se
  mantienen. El caso nominal no cambia contratos.
- **In-Memory OLTP.** El NFR del doc (`04 - config-cache.md`: *"No podemos configurar en el servidor
  opciones OLTP"*) lo prohíbe. Se mantiene la tabla en disco de `db-rules-cache` (ADR-1).
- **Hash del fingerprint (SHA2_256).** Con el dominio actual (~6 ofertas) el fingerprint crudo es
  legible y cabe holgadamente en `NVARCHAR(500)` (PH-5). El hash queda como cambio de una línea para el
  futuro si el catálogo crece a ~25+ ofertas.
- **Warm-up explícito post-publish.** El perfil de petición continua de WF tolera el primer miss tras un
  publish; no se materializan entradas por adelantado (PH-4).

## Approach

### High-level

1. **SP auxiliar `cfg_resolve_mf_winners` (Opción A).** Aísla los CTEs `mf_rules_win` / `mf_params_win`
   (idénticos a los del SP base) y devuelve por oferta `(MOTOROFERTA_ID, rules_mfid, params_mfid)`. Sobre
   ese conjunto agrega el **fingerprint** determinista. La resolución es la **capa ligera** (range-scan
   sobre `MRO_MOTORFECHA` + `ROW_NUMBER()`): barata, puede ejecutarse en cada request.
2. **Fingerprint determinista (formato cerrado).** Clave = `<offer_codes_key>|FP:<fingerprint>`, con:

   ```sql
   STRING_AGG(
       CAST(w.MOTOROFERTA_ID AS VARCHAR(10)) + ':' +
       CAST(ISNULL(w.rules_mfid,  0) AS VARCHAR(10)) + ':' +
       CAST(ISNULL(w.params_mfid, 0) AS VARCHAR(10)),
       '|'
   ) WITHIN GROUP (ORDER BY w.MOTOROFERTA_ID ASC)
   ```

   Una oferta sin período cubriente contribuye `:0:0` (distingue "sin período" de "no solicitada" y
   garantiza que activar un período futuro cambie el fingerprint). `STRING_AGG ... WITHIN GROUP` hace la
   clave independiente del orden de `@offer_codes`. Disponible desde SQL Server 2017 (instancia: 2017
   Enterprise, confirmado).
3. **Wrapper reescrito.** `resolve winners → cache_key → IF EXISTS lookup (hit) → miss: sp_getapplock +
   re-check → EXEC SP base → INSERT best-effort → evicción acotada → release lock`. La capa costosa
   (`FOR JSON` anidado, 2N subqueries correlacionadas por regla) sigue ejecutándose **solo en miss** — que
   es donde está el valor del caché.
4. **Sin refresh, sin G/H.** Se eliminan `cfg_refresh_rules_cache`, su seed y la llamada en
   `admin_service.js`. La invalidación es emergente del cambio de fingerprint. El TTL + cap de tamaño
   pasan a ser perillas de **gestión de almacenamiento** (no de corrección), satisfaciendo el requisito
   funcional del doc de *"tiempo de vida y tamaño de entrada configurable"*.

### Rationale

| Decisión | Por qué |
|---|---|
| **Clave = fingerprint de winners, no fecha** | Codifica la respuesta (qué config resuelve), no la pregunta (qué fecha). Dos fechas → misma config → misma clave. Mata D1/D2/D3 de raíz. Es la "solución óptima" que el propio doc funcional describe. |
| **SP auxiliar (A), no query inline (B)** | El SP base ya evolucionó una vez (`mro-snapshot-deploy`). Duplicar los CTEs en el wrapper crearía dos sitios que sincronizar a cada evolución del base. El auxiliar deja la lógica de resolución en un único lugar (DRY), testeable en aislamiento y útil para diagnóstico. El coste de "un objeto SQL más" es menor que la deuda de la duplicación. |
| **Eliminar `cfg_refresh_rules_cache` (no reconvertir en purge)** | Con clave-fingerprint el refresh no corrige nada. Las huérfanas son válidas, no incorrectas. Un purge de huérfanos sería redundante con el cap de tamaño + TTL y añadiría complejidad sin valor de corrección. Se puede añadir como mejora operativa futura si el volumen lo justifica. |
| **Fingerprint crudo, sin hash** | Con ~6 ofertas la clave peor-caso ≈ 275 chars, holgada bajo `NVARCHAR(500)`. El fingerprint legible permite diagnóstico directo en producción ("esta entrada corresponde a estos períodos"). El hash sacrifica legibilidad y solo es necesario si el catálogo crece mucho — cambio de una línea cuando llegue. |
| **Firma del wrapper estable** | `(@offer_codes, @DATE, @max_history_size)` no cambia → `config_service.js` no toca interfaz → cero riesgo en la capa Node y `parseAsOfDate()` sigue correcta. |
| **No warm-up post-publish** | El perfil continuo de WF tolera un único miss tras publicar; el segundo request ya es hit. Materializar por adelantado reintroduciría la maquinaria de refresh que estamos eliminando. |
| **TTL/tamaño como gestión de almacenamiento** | Sin función de corrección, el TTL solo evita acumulación indefinida de huérfanas; puede ser largo (días/semanas). Cumple el requisito funcional sin acoplar correctness a expiración. |

### Affected files

| Fichero | Cambio |
|---|---|
| `rule_set/sql/workflow_deploy/wf_sp_cfg_rules_cache.sql` | SP auxiliar `cfg_resolve_mf_winners` nuevo; wrapper reescrito (clave-fingerprint); `cfg_refresh_rules_cache` + su seed eliminados; tabla sin `cache_type` (detalle en diseño). |
| `rule_set/api/services/admin_service.js` | Eliminar la llamada best-effort a `cfg_refresh_rules_cache` y su try/catch tras el commit de `applyConfig` (~1500-1505). |
| `rule_set/test/config_cache.test.js` | Reescribir tests 3.4/3.5 (obsoletos); añadir ~5-6 tests de fingerprint. |

### No changes

- `rule_set/sql/workflow_deploy/wf_sp_cfg_get_offers_and_params_json.sql` — SP base intacto.
- `rule_set/api/services/config_service.js` — sin cambio de interfaz en el caso nominal.
- Motor JS (`rule_engine.js`) y simuladores — ajenos al caché.

### Risks

- **Perfil de coste no medido.** La afirmación de que el coste dominante es la serialización `FOR JSON`
  (y que la resolución de winners es barata y repetible por request) es **razonamiento estructural**, no
  medición. **Mitigación:** verificación live-DB con plan de ejecución real antes de promover a producción.
- **Techo de longitud de clave.** Con >~25 ofertas el fingerprint crudo podría acercarse a
  `NVARCHAR(500)`. Hoy el dominio tiene ~6 → riesgo bajo. **Mitigación:** confirmar el techo real (PH-5);
  si crece, migrar a `SHA2_256` (cambio de una línea en el SP auxiliar).
- **Primer request post-publish = miss.** Por diseño (PH-4, sin warm-up). **Mitigación:** el perfil
  continuo de WF lo absorbe en el siguiente request; `sp_getapplock` evita stampede de ese miss.
- **Reescritura de tests.** 3.4/3.5 cambian de semántica; riesgo de cobertura insuficiente en los nuevos
  casos de fingerprint. **Mitigación:** matriz explícita de casos (mismo período/distinto período/oferta
  sin período/evicción/stampede) definida en spec.

## Open questions

1. **PH-3 — tratamiento exacto de `cache_type`.** ¿Eliminar la columna por completo (requiere `ALTER`
   sobre la tabla existente o redeploy de tabla) o conservarla nullable/constante sin CHECK G/H? Decidir
   en diseño según política de migración del esquema desplegado.
2. **TTL — valor por defecto.** ¿Qué default de expiración fijar (días vs. semanas) y cómo exponerlo como
   configurable (parámetro de SP, columna calculada, job de limpieza)? El doc pide configurable pero no
   fija valor.
3. **`@max_history_size` — semántica/nombre.** Con G/H eliminado y clave-fingerprint, ¿sigue teniendo
   sentido el nombre "history" o conviene renombrar a algo como `@max_cache_entries` (manteniendo la firma
   compatible para no romper Node)? Decidir en diseño.
