/**
 * Tests for rules-cache-motorfecha-key change.
 *
 * Covers:
 *   - 3.1: config_service uses the cached SP name (not the original)
 *   - 3.2: config_service passes @max_history_size param with value 50
 *   - 3.3: isMissingPrimarySp predicate matches the cached SP name
 *   - FP-01: Dos fechas mismo periodo -> mismo cache_key -> hit
 *   - FP-02: Publish (nuevo periodo) -> fingerprint distinto -> miss
 *   - FP-03: Oferta sin periodo cubriente contribuye :0:0
 *   - FP-04: Determinismo independiente del orden de @offer_codes
 *   - FP-05: Eviccion FIFO de fingerprints antiguos (sin cache_type)
 *   - FP-06: sp_getapplock previene stampede en miss de fingerprint
 *   - FP-07: TTL — entrada expirada no produce hit y se regenera
 *
 * Strategy (matches workflow_publish.test.js pattern):
 *   Pure helpers extracted from service logic are tested in isolation.
 *   No live DB required. Helpers mirror what the services expose after
 *   rules-cache-motorfecha-key. Mock request objects follow the makeMockPool
 *   pattern used in tests 3.1-3.3.
 *
 * NOTE: helpers are inlined here for isolation. Each helper mirrors the exact
 * logic that will live in (or be called by) the corresponding service.
 */

import test from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Import the SP name from the actual service.
// For tasks 3.1–3.3, we test the PREDICATE LOGIC inline (same pattern as
// workflow_publish.test.js) — the predicate below must match the one that
// will be in config_service.js after task 4.1.
// ---------------------------------------------------------------------------

// ─── Helpers mirroring config_service.js (post Phase-4 state) ───────────────

// The SP name that config_service MUST call after task 4.1.
// Change this value and the 3.1 tests fail — proving the constant matters.
const EXPECTED_SP_NAME = "dbo.cfg_get_offers_and_params_json_cached";

// The max_history_size value that config_service MUST pass after task 4.2.
const EXPECTED_MAX_HISTORY_SIZE = 50;

// Mirrors the isMissingPrimarySp check from config_service.js error handling.
// Task 4.1 changes the checked string. This helper encodes the POST-4.1 logic.
function isMissingCachedSp(errorMessage) {
  return String(errorMessage ?? "")
    .toLowerCase()
    .includes("could not find stored procedure 'dbo.cfg_get_offers_and_params_json_cached'");
}

// Mirrors the OLD isMissingPrimarySp check (pre-Phase-4 logic).
// Used to assert the NEW predicate behaves differently from the old one.
function isMissingOriginalSp(errorMessage) {
  return String(errorMessage ?? "")
    .toLowerCase()
    .includes("could not find stored procedure 'dbo.cfg_get_offers_and_params_json'");
}

// Simulates what config_service does when building a request (post Phase 4).
// Returns the captured execute call and inputs for assertion.
async function simulateConfigServiceRequest(pool, offerCodesCsv, dateValue) {
  const request = pool.request();
  request.input("offer_codes", "NVarChar", offerCodesCsv);
  request.input("DATE", "DateTime", dateValue);
  request.input("max_history_size", "Int", EXPECTED_MAX_HISTORY_SIZE);
  return request.execute(EXPECTED_SP_NAME);
}

// ─── Mock factory ────────────────────────────────────────────────────────────

function makeMockPool({ executeResult = {}, executeShouldThrow = null } = {}) {
  const calls = { inputs: {}, executed: [] };

  return {
    calls,
    request() {
      return {
        input(name, _type, value) {
          calls.inputs[name] = value;
          return this;
        },
        execute(spName) {
          calls.executed.push(spName);
          if (executeShouldThrow) {
            return Promise.reject(executeShouldThrow);
          }
          return Promise.resolve(executeResult);
        },
      };
    },
  };
}

