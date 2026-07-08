/**
 * api/controllers/auth_controller.js — Login endpoint
 *
 * PITFALL (CJS interop): jsonwebtoken ships CommonJS. Under type:module use
 * the default import — named imports do NOT resolve under ESM interop.
 *
 * Security design (ADR-A5): missing email, unknown email, wrong password, and
 * disabled user ALL return the same generic 401 "Credenciales inválidas." to
 * prevent user-enumeration leaks. The 400 path is reserved for structural
 * request errors (missing fields) to help the caller fix their request.
 *
 * DI design (ADR-A2): createLoginHandler({ userService, sign }) factory lets
 * tests inject a fake userService and a fake sign function without hitting a
 * live DB or requiring a real JWT_SECRET. The default singleton `login` is
 * wired to the real dependencies and used by auth_routes.js unchanged.
 */
import jwt from "jsonwebtoken"; // default import required — CJS interop
import { env } from "../config/env.js";
import { AppError } from "../utils/app_error.js";
import { userService as defaultUserService } from "../services/user_service.js";

/**
 * Factory that returns the login Express handler bound to injected dependencies.
 * Tests inject fake userService / sign; production uses real defaults.
 *
 * @param {object} [opts]
 * @param {{ findUserByEmail: Function, verifyPassword: Function }} [opts.userService]
 * @param {(payload: object, secret: string, options: object) => string} [opts.sign]
 * @returns {import('express').RequestHandler}
 */
export function createLoginHandler({
  userService = defaultUserService,
  sign = (payload, secret, options) => jwt.sign(payload, secret, options),
} = {}) {
  /**
   * POST /api/auth/login
   * Body: { email: string, password: string }
   * Response 200: { token: string, expiresIn: string }
   * Response 400: missing/malformed body
   * Response 401: invalid credentials (unified — no user-existence leak)
   */
  return async function loginHandler(req, res, next) {
    try {
      const { email, password } = req.body ?? {};

      if (!email || !password) {
        throw new AppError("Email y contraseña son obligatorios.", 400);
      }

      // findUserByEmail already filters enabled = 1 (disabled users return null).
      const user = await userService.findUserByEmail(email);

      // Single generic 401 whether user is null (not found / disabled) OR password
      // is wrong. This prevents callers from distinguishing between the two cases
      // (user-enumeration mitigation, ADR-A5).
      const ok = user
        ? await userService.verifyPassword(password, user.password_hash)
        : false;

      if (!ok) {
        throw new AppError("Credenciales inválidas.", 401);
      }

      const token = sign(
        { sub: user.user_id, email: user.email, role: user.role },
        env.auth.jwtSecret,
        { expiresIn: env.auth.jwtExpiresIn }
      );

      res.status(200).json({ token, expiresIn: env.auth.jwtExpiresIn });
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Default singleton login handler — used by auth_routes.js.
 * Wired to the real userService and jwt.sign with env config.
 * auth_routes.js imports this named export and does NOT need to change.
 */
export const login = createLoginHandler();
