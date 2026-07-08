import {
  listFechas,
  createFecha,
  updateFecha,
  deleteFecha,
  duplicateFecha,
} from "../services/admin_fechas_service.js";
import { validateFechaCreatePayload, validateFechaUpdatePayload } from "../validators/admin_validator.js";

export async function getFechas(req, res, next) {
  try {
    const result = await listFechas();
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function postFecha(req, res, next) {
  try {
    validateFechaCreatePayload(req.body);
    const result = await createFecha(req.body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function putFecha(req, res, next) {
  try {
    const id = Number(req.params.fechaId);
    validateFechaUpdatePayload(req.body);
    const result = await updateFecha(id, req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function delFecha(req, res, next) {
  try {
    const id = Number(req.params.fechaId);
    const result = await deleteFecha(id);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function postDuplicateFecha(req, res, next) {
  try {
    const sourceId = Number(req.params.fechaId);
    const { valid_from } = req.body;
    if (!valid_from) {
      return res.status(400).json({ error: "valid_from es obligatorio." });
    }
    const result = await duplicateFecha(sourceId, valid_from);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}
