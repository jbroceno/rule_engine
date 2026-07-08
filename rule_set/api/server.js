import { createApp } from "./app.js";
import { env, assertAuthConfig } from "./config/env.js";

// Fail-fast: refuse to start if JWT_SECRET is not set.
// Tests never boot this file; they call createApp() directly via DI.
assertAuthConfig();

const app = createApp();

app.listen(env.port, () => {
  console.log(`API escuchando en http://localhost:${env.port}`);
});
