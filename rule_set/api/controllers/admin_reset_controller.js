/**
 * api/controllers/admin_reset_controller.js — POST /api/admin/config/reset-seed
 *
 * DI design (mirrors ADR-A2 / auth_controller.js's createLoginHandler): a
 * createResetSeedHandler({ createSnapshot, resetToSeed, env }) factory lets
 * tests inject fakes for the service calls and the feature flag without a
 * live DB or real env vars. The default singleton `postAdminResetSeed` is
 * wired to the real dependencies and used by admin_routes.js unchanged.
 */
import { createSnapshot as defaultCreateSnapshot, resetToSeed as defaultResetToSeed } from "../services/admin_service.js";
import { AppError } from "../utils/app_error.js";
import { env as defaultEnv } from "../config/env.js";

/**
 * Factory that returns the reset-seed Express handler bound to injected deps.
 *
 * @param {object} [opts]
 * @param {Function} [opts.createSnapshot]
 * @param {Function} [opts.resetToSeed]
 * @param {{ enableSeedReset: boolean }} [opts.env]
 * @returns {import('express').RequestHandler}
 */
export function createResetSeedHandler({
  createSnapshot = defaultCreateSnapshot,
  resetToSeed = defaultResetToSeed,
  env = defaultEnv,
} = {}) {
  /**
   * POST /api/admin/config/reset-seed
   * Body: { comment: string (required), createdBy?: string }
   * Response 200: { applied, offerCodes, snapshot_id, offer_date_id, removedOfferCodes, removedPeriodCount }
   * Response 400: missing/blank comment
   * Response 404: feature flag disabled — generic, via app's notFoundHandler
   *   (next() called with NO argument), indistinguishable from an unknown route.
   */
  return async function resetSeedHandler(req, res, next) {
    try {
      // Feature flag check MUST run first, before any payload validation — a
      // 400 for a bad body would still leak that this route exists.
      if (!env.enableSeedReset) {
        return next();
      }

      const comment = req.body?.comment;
      if (!comment || typeof comment !== "string" || !comment.trim()) {
        throw new AppError('El motivo (comment) es requerido para restaurar la configuracion semilla.', 400);
      }

      const { createdBy } = req.body;

      // 1. Snapshot of current state before replacing (same pattern as postAdminApply).
      const date = new Date().toISOString().replace("T", " ").substring(0, 16);
      const snapshotName = `Reset semilla ${date}`;
      const snapshotId = await createSnapshot(
        snapshotName,
        comment.trim(),
        typeof createdBy === "string" ? createdBy.trim() || null : null
      );

      // 2. Full-scope reset to the 6-offer seed configuration.
      const result = await resetToSeed({ createdBy });

      res.status(200).json({ ...result, snapshot_id: snapshotId });
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Default singleton handler — used by admin_routes.js.
 * Wired to the real admin_service functions and the real env.
 */
export const postAdminResetSeed = createResetSeedHandler();
