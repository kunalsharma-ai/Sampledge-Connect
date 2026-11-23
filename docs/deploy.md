# Deploying SampConnect

This guide takes one server (VPS or on-premises) from nothing to a running, HTTPS-served
Connect. Larger setups use the same images behind a load balancer; see **Scaling** below.

## What runs

| Service   | Image                                   | Port (internal)       | Notes                                          |
| --------- | --------------------------------------- | --------------------- | ---------------------------------------------- |
| `gateway` | `nginx:1.29-alpine`                     | 3000, 4000, 7880–7882 | The only service that publishes ports          |
| `web`     | `ghcr.io/<owner>/sampledge-connect-web` | 3000                  | Next.js server; public URLs baked in at build  |
| `api`     | `ghcr.io/<owner>/sampledge-connect-api` | 4000                  | REST + Socket.IO; runs migrations on start     |
| `mongo`   | `mongo:7`                               | 27017                 | Replica set recommended in production          |
| `redis`   | `redis:8-alpine`                        | 6379                  | Sessions cache, rate limits, presence, fan-out |
| `livekit` | `livekit/livekit-server`                | 7880, 7881, UDP 7882  | Calls; runs in the gateway's network           |
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
- Firewall: 80/443 TCP for the proxy; for calls 7881 TCP, 7882 UDP, 3478 UDP and
  30000–30100 UDP (TURN relay).
  MongoDB and Redis are never published (they only exist on the internal network).
- Before the first start, run `sh scripts/check-ports.sh`. It lists any port the stack needs
  that another program already holds (see **Port already in use** below).

### Networks and ports

Only one container, `gateway`, publishes ports. Everything else talks over the `internal`
network and is not reachable from outside the host:

```
                     host ports (all set in .env)                  internal network
 browsers/phones ──► WEB_PORT 3000 ─────► gateway (nginx) ──────► web:3000
 your proxy      ──► API_PORT 4000 ─────►                 ──────► api:4000 ──► mongo, redis
                     LIVEKIT_HTTP_PORT 7880 ─┐
                     LIVEKIT_TCP_PORT  7881 ─┼─ same network as the gateway: livekit
                     LIVEKIT_UDP_PORT  7882/udp (all call media)       (egress, api reach it
                     LIVEKIT_TURN_PORT 3478/udp                         as livekit:7880)
                     LIVEKIT_TURN_RELAY_START-END 30000-30100/udp
```

- **Call media uses one UDP port.** LiveKit multiplexes the media of every call on
  `LIVEKIT_UDP_PORT` instead of a range of ports. The only range left is the TURN relay
  (30000–30100), below 32768 where Linux, macOS and Windows never hand out ports on their own.
  LiveKit and the Jitsi video bridge run inside the gateway's network namespace, so their ports
  come from the gateway without a proxy hop in the media path.
- **`publicweb` network.** The gateway also joins a network named `publicweb`, so a reverse proxy
  in another compose project (Traefik, Caddy, nginx proxy manager, …) on that network reaches
  SampConnect as `gateway:3000` (web), `gateway:4000` (API), `gateway:7880` (calls) and, with
  Jitsi, `gateway:8000`. Compose creates the network if it doesn't exist. If your proxy already
  created it, set `PUBLIC_NETWORK_EXTERNAL=true`; set `PUBLIC_NETWORK` to use another name. When
  the proxy is the only thing that should reach the HTTP ports, also set `HTTP_BIND_IP=127.0.0.1`
  so web, API and signalling stay off the host's public interfaces (media ports stay public).
- The gateway takes the client address from `X-Forwarded-For` when the request comes from a
  private address (your proxy) and passes a single hop on, which the API's `trust proxy 1`
  expects, so rate limits and the audit log keep seeing real client IPs.
- For local development, `docker compose -f docker-compose.dev.yml up -d` starts MongoDB and
  Redis on `127.0.0.1` (ports `MONGO_PORT`, `REDIS_PORT`) without touching the full stack.

### Port already in use

If `docker compose up` stops with `failed to bind host port 0.0.0.0:7882/udp: address already
in use` (or any other port), another program on the machine holds that port. Earlier versions
published the UDP range 50000–50200, which collided with ports the system hands out to other
programs; the stack now needs only the ports listed above.

1. Find what holds it: `sudo ss -tulpn | grep 7882` (Linux) or `sudo lsof -nP -i :7882` (macOS).
2. Stop that program, or give SampConnect another port in `.env`:

   ```bash
   LIVEKIT_UDP_PORT=17882
   ```

3. Open the new port in the firewall, run `sh scripts/check-ports.sh`, then `docker compose up -d`.

Every published port moves the same way: `WEB_PORT`, `API_PORT`, `LIVEKIT_HTTP_PORT` (also
update `LIVEKIT_PUBLIC_URL` and the web build's RTC URL), `LIVEKIT_TCP_PORT`,
`LIVEKIT_UDP_PORT`, `LIVEKIT_TURN_PORT`, `LIVEKIT_TURN_RELAY_START`/`END`, and with Jitsi `JITSI_HTTP_PORT` and `JITSI_JVB_PORT`.
All of them are listed in `.env.example`. Upgrading from a version with the UDP range:
`LIVEKIT_RTC_PORT_START`/`END` are no longer used, so remove them from `.env`, open
`LIVEKIT_UDP_PORT` and the relay range in the firewall, and close 50000–50200.

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

Any proxy works; it must pass WebSocket upgrades to the API. Caddy on the same host:

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

A proxy in its own compose project joins the `publicweb` network instead and points at the
gateway by name (`reverse_proxy gateway:3000`, `gateway:4000`, `gateway:7880`); see
**Networks and ports** above.

The API trusts one proxy hop (`trust proxy 1`) for client IPs in rate limits and the audit
log. That hop is the gateway: it takes the client address your proxy put in
`X-Forwarded-For` (from private addresses only) and passes it on as the single hop, so one
proxy in front of the gateway keeps client IPs right. A proxy on a public address, or a chain
of several, needs its address added to `set_real_ip_from` in `deploy/gateway/nginx.conf`.

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