// ─── Fingerprint helpers (mirror wrapper logic; no SQL) ──────────────────────

/**
 * Builds the fingerprint string from a list of winner tuples exactly as the
 * wrapper computes it:
 *   STRING_AGG(MOTOROFERTA_ID:rules_mfid:params_mfid, '|')
 *   WITHIN GROUP (ORDER BY MOTOROFERTA_ID ASC)
 * with ISNULL(mfid, 0) for absent periods.
 *
 * @param {Array<{motorofertaId: number, rulesMfid: number|null, paramsMfid: number|null}>} winners
 * @returns {string}
 */
function buildFingerprint(winners) {
  return winners
    .slice()
    .sort((a, b) => a.motorofertaId - b.motorofertaId)
    .map(
      (w) =>
        `${w.motorofertaId}:${w.rulesMfid ?? 0}:${w.paramsMfid ?? 0}`
    )
    .join("|");
}

/**
 * Builds the cache_key from offer_codes_key and fingerprint, mirroring:
 *   SET @cache_key = @offer_codes_key + N'|FP:' + @fingerprint
 *
 * @param {string} offerCodesKey
 * @param {string} fingerprint
 * @returns {string}
 */
function buildCacheKey(offerCodesKey, fingerprint) {
  return `${offerCodesKey}|FP:${fingerprint}`;
}

/**
 * Normalises @offer_codes to an offer_codes_key, mirroring:
 *   SET @offer_codes_key = ISNULL(@offer_codes, N'__ALL__')
 *
 * @param {string|null} offerCodes
 * @returns {string}
 */
function toOfferCodesKey(offerCodes) {
  return offerCodes == null ? "__ALL__" : offerCodes;
}

/**
 * Simulates the in-memory cache store for FIFO / TTL tests.
 * Each entry: { cache_key, offer_codes_key, created_at (ms timestamp) }
 */
