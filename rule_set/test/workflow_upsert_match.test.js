/**
 * Integration test: RF-VDT-02 — upsertMotorFecha exact non-midnight DESDE_DT match.
 *
 * Covers finding WF-01:
 *   Deploying/publishing to a datetime that EXACTLY matches an existing
 *   non-midnight MRO_MOTORFECHA.DESDE_DT (the kind the external WF tool creates)
 *   REUSES that period's MOTORFECHA_ID (replace), NOT creating an orphan row.
 *   Negative control: a non-matching datetime creates a NEW period.
 *
 * Strategy — self-contained, zero persisted data:
 *   1. Open WF pool and begin a transaction.
 *   2. Seed one MRO_MOTORFECHA row with a far-future non-midnight DESDE_DT
 *      (2099-07-15 14:32:07) using MOTORFECHA_ID = MAX+1. HASTA_DT = NULL.
 *   3. (a) Call upsertMotorFecha with the EXACT matching datetime → must return
 *          the seeded MOTORFECHA_ID (reuse path).
 *      (b) Call upsertMotorFecha with a DIFFERENT datetime (2099-07-15 09:00:00)
 *          → must return a NEW id (insert path).
 *   4. Roll back in finally — assert no rows persist.
 *
 * Skips cleanly when WF DB credentials are absent (CI / local without WF creds).
 * WILL RUN when credentials are present (the intended environment).
 *
 * References: RF-VDT-02, INV-VDT-01, ADR-002 (useUTC:false).
 */

import test from "node:test";
import assert from "node:assert/strict";

import { hasWfSqlCredentials } from "../api/config/env.js";

// ---------------------------------------------------------------------------
// WF-01 (a): exact non-midnight DESDE_DT → MOTORFECHA_ID reused
// WF-01 (b): different datetime → new MOTORFECHA_ID created
// ---------------------------------------------------------------------------

