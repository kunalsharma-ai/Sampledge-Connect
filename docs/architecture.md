# SampConnect: system architecture

Status legend used across these docs: **Built** (working code with tests in this repo), **In progress** (open PR), **Planned** (designed here, not implemented). Anything not marked Built is not functional yet.

## 1. Goals that shape the architecture

1. **Messages are never silently lost.** Every outgoing message is written to the device's IndexedDB before any network attempt and stays there until the server acknowledges its `clientMessageId`.
2. **MongoDB is the source of truth.** Redis accelerates (presence, typing, rate limits, Socket.IO fan-out) but nothing business-critical exists only in Redis.
3. **Tenant isolation is structural.** The tenant is derived from the authenticated session on the server and injected into every query by a repository layer. Request bodies never choose the tenant.
4. **Internal chat is independent.** External messaging providers, Nextcloud, AI and Sampledge module integrations are separate services; their outages degrade features, not chat.
5. **Honest offline behaviour.** Without a network path, messages queue locally. On a LAN with a reachable Connect server, chat works without internet. Background sync only runs while the app is open or the browser grants a sync event.

## 2. High-level topology

```
 Browser / PWA (Next.js)          Mobile (Expo, separate thread)
 ┌──────────────────────────┐      ┌───────────────────────┐
 │ UI (React, Motion)       │      │ UI (React Native)     │
 │ @sampledge/offline       │      │ local store + outbox  │
 │  Dexie: cache + outbox   │      └─────────┬─────────────┘
 │ Service worker (shell)   │                │
 └───────┬─────────┬────────┘                │
     REST│(HTTPS)  │Socket.IO (WSS)          │
         ▼         ▼                         ▼
 ┌──────────────────────────────────────────────────────┐
 │ apps/api  (NestJS, stateless, N replicas)            │
 │  auth · tenancy · directory · conversations ·        │
 │  messages · receipts · sync · realtime gateway ·     │
 │  audit · health                                      │
 └──────┬───────────────────────┬───────────────────────┘
        │                       │
 ┌──────▼──────┐         ┌──────▼──────┐
 │ MongoDB     │         │ Redis       │
 │ (replica    │         │ presence,   │
 │  set)       │         │ typing, RL, │
 │ durable     │         │ socket.io   │
 │ history     │         │ adapter     │
 └─────────────┘         └─────────────┘

 Planned services (own deployables, own failure domains):
   files-service ── Nextcloud (WebDAV/OCS)        [Phase 1b]
   connect-sdk + module adapters (7 Sampledge)    [Phase 2]
   connector-gateway (Telegram, Slack, Teams...)  [Phase 3]
   ai-service (self-hosted models)                [Phase 4]
   worker (durable jobs: retention, fan-out,
           scheduled messages)                    [Phase 1b]
```

## 3. Monorepo layout

