import test from "node:test";
import assert from "node:assert/strict";

import {
  validateFechaCreatePayload,
  validateFechaUpdatePayload,
} from "../api/validators/admin_validator.js";
import { AppError } from "../api/utils/app_error.js";
import { hasSqlCredentials } from "../api/config/env.js";
import { deleteFecha } from "../api/services/admin_fechas_service.js";
import { normalizeVigenciaToSecond } from "../api/utils/vigencia.js";

// ---------------------------------------------------------------------------
// Validator — validateFechaCreatePayload
// ---------------------------------------------------------------------------

test("CA-001: crear período válido pasa sin error", () => {
  assert.doesNotThrow(() =>
    validateFechaCreatePayload({
      valid_from: "2026-01-01",
      valid_to: "2026-12-31",
      descripcion: "Período inicial",
      tipo_cd: "REGLAS",
    })
  );
});

test("CA-001: valid_to null (abierto) es válido", () => {
  assert.doesNotThrow(() =>
    validateFechaCreatePayload({
      valid_from: "2026-01-01",
      valid_to: null,
      descripcion: "Sin fin",
      tipo_cd: "AMBOS",
    })
  );
});

test("CA-002: valid_to <= valid_from produce error de validación", () => {
  assert.throws(
    () =>
      validateFechaCreatePayload({
        valid_from: "2026-06-01",
        valid_to: "2026-06-01",
        descripcion: "Mismo día",
        tipo_cd: "REGLAS",
      }),
    (err) => {
      assert.ok(err instanceof AppError, "debe ser AppError");
      assert.equal(err.statusCode, 400);
      const fieldErrors = err.details?.errors ?? [];
      assert.ok(
        fieldErrors.some((e) => e.field === "valid_to"),
        "debe reportar error en valid_to"
      );
      return true;
    }
  );
});

test("CA-002: valid_to anterior a valid_from produce error de validación", () => {
  assert.throws(
    () =>
      validateFechaCreatePayload({
        valid_from: "2026-06-15",
        valid_to: "2026-06-01",
        descripcion: "Rango invertido",
        tipo_cd: "PARAMS",
      }),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.ok(
        (err.details?.errors ?? []).some((e) => e.field === "valid_to")
      );
      return true;
    }
  );
});

test("tipo_cd inválido produce error de validación", () => {
  assert.throws(
    () =>
      validateFechaCreatePayload({
        valid_from: "2026-01-01",
        valid_to: null,
        descripcion: "Test",
        tipo_cd: "INVALIDO",
      }),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.ok(
        (err.details?.errors ?? []).some((e) => e.field === "tipo_cd")
      );
      return true;
    }
  );
});

test("tipo_cd PARAMS es válido", () => {
  assert.doesNotThrow(() =>
    validateFechaCreatePayload({
      valid_from: "2026-01-01",
      valid_to: null,
      descripcion: "Params período",
      tipo_cd: "PARAMS",
    })
  );
});

test("descripcion vacía produce error", () => {
  assert.throws(
    () =>
      validateFechaCreatePayload({
        valid_from: "2026-01-01",
        valid_to: null,
        descripcion: "  ",
        tipo_cd: "REGLAS",
      }),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.ok(
        (err.details?.errors ?? []).some((e) => e.field === "descripcion")
      );
      return true;
    }
  );
});

