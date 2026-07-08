import { computeDerived, finalize, initcheck, precheck } from "../../rule_engine.js";
import { loadNormalizedConfig } from "../services/config_service.js";
import { validateFinalSimulationPayload, validateInitSimulationPayload, validatePreSimulationPayload } from "../validators/simulate_validator.js";
import { buildWfBody, callWfApi, compareResults } from "../services/wf_compare_service.js";

export async function simulateInit(req, res, next) {
  try {
    validateInitSimulationPayload(req.body);

    const config = await loadNormalizedConfig({
      offerCodes: req.body.offerCodes,
      asOfDate: req.body.asOfDate,
    });

    const result = initcheck(req.body.input, config.offers, config.paramsIndex, {
      debug: req.body.debug === true,
    });

    if (req.body.validateWf && req.body.wfToken) {
      try {
        const wfBody = buildWfBody("INIT", req.body.input, req.body.wfToken, req.body.wfTokenExpCd, null, req.body.wfComunidadAutonoma ?? null, req.body.wfNumPersonaT1 ?? null);
        const wfResult = await callWfApi(wfBody);
        const diff = compareResults("INIT", result, wfResult);
        return res.status(200).json({ ...result, wfCompare: { wf: wfResult, ...diff } });
      } catch (wfError) {
        return res.status(200).json({ ...result, wfCompare: { error: wfError.message } });
      }
    }

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function simulatePre(req, res, next) {
  try {
    validatePreSimulationPayload(req.body);

    const config = await loadNormalizedConfig({
      offerCodes: req.body.offerCodes,
      asOfDate: req.body.asOfDate,
    });

    const debugMode   = req.body.debug   === true;
    const chainedMode = req.body.chained === true;

    const initResult = initcheck(req.body.input, config.offers, config.paramsIndex, { debug: debugMode });

    // En modo no encadenado bloqueamos si ninguna oferta supera INIT.
    if (!chainedMode && (initResult.eligibleOffers ?? []).length === 0) {
      return res.status(200).json({ init: initResult, pre: null });
    }

    const preResult = precheck(req.body.input, config.offers, config.paramsIndex, {
      debug: debugMode,
      chained: chainedMode,
    });

    const envelope = { init: initResult, pre: preResult };

    if (req.body.validateWf && req.body.wfToken) {
      try {
        const wfBody = buildWfBody("PRE", req.body.input, req.body.wfToken, req.body.wfTokenExpCd, null, req.body.wfComunidadAutonoma ?? null, req.body.wfNumPersonaT1 ?? null, req.body.wfNumPersonaT2 ?? null);
        const wfResult = await callWfApi(wfBody);
        const diff = compareResults("PRE", envelope, wfResult);
        return res.status(200).json({ ...envelope, wfCompare: { wf: wfResult, ...diff } });
      } catch (wfError) {
        return res.status(200).json({ ...envelope, wfCompare: { error: wfError.message } });
      }
    }

    res.status(200).json(envelope);
  } catch (error) {
    next(error);
  }
}

export async function simulateFinal(req, res, next) {
  try {
    validateFinalSimulationPayload(req.body);

    const config = await loadNormalizedConfig({
      offerCodes: req.body.offerCodes,
      asOfDate: req.body.asOfDate,
    });

    const debugMode   = req.body.debug   === true;
    const chainedMode = req.body.chained === true;

    const initResult = initcheck(req.body.preInput, config.offers, config.paramsIndex, { debug: debugMode });

    // En modo no encadenado bloqueamos si ninguna oferta supera INIT o PRE.
    if (!chainedMode && (initResult.eligibleOffers ?? []).length === 0) {
      return res.status(200).json({ init: initResult, pre: null, final: null });
    }

    // preResult con chaining ya propaga fallos de INIT por oferta.
    const preResult = precheck(req.body.preInput, config.offers, config.paramsIndex, {
      debug: debugMode,
      chained: chainedMode,
    });

    if (!chainedMode && (preResult.eligibleOffers ?? []).length === 0) {
      return res.status(200).json({ init: initResult, pre: preResult, final: null });
    }

    const finalInput = computeDerived({
      ...req.body.preInput,
      ...req.body.finalInput,
    });

    // preResult ya tiene el chaining aplicado; finalize lo usa directamente.
    const finalResult = finalize(finalInput, config.offers, config.paramsIndex, preResult, { debug: debugMode });

    const envelope = { init: initResult, pre: preResult, final: finalResult };

    if (req.body.validateWf && req.body.wfToken) {
      try {
        const wfBody = buildWfBody("FINAL", req.body.preInput, req.body.wfToken, req.body.wfTokenExpCd, req.body.finalInput, req.body.wfComunidadAutonoma ?? null, req.body.wfNumPersonaT1 ?? null, req.body.wfNumPersonaT2 ?? null);
        const wfResult = await callWfApi(wfBody);
        const diff = compareResults("FINAL", envelope, wfResult);
        return res.status(200).json({ ...envelope, wfCompare: { wf: wfResult, ...diff } });
      } catch (wfError) {
        return res.status(200).json({ ...envelope, wfCompare: { error: wfError.message } });
      }
    }

    res.status(200).json(envelope);
  } catch (error) {
    next(error);
  }
}
