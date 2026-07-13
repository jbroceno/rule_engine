/**
 * test/snapshot_integrity.test.js — TDD tests for the OWASP-10 snapshot
 * integrity safeguard (HMAC-SHA256 checksum computed at creation, verified
 * at restore).
 *
 * Follows the patterns already established in this repo:
 *   - Unit tests (no DB): direct function calls against
 *     api/utils/snapshot_integrity.js — same style as test/require_role.test.js.
 *   - Integration tests (real SQL pool, own cleanup in finally): same style
 *     as test/admin_apply_safeguard.test.js / test/admin_offers_period.test.js.
 *     Skips cleanly when SQL credentials are absent ({ skip: !hasSqlCredentials() }).
 *
 * Spec ref: openspec/changes/rbac-and-config-safeguards/specs/snapshot-integrity/spec.md
 * Design ref: openspec/changes/rbac-and-config-safeguards/design.md
 *   § "Integridad de snapshots (OWASP-10)", § "HMAC canonicalization"
 */

import test from "node:test";
import assert from "node:assert/strict";

import { AppError } from "../api/utils/app_error.js";
import { hasSqlCredentials } from "../api/config/env.js";
import { getSqlPool, sql } from "../api/db/sql_client.js";

// ---------------------------------------------------------------------------
// Imports from the new util — RED until WU-11 creates
// api/utils/snapshot_integrity.js.
// ---------------------------------------------------------------------------
const { computeSnapshotChecksum, verifySnapshotChecksum } = await import(
  "../api/utils/snapshot_integrity.js"
);

// createSnapshot/restoreSnapshot already exist — used unmodified until WU-11
// wires checksum compute/verify into them (RED for the integration tests
// below, GREEN once WU-11 lands).
const { createSnapshot, restoreSnapshot } = await import("../api/services/admin_service.js");

const SECRET = "test-secret-for-snapshot-integrity";

// ---------------------------------------------------------------------------
// Unit (no DB) — computeSnapshotChecksum: deterministic, sensitive to content
// ---------------------------------------------------------------------------

test("computeSnapshotChecksum: mismo input -> mismo hex de 64 caracteres (determinista)", () => {
  const rulesJson = JSON.stringify([{ a: 1 }]);
  const paramsJson = JSON.stringify([{ b: 2 }]);
  const checksum1 = computeSnapshotChecksum(rulesJson, paramsJson, SECRET);
  const checksum2 = computeSnapshotChecksum(rulesJson, paramsJson, SECRET);
  assert.equal(checksum1, checksum2);
  assert.match(checksum1, /^[0-9a-f]{64}$/, "debe ser hex de 64 caracteres (HMAC-SHA256)");
});

test("computeSnapshotChecksum: contenido distinto -> checksum distinto", () => {
  const paramsJson = JSON.stringify([{ b: 2 }]);
  const checksumA = computeSnapshotChecksum(JSON.stringify([{ a: 1 }]), paramsJson, SECRET);
  const checksumB = computeSnapshotChecksum(JSON.stringify([{ a: 2 }]), paramsJson, SECRET);
  assert.notEqual(checksumA, checksumB);
});

// ---------------------------------------------------------------------------
// Unit (no DB) — verifySnapshotChecksum: verified / failed / legacy
// ---------------------------------------------------------------------------

test("verifySnapshotChecksum: checksum recalculado coincide -> status 'verified'", () => {
  const rulesJson = JSON.stringify([{ a: 1 }]);
  const paramsJson = JSON.stringify([{ b: 2 }]);
  const storedChecksum = computeSnapshotChecksum(rulesJson, paramsJson, SECRET);
  const result = verifySnapshotChecksum({ rulesJson, paramsJson, storedChecksum, secret: SECRET });
  assert.equal(result.status, "verified");
});

