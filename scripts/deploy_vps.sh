#!/usr/bin/env bash
# ============================================================
# deploy_vps.sh — provision a clean Ubuntu/Debian VPS to run
# the jewelry management system as a single Node process
# (Express API + built React frontend + uploads on one port).
#
# Usage (on the VPS, with sudo):
#   sudo bash scripts/deploy_vps.sh
#
# Environment overrides (export before running):
#   SOURCE_DIR      local repo copy to deploy      (default: this repo)
#   GIT_URL         instead: git clone this URL into INSTALL_DIR
#   INSTALL_DIR     app install path               (default: /opt/jewelry)
#   APP_USER        unix user running the app      (default: jewelry)
#   APP_PORT        HTTP port                      (default: 4001)
#   DB_USER / DB_NAME                              (default: jewelry)
#   DB_PASS         postgres password              (default: random)
#   DB_DUMP_FILE    path to a pg_dump on the VPS   (default: fresh schema+seed)
#   UPLOADS_SRC     dir of existing uploads/ to copy into the app
# ============================================================
set -euo pipefail

# ---------- config ----------
APP_NAME="${APP_NAME:-jewelry}"
APP_USER="${APP_USER:-jewelry}"
INSTALL_DIR="${INSTALL_DIR:-/opt/${APP_NAME}}"
APP_PORT="${APP_PORT:-4001}"
DB_USER="${DB_USER:-jewelry}"
DB_NAME="${DB_NAME:-jewelry}"
DB_PASS="${DB_PASS:-$(openssl rand -hex 16)}"
DB_DUMP_FILE="${DB_DUMP_FILE:-}"
UPLOADS_SRC="${UPLOADS_SRC:-}"
SOURCE_DIR="${SOURCE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
GIT_URL="${GIT_URL:-}"
SYS_IP="${SYS_IP:-$(hostname -I 2>/dev/null | awk '{print $1}')}"

log()  { printf '\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m==> %s\033[0m\n' "$*"; }

# ---------- preflight ----------
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo (sudo bash scripts/deploy_vps.sh)"; exit 1; }
command -v curl >/dev/null || apt-get install -y curl >/dev/null
command -v openssl >/dev/null || { echo "openssl required"; exit 1; }

log "Preparing clean VPS for ${APP_NAME} (port ${APP_PORT})"

# ---------- system packages ----------
log "Installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates gnupg git rsync build-essential apt-transport-https

# ---------- Node.js 22 LTS ----------
if ! command -v node >/dev/null; then
  log "Installing Node.js 22 LTS"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y nodejs
fi
log "Node $(node --version) / npm $(npm --version)"

# ---------- PostgreSQL ----------
if ! command -v psql >/dev/null; then
  log "Installing PostgreSQL"
  apt-get install -y postgresql postgresql-client
fi
log "Ensuring PostgreSQL is running"
systemctl enable --now postgresql >/dev/null 2>&1 || true
systemctl start postgresql >/dev/null 2>&1 || true
for _ in $(seq 1 15); do
  su -s /bin/bash postgres -c "pg_isready -q" && break
  sleep 1
done
su -s /bin/bash postgres -c "pg_isready -q"
PG_PORT=5432

# ---------- app unix user ----------
CURRENT_USER="$(id -un)"
RUN_SUDO=""
if [ "$CURRENT_USER" != "$APP_USER" ]; then
  if ! id -u "$APP_USER" >/dev/null 2>&1; then
    log "Creating app user '${APP_USER}'"
    useradd -r -m -d "/var/lib/${APP_USER}" -s /bin/bash "$APP_USER"
  fi
  RUN_SUDO="1"
fi
asapp() {
  if [ -n "$RUN_SUDO" ]; then sudo -H -u "$APP_USER" "$@"; else "$@"; fi
}

# ---------- fetch source ----------
if [ -n "$GIT_URL" ]; then
  log "Cloning $GIT_URL into $INSTALL_DIR"
  rm -rf "$INSTALL_DIR"
  git clone --depth 1 "$GIT_URL" "$INSTALL_DIR"
elif [ "$SOURCE_DIR" != "$INSTALL_DIR" ]; then
  log "Copying source from $SOURCE_DIR into $INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"
  rsync -a --delete \
    --exclude node_modules --exclude .git --exclude dist \
    --exclude '*.tsbuildinfo' --exclude uploads \
    "$SOURCE_DIR"/ "$INSTALL_DIR"/
else
  log "Deploying in place at $INSTALL_DIR"
fi
chown -R "${APP_USER}:${APP_USER}" "$INSTALL_DIR" 2>/dev/null || true

# ---------- dependencies ----------
log "Installing dependencies (server + client)"
asapp npm ci --prefix "$INSTALL_DIR/server" --no-audit --no-fund
asapp npm ci --prefix "$INSTALL_DIR/client" --no-audit --no-fund

# ---------- .env ----------
ENV_FILE="$INSTALL_DIR/server/.env"
if [ ! -f "$ENV_FILE" ]; then
  log "Generating $ENV_FILE"
  JWT_SECRET="$(openssl rand -base64 42)"
  cat > "$ENV_FILE" <<EOF