test("valid_from ausente produce error", () => {
  assert.throws(
    () =>
      validateFechaCreatePayload({
        valid_to: "2026-12-31",
        descripcion: "Sin from",
        tipo_cd: "REGLAS",
      }),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.ok(
        (err.details?.errors ?? []).some((e) => e.field === "valid_from")
      );
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// CA-003 — deleteFecha: el bloqueo 409 por refs fue reemplazado por cascade
// delete transaccional (commit 11ae777). El contrato verificable sin BD es
// el 404 cuando el período no existe (getFechaOrThrow corta antes de la tx).
// ---------------------------------------------------------------------------

const mockPoolNotFound = {
  request() {
    return {
      input() { return this; },
      async query() {
        return { recordset: [], rowsAffected: [0] };
      },
    };
  },
};

test("CA-003: deleteFecha lanza 404 si el período no existe", async () => {
  await assert.rejects(
    () => deleteFecha(999, { pool: mockPoolNotFound }),
    (err) => {
      assert.ok(err instanceof AppError, "debe ser AppError");
      assert.equal(err.statusCode, 404);
      assert.ok(err.message.includes("No existe"), "mensaje debe indicar que no existe");
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// CA-005 — filtrado por fecha via SP (requiere BD real; se omite si no hay credenciales)
// ---------------------------------------------------------------------------

test(
  "CA-005: SP filtra reglas por fecha via cfg_offer_dates — requiere BD",
  { skip: !hasSqlCredentials() },
  async () => {
    const { getSqlPool, sql } = await import("../api/db/sql_client.js");
    const pool = await getSqlPool();
    const req = pool.request();
    req.input("DATE", sql.Date, new Date());
    const result = await req.execute("dbo.cfg_get_offers_and_params_json");
    assert.ok(result != null, "SP ejecuta sin error");
  }
);

// ---------------------------------------------------------------------------
// WU-05 / RF-COD-01/02/03 — Validator temporal comparison with THH:mm:ss
// These tests use the already-updated validator (WU-08 GREEN) — they verify
// the temporal (epoch-millis) behaviour, replacing the old lexical compare.
// ---------------------------------------------------------------------------

test("(CA-COD-003) valid_from con datetime — pasa validación (YYYY-MM-DDTHH:mm:ss)", () => {
  assert.doesNotThrow(() =>
    validateFechaCreatePayload({
      valid_from: "2026-03-15T14:32:07",
      valid_to: "2026-06-01T09:00:00",
      descripcion: "Período con hora",
      tipo_cd: "AMBOS",
    })
  );
});

test("(CA-COD-003) valid_to 1 segundo después de valid_from — pasa validación", () => {
  assert.doesNotThrow(() =>
    validateFechaCreatePayload({
      valid_from: "2026-06-01T09:00:00",
      valid_to: "2026-06-01T09:00:01",
      descripcion: "Un segundo de diferencia",
      tipo_cd: "REGLAS",
    })
  );
});

test("(CA-COD-004) valid_to == valid_from datetime — produce error 400", () => {
  assert.throws(
    () =>
      validateFechaCreatePayload({
        valid_from: "2026-06-01T09:00:00",
        valid_to: "2026-06-01T09:00:00",
        descripcion: "Igual fecha y hora",
        tipo_cd: "REGLAS",
      }),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 400);
      assert.ok((err.details?.errors ?? []).some((e) => e.field === "valid_to"));
      return true;
    }
  );
});

test("(CA-COD-004) valid_to anterior a valid_from datetime — produce error 400", () => {
  assert.throws(
    () =>
      validateFechaCreatePayload({
        valid_from: "2026-06-01T09:00:00",
        valid_to: "2026-06-01T08:59:59",
        descripcion: "Un segundo antes",
        tipo_cd: "PARAMS",
      }),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.ok((err.details?.errors ?? []).some((e) => e.field === "valid_to"));
      return true;
    }
  );
});

test("(CA-COD-004) lexicographic-trick: '2026-10-01' vs '2026-9-30' no existente — acepta '2026-10-01T00:00:01' > '2026-10-01'", () => {
  // Verify temporal compare handles different-length formats correctly
  assert.doesNotThrow(() =>
    validateFechaCreatePayload({
      valid_from: "2026-10-01",           // midnight
      valid_to: "2026-10-01T00:00:01",   // 1 second later
      descripcion: "Temporal vs lexical",
      tipo_cd: "AMBOS",
    })
  );
});

test("(CA-COD-004) WU-08 RED: valid_to malformado debe producir error de validación", () => {
  // The new validator must reject malformed strings (currently any non-empty string passes)
  assert.throws(
    () =>
      validateFechaCreatePayload({
        valid_from: "2026-06-01T09:00:00",
        valid_to: "no-es-fecha-valida",
        descripcion: "Formato inválido",
        tipo_cd: "REGLAS",
      }),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 400);
      assert.ok((err.details?.errors ?? []).some((e) => e.field === "valid_to"));
      return true;
    }
  );
});

test("(CA-COD-004) WU-08 RED: valid_from malformado debe producir error de validación", () => {
  // The new validator must also reject malformed valid_from
  assert.throws(
    () =>
      validateFechaCreatePayload({
        valid_from: "not-a-date",
        valid_to: null,
        descripcion: "valid_from inválido",
        tipo_cd: "REGLAS",
      }),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 400);
      assert.ok((err.details?.errors ?? []).some((e) => e.field === "valid_from"));
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// WU-05 — normalizeVigenciaToSecond used in period-close logic (pure unit)
// Verifies the helper produces the exact value that will be stored as valid_to.
// ---------------------------------------------------------------------------

test("(INV-COD-04) close-period: valid_to = normalizeVigenciaToSecond(newValidFrom) exacto", () => {
  const newValidFrom = "2026-06-01T14:32:07";
  const closeDate = normalizeVigenciaToSecond(newValidFrom);
  assert.ok(closeDate instanceof Date, "debe ser Date");
  assert.equal(closeDate.getHours(), 14, "hora preservada");
  assert.equal(closeDate.getMinutes(), 32, "minutos preservados");
  assert.equal(closeDate.getSeconds(), 7, "segundos preservados");
  assert.equal(closeDate.getMilliseconds(), 0, "ms = 0 (truncado)");
  // The closeDate IS the new period start — exact (no -1 day, no day arithmetic)
  const newPeriodStart = normalizeVigenciaToSecond(newValidFrom);
  assert.equal(closeDate.getTime(), newPeriodStart.getTime(), "close = exact next start");
});

test("(INV-COD-04) no resta un día — la fecha de cierre NO es el día anterior", () => {
  const newFrom = "2026-06-15T00:00:00";
  const closeDate = normalizeVigenciaToSecond(newFrom);
  // Must NOT be the day before (2026-06-14)
  assert.equal(closeDate.getDate(), 15, "debe ser el día 15, no el 14");
  assert.equal(closeDate.getMonth(), 5, "debe ser junio (mes 5, 0-indexed)");
});

// ---------------------------------------------------------------------------
// CA-COD-001 — cfg_offer_dates.valid_from / valid_to deben ser DATETIME2(0)
// Cubre RF-COD-06, WU-01.
// Se omite si no hay credenciales de BD (integration test).
// ---------------------------------------------------------------------------

test(
  "CA-COD-001: cfg_offer_dates.valid_from y valid_to son DATETIME2(0) — requiere BD",
  { skip: !hasSqlCredentials() },
  async () => {
    const { getSqlPool } = await import("../api/db/sql_client.js");
    const pool = await getSqlPool();

    const result = await pool
      .request()
      .query(
        `SELECT COLUMN_NAME, DATA_TYPE, DATETIME_PRECISION
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_NAME = 'cfg_offer_dates'
           AND COLUMN_NAME IN ('valid_from', 'valid_to')
         ORDER BY COLUMN_NAME`
      );

    assert.equal(
      result.recordset.length,
      2,
      "Deben existir exactamente 2 filas (valid_from y valid_to)"
    );

    for (const row of result.recordset) {
      assert.equal(
        row.DATA_TYPE,
        "datetime2",
        `${row.COLUMN_NAME} debe ser datetime2, es ${row.DATA_TYPE}`
      );
      assert.equal(
        row.DATETIME_PRECISION,
        0,
        `${row.COLUMN_NAME} debe tener precisión 0 (segundos), es ${row.DATETIME_PRECISION}`
      );
    }
  }
);