test("verifySnapshotChecksum: alteracion de 1 byte en rulesJson -> status 'failed'", () => {
  const rulesJson = JSON.stringify([{ a: 1 }]);
  const paramsJson = JSON.stringify([{ b: 2 }]);
  const storedChecksum = computeSnapshotChecksum(rulesJson, paramsJson, SECRET);
  // Flip a single character in the persisted string, as if it had been
  // altered directly in the DB after the snapshot was created.
  const tamperedRulesJson = rulesJson.replace('"a":1', '"a":2');
  assert.notEqual(tamperedRulesJson, rulesJson, "el fixture debe garantizar una alteracion real");
  const result = verifySnapshotChecksum({
    rulesJson: tamperedRulesJson,
    paramsJson,
    storedChecksum,
    secret: SECRET,
  });
  assert.equal(result.status, "failed");
});

test("verifySnapshotChecksum: storedChecksum es null -> status 'legacy' (no lanza)", () => {
  const result = verifySnapshotChecksum({
    rulesJson: "[]",
    paramsJson: "[]",
    storedChecksum: null,
    secret: SECRET,
  });
  assert.equal(result.status, "legacy");
});

test("verifySnapshotChecksum: storedChecksum es cadena vacia -> status 'legacy'", () => {
  const result = verifySnapshotChecksum({
    rulesJson: "[]",
    paramsJson: "[]",
    storedChecksum: "",
    secret: SECRET,
  });
  assert.equal(result.status, "legacy");
});

test("verifySnapshotChecksum: storedChecksum de longitud distinta -> status 'failed' (guarda de longitud, no lanza)", () => {
  const rulesJson = "[]";
  const paramsJson = "[]";
  assert.doesNotThrow(() => {
    const result = verifySnapshotChecksum({
      rulesJson,
      paramsJson,
      storedChecksum: "deadbeef", // valid hex, wrong length vs the real 64-char digest
      secret: SECRET,
    });
    assert.equal(result.status, "failed");
  });
});

// ---------------------------------------------------------------------------
// Integration (skip sin SQL) — helpers
// ---------------------------------------------------------------------------

async function countSnapshots(pool) {
  const r = await pool.request().query(`SELECT COUNT(*) AS cnt FROM dbo.cfg_config_snapshot`);
  return r.recordset[0].cnt;
}

async function readSnapshotRow(pool, snapshotId) {
  const r = await pool
    .request()
    .input("id", sql.Int, snapshotId)
    .query(
      `SELECT snapshot_id, rules_json, params_json, checksum FROM dbo.cfg_config_snapshot WHERE snapshot_id = @id`
    );
  return r.recordset[0];
}

async function deleteSnapshotRow(pool, snapshotId) {
  await pool
    .request()
    .input("id", sql.Int, snapshotId)
    .query(`DELETE FROM dbo.cfg_config_snapshot WHERE snapshot_id = @id`)
    .catch(() => {});
}

/** Captures console.warn calls made during fn(); always restores console.warn. */
async function withCapturedWarn(fn) {
  const calls = [];
  const original = console.warn;
  console.warn = (...args) => calls.push(args);
  try {
    const result = await fn();
    return { result, calls };
  } finally {
    console.warn = original;
  }
}

// ---------------------------------------------------------------------------
// Integration (skip sin SQL) — createSnapshot calcula y persiste checksum
// ---------------------------------------------------------------------------

test(
  "createSnapshot: la fila insertada tiene checksum no nulo de 64 caracteres hex",
  { skip: !hasSqlCredentials() },
  async () => {
    const pool = await getSqlPool();
    let snapshotId = null;
    try {
      snapshotId = await createSnapshot(
        "Test snapshot integrity T-09",
        "Comentario de prueba T-09",
        null
      );
      const row = await readSnapshotRow(pool, snapshotId);
      assert.ok(row, "la fila del snapshot debe existir");
      assert.ok(row.checksum, "checksum no debe ser nulo/vacio");
      assert.match(String(row.checksum), /^[0-9a-f]{64}$/i);
    } finally {
      if (snapshotId) await deleteSnapshotRow(pool, snapshotId);
    }
  }
);