test(
  "WF-01: upsertMotorFecha reuses MOTORFECHA_ID for exact non-midnight DESDE_DT match (RF-VDT-02)",
  { skip: !hasWfSqlCredentials() },
  async () => {
    const { getWfSqlPool, sql } = await import("../api/db/sql_client.js");
    const { upsertMotorFecha } = await import("../api/services/admin_workflow_service.js");

    const pool = await getWfSqlPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      // -----------------------------------------------------------------------
      // Step 1: Capture MAX(MOTORFECHA_ID) inside the transaction so our seeded
      // id stays above the high-water mark even if other tests run in parallel.
      // -----------------------------------------------------------------------
      const maxResult = await tx.request().query(`
        SELECT ISNULL(MAX(MOTORFECHA_ID), 0) AS maxId FROM dbo.MRO_MOTORFECHA
      `);
      const baseMax = maxResult.recordset[0].maxId;
      const seededId = baseMax + 1;

      // -----------------------------------------------------------------------
      // Step 2: Seed a MRO_MOTORFECHA row with a NON-midnight DESDE_DT far in
      // the future (2099-07-15 14:32:07) to avoid any collision with real data.
      // HASTA_DT = NULL (open-ended period — the most common WF-tool pattern).
      // TIPO_DS = 'AMBOS' (standard value for a full publish period).
      // -----------------------------------------------------------------------
      const seedDesdeDt = new Date(2099, 6, 15, 14, 32, 7, 0); // local wall-clock, ms=0
      const seedReq = tx.request();
      seedReq.input("id", sql.Int, seededId);
      seedReq.input("desde", sql.DateTime2(0), seedDesdeDt);
      seedReq.input("tipo", sql.VarChar(10), "AMBOS");
      await seedReq.query(`
        INSERT INTO dbo.MRO_MOTORFECHA (MOTORFECHA_ID, DESDE_DT, HASTA_DT, TIPO_DS, ALTA_DT)
        VALUES (@id, @desde, NULL, @tipo, GETDATE())
      `);

      // Confirm the seed row is visible inside this transaction.
      const confirmReq = tx.request();
      confirmReq.input("id", sql.Int, seededId);
      const confirmResult = await confirmReq.query(`
        SELECT MOTORFECHA_ID, DESDE_DT FROM dbo.MRO_MOTORFECHA WHERE MOTORFECHA_ID = @id
      `);
      assert.equal(
        confirmResult.recordset.length,
        1,
        `Seed row with MOTORFECHA_ID=${seededId} debe ser visible en la transacción`,
      );

      // -----------------------------------------------------------------------
      // Step 3a: POSITIVE control — call upsertMotorFecha with the EXACT datetime
      // that was seeded.  The function must return the seeded id (reuse path, not
      // insert path). This is the core RF-VDT-02 assertion.
      // maxIdRef starts at seededId so that any insert would produce seededId+1.
      // -----------------------------------------------------------------------
      const maxIdRefA = { val: seededId };
      const returnedIdA = await upsertMotorFecha(
        tx,
        seedDesdeDt,       // exact match — same Date object, ms=0
        null,              // HASTA_DT IS NULL path
        "AMBOS",
        maxIdRefA,
      );

      assert.equal(
        returnedIdA,
        seededId,
        `RF-VDT-02 POSITIVO: upsertMotorFecha debe reusar MOTORFECHA_ID=${seededId} ` +
        `cuando DESDE_DT coincide exactamente (no debe crear fila nueva).`,
      );

      // Verify maxIdRef was NOT incremented (no INSERT happened).
      assert.equal(
        maxIdRefA.val,
        seededId,
        "maxIdRef.val no debe incrementarse cuando hay match exacto (reuse path)",
      );

      // -----------------------------------------------------------------------
      // Step 3b: NEGATIVE control — call upsertMotorFecha with a DIFFERENT
      // datetime (same date, different time: 09:00:00 vs 14:32:07).
      // The function must INSERT a new row and return seededId + 1.
      // -----------------------------------------------------------------------
      const differentDesdeDt = new Date(2099, 6, 15, 9, 0, 0, 0); // 09:00:00, same date
      const maxIdRefB = { val: seededId };
      const returnedIdB = await upsertMotorFecha(
        tx,
        differentDesdeDt,  // different time → no match
        null,
        "AMBOS",
        maxIdRefB,
      );

      const expectedNewId = seededId + 1;
      assert.equal(
        returnedIdB,
        expectedNewId,
        `RF-VDT-02 NEGATIVO: upsertMotorFecha debe crear MOTORFECHA_ID=${expectedNewId} ` +
        `cuando DESDE_DT NO coincide (09:00:00 ≠ 14:32:07).`,
      );

      // Verify maxIdRef was incremented (INSERT happened).
      assert.equal(
        maxIdRefB.val,
        expectedNewId,
        "maxIdRef.val debe incrementarse cuando no hay match (insert path)",
      );

      // Verify a second row was actually inserted inside the transaction.
      const countReq = tx.request();
      countReq.input("minId", sql.Int, seededId);
      const countResult = await countReq.query(`
        SELECT COUNT(*) AS cnt FROM dbo.MRO_MOTORFECHA WHERE MOTORFECHA_ID >= @minId
      `);
      assert.equal(
        countResult.recordset[0].cnt,
        2,
        "Deben existir exactamente 2 filas con MOTORFECHA_ID >= seededId dentro de la transacción",
      );

    } finally {
      // -----------------------------------------------------------------------
      // Step 4: ALWAYS roll back — nothing must persist in the test WF DB.
      // -----------------------------------------------------------------------
      await tx.rollback();

      // Confirm rollback: the seeded id must no longer be visible.
      const afterReq = pool.request();
      afterReq.input("id", sql.Int, (await pool.request().query(
        `SELECT ISNULL(MAX(MOTORFECHA_ID),0) AS m FROM dbo.MRO_MOTORFECHA`
      )).recordset[0].m + 1); // any id > current max is also fine — just check seeded one
      // Simpler: directly check the seeded id is gone.
      const seedCheck = pool.request();
      const baseMaxResult = await pool.request().query(`
        SELECT ISNULL(MAX(MOTORFECHA_ID), 0) AS maxId FROM dbo.MRO_MOTORFECHA
      `);
      // The seeded id was baseMax+1. After rollback, MAX should still be baseMax
      // (or lower — it cannot be higher unless an unrelated concurrent insert happened).
      // We only assert the seeded row is absent — no strict MAX comparison since
      // the DB can have concurrent activity.
      const afterCheckReq = pool.request();
      afterCheckReq.input("desde", sql.DateTime2(0), new Date(2099, 6, 15, 14, 32, 7, 0));
      const afterCheck = await afterCheckReq.query(`
        SELECT COUNT(*) AS cnt FROM dbo.MRO_MOTORFECHA
        WHERE DESDE_DT = @desde AND TIPO_DS = 'AMBOS'
      `);
      assert.equal(
        afterCheck.recordset[0].cnt,
        0,
        "Rollback: la fila sembrada con DESDE_DT=2099-07-15 14:32:07 no debe persistir en la BD",
      );
    }
  },
);
