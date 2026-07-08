# API REST (Express + mssql). Contexto de build: rule_set/
# syntax=docker/dockerfile:1

# --- Dependencias de producción --------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# --- Imagen final -----------------------------------------------------------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY rule_engine.js ./
COPY rules.json ./
COPY api ./api
COPY scripts ./scripts

EXPOSE 3000
CMD ["node", "api/server.js"]
