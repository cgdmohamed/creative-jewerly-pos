# Creative Jewelry POS

Production-ready jewelry point-of-sale and inventory management system.

The POS application manages inventory, daily metal pricing, branches, sales, reservations, invoices, returns, staff permissions, audit logs, reports, and uploaded item images.

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, TanStack Query, Zustand |
| Backend | Express, TypeScript |
| Database | PostgreSQL 16 |
| Auth | JWT + 4-digit staff PIN |
| Deployment | Docker Compose, Coolify-compatible |

## Repository Layout

```text
client/                 POS React frontend
server/                 POS Express API
db/                     schema, seed, and migrations
docker/postgres/         PostgreSQL init script
scripts/                local setup, reset, smoke test, and VPS deployment scripts
docs/                   readiness and operational notes
Dockerfile              production image
docker-compose.yaml     Coolify-compatible compose file
```

## Local Development

### Requirements

- Node.js 22+
- npm
- PostgreSQL 16+
- Bash-compatible shell for the helper scripts

Install dependencies:

```bash
npm install --prefix server
npm install --prefix client
```

Create and seed the database:

```bash
npm run setup
```

Run the backend and frontend:

```bash
npm run api
npm run web
```

The API runs on `http://localhost:4001`.

The frontend runs on `http://localhost:5174`.

## Useful Commands

```bash
npm run db:reset       # reset and seed the database
npm run smoke          # run API smoke tests
npm run typecheck      # typecheck backend and build frontend
npm run build          # build backend and frontend
npm start              # run the built backend
```

## Default Staff Accounts

Initial PIN is `1234` for all seeded staff users.

| Username | Role |
| --- | --- |
| `manager` | Store manager with full permissions |
| `cashier` | Cashier with POS permissions |
| `social` | Social sales user for central stock reservations |

## Docker Deployment

Build and start the POS application and PostgreSQL:

```bash
docker compose up --build -d
```

Check status:

```bash
docker compose ps
docker compose logs -f app
```

The compose file defines:

| Service | Purpose | Internal port |
| --- | --- | --- |
| `app` | POS backend + built frontend | `4001` |
| `postgres` | PostgreSQL database | `5432` |
| `migrate` | One-shot migration runner | none |

Persistent volumes:

| Volume | Stores |
| --- | --- |
| `postgres-data` | PostgreSQL data |
| `uploads-data` | Uploaded item images |

The database is initialized automatically on first run from:

1. `db/schema.sql`
2. `db/seed.sql`
3. `db/migrations/*.sql`

## Coolify Deployment

Use **Docker Compose** deployment in Coolify and point it to `docker-compose.yaml`.

The compose file does not expose public `ports` directly. The app exposes internal port `4001`, and Coolify can route the public domain through `SERVICE_URL_APP_4001`.

Set production variables in Coolify:

```env
SERVICE_REALBASE64_64_JWT=generate-a-strong-secret
SERVICE_PASSWORD_POSTGRES=generate-a-strong-db-password
PGUSER=jewelry
PGDATABASE=jewelry
```

Recommended domain mapping:

| Domain | Coolify service | Port |
| --- | --- | --- |
| POS domain | `app` | `4001` |

## VPS Script Deployment

The VPS script deploys the POS application as a single Node process serving the built frontend, API, and uploads:

```bash
sudo bash scripts/deploy_vps.sh
```

Configurable variables:

| Variable | Default | Description |
| --- | --- | --- |
| `APP_PORT` | `4001` | Application port |
| `INSTALL_DIR` | `/opt/jewelry` | Installation directory |
| `GIT_URL` | empty | Clone from Git instead of copying the local project |
| `DB_DUMP_FILE` | empty | Restore a real PostgreSQL dump instead of seed data |
| `UPLOADS_SRC` | empty | Existing uploads directory to copy |
| `DB_PASS` | random | Database password |

## Production Notes

- Change all default secrets, database passwords, and staff PINs before publishing.
- Keep PostgreSQL private and expose only the HTTP application through Coolify or a reverse proxy.
- Back up `postgres-data` and `uploads-data`.
- Use HTTPS at the proxy or Coolify level.
- Restore real production data with `DB_DUMP_FILE` and `UPLOADS_SRC` when using the VPS script.
