# Frontend Angular 20. Contexto de build: rule_set/web/
# syntax=docker/dockerfile:1

# --- Build del bundle de producción ----------------------------------------
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
RUN npm run build

# --- Servidor estático con proxy a la API ----------------------------------
FROM nginx:1.27-alpine
# Dos vhosts disponibles (HTTP / HTTP+HTTPS); docker-entrypoint-tls.sh elige uno
# en arranque según si hay certificados montados en /certs (ver docker-compose.yml).
COPY nginx.conf /etc/nginx/conf-available/http.conf
COPY nginx-ssl.conf /etc/nginx/conf-available/https.conf
COPY docker-entrypoint-tls.sh /docker-entrypoint.d/40-select-tls-conf.sh
RUN chmod +x /docker-entrypoint.d/40-select-tls-conf.sh
# @angular/build:application deja el bundle en dist/<project>/browser
COPY --from=build /app/dist/web/browser /usr/share/nginx/html
EXPOSE 80 443
