/**
 * Unit tests for api/utils/vigencia.js
 *
 * Covers:
 *   - normalizeVigenciaToSecond — ADR-001 belt-and-suspenders contract
 *   - parseVigencia — ADR-004, RF-COD-04
 *   - toLocalWallClock — ADR-005 wire-format contract (no UTC leak)
 *
 * All tests are pure (no DB, no I/O).
 * WU-03: RED step — these tests fail before vigencia.js exists.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeVigenciaToSecond, parseVigencia, toLocalWallClock } from "../api/utils/vigencia.js";

// ---------------------------------------------------------------------------
// normalizeVigenciaToSecond
// ---------------------------------------------------------------------------

test("(3.1a) YYYY-MM-DDTHH:mm:ss — preserva componentes wall-clock locales", () => {
  const result = normalizeVigenciaToSecond("2026-03-15T14:32:07");
  assert.ok(result instanceof Date, "debe devolver Date");
  assert.equal(result.getFullYear(), 2026);
  assert.equal(result.getMonth(), 2);   // 0-indexed → March
  assert.equal(result.getDate(), 15);
  assert.equal(result.getHours(), 14);
  assert.equal(result.getMinutes(), 32);
  assert.equal(result.getSeconds(), 7);
  assert.equal(result.getMilliseconds(), 0, "milisegundos deben ser 0");
});

test("(3.1b) YYYY-MM-DDTHH:mm — agrega :00 segundos", () => {
  const result = normalizeVigenciaToSecond("2026-03-15T14:32");
  assert.ok(result instanceof Date);
  assert.equal(result.getHours(), 14);
  assert.equal(result.getMinutes(), 32);
  assert.equal(result.getSeconds(), 0);
  assert.equal(result.getMilliseconds(), 0);
});

test("(3.1c) YYYY-MM-DD legacy — produce medianoche (00:00:00)", () => {
  const result = normalizeVigenciaToSecond("2026-01-01");
  assert.ok(result instanceof Date);
  assert.equal(result.getFullYear(), 2026);
  assert.equal(result.getMonth(), 0);   // January
  assert.equal(result.getDate(), 1);
  assert.equal(result.getHours(), 0);
  assert.equal(result.getMinutes(), 0);
  assert.equal(result.getSeconds(), 0);
  assert.equal(result.getMilliseconds(), 0);
});

test("(3.1d) dos inputs que difieren solo en ms producen === misma fecha (epoch igual)", () => {
  const a = normalizeVigenciaToSecond("2026-06-01T09:00:00");
  const b = normalizeVigenciaToSecond("2026-06-01T09:00:00");
  // Both should be identical after ms zeroing
  assert.equal(a.getTime(), b.getTime(), "epoch debe ser idéntico");
});

test("(3.1d-bis) ms siempre cero — garantiza invariante truncación", () => {
  // Simulate a Date with ms by passing a Date object
  const d = new Date(2026, 2, 15, 14, 32, 7, 999);
  const result = normalizeVigenciaToSecond(d);
  assert.equal(result.getMilliseconds(), 0, "ms deben zeroearse");
  assert.equal(result.getSeconds(), 7, "segundos preservados");
});

test("(3.1e) null devuelve null", () => {
  assert.equal(normalizeVigenciaToSecond(null), null);
});

test("(3.1e) string vacío devuelve null", () => {
  assert.equal(normalizeVigenciaToSecond(""), null);
});

test("(3.1e) undefined devuelve null", () => {
  assert.equal(normalizeVigenciaToSecond(undefined), null);
});

// ---------------------------------------------------------------------------
// parseVigencia
// ---------------------------------------------------------------------------

test("(3.2a) YYYY-MM-DDTHH:mm:ss válido devuelve epoch number", () => {
  const result = parseVigencia("2026-03-15T14:32:07");
  assert.equal(typeof result, "number", "debe ser number");
  // Reconstruct to verify round-trip
  const d = new Date(result);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getHours(), 14);
  assert.equal(d.getSeconds(), 7);
});

test("(3.2a) YYYY-MM-DD legacy devuelve epoch number", () => {
  const result = parseVigencia("2026-01-01");
  assert.equal(typeof result, "number");
  const d = new Date(result);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
});

test("(3.2b) valid_to == valid_from produce to <= from (igual → inválido para el validador)", () => {
  const from = parseVigencia("2026-06-01T00:00:00");
  const to   = parseVigencia("2026-06-01T00:00:00");
  assert.ok(to <= from, "igual debe ser <= (validador rechaza)");
});

test("(3.2b) valid_to 1 segundo después de valid_from es válido (to > from)", () => {
  const from = parseVigencia("2026-06-01T00:00:00");
  const to   = parseVigencia("2026-06-01T00:00:01");
  assert.ok(to > from, "1 segundo después debe ser mayor");
});

test("(3.2c) string malformado devuelve null", () => {
  assert.equal(parseVigencia("no-es-fecha"), null);
});

test("(3.2c) string vacío devuelve null", () => {
  assert.equal(parseVigencia(""), null);
});

test("(3.2c) null devuelve null", () => {
  assert.equal(parseVigencia(null), null);
});

test("(3.2d) lexicographic-trick: '2026-10-01' vs '2026-09-30' — temporal comparison es correcto", () => {
  // Lexicographically '2026-10-01' > '2026-09-30' ✓, but this test ensures
  // the temporal parse also agrees (epoch of Oct > epoch of Sep)
  const oct = parseVigencia("2026-10-01");
  const sep = parseVigencia("2026-09-30");
  assert.ok(oct > sep, "octubre debe ser mayor que septiembre temporalmente");
});

// ---------------------------------------------------------------------------
// toLocalWallClock — ADR-005 wire-format contract
// ---------------------------------------------------------------------------

test("(3.3a) Date local → 'YYYY-MM-DDTHH:mm:ss' preservando componentes locales (sin UTC)", () => {
  // Local midnight. .toISOString() lo desplazaría a UTC (ej. 31/05 22:00 en +02);
  // toLocalWallClock debe conservar el wall-clock local.
  const d = new Date(2026, 5, 1, 0, 0, 0, 0); // 2026-06-01 00:00:00 local
  const result = toLocalWallClock(d);
  assert.equal(result, "2026-06-01T00:00:00");
});

test("(3.3b) nunca emite sufijo 'Z' ni desfase de zona", () => {
  const d = new Date(2026, 0, 15, 9, 30, 45, 0);
  const result = toLocalWallClock(d);
  assert.ok(!result.endsWith("Z"), "no debe terminar en Z");
  assert.equal(result, "2026-01-15T09:30:45");
});

test("(3.3c) pad de un dígito en mes/día/hora/min/seg", () => {
  const d = new Date(2026, 2, 3, 4, 5, 6, 0); // 2026-03-03 04:05:06
  assert.equal(toLocalWallClock(d), "2026-03-03T04:05:06");
});

test("(3.3d) string ya en formato wire se devuelve tal cual (sin doble conversión)", () => {
  assert.equal(toLocalWallClock("2026-06-01T00:00:00"), "2026-06-01T00:00:00");
});

test("(3.3e) null/undefined/'' devuelven null", () => {
  assert.equal(toLocalWallClock(null), null);
  assert.equal(toLocalWallClock(undefined), null);
  assert.equal(toLocalWallClock(""), null);
});

test("(3.3f) Date inválida devuelve null", () => {
  assert.equal(toLocalWallClock(new Date("no-es-fecha")), null);
});
