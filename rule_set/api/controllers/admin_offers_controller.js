import {
  createOffer,
  deleteOffer,
  deleteRulesForOfferInPeriod,
  listOffers,
  listOffersInPeriod,
  setOfferEnabled,
  updateOffer,
} from "../services/admin_service.js";
import { AppError } from "../utils/app_error.js";

export async function getOffers(req, res, next) {
  try {
    const offerDateId = req.query.offerDateId ? Number(req.query.offerDateId) : null;
    const payload = (offerDateId && offerDateId > 0)
      ? await listOffersInPeriod(offerDateId)
      : await listOffers();
    res.status(200).json(payload);
  } catch (error) {
    next(error);
  }
}

export async function postOffer(req, res, next) {
  try {
    const { code, name, offer_rank, enabled, oferta_id } = req.body ?? {};
    if (typeof code !== "string" || !code.trim()) {
      throw new AppError("code es obligatorio.", 400);
    }
    if (typeof name !== "string" || !name.trim()) {
      throw new AppError("name es obligatorio.", 400);
    }
    const created = await createOffer({
      code,
      name,
      offer_rank: offer_rank ?? 0,
      enabled: enabled !== false,
      oferta_id: oferta_id ?? 0,
    });
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
}

export async function putOffer(req, res, next) {
  try {
    const { offerCode } = req.params;
    if (!offerCode) {
      throw new AppError("offerCode es obligatorio.", 400);
    }
    const updated = await updateOffer(offerCode, req.body ?? {});
    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
}

export async function removeOffer(req, res, next) {
  try {
    const { offerCode } = req.params;
    const createdBy = req.query.createdBy ?? null;
    const result = await deleteOffer(offerCode, createdBy);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function removeOfferRulesInPeriod(req, res, next) {
  try {
    const { offerCode } = req.params;
    const offerDateId = req.query.offerDateId ? Number(req.query.offerDateId) : null;
    if (!offerDateId || offerDateId <= 0) {
      throw new AppError("offerDateId es obligatorio.", 400);
    }
    const createdBy = req.query.createdBy ?? null;
    const result = await deleteRulesForOfferInPeriod(offerCode, offerDateId, createdBy);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function patchOfferEnabled(req, res, next) {
  try {
    const { offerCode } = req.params;
    const { enabled } = req.body ?? {};
    if (typeof enabled !== "boolean") {
      throw new AppError("enabled debe ser booleano.", 400);
    }
    const result = await setOfferEnabled(offerCode, enabled);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
