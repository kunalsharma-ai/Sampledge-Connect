# SampConnect

**One Workspace. Every Conversation. Connected.**

SampConnect is a premium, offline-first, multi-tenant communication platform for the Sampledge ecosystem: internal chat that keeps working through network drops, connected to the business records your teams work on.

## Status

Phase 1 (product foundation) is being built in reviewable pull requests. See [`docs/roadmap-status.md`](docs/roadmap-status.md) for exactly what is built and what is planned. Nothing listed as Planned is functional.

## Requirements

- Node.js **26.13.1 LTS** (`nvm use` reads `.nvmrc`)
- pnpm **12.21** (`npm install -g pnpm@12.21.0`; Node 26 no longer bundles Corepack)
- Docker (MongoDB 7 and Redis 8 for local development and integration tests)

## Getting started

```bash
docker compose -f docker-compose.dev.yml up -d   # MongoDB + Redis on localhost
pnpm install
pnpm build
pnpm test
pnpm test:integration   # API against real MongoDB + Redis
```

Full stack in Docker: `sh scripts/check-ports.sh && docker compose up -d --build`. Only the
`gateway` service publishes ports (web, API, call signalling and one UDP media port); everything
else stays on an internal network. If a port is already in use on your machine, change it in
`.env` (see "Networks and ports" in [docs/deploy.md](docs/deploy.md)).

## Documentation

| Doc                                                    | What it covers                                                                |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| [Architecture](docs/architecture.md)                   | Topology, monorepo layout, write/read paths, Redis usage, deployment          |
| [User journeys](docs/user-journeys.md)                 | Core journeys with acceptance criteria                                        |
| [Permission model](docs/permission-model.md)           | Tenant roles, conversation roles, enforcement points                          |
| [Data model](docs/data-model.md)                       | MongoDB collections and indexes                                               |
| [Offline sync protocol](docs/offline-sync-protocol.md) | IndexedDB schema, outbox state machine, cursor sync, conflicts                |
| [Threat model](docs/threat-model.md)                   | STRIDE analysis, including cross-tenant leakage and offline device compromise |
| [Deploy](docs/deploy.md)                               | Server setup, secrets, HTTPS, upgrades, backups, scaling                      |
| [Monitoring](docs/monitoring.md)                       | Health checks, Prometheus metrics, alerts, logs                               |
| [Launch readiness](docs/launch-readiness.md)           | Security, performance and accessibility checks with measured results          |

## Repository layout

```
apps/
  api/            NestJS API + Socket.IO gateway
  web/            Next.js web app and PWA
packages/
  contracts/      Shared zod schemas and types (REST, Socket.IO, sync, permissions)
  design-tokens/  Themes and design tokens
  ui/             React component library
  offline/        IndexedDB (Dexie) cache, outbox and sync engine
docs/             Architecture and protocol documentation
```
