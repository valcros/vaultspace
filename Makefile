.PHONY: setup start stop restart logs ps update backup psql reset-dev help

COMPOSE := docker compose
POSTGRES_CONTAINER := vaultspace-postgres

##@ Setup

setup: ## Run the interactive installer (scripts/setup.sh)
	@bash scripts/setup.sh

##@ Lifecycle

start: ## Start all services (containers must already exist)
	$(COMPOSE) up -d

stop: ## Stop running containers without removing them
	$(COMPOSE) stop

restart: ## Restart running containers without recreating them
	$(COMPOSE) restart

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

# reset-dev requires three conditions before touching any data:
#   1. VAULTSPACE_ENV=dev  — caller must declare this is a dev environment
#   2. APP_URL in .env must contain localhost or 127.0.0.1
#   3. User must type YES at the confirmation prompt
reset-dev: ## WARNING: destroy all data. Requires VAULTSPACE_ENV=dev and localhost APP_URL
	@[ "$${VAULTSPACE_ENV}" = "dev" ] || \
	  { echo "Error: VAULTSPACE_ENV must equal 'dev' to use reset-dev."; exit 1; }
	@APP_URL=$$(grep -E '^APP_URL=' .env 2>/dev/null | head -1 | cut -d= -f2-); \
	  case "$$APP_URL" in \
	    *localhost*|*127.0.0.1*) ;; \
	    *) echo "Error: reset-dev refused — APP_URL='$$APP_URL' must contain localhost or 127.0.0.1. Ensure .env exists and APP_URL is set to a localhost address."; exit 1; ;; \
	  esac
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