PORT=${APP_PORT}
JWT_SECRET=${JWT_SECRET}
CORS_ORIGIN=http://${SYS_IP}:${APP_PORT}
PGHOST=127.0.0.1
PGPORT=${PG_PORT}
PGUSER=${DB_USER}
PGPASSWORD=${DB_PASS}
PGDATABASE=${DB_NAME}
UPLOAD_DIR=uploads
EOF
else
  warn "$ENV_FILE already exists — leaving it untouched (existing credentials preserved)"
fi
chown "${APP_USER}:${APP_USER}" "$ENV_FILE"

# ---------- database ----------
log "Creating role '${DB_USER}' and database '${DB_NAME}'"
su -s /bin/bash postgres -c "psql -v ON_ERROR_STOP=1 -tc \"SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'\" | grep -q 1" \
  || su -s /bin/bash postgres -c "psql -v ON_ERROR_STOP=1 -c \"CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}'\""
su -s /bin/bash postgres -c "psql -v ON_ERROR_STOP=1 -c \"ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}'\""
su -s /bin/bash postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'\" | grep -q 1" \
  || su -s /bin/bash postgres -c "createdb -O ${DB_USER} ${DB_NAME}"

export PGPASSWORD="$DB_PASS"
DB_ARGS="-h 127.0.0.1 -p ${PG_PORT} -U ${DB_USER} -d ${DB_NAME}"
if [ -n "$DB_DUMP_FILE" ]; then
  log "Restoring database from $DB_DUMP_FILE"
  case "$DB_DUMP_FILE" in
    *.dump|*.custom) pg_restore -h 127.0.0.1 -p "$PG_PORT" -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges --clean --if-exists "$DB_DUMP_FILE" ;;
    *) psql $DB_ARGS -v ON_ERROR_STOP=1 -f "$DB_DUMP_FILE" ;;
  esac
else
  log "Loading schema + seed"
  psql $DB_ARGS -v ON_ERROR_STOP=1 -f "$INSTALL_DIR/db/schema.sql" >/dev/null
  psql $DB_ARGS -v ON_ERROR_STOP=1 -f "$INSTALL_DIR/db/seed.sql" >/dev/null
fi
log "Applying migrations (db/migrations/*.sql)"
for m in "$INSTALL_DIR"/db/migrations/*.sql; do
  [ -f "$m" ] || continue
  log "  $(basename "$m")"
  psql $DB_ARGS -v ON_ERROR_STOP=1 -f "$m" >/dev/null
done
unset PGPASSWORD

# ---------- uploads ----------
mkdir -p "$INSTALL_DIR/server/uploads"
if [ -n "$UPLOADS_SRC" ]; then
  log "Copying uploads from $UPLOADS_SRC"
  rsync -a "$UPLOADS_SRC"/ "$INSTALL_DIR/server/uploads"/
fi
chown -R "${APP_USER}:${APP_USER}" "$INSTALL_DIR/server/uploads"

# ---------- build ----------
log "Building server (tsc) + client (vite)"
asapp npm run build --prefix "$INSTALL_DIR/server"
asapp npm run build --prefix "$INSTALL_DIR/client"
chown -R "${APP_USER}:${APP_USER}" "$INSTALL_DIR" 2>/dev/null || true

# ---------- systemd service ----------
NODE_BIN="$(command -v node)"
UNIT="/etc/systemd/system/${APP_NAME}.service"
log "Writing systemd unit $UNIT"
cat > "$UNIT" <<EOF
[Unit]
Description=Jewelry Management (API + Web)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${INSTALL_DIR}/server
Environment=NODE_ENV=production
EnvironmentFile=-${INSTALL_DIR}/server/.env
ExecStart=${NODE_BIN} dist/index.js
Restart=always
RestartSec=3
TimeoutStopSec=10

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "${APP_NAME}.service" >/dev/null
log "Starting ${APP_NAME}.service"
systemctl restart "${APP_NAME}.service"

# ---------- health check ----------
ok "Waiting for ${APP_NAME} on port ${APP_PORT}..."
for _ in $(seq 1 15); do
  if curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1; then break; fi
  sleep 1
done
if curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1; then
  ok "App is healthy at http://${SYS_IP}:${APP_PORT}  (login PIN for seeded users: 1234)"
else
  warn "Health check failed — inspect logs:  journalctl -u ${APP_NAME} -n 50"
  systemctl --no-pager -l status "${APP_NAME}.service" || true
  exit 1
fi

cat <<EOF

------------------------------------------------------------
  ${APP_NAME} deployed
------------------------------------------------------------
  URL          : http://${SYS_IP}:${APP_PORT}
  App dir      : ${INSTALL_DIR}
  Service      : systemctl status ${APP_NAME}
  Logs         : journalctl -u ${APP_NAME} -f
  DB           : postgres://${DB_USER}@127.0.0.1:${PG_PORT}/${DB_NAME}
------------------------------------------------------------
  Useful commands:
    Restart   : sudo systemctl restart ${APP_NAME}
    Update    : sudo bash scripts/deploy_vps.sh   (re-runs build + migrations)
    Firewall  : sudo ufw allow ${APP_PORT}/tcp   (if ufw enabled)
  For HTTPS use a reverse proxy (e.g. Caddy/nginx) that forwards
  to 127.0.0.1:${APP_PORT}; then set CORS_ORIGIN to the public origin.
------------------------------------------------------------
EOF
