import { createSnapshot, listSnapshots, restoreSnapshot, deleteSnapshot, getSnapshotContent } from "../services/admin_service.js";
import { createWorkflowSnapshot, publishCfgToWorkflow, buildWfSafetySnapshotComment } from "../services/admin_workflow_service.js";
import { validateEntornoCd } from "../validators/admin_validator.js";
import { AppError } from "../utils/app_error.js";

function parseSnapshotId(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError("snapshotId debe ser entero positivo.", 400);
  }
  return parsed;
}

export function parseOfertaIdOverrides(value) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (Array.isArray(value) || typeof value !== "object") {
    throw new AppError(
      "ofertaIdOverrides debe ser un objeto de {offerCode: oferta_id} con enteros positivos.",
      400,
    );
  }
  for (const [key, val] of Object.entries(value)) {
    if (!key || typeof key !== "string") {
      throw new AppError(
        "ofertaIdOverrides debe ser un objeto de {offerCode: oferta_id} con enteros positivos.",
        400,
      );
    }
    if (!Number.isInteger(val) || val < 1) {
      throw new AppError(
        "ofertaIdOverrides debe ser un objeto de {offerCode: oferta_id} con enteros positivos.",
        400,
      );
    }
  }
  return value;
}

export async function getSnapshots(req, res, next) {
  try {
    const { dateFrom, dateTo, q, entorno, page, pageSize } = req.query;
    const filters = {
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      q: q || undefined,
      entorno: entorno || undefined,
      page: page ? Math.max(1, Number(page)) : 1,
      pageSize: pageSize ? Math.min(100, Math.max(1, Number(pageSize))) : 20,
    };
    const result = await listSnapshots(filters);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function postCreatePocSnapshot(req, res, next) {
  try {
    const body = req.body ?? {};
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    if (!comment) {
      throw new AppError("El campo 'comment' es requerido.", 400);
    }
    const createdBy = typeof body.createdBy === "string" ? body.createdBy.trim() || null : null;
    const date = new Date().toISOString().replace("T", " ").substring(0, 16);
    const name = `POC Snapshot ${date}`;
    const snapshotId = await createSnapshot(name, comment, createdBy);
    res.status(201).json({ snapshot_id: snapshotId, snapshot_name: name });
  } catch (error) {
    next(error);
  }
}

export async function postSnapshotRestore(req, res, next) {
  try {
    const snapshotId = parseSnapshotId(req.params.snapshotId);
    const body = req.body ?? {};
    const createdBy = typeof body.createdBy === "string" ? body.createdBy.trim() || null : null;
    // Scenario 13: reject any destino outside {POC, WF} with HTTP 400.
    const destino = validateEntornoCd(typeof body.destino === "string" ? body.destino.toUpperCase() : "POC");
    const rangoDestino = body.rangoDestino ?? undefined;
    // Overrides apply both to WF publish (offerCode → WF oferta_id) and to
    // WF→POC restore (POC code → snapshot oferta_id, to reconcile id drift).
    const ofertaIdOverrides = parseOfertaIdOverrides(body.ofertaIdOverrides);
    const pocFechaDesde = typeof body.pocFechaDesde === "string" ? body.pocFechaDesde.trim() || undefined : undefined;
    const result = await restoreSnapshot(snapshotId, { createdBy, destino, rangoDestino, ofertaIdOverrides, pocFechaDesde });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function postWorkflowSnapshot(req, res, next) {
  try {
    const body = req.body ?? {};
    const vigDesde = body.vigDesde ?? null;
    const vigHasta = body.vigHasta ?? null;
    const createdBy = typeof body.createdBy === "string" ? body.createdBy.trim() || null : null;
    const result = await createWorkflowSnapshot(vigDesde, vigHasta, createdBy);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getSnapshotPreview(req, res, next) {
  try {
    const snapshotId = parseSnapshotId(req.params.snapshotId);
    const result = await getSnapshotContent(snapshotId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function delSnapshot(req, res, next) {
  try {
    const snapshotId = parseSnapshotId(req.params.snapshotId);
    const result = await deleteSnapshot(snapshotId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

function parseTipoDs(value) {
  const ALLOWED = new Set(["REGLAS", "PARAMS", "AMBOS"]);
  if (value === undefined || value === null) return "AMBOS"; // default
  const upper = String(value).toUpperCase();
  if (!ALLOWED.has(upper)) {
    throw new AppError(`tipoDs debe ser REGLAS, PARAMS o AMBOS. Recibido: ${value}`, 400);
  }
  return upper;
}

export async function postWorkflowPublicar(req, res, next) {
  try {
    const body = req.body ?? {};
    const offerDateId = Number(body.offerDateId);
    if (!Number.isInteger(offerDateId) || offerDateId <= 0) {
      throw new AppError("offerDateId es obligatorio y debe ser entero positivo.", 400);
    }
    const rangoDestino = body.rangoDestino;
    if (!rangoDestino?.vigDesde) {
      throw new AppError("rangoDestino.vigDesde es obligatorio.", 400);
    }
    const createdBy = typeof body.createdBy === "string" ? body.createdBy.trim() || null : null;
    const ofertaIdOverrides = parseOfertaIdOverrides(body.ofertaIdOverrides);
    const tipoDs = parseTipoDs(body.tipoDs);

    // W-2: safety snapshot — capture current WF state before overwriting.
    // createWorkflowSnapshot reads from WF DB via SP; vigDesde/vigHasta = null
    // means "full WF dump" which is the safest baseline.
    const safetyComment = buildWfSafetySnapshotComment(rangoDestino);
    const safetySnapshot = await createWorkflowSnapshot(null, null, createdBy);

    const result = await publishCfgToWorkflow(offerDateId, rangoDestino, { ofertaIdOverrides, tipoDs });
    res.status(200).json({ ...result, prePublishSnapshotId: safetySnapshot.snapshot_id, safetyComment });
  } catch (error) {
    next(error);
  }
}
