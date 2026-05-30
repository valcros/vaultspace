# VaultSpace Installation Guide

Self-hosted deployment using Docker Compose. The installer handles environment
configuration, image builds, database migrations, and first-admin setup.

## Prerequisites

| Requirement    | Minimum version | Notes                                                  |
| -------------- | --------------- | ------------------------------------------------------ |
| Docker         | 24.0            | With BuildKit enabled (default in Docker Desktop)      |
| Docker Compose | v2.20           | Plugin form (`docker compose`, not `docker-compose`)   |
| Bash           | 4.0             | macOS ships Bash 3.2 — install via `brew install bash` |
| curl           | any             | Included on most systems                               |
| jq             | 1.6             | `brew install jq` / `apt install jq`                   |
| openssl        | any             | For secret generation — included on most systems       |

Verify your environment:

```bash
docker --version
docker compose version
bash --version
jq --version
```

---

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/your-org/vaultspace.git
cd vaultspace

# 2. Run the installer
./scripts/setup.sh
```

The installer will prompt for your organization name, admin credentials, email
settings, and storage backend, then start all services and open the app.

For a fully non-interactive install (CI/CD or scripted deployments):

```bash
./scripts/setup.sh \
  --org-name "Acme Corp" \
  --org-slug acme \
  --admin-first-name Alice \
  --admin-last-name Admin \
  --admin-email alice@acme.com \
  --admin-password "Str0ng!Pass" \
  --app-url https://vault.acme.com \
  --smtp-host smtp.acme.com \
  --smtp-port 587 \
  --smtp-tls false \
  --smtp-from noreply@acme.com \
  --yes
