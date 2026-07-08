/**
 * Vigencia datetime utilities.
 *
 * All functions are pure (no DB, no I/O) — unit-testable without mocks.
 *
 * Invariant (ADR-001): every vigencia Date produced here has milliseconds = 0
 * and is parsed as LOCAL wall-clock (never UTC). This matches what SQL Server
 * stores via DATETIME2(0) with useUTC:false — the wall-clock the user typed is
 * the wall-clock stored.
 */

/**
 * Parse a vigencia string into its numeric components from a fixed-width pattern.
 * Returns null if the input does not match YYYY-MM-DD[THH[:mm[:ss]]].
 *
 * @param {string} s
 * @returns {{ y:number, mo:number, d:number, h:number, mi:number, s:number }|null}
 */
function parseComponents(s) {
  if (typeof s !== "string" || !s.trim()) return null;

  // Accepted formats (all local wall-clock):
  //   YYYY-MM-DDTHH:mm:ss   (full second precision)
  //   YYYY-MM-DDTHH:mm      (minute precision — seconds default to 0)
  //   YYYY-MM-DD            (legacy date — time defaults to 00:00:00)
  const re = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2})(?::(\d{2})(?::(\d{2}))?)?)?$/;
  const m = re.exec(s.trim());
  if (!m) return null;

  const y  = Number(m[1]);
  const mo = Number(m[2]);
  const d  = Number(m[3]);
  const h  = Number(m[4] ?? 0);
  const mi = Number(m[5] ?? 0);
  const sc = Number(m[6] ?? 0);

  // Basic sanity guards
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > 31) return null;
  if (h > 23 || mi > 59 || sc > 59) return null;

  return { y, mo, d, h, mi, s: sc };
}

/**
 * Normalize a vigencia value to a second-truncated local-wall-clock Date.
 *
 * Accepts:
 *   - Date object      → milliseconds zeroed, same local components
 *   - "YYYY-MM-DDTHH:mm:ss" → local wall-clock, ms = 0
 *   - "YYYY-MM-DDTHH:mm"    → local wall-clock, seconds = 0, ms = 0
 *   - "YYYY-MM-DD"          → local midnight, ms = 0
 *   - null / "" / undefined → null (represents open-ended hasta)
 *
 * NEVER uses new Date("...Z") or toISOString() — those convert to UTC.
 *
 * @param {Date|string|null|undefined} value
 * @returns {Date|null}
 */
export function normalizeVigenciaToSecond(value) {
  if (value == null) return null;

  if (value instanceof Date) {
    const d = new Date(value.getTime());
    d.setMilliseconds(0);
    return d;
  }

  if (typeof value === "string") {
    if (!value.trim()) return null;
    const c = parseComponents(value);
    if (!c) return null;
    // Construct as local time — NOT UTC
    const d = new Date(c.y, c.mo - 1, c.d, c.h, c.mi, c.s, 0);
    return d;
  }

  return null;
}

/**
 * Format a value as a local wall-clock string "YYYY-MM-DDTHH:mm:ss".
 *
 * The mssql driver (useUTC:false) returns DATETIME2 columns as JS Date objects
 * holding the local wall-clock the user stored. If those Dates reach res.json()
 * untouched, JSON.stringify serializes them via .toISOString() — converting to
 * UTC and appending "Z", which breaks the local-wall-clock wire contract
 * (ADR-005) the frontend relies on. Use this on every vigencia Date BEFORE it
 * leaves the API so the wire format stays naked local wall-clock (no "Z").
 *
 * NEVER uses .toISOString() — that would convert to UTC.
 *
 * @param {Date|string|null|undefined} value
 * @returns {string|null}
 */
export function toLocalWallClock(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    // Already a wire string — return as-is (no double conversion).
    return value.trim() ? value : null;
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;

  const p = (n) => String(n).padStart(2, "0");
  const y = value.getFullYear();
  const mo = p(value.getMonth() + 1);
  const d = p(value.getDate());
  const h = p(value.getHours());
  const mi = p(value.getMinutes());
  const s = p(value.getSeconds());
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

/**
 * Parse a vigencia string and return its epoch milliseconds (number), or null
 * on invalid/empty input.
 *
 * Used by admin_validator.js for temporal comparison (ADR-004):
 *   parseVigencia(to) <= parseVigencia(from)  → reject
 *
 * @param {string|null|undefined} str
 * @returns {number|null}
 */
export function parseVigencia(str) {
  if (str == null) return null;
  if (typeof str !== "string" || !str.trim()) return null;
  const d = normalizeVigenciaToSecond(str);
  if (!d) return null;
  return d.getTime();
}
