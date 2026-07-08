/**
 * api/services/user_service.js — User lookup and password verification
 *
 * Uses a DI factory (createUserService) so tests can inject a fake pool
 * and a fake compare without requiring a live DB or mock.module.
 *
 * PITFALL (CJS interop): bcryptjs ships CommonJS. Under type:module use the
 * default import — named imports (`import { compare } from "bcryptjs"`) do NOT
 * resolve under ESM interop and would silently be undefined.
 */
import bcrypt from "bcryptjs"; // default import required — CJS interop
import { getSqlPool, sql } from "../db/sql_client.js";

/**
 * Factory that returns a user-service bound to the given pool getter and
 * password-compare function. Exported for testing with injected fakes.
 *
 * @param {object} [opts]
 * @param {() => Promise<import('mssql').ConnectionPool>} [opts.poolGetter]
 * @param {(plain: string, hash: string) => Promise<boolean>} [opts.compare]
 */
export function createUserService({
  poolGetter = getSqlPool,
  compare = bcrypt.compare.bind(bcrypt),
} = {}) {
  /**
   * Find an enabled user by email.
   * Returns the row object or null if not found / invalid email.
   * The query already filters enabled = 1, so disabled users return null.
   *
   * @param {string|null|undefined} email
   * @returns {Promise<object|null>}
   */
  async function findUserByEmail(email) {
    if (!email || typeof email !== "string") return null;
    const pool = await poolGetter();
    const result = await pool
      .request()
      .input("email", sql.NVarChar(200), email.trim())
      .query(
        `SELECT TOP 1 user_id, email, password_hash, role, enabled
         FROM dbo.cfg_user
         WHERE email = @email AND enabled = 1`
      );
    return result.recordset?.[0] ?? null;
  }

  /**
   * Verify a plaintext password against a bcrypt hash.
   * Returns false immediately if either argument is falsy.
   *
   * @param {string|null|undefined} plain
   * @param {string|null|undefined} hash
   * @returns {Promise<boolean>}
   */
  async function verifyPassword(plain, hash) {
    if (!plain || !hash) return false;
    return compare(plain, hash); // bcryptjs.compare returns a Promise<boolean>
  }

  return { findUserByEmail, verifyPassword };
}

/** Default singleton — used by auth_controller. */
export const userService = createUserService();

/** Named re-exports for callers that only need individual functions. */
export const { findUserByEmail, verifyPassword } = userService;