// ---------------------------------------------------------------------------
// Integration (skip sin SQL) — restoreSnapshot rechaza (409) si rules_json fue
// alterado en BD tras la creacion; ni muta datos ni crea snapshot de respaldo.
// ---------------------------------------------------------------------------

test(
  "restoreSnapshot: rules_json alterado en BD tras crear -> AppError 409, sin mutacion ni snapshot de respaldo",
  { skip: !hasSqlCredentials() },
  async () => {
    const pool = await getSqlPool();
    let snapshotId = null;
    try {
      snapshotId = await createSnapshot(
        "Test snapshot integrity tamper T-09",
        "Comentario tamper T-09",
        null
      );

      // Tamper the persisted rules_json directly in the DB, simulating an
      // out-of-band alteration after the snapshot was created.
      await pool
        .request()
        .input("id", sql.Int, snapshotId)
        .query(
          `UPDATE dbo.cfg_config_snapshot SET rules_json = rules_json + 'TAMPERED' WHERE snapshot_id = @id`
        );

      const snapshotCountBefore = await countSnapshots(pool);

      await assert.rejects(
        () => restoreSnapshot(snapshotId),
        (err) => {
          assert.ok(err instanceof AppError, "se esperaba AppError");
          assert.equal(err.statusCode, 409);
          assert.match(
            err.message,
            /integridad del snapshot/i,
            "el mensaje debe indicar que la integridad no pudo verificarse"
          );
          return true;
        }
      );

      const snapshotCountAfter = await countSnapshots(pool);
      assert.equal(
        snapshotCountAfter,
        snapshotCountBefore,
        "no debe crearse ningun snapshot de seguridad pre-restore cuando la verificacion falla"
      );
    } finally {
      if (snapshotId) await deleteSnapshotRow(pool, snapshotId);
    }
  }
);

// ---------------------------------------------------------------------------
// Integration (skip sin SQL) — snapshot legado (checksum NULL) permite
// restaurar con integrity.status === "legacy" y registra un aviso (warn).
// ---------------------------------------------------------------------------

test(
  "restoreSnapshot: checksum NULL (legado) -> restauracion procede con integrity.status 'legacy'",
  { skip: !hasSqlCredentials() },
  async () => {
    const pool = await getSqlPool();
    let legacySnapshotId = null;
    let preRestoreSnapshotId = null;
    try {
      const insertResult = await pool
        .request()
        .input("name", sql.NVarChar(200), "Test legacy snapshot T-09")
        .input("comment", sql.NVarChar(1000), "Legado sin checksum")
        .input("rulesJson", sql.NVarChar(sql.MAX), "[]")
        .input("paramsJson", sql.NVarChar(sql.MAX), "[]")
        .query(`
          INSERT INTO dbo.cfg_config_snapshot (snapshot_name, comment, rules_json, params_json, checksum)
          OUTPUT INSERTED.snapshot_id
          VALUES (@name, @comment, @rulesJson, @paramsJson, NULL)
        `);
      legacySnapshotId = insertResult.recordset[0].snapshot_id;

      const { result, calls } = await withCapturedWarn(() => restoreSnapshot(legacySnapshotId));

      assert.ok(result.integrity, "la respuesta debe incluir integrity");
      assert.equal(result.integrity.status, "legacy");
      assert.equal(result.integrity.checksumPresent, false);
      assert.ok(calls.length > 0, "debe registrarse un aviso (console.warn) para snapshots legados");
      preRestoreSnapshotId = result.preRestoreSnapshotId;
    } finally {
      if (legacySnapshotId) await deleteSnapshotRow(pool, legacySnapshotId);
      if (preRestoreSnapshotId) await deleteSnapshotRow(pool, preRestoreSnapshotId);
    }
  }
);
