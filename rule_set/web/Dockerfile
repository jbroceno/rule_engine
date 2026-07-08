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
COPY nginx.conf /etc/nginx/conf.d/default.conf
# @angular/build:application deja el bundle en dist/<project>/browser
COPY --from=build /app/dist/web/browser /usr/share/nginx/html
EXPOSE 80
