.DEFAULT_GOAL := help

COMPOSE := docker compose

.PHONY: help env build up up-d down logs ps restart add-user reset-db clean

help: ## Muestra esta ayuda
	@echo "Targets disponibles:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

env: ## Crea .env a partir de env.example si no existe
	@if [ ! -f .env ]; then cp env.example .env; echo ".env creado a partir de env.example"; else echo ".env ya existe, no se sobrescribe"; fi

build: ## Construye las imagenes (sin arrancar)
	$(COMPOSE) build

up: env build ## Construye y arranca todo el stack en foreground (logs en consola)
	$(COMPOSE) up

up-d: env build ## Construye y arranca todo el stack en segundo plano
	$(COMPOSE) up -d

down: ## Detiene y elimina los contenedores (conserva el volumen de datos)
	$(COMPOSE) down

restart: down up-d ## Reinicia el stack (down + up-d)

logs: ## Sigue los logs de todos los servicios
	$(COMPOSE) logs -f

ps: ## Estado de los contenedores del stack
	$(COMPOSE) ps

add-user: ## Da de alta (o actualiza) un usuario admin. Uso: make add-user EMAIL=user@x.com PASSWORD=secreto
	@if [ -z "$(EMAIL)" ] || [ -z "$(PASSWORD)" ]; then \
		echo "Uso: make add-user EMAIL=user@x.com PASSWORD=secreto"; \
		exit 1; \
	fi
	$(COMPOSE) exec api node scripts/seed_user.mjs --email "$(EMAIL)" --password "$(PASSWORD)" --force

reset-db: ## Vuelve a sembrar la base de datos desde cero (borra el volumen y relanza)
	$(COMPOSE) down -v
	$(MAKE) up-d

clean: ## Para el stack y elimina contenedores, volumenes e imagenes construidas (limpieza total)
	$(COMPOSE) down -v --rmi all --remove-orphans
