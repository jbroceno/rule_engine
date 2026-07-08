import { loadNormalizedConfig } from "../services/config_service.js";
import { initcheck, precheck, computeDerived, finalize } from "../../rule_engine.js";
import { adaptWorkflowToMotor, adaptMotorToWorkflow } from "../services/workflow_adapter.js";
import { AppError } from "../utils/app_error.js";

export async function postCondicionesHipotecas(req, res, next) {
  try {
    const body = req.body;
    if (!body || typeof body !== "object") {
      throw new AppError("El body debe ser un objeto JSON.", 400);
    }

    const faseCd = String(body.faseCd ?? "").toUpperCase();
    if (!["INIT", "PRE", "FINAL"].includes(faseCd)) {
      throw new AppError("FASE_CD debe ser INIT, PRE o FINAL.", 400);
    }

    const motorInput = adaptWorkflowToMotor(body);
    const { offers, paramsIndex } = await loadNormalizedConfig({});

    let motorResult;
    if (faseCd === "INIT") {
      const result = initcheck(motorInput, offers, paramsIndex);
      motorResult = { eligibleOffers: result.eligibleOffers, uiLimits: null, winner: null };
    } else if (faseCd === "PRE") {
      const inputWithDerived = { ...motorInput, ...computeDerived(motorInput) };
      const result = precheck(inputWithDerived, offers, paramsIndex);
      motorResult = { eligibleOffers: result.eligibleOffers, uiLimits: result.uiLimits, winner: null };
    } else {
      const inputWithDerived = { ...motorInput, ...computeDerived(motorInput) };
      const preResult = precheck(inputWithDerived, offers, paramsIndex);
      const finalResult = finalize(inputWithDerived, offers, paramsIndex, preResult);
      motorResult = { eligibleOffers: preResult.eligibleOffers, uiLimits: preResult.uiLimits, winner: finalResult.winner };
    }

    res.status(200).json(adaptMotorToWorkflow(motorResult));
  } catch (error) {
    next(error);
  }
}
