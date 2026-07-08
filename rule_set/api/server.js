import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { createApp } from "./app.js";
import { env, assertAuthConfig } from "./config/env.js";

// Fail-fast: refuse to start if JWT_SECRET is not set.
// Tests never boot this file; they call createApp() directly via DI.
assertAuthConfig();

const app = createApp();

// TLS is opt-in via mounted cert files (see docker-compose.yml SSL_CERTS_DIR).
// Falls back to plain HTTP when the paths are unset, the files aren't there,
// or they exist but can't be read/parsed (e.g. a cert copy interrupted mid-
// renewal) — a bad cert must never crash the API container.
function createTlsServer() {
  if (!env.ssl.fullchainPath || !env.ssl.privkeyPath) {
    return null;
  }
  if (!fs.existsSync(env.ssl.fullchainPath) || !fs.existsSync(env.ssl.privkeyPath)) {
    return null;
  }
  try {
    const cert = fs.readFileSync(env.ssl.fullchainPath);
    const key = fs.readFileSync(env.ssl.privkeyPath);
    return https.createServer({ cert, key }, app);
  } catch (err) {
    console.error(`Certificados TLS inválidos, se usará HTTP: ${err.message}`);
    return null;
  }
}

const tlsServer = createTlsServer();
const server = tlsServer ?? http.createServer(app);

server.listen(env.port, () => {
  console.log(`API escuchando en ${tlsServer ? "https" : "http"}://localhost:${env.port}`);
});
