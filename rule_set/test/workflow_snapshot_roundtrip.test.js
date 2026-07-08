/**
 * Tests for PR2a: WF snapshot SP migration + createWorkflowSnapshot assembly.
 *
 * Covers:
 *   - assembleWfSnapshotPayload: pure JS helper extracted from createWorkflowSnapshot
 *     that converts raw SP JSON output into the INSERT payload shape.
 *
 * Tasks: 2.4 (T2.4a–e)
 *
 * NOTE: createWorkflowSnapshot itself requires a live DB (two pools: WF SP call +
 * POC INSERT). The pure assembly logic is extracted here for CI-green coverage.
 * The full round-trip (publish → SP read → INSERT snapshot) is LIVE-DB-pending.
 *
 * SP contract (post 2.6 migration):
 *   cfg_get_workflow_snapshot_json returns snapshot_json with:
 *   - ofertas: [{ OFERTA_ID, NOMBRE_REGLA_TXT, OFERTA_RANK_NM }]
 *   - reglas:  [{ REGLA_ID, OFERTA_ID, VIGENCIA_DESDE_DT, VIGENCIA_HASTA_DT, ... }]
 *   - params:  [{ PARAM_ID, OFERTA_ID, VIGENCIA_DESDE_DT, VIGENCIA_HASTA_DT, ... }]
 *   VIGENCIA_DESDE_DT / VIGENCIA_HASTA_DT are aliased from mf.DESDE_DT / mf.HASTA_DT
 *   so the JS field names remain stable after the SP migration.
 *
 * Live-DB verification checklist (run against SQL Server before prod):
 *   1. Execute SP with @MOTORFECHA_ID = <id> matching a known period; assert
 *      VIGENCIA_DESDE_DT and VIGENCIA_HASTA_DT in result equal mf.DESDE_DT/HASTA_DT.
 *   2. Execute SP with NULL @MOTORFECHA_ID; assert all current MRO_ rows returned.
 *   3. Execute SP with a MOTORFECHA_ID that has TIPO_DS='REGLAS'; assert params array
 *      is empty (no param period for that MOTORFECHA_ID).
 *   4. Execute SP with a MOTORFECHA_ID that has TIPO_DS='PARAMS'; assert reglas array
 *      is empty.
 *   5. Execute SP with a MOTORFECHA_ID that has TIPO_DS='AMBOS'; assert both arrays
 *      are populated.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { hasSqlCredentials, hasWfSqlCredentials } from "../api/config/env.js";

// ---------------------------------------------------------------------------
// Helper extracted from createWorkflowSnapshot (mirrors what the service does).
// Converts raw SP output (snapshot_json string) + metadata into the INSERT payload.
//
// Pure: no DB, no I/O. All inputs are values.
// ---------------------------------------------------------------------------

import { assembleWfSnapshotPayload } from "../api/services/admin_workflow_service.js";

// ---------------------------------------------------------------------------
// T2.4a — parses a well-formed SP JSON string; returns correct rulesJson
// ---------------------------------------------------------------------------

test("T2.4a: assembleWfSnapshotPayload parses SP JSON string and echoes snapshotData as rulesJson", () => {
  const spJson = JSON.stringify({
    ofertas: [{ OFERTA_ID: 1, NOMBRE_REGLA_TXT: "OFERTA_RESTRICTIVA", OFERTA_RANK_NM: 100 }],
    reglas: [{ REGLA_ID: 10, OFERTA_ID: 1, VIGENCIA_DESDE_DT: "2026-01-01", VIGENCIA_HASTA_DT: "2026-12-31" }],
    params: [{ PARAM_ID: 5, OFERTA_ID: 1, VIGENCIA_DESDE_DT: "2026-01-01", VIGENCIA_HASTA_DT: "2026-12-31" }],
  });

  const payload = assembleWfSnapshotPayload(spJson, "2026-01-01", "test.user");

  const parsed = JSON.parse(payload.rulesJson);
  assert.ok(Array.isArray(parsed.reglas), "rulesJson debe tener campo reglas");
  assert.equal(parsed.reglas.length, 1);
  assert.equal(parsed.reglas[0].VIGENCIA_DESDE_DT, "2026-01-01");
  assert.equal(parsed.reglas[0].VIGENCIA_HASTA_DT, "2026-12-31");
});

// ---------------------------------------------------------------------------
// T2.4b — snapshot_name includes "WF Snapshot" prefix
// ---------------------------------------------------------------------------

test("T2.4b: assembleWfSnapshotPayload generates a name with 'WF Snapshot' prefix", () => {
  const payload = assembleWfSnapshotPayload("{}", null, null);
  assert.ok(
    payload.name.startsWith("WF Snapshot"),
    `Expected name to start with 'WF Snapshot', got: ${payload.name}`,
  );
});

// ---------------------------------------------------------------------------
// T2.4c — comment includes the vigDesde value when provided
// ---------------------------------------------------------------------------

test("T2.4c: assembleWfSnapshotPayload includes vigDesde in comment", () => {
  const payload = assembleWfSnapshotPayload("{}", "2026-06-01", "user1");
  assert.ok(
    payload.comment.includes("2026-06-01"),
    `Expected comment to include vigDesde, got: ${payload.comment}`,
  );
});

// ---------------------------------------------------------------------------
// T2.4d — comment says 'completo' when vigDesde is null
// ---------------------------------------------------------------------------

test("T2.4d: assembleWfSnapshotPayload uses 'completo' in comment when vigDesde is null", () => {
  const payload = assembleWfSnapshotPayload("{}", null, null);
  assert.ok(
    payload.comment.includes("completo"),
    `Expected comment to include 'completo', got: ${payload.comment}`,
  );
});

// ---------------------------------------------------------------------------
// T2.4e — malformed JSON string falls back to empty object; no throw
// ---------------------------------------------------------------------------

test("T2.4e: assembleWfSnapshotPayload handles malformed JSON without throwing", () => {
  const payload = assembleWfSnapshotPayload("not-valid-json", "2026-01-01", "user");
  assert.doesNotThrow(() => JSON.parse(payload.rulesJson));
  // Fallback is {} — rulesJson parses to an object
  const parsed = JSON.parse(payload.rulesJson);
  assert.equal(typeof parsed, "object");
});

// ---------------------------------------------------------------------------
// CA-VDT-004 (2.1 RED): cfg_get_workflow_snapshot_json SP parámetros deben ser
// DATETIME2(0), no DATE. Con DATE (estado actual), el matching de precisión de
// segundos es imposible (DATE trunca a día). Cubre RF-VDT-04, INV-VDT-03.
// Se omite si no hay credenciales de BD WF (integration test).
// ---------------------------------------------------------------------------

test(
  "CA-VDT-004: cfg_get_workflow_snapshot_json @VIGENCIA_DESDE y @VIGENCIA_HASTA son DATETIME2(0) — requiere BD WF",
  { skip: !hasWfSqlCredentials() },
  async () => {
    const { getWfSqlPool } = await import("../api/db/sql_client.js");
    const pool = await getWfSqlPool();

    const result = await pool.request().query(`
      SELECT PARAMETER_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.PARAMETERS
      WHERE SPECIFIC_NAME = 'cfg_get_workflow_snapshot_json'
        AND PARAMETER_NAME IN ('@VIGENCIA_DESDE', '@VIGENCIA_HASTA')
      ORDER BY ORDINAL_POSITION
    `);

    assert.equal(
      result.recordset.length,
      2,
      "Deben existir exactamente 2 parámetros (@VIGENCIA_DESDE y @VIGENCIA_HASTA)"
    );

    for (const row of result.recordset) {
      assert.equal(
        row.DATA_TYPE,
        "datetime2",
        `${row.PARAMETER_NAME} debe ser datetime2, actualmente es ${row.DATA_TYPE}`
      );
    }
  }
);

// ---------------------------------------------------------------------------
// CA-VDT-004 triangulation (2.2 RED): SP con DATETIME2(0) devuelve filas para
// un MOTORFECHA conocido. Con sql.Date (estado actual) el match falla porque
// useUTC:true desplaza la hora y rompe la igualdad exacta.
// Escenario negativo documenta el bug original (DATE param pierde precisión).
// Cubre RF-VDT-04, ADR-002 (useUTC:false co-ship).
// Se omite si no hay credenciales de BD WF.
// ---------------------------------------------------------------------------

test(
  "CA-VDT-004b: SP con DATETIME2(0) y sql.DateTime2(0) devuelve snapshot no vacío — requiere BD WF",
  { skip: !hasWfSqlCredentials() },
  async () => {
    const { getWfSqlPool, sql } = await import("../api/db/sql_client.js");
    const pool = await getWfSqlPool();

    // Obtain a known existing DESDE_DT from MRO_MOTORFECHA so the test
    // is self-contained and does not depend on static fixture data.
    const lookupResult = await pool.request().query(`
      SELECT TOP 1 MOTORFECHA_ID, DESDE_DT
      FROM dbo.MRO_MOTORFECHA
      WHERE BORRADO_FL IS NULL OR BORRADO_FL = 0
      ORDER BY MOTORFECHA_ID DESC
    `);

    assert.ok(
      lookupResult.recordset.length > 0,
      "Debe existir al menos un MRO_MOTORFECHA para ejecutar este test"
    );

    const { DESDE_DT } = lookupResult.recordset[0];
    // Truncate to whole second (normalizeVigenciaToSecond contract)
    const desdeNorm = new Date(DESDE_DT);
    desdeNorm.setMilliseconds(0);

    const req = pool.request();
    req.input("VIGENCIA_DESDE", sql.DateTime2(0), desdeNorm);
    req.input("VIGENCIA_HASTA", sql.DateTime2(0), null);
    const spResult = await req.execute("dbo.cfg_get_workflow_snapshot_json");

    const row = spResult.recordset?.[0];
    const parsed = JSON.parse(row?.snapshot_json ?? "{}");

    // After SP update to DATETIME2(0) with useUTC:false, the exact match returns rows.
    // Pre-update (DATE params + useUTC:true), this assertion fails (0 rows returned).
    const totalRows = (parsed.reglas?.length ?? 0) + (parsed.params?.length ?? 0);
    assert.ok(
      totalRows > 0,
      `SP debe devolver al menos una regla o param para DESDE_DT=${desdeNorm.toISOString()}. ` +
      `Con DATE params + useUTC:true el match falla (reglas=${parsed.reglas?.length ?? 0}, params=${parsed.params?.length ?? 0})`
    );
  }
);