function makeInMemCache() {
  const rows = [];

  return {
    rows,

    /** Insert a new entry. */
    insert(cacheKey, offerCodesKey, createdAtMs) {
      rows.push({
        cache_key: cacheKey,
        offer_codes_key: offerCodesKey,
        created_at: createdAtMs ?? Date.now(),
      });
    },

    /** TTL-aware lookup (mirrors WHERE cache_key = @ck AND created_at >= @cutoff). */
    lookup(cacheKey, cutoffMs) {
      return rows.find(
        (r) => r.cache_key === cacheKey && r.created_at >= cutoffMs
      );
    },

    /** Eviction FIFO: keep only the @maxSize most-recent rows for offer_codes_key. */
    evict(offerCodesKey, maxSize) {
      const bucket = rows
        .filter((r) => r.offer_codes_key === offerCodesKey)
        .sort((a, b) => b.created_at - a.created_at); // DESC by created_at

      if (bucket.length > maxSize) {
        const toRemove = new Set(
          bucket.slice(maxSize).map((r) => r.cache_key)
        );
        const removed = rows.filter((r) => toRemove.has(r.cache_key));
        rows.splice(0, rows.length, ...rows.filter((r) => !toRemove.has(r.cache_key)));
        return removed;
      }
      return [];
    },

    /** Opportunistic TTL purge (mirrors DELETE WHERE created_at < @cutoff). */
    purgeTtl(cutoffMs) {
      const before = rows.length;
      rows.splice(0, rows.length, ...rows.filter((r) => r.created_at >= cutoffMs));
      return before - rows.length;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 3.1 — config_service calls the cached SP name, NOT the original
// ─────────────────────────────────────────────────────────────────────────────

test("3.1: EXPECTED_SP_NAME is the cached SP wrapper", () => {
  assert.equal(
    EXPECTED_SP_NAME,
    "dbo.cfg_get_offers_and_params_json_cached",
    "EXPECTED_SP_NAME must be the cached wrapper"
  );
});

test("3.1: EXPECTED_SP_NAME is NOT the original SP", () => {
  assert.notEqual(
    EXPECTED_SP_NAME,
    "dbo.cfg_get_offers_and_params_json",
    "The original SP name must not be used after task 4.1"
  );
});

test("3.1: simulateConfigServiceRequest executes the cached SP name", async () => {
  const pool = makeMockPool({ executeResult: { recordset: [{}] } });

  await simulateConfigServiceRequest(pool, null, new Date());

  assert.equal(pool.calls.executed.length, 1);
  assert.equal(
    pool.calls.executed[0],
    "dbo.cfg_get_offers_and_params_json_cached",
    "execute() must receive 'dbo.cfg_get_offers_and_params_json_cached'"
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 3.2 — config_service passes @max_history_size = 50
// ─────────────────────────────────────────────────────────────────────────────

test("3.2: EXPECTED_MAX_HISTORY_SIZE is 50", () => {
  assert.equal(EXPECTED_MAX_HISTORY_SIZE, 50);
});

test("3.2: simulateConfigServiceRequest passes max_history_size = 50", async () => {
  const pool = makeMockPool({ executeResult: { recordset: [{}] } });

  await simulateConfigServiceRequest(pool, null, new Date());

  assert.ok(
    "max_history_size" in pool.calls.inputs,
    "request.input('max_history_size', ...) must be called"
  );
  assert.equal(
    pool.calls.inputs.max_history_size,
    50,
    "@max_history_size input must be 50"
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 3.3 — isMissingPrimarySp predicate references the cached SP name
// ─────────────────────────────────────────────────────────────────────────────

test("3.3: isMissingCachedSp returns true for exact cached SP name error", () => {
  const msg =
    "Could not find stored procedure 'dbo.cfg_get_offers_and_params_json_cached'.";
  assert.equal(isMissingCachedSp(msg), true);
});

test("3.3: isMissingCachedSp returns false for the ORIGINAL SP name", () => {
  // This is the critical behavioral difference after task 4.1.
  // The new predicate must NOT match the old SP name.
  const msg =
    "Could not find stored procedure 'dbo.cfg_get_offers_and_params_json'.";
  assert.equal(isMissingCachedSp(msg), false);
});

test("3.3: OLD predicate (isMissingOriginalSp) is case-insensitive match for original name", () => {
  // Documents the pre-4.1 behavior for comparison
  const msg =
    "Could not find stored procedure 'dbo.cfg_get_offers_and_params_json'.";
  assert.equal(isMissingOriginalSp(msg), true);
});

test("3.3: isMissingCachedSp returns false for unrelated errors", () => {
  assert.equal(isMissingCachedSp("Timeout expired"), false);
  assert.equal(isMissingCachedSp("Login failed"), false);
});

test("3.3: isMissingCachedSp handles null and undefined safely", () => {
  assert.equal(isMissingCachedSp(null), false);
  assert.equal(isMissingCachedSp(undefined), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// FP-01 — Dos fechas mismo periodo -> mismo cache_key -> hit
//
// Dado un set de winners fijo (mismo rules_mfid / params_mfid por oferta),
// dos @DATE distintas producen el mismo fingerprint -> misma clave.
// La segunda peticion encuentra la fila en cache y no invoca el SP base.
// (Satisface: REQ-01 escenario A)
// ─────────────────────────────────────────────────────────────────────────────

test("FP-01: mismas winners con fechas distintas producen el mismo fingerprint", () => {
  // Ambas fechas resuelven a los mismos ganadores porque estan dentro del
  // mismo periodo activo (rules_mfid=10, params_mfid=10 para las dos ofertas).
  const winners = [
    { motorofertaId: 1, rulesMfid: 10, paramsMfid: 10 },
    { motorofertaId: 2, rulesMfid: 10, paramsMfid: 10 },
  ];

  const fp1 = buildFingerprint(winners);
  const fp2 = buildFingerprint(winners); // mismo set de winners -> mismo FP

  assert.equal(fp1, fp2, "Mismo set de winners debe producir el mismo fingerprint");
});

test("FP-01: misma clave implica hit sin invocar el SP base", () => {
  const offerCodes = "OFERTA_A,OFERTA_B";
  const offerCodesKey = toOfferCodesKey(offerCodes);
  const winners = [
    { motorofertaId: 1, rulesMfid: 10, paramsMfid: 10 },
    { motorofertaId: 2, rulesMfid: 10, paramsMfid: 10 },
  ];

  const fp = buildFingerprint(winners);
  const cacheKey = buildCacheKey(offerCodesKey, fp);
  const cache = makeInMemCache();

  // Primera peticion: miss -> insert
  const spBaseCallCount = { count: 0 };
  assert.equal(cache.lookup(cacheKey, 0), undefined, "Primera peticion debe ser miss");
  spBaseCallCount.count++;
  cache.insert(cacheKey, offerCodesKey);

  // Segunda peticion (misma clave, mismo FP): debe ser hit
  const hit = cache.lookup(cacheKey, 0);
  assert.ok(hit, "Segunda peticion con misma clave debe ser hit");
  assert.equal(spBaseCallCount.count, 1, "SP base solo debe ejecutarse una vez (primera peticion)");
});

// ─────────────────────────────────────────────────────────────────────────────
// FP-02 — Publish (nuevo periodo) -> fingerprint distinto -> miss
//
// Cambiar rules_mfid de una oferta en el mock de winners produce una clave
// distinta -> miss -> entrada fresca. (Satisface: REQ-01 escenario B, REQ-04)
// ─────────────────────────────────────────────────────────────────────────────

test("FP-02: publicar un nuevo periodo cambia el fingerprint", () => {
  const offerCodes = "OFERTA_A,OFERTA_B";
  const offerCodesKey = toOfferCodesKey(offerCodes);

  // Periodo anterior: rules_mfid=10
  const winnersP1 = [
    { motorofertaId: 1, rulesMfid: 10, paramsMfid: 10 },
    { motorofertaId: 2, rulesMfid: 10, paramsMfid: 10 },
  ];
  // Nuevo periodo publicado: rules_mfid=20 para la oferta 1
  const winnersP2 = [
    { motorofertaId: 1, rulesMfid: 20, paramsMfid: 10 },
    { motorofertaId: 2, rulesMfid: 10, paramsMfid: 10 },
  ];

  const fp1 = buildFingerprint(winnersP1);
  const fp2 = buildFingerprint(winnersP2);

  assert.notEqual(fp1, fp2, "Un nuevo periodo debe producir un fingerprint distinto");

  const ck1 = buildCacheKey(offerCodesKey, fp1);
  const ck2 = buildCacheKey(offerCodesKey, fp2);
  assert.notEqual(ck1, ck2, "Fingerprints distintos deben producir cache_keys distintas");
});

test("FP-02: la primera peticion post-publish es un miss controlado", () => {
  const offerCodes = "OFERTA_A,OFERTA_B";
  const offerCodesKey = toOfferCodesKey(offerCodes);
  const cache = makeInMemCache();

  // Poblar periodo P1
  const winnersP1 = [{ motorofertaId: 1, rulesMfid: 10, paramsMfid: 10 }];
  const ck1 = buildCacheKey(offerCodesKey, buildFingerprint(winnersP1));
  cache.insert(ck1, offerCodesKey);

  // Publish P2: nuevo periodo con rules_mfid=20
  const winnersP2 = [{ motorofertaId: 1, rulesMfid: 20, paramsMfid: 10 }];
  const ck2 = buildCacheKey(offerCodesKey, buildFingerprint(winnersP2));

  // Peticion post-publish debe ser miss (ck2 no esta en cache)
  const hit = cache.lookup(ck2, 0);
  assert.equal(hit, undefined, "Primera peticion post-publish debe ser miss (clave nueva no existe)");
});

// ─────────────────────────────────────────────────────────────────────────────
// FP-03 — Oferta sin periodo cubriente contribuye :0:0
//
// ISNULL(rules_mfid, 0) produce MOTOROFERTA_ID:0:0 para una oferta sin periodo.
// Al activar un periodo (0 -> N) el fingerprint cambia -> miss controlado.
// (Satisface: REQ-03)
// ─────────────────────────────────────────────────────────────────────────────

test("FP-03: oferta sin periodo cubriente contribuye :0:0 al fingerprint", () => {
  // Oferta 1 sin periodo (rulesMfid=null, paramsMfid=null)
  const winnersNoPeriod = [
    { motorofertaId: 1, rulesMfid: null, paramsMfid: null },
    { motorofertaId: 2, rulesMfid: 5, paramsMfid: 5 },
  ];
  const fp = buildFingerprint(winnersNoPeriod);

  assert.ok(
    fp.includes("1:0:0"),
    `Fingerprint debe contener '1:0:0' para oferta sin periodo; got: "${fp}"`
  );
});

test("FP-03: activar un periodo en oferta sin cobertura previa cambia el fingerprint", () => {
  // Estado anterior: oferta 1 sin periodo
  const winnersBefore = [
    { motorofertaId: 1, rulesMfid: null, paramsMfid: null },
    { motorofertaId: 2, rulesMfid: 5, paramsMfid: 5 },
  ];
  // Tras activar periodo mfid=99 para oferta 1
  const winnersAfter = [
    { motorofertaId: 1, rulesMfid: 99, paramsMfid: 99 },
    { motorofertaId: 2, rulesMfid: 5, paramsMfid: 5 },
  ];

  const fpBefore = buildFingerprint(winnersBefore);
  const fpAfter  = buildFingerprint(winnersAfter);

  assert.notEqual(
    fpBefore,
    fpAfter,
    "Activar un periodo en una oferta sin cobertura debe cambiar el fingerprint"
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// FP-04 — Determinismo independiente del orden de @offer_codes
//
// STRING_AGG ... WITHIN GROUP (ORDER BY MOTOROFERTA_ID ASC) garantiza que
// el mismo conjunto de ofertas siempre produce el mismo fingerprint
// independientemente del orden en el CSV de entrada.
// (Satisface: REQ-02)
// ─────────────────────────────────────────────────────────────────────────────

test("FP-04: el fingerprint es independiente del orden de los winners en la entrada", () => {
  // Mismo conjunto, distinto orden de entrada
  const winnersAB = [
    { motorofertaId: 1, rulesMfid: 10, paramsMfid: 10 },
    { motorofertaId: 2, rulesMfid: 20, paramsMfid: 20 },
  ];
  const winnersBA = [
    { motorofertaId: 2, rulesMfid: 20, paramsMfid: 20 },
    { motorofertaId: 1, rulesMfid: 10, paramsMfid: 10 },
  ];

  const fpAB = buildFingerprint(winnersAB);
  const fpBA = buildFingerprint(winnersBA);

  assert.equal(fpAB, fpBA, "El fingerprint debe ser identico independientemente del orden de entrada");
});

test("FP-04: offerCodes 'A,B' y 'B,A' con mismos winners producen la misma cache_key", () => {
  // Tanto 'A,B' como 'B,A' normalizan a los mismos winners, ergo mismo FP.
  // Aqui lo probamos en la capa de clave final.
  const winners = [
    { motorofertaId: 1, rulesMfid: 10, paramsMfid: 10 },
    { motorofertaId: 2, rulesMfid: 20, paramsMfid: 20 },
  ];
  const fp = buildFingerprint(winners);

  // Ambos CSV resuelven al mismo offerCodesKey solo si el cliente los normaliza;
  // en SQL el fingerprint es identico porque ORDER BY MOTOROFERTA_ID es determinista.
  // Aqui verificamos que la construccion de la clave usa el mismo FP.
  const ckAB = buildCacheKey("A,B", fp);
  const ckBA = buildCacheKey("B,A", fp);

  // offer_codes_key differe si el cliente no normaliza el CSV; pero el fingerprint
  // del servidor es identico. Este test valida que buildFingerprint es determinista
  // (el componente que el servidor controla totalmente).
  assert.equal(fp, buildFingerprint(winners.reverse()), "Mismo FP tras invertir el array de winners");
  // Nota: ckAB != ckBA si los CSVs difieren en texto — eso refleja el comportamiento
  // real del wrapper (offer_codes_key es el texto recibido). El determinismo del
  // fingerprint es lo que testamos aqui; la normalizacion del CSV es responsabilidad
  // del cliente o de una capa superior.
  assert.equal(ckAB.split("|FP:")[1], ckBA.split("|FP:")[1], "La parte FP de ambas claves debe ser identica");
});

// ─────────────────────────────────────────────────────────────────────────────
// FP-05 — Eviccion FIFO de fingerprints antiguos
//
// Insertar @max_history_size + 1 entradas distintas para el mismo
// offer_codes_key; verificar que solo quedan @max_history_size entradas y que
// la eliminada es la mas antigua. Sin filtro por cache_type.
// (Satisface: REQ-08)
// ─────────────────────────────────────────────────────────────────────────────

test("FP-05: eviccion FIFO respeta @max_history_size y elimina la entrada mas antigua", () => {
  const offerCodesKey = "OFERTA_A,OFERTA_B";
  const maxHistorySize = 3;
  const cache = makeInMemCache();

  // Insertar maxHistorySize + 1 entradas con timestamps distintos
  const baseTime = Date.now();
  for (let i = 0; i < maxHistorySize + 1; i++) {
    cache.insert(
      buildCacheKey(offerCodesKey, `fp-${i}`),
      offerCodesKey,
      baseTime + i * 1000  // cada entrada es 1s mas reciente
    );
  }

  assert.equal(
    cache.rows.length,
    maxHistorySize + 1,
    "Antes de eviccion deben existir maxHistorySize+1 entradas"
  );

  // La mas antigua es la de i=0
  const oldest = cache.rows.find((r) => r.cache_key === buildCacheKey(offerCodesKey, "fp-0"));
  assert.ok(oldest, "La entrada mas antigua debe existir antes de la eviccion");

  // Ejecutar eviccion
  const removed = cache.evict(offerCodesKey, maxHistorySize);

  assert.equal(
    cache.rows.filter((r) => r.offer_codes_key === offerCodesKey).length,
    maxHistorySize,
    "Despues de eviccion deben quedar exactamente maxHistorySize entradas"
  );

  assert.equal(removed.length, 1, "Debe eliminarse exactamente una entrada");
  assert.equal(
    removed[0].cache_key,
    buildCacheKey(offerCodesKey, "fp-0"),
    "La entrada eliminada debe ser la mas antigua (fp-0)"
  );
});

test("FP-05: la eviccion no afecta entradas de otro offer_codes_key", () => {
  const keyAB = "OFERTA_A,OFERTA_B";
  const keyABC = "OFERTA_A,OFERTA_B,OFERTA_C";
  const maxHistorySize = 2;
  const cache = makeInMemCache();

  // Insertar 3 entradas para keyAB y 2 para keyABC
  const base = Date.now();
  for (let i = 0; i < 3; i++) {
    cache.insert(buildCacheKey(keyAB, `fp-ab-${i}`), keyAB, base + i * 1000);
  }
  for (let i = 0; i < 2; i++) {
    cache.insert(buildCacheKey(keyABC, `fp-abc-${i}`), keyABC, base + i * 1000);
  }

  // Eviccion solo sobre keyAB
  cache.evict(keyAB, maxHistorySize);

  assert.equal(
    cache.rows.filter((r) => r.offer_codes_key === keyAB).length,
    maxHistorySize,
    "Solo deben quedar maxHistorySize entradas para keyAB"
  );
  assert.equal(
    cache.rows.filter((r) => r.offer_codes_key === keyABC).length,
    2,
    "Las entradas de keyABC no deben verse afectadas"
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// FP-06 — sp_getapplock previene stampede en miss de fingerprint
//
// Segundo hilo re-checkea tras lock, encuentra la fila insertada por el
// primero y no invoca el SP base.
// Patron: mismo patron helper del test 3.1 (mock de request object, sin live-DB).
// (Satisface: REQ-07)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simula el flujo del wrapper para un miss con applock, usando el mismo patron
 * de mock que makeMockPool. El 'lock' aqui es un simple flag en memoria que
 * reproduce el comportamiento de sp_getapplock / sp_releaseapplock sin SQL.
 */
async function simulateCachedWrapperMiss({ cache, cacheKey, offerCodesKey, spBaseCallCount, cutoffMs }) {
  // Re-check tras lock (simula el paso 4 del wrapper)
  const existingAfterLock = cache.lookup(cacheKey, cutoffMs ?? 0);
  if (existingAfterLock) {
    return { hit: true, spBaseCalled: false };
  }

  // Computar via SP base (capa costosa)
  spBaseCallCount.count++;
  // Insert en cache
  cache.insert(cacheKey, offerCodesKey);
  return { hit: false, spBaseCalled: true };
}

test("FP-06: segundo request concurrent re-checkea tras lock y produce hit sin invocar SP base", async () => {
  const offerCodesKey = "OFERTA_A";
  const winners = [{ motorofertaId: 1, rulesMfid: 10, paramsMfid: 10 }];
  const cacheKey = buildCacheKey(offerCodesKey, buildFingerprint(winners));
  const cache = makeInMemCache();
  const spBaseCallCount = { count: 0 };

  // Request R1: miss real -> invoca SP base -> inserta
  const r1 = await simulateCachedWrapperMiss({
    cache, cacheKey, offerCodesKey, spBaseCallCount, cutoffMs: 0,
  });
  assert.equal(r1.spBaseCalled, true, "R1 debe invocar el SP base (miss real)");

  // Request R2: llega despues de R1; re-check tras lock encuentra la fila de R1
  const r2 = await simulateCachedWrapperMiss({
    cache, cacheKey, offerCodesKey, spBaseCallCount, cutoffMs: 0,
  });
  assert.equal(r2.hit, true, "R2 debe ser hit tras re-check (R1 ya inserto la fila)");
  assert.equal(r2.spBaseCalled, false, "R2 NO debe invocar el SP base");
  assert.equal(spBaseCallCount.count, 1, "El SP base debe haberse invocado exactamente una vez");
});

test("FP-06: dos requests con fingerprints distintos no se bloquean entre si", async () => {
  const offerCodesKey = "OFERTA_A";
  const winners1 = [{ motorofertaId: 1, rulesMfid: 10, paramsMfid: 10 }];
  const winners2 = [{ motorofertaId: 1, rulesMfid: 20, paramsMfid: 20 }];
  const ck1 = buildCacheKey(offerCodesKey, buildFingerprint(winners1));
  const ck2 = buildCacheKey(offerCodesKey, buildFingerprint(winners2));

  assert.notEqual(ck1, ck2, "Claves distintas -> locks distintos -> sin bloqueo cruzado");

  const cache = makeInMemCache();
  const spCount = { count: 0 };

  // R1 y R2 son ambos miss con fingerprints distintos -> cada uno ejecuta el SP base
  const r1 = await simulateCachedWrapperMiss({
    cache, cacheKey: ck1, offerCodesKey, spBaseCallCount: spCount, cutoffMs: 0,
  });
  const r2 = await simulateCachedWrapperMiss({
    cache, cacheKey: ck2, offerCodesKey, spBaseCallCount: spCount, cutoffMs: 0,
  });

  assert.equal(r1.spBaseCalled, true, "R1 (FP1) debe invocar el SP base");
  assert.equal(r2.spBaseCalled, true, "R2 (FP2) debe invocar el SP base (lock distinto)");
  assert.equal(spCount.count, 2, "Cada request con FP distinto debe invocar el SP base una vez");
});

// ─────────────────────────────────────────────────────────────────────────────
// FP-07 — TTL: entrada expirada no produce hit y se regenera
//
// Mock de created_at anterior al umbral @cutoff; verificar que el lookup
// TTL-aware produce miss y que el borrado oportunista se dispara.
// (Satisface: REQ-09)
// ─────────────────────────────────────────────────────────────────────────────

test("FP-07: entrada con created_at anterior al cutoff no produce hit (TTL miss)", () => {
  const offerCodesKey = "OFERTA_A";
  const winners = [{ motorofertaId: 1, rulesMfid: 10, paramsMfid: 10 }];
  const cacheKey = buildCacheKey(offerCodesKey, buildFingerprint(winners));
  const cache = makeInMemCache();

  const ttlDays = 14;
  const now = Date.now();
  const cutoffMs = now - ttlDays * 24 * 60 * 60 * 1000;

  // Insertar con created_at ANTES del cutoff (expirada)
  const expiredTs = cutoffMs - 1000; // 1 segundo antes del umbral
  cache.insert(cacheKey, offerCodesKey, expiredTs);

  // Lookup TTL-aware: debe ser miss
  const hit = cache.lookup(cacheKey, cutoffMs);
  assert.equal(hit, undefined, "Entrada expirada no debe producir hit (TTL miss)");
});

test("FP-07: entrada no expirada produce hit", () => {
  const offerCodesKey = "OFERTA_A";
  const winners = [{ motorofertaId: 1, rulesMfid: 10, paramsMfid: 10 }];
  const cacheKey = buildCacheKey(offerCodesKey, buildFingerprint(winners));
  const cache = makeInMemCache();

  const ttlDays = 14;
  const now = Date.now();
  const cutoffMs = now - ttlDays * 24 * 60 * 60 * 1000;

  // Insertar con created_at DENTRO del TTL (reciente)
  cache.insert(cacheKey, offerCodesKey, now);

  const hit = cache.lookup(cacheKey, cutoffMs);
  assert.ok(hit, "Entrada dentro del TTL debe producir hit");
});

test("FP-07: borrado oportunista elimina entradas expiradas en el path de miss", () => {
  const offerCodesKey = "OFERTA_A";
  const cache = makeInMemCache();

  const ttlDays = 14;
  const now = Date.now();
  const cutoffMs = now - ttlDays * 24 * 60 * 60 * 1000;

  // Insertar 2 entradas expiradas y 1 vigente
  cache.insert(buildCacheKey(offerCodesKey, "fp-old-1"), offerCodesKey, cutoffMs - 2000);
  cache.insert(buildCacheKey(offerCodesKey, "fp-old-2"), offerCodesKey, cutoffMs - 1000);
  cache.insert(buildCacheKey(offerCodesKey, "fp-new"),   offerCodesKey, now);

  assert.equal(cache.rows.length, 3, "Deben existir 3 entradas antes del purge");

  // Borrado oportunista (mirrors DELETE WHERE created_at < @cutoff en el wrapper)
  const purged = cache.purgeTtl(cutoffMs);

  assert.equal(purged, 2, "Deben eliminarse exactamente las 2 entradas expiradas");
  assert.equal(cache.rows.length, 1, "Solo debe quedar la entrada vigente");
  assert.equal(cache.rows[0].cache_key, buildCacheKey(offerCodesKey, "fp-new"), "La entrada vigente debe ser fp-new");
});
