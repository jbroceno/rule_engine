import { applyConfig, computeApplyImpact, createSnapshot } from "../services/admin_service.js";
import { AppError } from "../utils/app_error.js";

function validateRulesShape(payload) {
  if (!payload || !Array.isArray(payload.rules)) {
    throw new AppError('El payload debe contener un campo "rules" de tipo array.', 400);
  }
  if (payload.rules.length === 0) {
    throw new AppError('El campo "rules" no puede estar vacio.', 400);
  }
  if (payload.params !== undefined && !Array.isArray(payload.params)) {
    throw new AppError('El campo "params" debe ser un array o estar ausente.', 400);
  }
  for (let i = 0; i < payload.rules.length; i++) {
    const rule = payload.rules[i];
    if (!rule.offerCode || typeof rule.offerCode !== "string") {
      throw new AppError(`rules[${i}].offerCode es requerido.`, 400);
    }
    if (!rule.rule_name || typeof rule.rule_name !== "string") {
      throw new AppError(`rules[${i}].rule_name es requerido.`, 400);
    }
    if (!Array.isArray(rule.conditions)) {
      throw new AppError(`rules[${i}].conditions debe ser un array.`, 400);
    }
    if (!Array.isArray(rule.actions)) {
      throw new AppError(`rules[${i}].actions debe ser un array.`, 400);
    }
  }
}

// Exported for unit testing (T-05) — validates the shape shared by both the
// real apply and its read-only preview, WITHOUT requiring comment/confirmReplaceAll.
export function validatePreviewPayload(payload) {
  validateRulesShape(payload);
}

// Exported for unit testing (T-05). Requires everything validatePreviewPayload
// requires, PLUS the comment and the explicit confirmReplaceAll:true gate
// (OWASP-02) — both MUST run before any snapshot/DB write.
export function validateApplyPayload(payload) {
  validateRulesShape(payload);
  if (payload.confirmReplaceAll !== true) {
    throw new AppError(
      "Debes confirmar el reemplazo total de la configuración (confirmReplaceAll).",
      400
    );
  }
  if (!payload.comment || typeof payload.comment !== "string" || !payload.comment.trim()) {
    throw new AppError('El motivo (comment) es requerido para grabar la configuracion.', 400);
  }
}

export async function postAdminApply(req, res, next) {
  try {
    validateApplyPayload(req.body);

    const { comment, createdBy, rules, params } = req.body;

    // 1. Snapshot of current state before replacing
    const date = new Date().toISOString().replace("T", " ").substring(0, 16);
    const snapshotName = `Grabacion ${date}`;
    const snapshotId = await createSnapshot(
      snapshotName,
      comment.trim(),
      typeof createdBy === "string" ? createdBy.trim() || null : null
    );

    // 2. Apply the new config — full replace across all periods
    const result = await applyConfig({ rules, params }, { deleteAllPeriods: true });

    res.status(200).json({ ...result, snapshot_id: snapshotId });
  } catch (error) {
    next(error);
  }
}

// Read-only preview of what postAdminApply's applyConfig({deleteAllPeriods:true})
// would delete/insert — no comment/confirmReplaceAll required, no DB write, no
// snapshot created (OWASP-02).
export async function postAdminApplyPreview(req, res, next) {
  try {
    validatePreviewPayload(req.body);

    const { rules, params } = req.body;
    const impact = await computeApplyImpact({ rules, params }, { deleteAllPeriods: true });

    res.status(200).json(impact);
  } catch (error) {
    next(error);
  }
}