| Path                     | Package                    | Status          | Purpose                                                                                                                 |
| ------------------------ | -------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts`     | `@sampledge/contracts`     | Built           | Zod schemas and TS types for REST DTOs, Socket.IO events, sync protocol, error codes, permission model, UUIDv7, backoff |
| `packages/design-tokens` | `@sampledge/design-tokens` | In progress     | Five themes, typography, spacing, radii, elevation, motion tokens, CSS variable generation                              |
| `packages/ui`            | `@sampledge/ui`            | In progress     | React component library (shadcn/ui conventions on Tailwind v4 + Motion)                                                 |
| `packages/offline`       | `@sampledge/offline`       | In progress     | Dexie schema, durable outbox, sync engine, reconnect and backoff, quota management                                      |
| `apps/api`               | `@sampledge/api`           | In progress     | NestJS API + Socket.IO gateway                                                                                          |
| `apps/web`               | `@sampledge/web`           | In progress     | Next.js app: auth, onboarding, three-column workspace, design gallery, PWA                                              |
| `apps/mobile`            |                            | Separate thread | Expo app                                                                                                                |
| `packages/sdk`           |                            | Planned         | SampConnect SDK + embeddable chat widget                                                                                |
| `apps/connector-gateway` |                            | Planned         | External messaging adapters                                                                                             |

Tooling: pnpm 12 workspaces, Turborepo, TypeScript 7, Node.js **26.13.1 LTS** (pinned in `.nvmrc`, `engines`, Dockerfiles and CI), Vitest, Playwright.

## 4. Backend modules (apps/api)

| Module          | Responsibility                                                                                                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config`        | Typed env parsing with zod; refuses to boot on missing secrets                                                                                                                                             |
| `database`      | Mongo client, migrations runner, `TenantScoped` collection wrapper                                                                                                                                         |
| `redis`         | ioredis clients (command + pub/sub), rate limiter                                                                                                                                                          |
| `auth`          | Password login (argon2id), short-lived access JWT (EdDSA), rotating refresh tokens with reuse detection, device sessions, revocation. OIDC single sign-on and TOTP two-step verification (docs/sign-in.md) |
| `tenancy`       | Tenant registration (tenant + owner + default workspace + #general), membership lookups, tenant context guard                                                                                              |
| `directory`     | Users list, invite member (admin)                                                                                                                                                                          |
| `conversations` | DM (deduplicated per pair), group, public/private channels, membership, archive                                                                                                                            |
| `messages`      | Idempotent send, edit, soft delete, history pagination, sequence allocation                                                                                                                                |
| `receipts`      | Delivered/read watermarks                                                                                                                                                                                  |
| `sync`          | Cursor sync over all readable conversations                                                                                                                                                                |
| `realtime`      | Socket.IO gateway, room management, Redis adapter, typing and presence                                                                                                                                     |
| `audit`         | Append-only audit log for security-relevant actions                                                                                                                                                        |
| `health`        | Liveness / readiness (Mongo + Redis ping)                                                                                                                                                                  |

## 5. Message write path

1. Client generates `clientMessageId` (UUIDv7), writes the message to the Dexie `outbox` and `messages` tables (status `queued`) in one transaction, renders it.
2. Sync engine sends via Socket.IO `message:send` (REST fallback when the socket is down but HTTP works).
3. API: authenticate → derive tenant/user from token → rate limit (Redis) → authorize (`message.send` on the conversation) → look up `(tenantId, clientMessageId)`; if present return it with `duplicate: true`.
4. Otherwise atomically `$inc` the conversation's `lastChangeSequence` (`findOneAndUpdate`) and insert the message with `serverSequence = changeSequence = n`. A unique index on `(tenantId, clientMessageId)` makes concurrent duplicates lose the race safely; the loser reads and returns the winner (leaving a harmless sequence gap).
5. Ack to sender; emit `message:new` to the conversation room (Redis adapter fans out across API replicas).
6. Client marks `sent`, removes outbox entry. Recipients' clients ack `delivered` on receipt and `read` when visible; watermarks update; sender derives `delivered` / `read`.

Why gaps are acceptable: sync is "give me everything after cursor N", never "give me sequence N+1". Gaps can only arise from a lost race or a crashed request between increment and insert.

## 6. Read path and recovery

- On app open, reconnect, or `online` event: run `POST /v1/sync` with per-conversation cursors (highest `changeSequence` applied). Page until `hasMore` is false.
- On a `message:new` whose sequence is greater than `cursor + 1`, schedule a sync (gap recovery). Duplicates are dropped by primary key.
- History scroll-back uses `GET /v1/conversations/:id/messages?before=<serverSequence>` and caches pages locally.

## 7. Redis usage

| Key pattern                | Type                  | TTL                         | Purpose                                                       |
| -------------------------- | --------------------- | --------------------------- | ------------------------------------------------------------- |
| `presence:{tid}:{uid}`     | hash deviceId→status  | 90s, refreshed by heartbeat | Online presence across devices                                |
| `typing:{tid}:{cid}:{uid}` | string                | 6s                          | Typing indicators                                             |
| `rl:{route}:{tid}:{uid}`   | rate-limiter-flexible | window                      | Per-user rate limits; per-IP for auth routes                  |
| `socket.io#*`              | pub/sub               | n/a                         | Socket.IO Redis adapter for horizontal scale                  |
| `member:{tid}:{uid}`       | JSON                  | 60s                         | Membership/role cache for guards (invalidated on role change) |

Durable background work (retention sweeps, scheduled messages, notification fan-out, webhook delivery) will use a MongoDB-backed job collection with leases (Planned), so a Redis flush cannot drop business events.

## 8. Deployment

- Docker images per app (Node 26 alpine), `docker-compose.yml` for local and single-VPS deployments with MongoDB replica set and Redis.
- Kubernetes manifests and Helm chart: Planned.
- LAN / on-prem: the same compose stack on a local server lets devices on the LAN chat without internet.
- Observability: structured JSON logs (pino) now; OpenTelemetry traces/metrics exporter: Planned.

## 9. Upgrade path to dedicated tenant databases

All tenant data access goes through `TenantDb.for(tenantId)`, which today returns collections from the shared database with an enforced `tenantId` filter. Enterprise tenants can later be mapped (via the `tenants.dataPlacement` field) to a dedicated database or cluster without changing callers.
