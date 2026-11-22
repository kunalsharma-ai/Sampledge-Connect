# Deploying SampConnect

This guide takes one server (VPS or on-premises) from nothing to a running, HTTPS-served
Connect. Larger setups use the same images behind a load balancer; see **Scaling** below.

## What runs

| Service   | Image                                   | Port (internal)       | Notes                                          |
| --------- | --------------------------------------- | --------------------- | ---------------------------------------------- |
| `web`     | `ghcr.io/<owner>/sampledge-connect-web` | 3000                  | Next.js server; public URLs baked in at build  |
| `api`     | `ghcr.io/<owner>/sampledge-connect-api` | 4000                  | REST + Socket.IO; runs migrations on start     |
| `mongo`   | `mongo:7`                               | 27017                 | Replica set recommended in production          |
| `redis`   | `redis:8-alpine`                        | 6379                  | Sessions cache, rate limits, presence, fan-out |
| `livekit` | `livekit/livekit-server`                | 7880, 7881, UDP media | Calls; see [calls.md](calls.md)                |
| `egress`  | `livekit/egress`                        | –                     | Call recording; ~2 CPU / 2 GB per recording    |

Images are built and pushed by `.github/workflows/release.yml` on every merge to `main`
(`:main`, `:sha-<short>`) and on version tags (`v1.2.3` → `:1.2.3`, `:latest`). Set the
repository variables `PUBLIC_API_URL` and `PUBLIC_RTC_URL` so the web image points at your
domain, or build the web image yourself with `--build-arg`.

## Sizing

| Organization size | CPU / RAM for web + api + mongo + redis                               | Disk                          |
| ----------------- | --------------------------------------------------------------------- | ----------------------------- |
| up to 200 people  | 2 vCPU / 4 GB                                                         | 40 GB SSD + files/recordings  |
| up to 1,000       | 4 vCPU / 8 GB                                                         | 100 GB SSD + files/recordings |
| more              | split Mongo and Redis onto their own machines and run 2+ API replicas |

Add the call server's needs on top (see [calls.md](calls.md)). The measured numbers behind
these figures are in [launch-readiness.md](launch-readiness.md).

## 1. Prepare the server

- Ubuntu 24.04 or similar with Docker Engine and the compose plugin.
- DNS: `app.example.com` (web), `api.example.com` (API), `rtc.example.com` (calls).
- Firewall: 80/443 TCP for the proxy; for calls 7881 TCP, 3478 UDP and 50000–50200 UDP.
  Keep 27017 and 6379 closed to the internet (compose binds them to 127.0.0.1).

## 2. Secrets (`.env` next to `docker-compose.yml`)

Only bootstrap values live here. Every integration (SMTP, Stripe, SSO, AI, storage, push,
modules) is configured afterwards in **Admin → Integrations** and stored encrypted in MongoDB.

```bash
openssl genpkey -algorithm ed25519 -out jwt.key
openssl pkey -in jwt.key -pubout -out jwt.pub
cat > .env <<ENV
JWT_PRIVATE_KEY="$(awk 'BEGIN{ORS="\\n"}1' jwt.key)"
JWT_PUBLIC_KEY="$(awk 'BEGIN{ORS="\\n"}1' jwt.pub)"
FILES_URL_SECRET=$(openssl rand -base64 48)
SETTINGS_ENCRYPTION_KEY=$(openssl rand -base64 32)
LIVEKIT_API_SECRET=$(openssl rand -base64 48)
METRICS_TOKEN=$(openssl rand -hex 24)
CORS_ORIGINS=https://app.example.com
PUBLIC_WEB_URL=https://app.example.com
PUBLIC_API_URL=https://api.example.com
LIVEKIT_PUBLIC_URL=wss://rtc.example.com
PLATFORM_ADMIN_EMAILS=your-org-slug:you@example.com
ENV
chmod 600 .env jwt.key
```

Back up `.env` somewhere safe. Losing `SETTINGS_ENCRYPTION_KEY` makes stored integration
secrets unreadable (you would re-enter them); losing the JWT keys signs everyone out.

## 3. Start

```bash
docker compose pull            # or: docker compose build
docker compose up -d
docker compose logs -f api     # "listening on :4000"; migrations run before that
curl -s localhost:4000/health/ready   # {"status":"ok","mongo":"ok","redis":"ok"}
```

## 4. HTTPS reverse proxy

Any proxy works; it must pass WebSocket upgrades to the API. Caddy example:

```
app.example.com {
  reverse_proxy 127.0.0.1:3000
}
api.example.com {
  reverse_proxy 127.0.0.1:4000
}
rtc.example.com {
  reverse_proxy 127.0.0.1:7880
}
```

The API trusts one proxy hop (`trust proxy 1`) for client IPs in rate limits and the audit
log. Don't put a second proxy in front without adjusting that.

## 5. First sign-in

1. Open `https://app.example.com/register` and create the first organization. If its owner's
   email is in `PLATFORM_ADMIN_EMAILS`, that person becomes the first super admin and gets the
   **Super admin** console (every organization, plans, platform integrations, platform admins).
   Add other platform admins there; see [super-admin.md](super-admin.md).
2. Admin → Integrations: SMTP, then anything else you use (SSO, Stripe, AI model server,
   Nextcloud, push). Each has **Test connection**.
3. Admin → Billing (platform operators): publish plans, or leave none for "Pricing on request".

## Upgrades

```bash
docker compose pull && docker compose up -d
```

Migrations are forward-only and idempotent, and a lock document stops two API replicas from
running them at once. Pin images to a version tag in production and read the release notes
before moving to the next one. To roll back, start the previous tag: migrations only add
collections, fields and indexes, so older API versions keep working against a newer database.

## Backups

- **MongoDB** holds everything except recordings on disk: `mongodump --archive --gzip` nightly,
  keep 14 days, copy off the server. With GridFS file storage this includes attachments.
- **Recordings** live in the `recordings-spool` volume until moved into tenant storage (GridFS
  or Nextcloud); include the volume if you keep recordings locally.
- **Redis** is a cache. It can be lost; people stay signed in (sessions are in MongoDB) and
  presence rebuilds.
- Test a restore every quarter: `mongorestore --archive --gzip --drop` into a spare server.

## Scaling

- Run 2+ `api` replicas behind the proxy. Socket.IO uses the Redis adapter, so events reach
  people connected to any replica; sticky sessions are not required with the WebSocket
  transport the clients use.
- MongoDB as a 3-node replica set (`MONGO_URL=mongodb://a,b,c/?replicaSet=rs0`).
- Redis with persistence (compose enables AOF) or a managed Redis.
- Watch the dashboards in [monitoring.md](monitoring.md) before and after each change.

## Security checklist before go-live

- [ ] `NODE_ENV=production` (refuses to start without keys, refuses `RATE_LIMIT_DISABLED`).
- [ ] HTTPS everywhere; HSTS is sent by the API.
- [ ] Mongo and Redis not reachable from the internet.
- [ ] `.env` readable only by root; offsite backup of `.env` and the database.
- [ ] `METRICS_TOKEN` set if you scrape metrics; the endpoint is off without it.
- [ ] SMTP tested in Integrations; SSO tested with a non-owner account.
- [ ] A restore drill done once.
