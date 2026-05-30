.PHONY: start stop restart logs ps update backup psql reset-dev help

COMPOSE := docker compose
POSTGRES_CONTAINER := vaultspace-postgres

##@ Lifecycle

start: ## Start all services
	$(COMPOSE) up -d

stop: ## Stop all services
	$(COMPOSE) down

restart: ## Restart all services
	$(COMPOSE) down
	$(COMPOSE) up -d

logs: ## Follow logs (all services). Use service=app to tail one service
	$(COMPOSE) logs -f $(service)

ps: ## Show service status
	$(COMPOSE) ps

##@ Maintenance

update: ## Pull new images, rebuild, and restart (runs scripts/update.sh)
	@bash scripts/update.sh

backup: ## Dump PostgreSQL to ./backups/vaultspace-TIMESTAMP.sql.gz
	@mkdir -p backups
	@TS=$$(date +%Y%m%d-%H%M%S); \
	  docker exec vaultspace-postgres pg_dump \
	    -U "$${POSTGRES_USER:-vaultspace}" \
	    "$${POSTGRES_DB:-vaultspace}" \
	  | gzip > "backups/vaultspace-$$TS.sql.gz" && \
	  echo "Backup written to backups/vaultspace-$$TS.sql.gz"

psql: ## Open an interactive psql session
	docker exec -it $(POSTGRES_CONTAINER) \
	  psql -U "$${POSTGRES_USER:-vaultspace}" "$${POSTGRES_DB:-vaultspace}"

##@ Danger zone

reset-dev: ## WARNING: destroy all data and restart fresh (requires confirmation)
	@printf 'This will DELETE ALL DATA (volumes + containers). Type YES to confirm: '; \
	  read ans; \
	  [ "$$ans" = "YES" ] || { echo "Aborted."; exit 1; }
	$(COMPOSE) down -v --remove-orphans
	$(COMPOSE) up -d

##@ Help

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n"} \
	  /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2 } \
	  /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) }' $(MAKEFILE_LIST)

.DEFAULT_GOAL := help
