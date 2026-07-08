import { exportConfig } from "../services/admin_service.js";

export async function getAdminExport(req, res, next) {
  try {
    const config = await exportConfig();
    res.status(200).json(config);
  } catch (error) {
    next(error);
  }
}
