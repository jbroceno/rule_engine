import { Router } from "express";

import {
  getRules,
  patchRuleEnabled,
  patchRuleReorder,
  postRule,
  putRule,
  removeRule,
} from "../controllers/admin_rules_controller.js";
import { getParams, postParam, putParam, removeParam } from "../controllers/admin_params_controller.js";
import { getOffers, postOffer, putOffer, removeOffer, removeOfferRulesInPeriod, patchOfferEnabled } from "../controllers/admin_offers_controller.js";
import { postAdminValidate } from "../controllers/admin_validate_controller.js";
import { getAdminExport } from "../controllers/admin_export_controller.js";
import { postAdminApply } from "../controllers/admin_apply_controller.js";
import { getSnapshots, postCreatePocSnapshot, postSnapshotRestore, postWorkflowSnapshot, postWorkflowPublicar, delSnapshot, getSnapshotPreview } from "../controllers/admin_snapshots_controller.js";
import { getFechas, postFecha, putFecha, delFecha, postDuplicateFecha } from "../controllers/admin_fechas_controller.js";

const adminRouter = Router();

adminRouter.get("/offers", getOffers);
adminRouter.post("/offers", postOffer);
adminRouter.put("/offers/:offerCode", putOffer);
// CRITICAL: /offers/:offerCode/rules MUST be registered BEFORE /offers/:offerCode
// so Express does not match the entity-delete route first (T2a.7).
adminRouter.delete("/offers/:offerCode/rules", removeOfferRulesInPeriod);
adminRouter.delete("/offers/:offerCode", removeOffer);
adminRouter.patch("/offers/:offerCode/enabled", patchOfferEnabled);

adminRouter.get("/rules", getRules);
adminRouter.post("/rules", postRule);
adminRouter.put("/rules/:ruleId", putRule);
adminRouter.delete("/rules/:ruleId", removeRule);
adminRouter.patch("/rules/:ruleId/enabled", patchRuleEnabled);
adminRouter.patch("/rules/reorder", patchRuleReorder);

adminRouter.get("/params", getParams);
adminRouter.post("/params", postParam);
adminRouter.put("/params/:paramId", putParam);
adminRouter.delete("/params/:paramId", removeParam);

adminRouter.post("/validate", postAdminValidate);

adminRouter.get("/export", getAdminExport);
adminRouter.post("/config/apply", postAdminApply);

adminRouter.get("/snapshots", getSnapshots);
adminRouter.post("/snapshots", postCreatePocSnapshot);
adminRouter.get("/snapshots/:snapshotId/content", getSnapshotPreview);
adminRouter.post("/snapshots/:snapshotId/restore", postSnapshotRestore);
adminRouter.delete("/snapshots/:snapshotId", delSnapshot);
adminRouter.post("/workflow/snapshot", postWorkflowSnapshot);
adminRouter.post("/workflow/publicar", postWorkflowPublicar);

adminRouter.get("/fechas", getFechas);
adminRouter.post("/fechas", postFecha);
adminRouter.post("/fechas/:fechaId/duplicate", postDuplicateFecha);
adminRouter.put("/fechas/:fechaId", putFecha);
adminRouter.delete("/fechas/:fechaId", delFecha);

export default adminRouter;
