import { validateRuleParamReferences } from "../services/admin_service.js";
import { runValidationPreview, validateAdminValidatePayload } from "../validators/admin_validator.js";

export async function postAdminValidate(req, res, next) {
  try {
    const { entity, payload } = validateAdminValidatePayload(req.body);
    const errors = runValidationPreview(entity, payload);
    const referenceErrors = entity === "rule" ? await validateRuleParamReferences(payload) : [];
    const mergedErrors = [...errors, ...referenceErrors];

    res.status(200).json({
      valid: mergedErrors.length === 0,
      errors: mergedErrors,
      warnings: [],
    });
  } catch (error) {
    next(error);
  }
}
