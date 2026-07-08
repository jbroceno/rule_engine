import express from "express";

import apiRoutes from "./routes/index.js";
import { authMiddleware } from "./middleware/auth_middleware.js";
import { errorHandler } from "./middleware/error_handler.js";
import { notFoundHandler } from "./middleware/not_found.js";

export function createApp() {
  const app = express();

  // 1. Parse JSON bodies first — authMiddleware may need req.body in future.
  app.use(express.json({ limit: "1mb" }));

  // 2. Auth middleware at app-root (AFTER json, BEFORE /api routes).
  //    Public paths (GET /api/health, POST /api/auth/login) bypass automatically.
  //    Tests never boot server.js and therefore never trigger assertAuthConfig();
  //    they call createApp() directly with DI-injected verifiers.
  app.use(authMiddleware);

  // 3. API routes — all protected (except the public paths above).
  app.use("/api", apiRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