```

---

## Installer Options

```
./scripts/setup.sh [OPTIONS]

  --org-name NAME           Organization display name
  --org-slug SLUG           URL slug (lowercase, hyphens only)
  --admin-first-name STR    Admin first name
  --admin-last-name STR     Admin last name
  --admin-email EMAIL       Admin email address
  --admin-password PASS     Admin password (min 8 chars)
  --smtp-host HOST          SMTP server hostname
  --smtp-port PORT          SMTP port (default: 587)
  --smtp-tls true|false     Enable STARTTLS/TLS (default: false)
  --smtp-user USER          SMTP username (leave blank if not required)
  --smtp-password PASS      SMTP password
  --smtp-from EMAIL         Sender address
  --storage local|s3        Storage backend (default: local)
  --s3-endpoint URL         S3 endpoint (MinIO, Backblaze B2, DO Spaces, etc.)
  --s3-bucket BUCKET        S3 bucket name
  --s3-key-id KEY           S3 access key ID
  --s3-secret KEY           S3 secret access key
  --s3-region REGION        S3 region (default: us-east-1)
  --s3-path-style true|false  Force path-style URLs (MinIO: true)
  --app-url URL             Public URL (default: http://localhost:3000)
  --app-port PORT           Host port for the app (default: 3000)
  --demo                    Load demo data (skips first-admin prompt)
  --fresh                   Pass --no-cache to docker build
  --non-interactive         Fail if any required value is missing
  -y, --yes                 Skip confirmation prompts
  --dry-run                 Print commands without executing
```

---

## Storage Backends

### Local filesystem (default)

Files are stored as bind mounts at `./storage` and `./uploads` in the
repository directory. Simple and zero-config; suitable for single-host
deployments. Back up these directories before updating or migrating hosts.

Generated `.env` entry:

```dotenv
STORAGE_PROVIDER=local
```

### S3-compatible (MinIO, Backblaze B2, DigitalOcean Spaces, AWS S3)

Pass `--storage s3` to the installer along with the bucket credentials. The
installer writes all required env vars automatically.

```dotenv
STORAGE_PROVIDER=s3
STORAGE_ENDPOINT=https://minio.example.com   # omit for AWS S3
STORAGE_BUCKET=vaultspace
STORAGE_KEY_ID=your-access-key
STORAGE_SECRET_KEY=your-secret-key
STORAGE_REGION=us-east-1
S3_FORCE_PATH_STYLE=true                     # true for MinIO; false for AWS/DO
```

Bucket lifecycle policies and replication are managed by your S3 provider.
VaultSpace does not manage bucket-level retention or cross-region replication.

---

## Environment Variables Reference

The installer generates `.env` automatically. For manual configuration or
upgrades, the full reference follows.

### Core

| Variable          | Required | Default      | Description                                   |
| ----------------- | -------- | ------------ | --------------------------------------------- |
| `DEPLOYMENT_MODE` | Yes      | —            | Must be `standalone` for self-hosted installs |
| `NODE_ENV`        | Yes      | —            | Must be `production`                          |
| `APP_URL`         | Yes      | —            | Public URL (e.g. `https://vault.example.com`) |
| `APP_PORT`        | No       | `3000`       | Host port Docker binds the app to             |
| `APP_NAME`        | No       | `VaultSpace` | Display name shown in the UI and emails       |
| `SESSION_SECRET`  | Yes      | —            | 64-char hex string. Generated by installer.   |
| `LOG_LEVEL`       | No       | `info`       | `debug`, `info`, `warn`, `error`              |

### Database

| Variable            | Required | Default | Description                                           |
| ------------------- | -------- | ------- | ----------------------------------------------------- |
| `DATABASE_PASSWORD` | Yes      | —       | PostgreSQL password. Generated by installer.          |
| `DATABASE_PORT`     | No       | `5432`  | Host port Docker binds PostgreSQL to                  |
| `DATABASE_URL`      | No       | —       | Full Postgres URL; generated internally from password |

### Redis

| Variable         | Required | Default | Description                             |
| ---------------- | -------- | ------- | --------------------------------------- |
| `REDIS_PASSWORD` | Yes      | —       | Redis password. Generated by installer. |
| `REDIS_PORT`     | No       | `6379`  | Host port Docker binds Redis to         |

### Storage

| Variable                    | Required    | Default     | Description                                                                |
| --------------------------- | ----------- | ----------- | -------------------------------------------------------------------------- |
| `STORAGE_PROVIDER`          | Yes         | `local`     | `local` or `s3`                                                            |
| `STORAGE_ENDPOINT`          | Conditional | —           | S3 endpoint URL. Required for `STORAGE_PROVIDER=s3` with non-AWS providers |
| `STORAGE_BUCKET`            | Conditional | —           | Bucket name. Required for `STORAGE_PROVIDER=s3`                            |
| `STORAGE_KEY_ID`            | Conditional | —           | Access key ID. Required for `STORAGE_PROVIDER=s3`                          |
| `STORAGE_SECRET_KEY`        | Conditional | —           | Secret key. Required for `STORAGE_PROVIDER=s3`                             |
| `STORAGE_REGION`            | No          | `us-east-1` | S3 region                                                                  |
| `S3_FORCE_PATH_STYLE`       | No          | `false`     | Set `true` for MinIO and other path-style providers                        |
| `SIGNED_URL_EXPIRY_SECONDS` | No          | `300`       | Signed preview URL TTL (5 minutes)                                         |

### Email

| Variable         | Required    | Default   | Description                                                  |
| ---------------- | ----------- | --------- | ------------------------------------------------------------ |
| `EMAIL_PROVIDER` | Yes         | `console` | `smtp` or `console` (console logs emails instead of sending) |
| `SMTP_HOST`      | Conditional | —         | SMTP server hostname. Required for `EMAIL_PROVIDER=smtp`     |
| `SMTP_PORT`      | No          | `587`     | SMTP port                                                    |
| `SMTP_TLS`       | No          | `false`   | Enable STARTTLS/TLS (`true` or `false`)                      |
| `SMTP_USER`      | No          | —         | SMTP username (leave blank if not required)                  |
| `SMTP_PASSWORD`  | No          | —         | SMTP password                                                |
| `SMTP_FROM`      | Conditional | —         | Sender address. Required for `EMAIL_PROVIDER=smtp`           |

### Preview and Scanning

| Variable                  | Required    | Default                 | Description                                                                                                                                                                         |
| ------------------------- | ----------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PREVIEW_ENGINE`          | No          | `sharp`                 | Preview backend: `gotenberg` (full document conversion, requires Gotenberg service) or `sharp` (image-only thumbnails, no Gotenberg needed). Standalone installer sets `gotenberg`. |
| `GOTENBERG_URL`           | Conditional | `http://gotenberg:3000` | Required for `PREVIEW_ENGINE=gotenberg`                                                                                                                                             |
| `PREVIEW_TIMEOUT_SECONDS` | No          | `60`                    | Timeout for document conversion                                                                                                                                                     |
| `SCAN_ENGINE`             | No          | `clamav`                | Virus scanner: `clamav` or `passthrough`. `passthrough` skips scanning — never use in production                                                                                    |
| `CLAMAV_HOST`             | Conditional | `clamav`                | Required for `SCAN_ENGINE=clamav`                                                                                                                                                   |
| `CLAMAV_PORT`             | No          | `3310`                  | ClamAV daemon port                                                                                                                                                                  |

### Search and Encryption

| Variable              | Required | Default    | Description                                                 |
| --------------------- | -------- | ---------- | ----------------------------------------------------------- |
| `SEARCH_PROVIDER`     | No       | `postgres` | `postgres` (built-in FTS) or `meilisearch`                  |
| `ENCRYPTION_PROVIDER` | No       | `noop`     | `noop` (no encryption at rest) or `vault` (HashiCorp Vault) |

---

## Upgrade Procedure

```bash
# 1. Pull the latest source (your responsibility)
git pull

# 2. Run the update script
./scripts/update.sh
```

Or via Make:

```bash
make update
```

`scripts/update.sh` does the following:

1. Pulls updated base images from Docker Hub
2. Rebuilds app and worker images from the local source tree
3. Stops all containers (`docker compose down`)
4. Starts all containers (`docker compose up -d`)
5. Waits for `/api/health?deep=true` to return `healthy` or `degraded`

Database migrations run automatically on startup via `docker-entrypoint.sh`.
You do not need to run `prisma migrate` manually. If you need to run migrations
independently:

```bash
docker compose run --rm --entrypoint="" app npx prisma migrate deploy
```

---

## Backup and Restore

### PostgreSQL

Back up before every upgrade and on a regular schedule.

```bash
# Dump to a compressed file
docker exec vaultspace-postgres pg_dump \
  -U vaultspace vaultspace | gzip > backups/vaultspace-$(date +%Y%m%d).sql.gz

# Or use the Make target
make backup
```

Restore from a dump:

```bash
gunzip -c backups/vaultspace-20260101.sql.gz | \
  docker exec -i vaultspace-postgres psql -U vaultspace vaultspace
```

### File Storage

Storage backup depends on your storage backend.

**Local filesystem:** Uploaded files are stored as bind mounts at `./storage`
and `./uploads` in the repository directory. Back them up with a tar archive:

```bash
mkdir -p backups
tar czf backups/storage-$(date +%Y%m%d).tar.gz ./storage ./uploads
```

Restore by extracting the archive into the same directory before starting the
stack:

```bash
tar xzf backups/storage-20260101.tar.gz
```

**S3-compatible storage:** VaultSpace writes files to S3 but does not manage
bucket-level replication or versioning. Configure backup at the bucket level:

- **MinIO:** Enable versioning and configure a replication target in the MinIO
  console or via `mc`.
- **Backblaze B2 / DigitalOcean Spaces:** Enable lifecycle rules or snapshots
  through your provider's dashboard.
- **AWS S3:** Enable S3 Versioning and Cross-Region Replication (CRR) via AWS
  Console or CloudFormation.

**Azure Blob Storage:** If you are using the Azure deployment mode, enable
soft-delete and configure Azure Backup for Blob Storage through the Azure
Portal. Pair with Azure Database for PostgreSQL's built-in PITR for full
recovery coverage.

---

## Troubleshooting

### App container restarts immediately

Check the app logs for the startup error:

```bash
docker compose logs app
```

Common causes:

- **Missing required env var:** The app will print `Missing required config: VAR_NAME`. Add the variable to `.env` and restart.
- **Database connection failed:** Ensure `vaultspace-postgres` is healthy (`docker compose ps`). Check `DATABASE_PASSWORD` matches in `.env`.
- **Port already in use:** Change `APP_PORT`, `DATABASE_PORT`, or `REDIS_PORT` in `.env` and run `docker compose down && docker compose up -d`.

### Migration failed on startup

The entrypoint runs `prisma migrate deploy` automatically. If it fails:

```bash
docker compose logs app | grep -i migrat
```

To run migrations manually after fixing the issue:

```bash
docker compose run --rm --entrypoint="" app npx prisma migrate deploy
```

### ClamAV or Gotenberg not reachable

Documents will be queued but not scanned/converted until these services are
healthy. The health endpoint reports degraded status:

```bash
curl -s http://localhost:3000/api/health?deep=true | jq .
```

Check the relevant service:

```bash
docker compose logs clamav
docker compose logs gotenberg
```

ClamAV performs a virus definition update on startup, which can take several
minutes on the first run.

### Health endpoint returns 503

The app is running but at least one critical dependency is unhealthy. Check the
`checks` section of the health response:

```bash
curl -s http://localhost:3000/api/health?deep=true | jq .checks
```

A `degraded` response (HTTP 200) means optional services (ClamAV, Gotenberg)
are unavailable; the app is still functional for core operations.

### Resetting a failed installation

To start completely fresh (destroys all data):

```bash
VAULTSPACE_ENV=dev make reset-dev
```

`reset-dev` enforces two safety conditions before touching anything:

1. `VAULTSPACE_ENV` must equal `dev` — you must explicitly declare this is a
   dev environment.
2. `APP_URL` in `.env` must contain `localhost` or `127.0.0.1` — the target
   refuses to run against a non-localhost URL, protecting remote installs from
   accidental data loss.

If `.env` is absent or `APP_URL` is blank the command will fail with an error
rather than proceeding.

Or manually (no guards):

```bash
docker compose down -v --remove-orphans
```

Then re-run `./scripts/setup.sh`.

---

## Security Notes

- `.env` is written with mode `600` (owner read/write only). Keep it out of
  version control — ensure `.env` is in `.gitignore`.
- `SESSION_SECRET`, `DATABASE_PASSWORD`, and `REDIS_PASSWORD` are generated
  with `openssl rand -hex 32` by the installer. Do not reuse values across
  environments.
- ClamAV virus scanning is enabled by default. Do not set `SCAN_ENGINE=passthrough`
  in production — documents would become accessible without a scan.
- Signed preview URLs expire after 5 minutes (`SIGNED_URL_EXPIRY_SECONDS=300`).
  Do not increase this value without understanding the access-control
  implications.

---

## Further Reading

- `DEPLOYMENT.md` — full environment variable reference and Azure deployment
- `ARCHITECTURE.md` — system design and provider interfaces
- `SECURITY.md` — security policies and vulnerability reporting
