# Deploying SampConnect

This guide takes one server (VPS or on-premises) from nothing to a running, HTTPS-served
Connect. Larger setups use the same images behind a load balancer; see **Scaling** below.

## What runs

| Service   | Image                                   | Port (internal)      | Notes                                          |
| --------- | --------------------------------------- | -------------------- | ---------------------------------------------- |
| `gateway` | `nginx:1.29-alpine`                     | 80, 7880–7882        | Publishes call media only; web is on publicweb |
| `web`     | `ghcr.io/<owner>/sampledge-connect-web` | 3000                 | Next.js server; serves everything but `/api`   |
| `api`     | `ghcr.io/<owner>/sampledge-connect-api` | 4000                 | REST + Socket.IO under `/api`; runs migrations |
| `mongo`   | `mongo:7`                               | 27017                | Replica set recommended in production          |
| `redis`   | `redis:8-alpine`                        | 6379                 | Sessions cache, rate limits, presence, fan-out |
| `livekit` | `livekit/livekit-server`                | 7880, 7881, UDP 7882 | Calls; runs in the gateway's network           |
| `egress`  | `livekit/egress`                        | –                    | Call recording; ~2 CPU / 2 GB per recording    |

Images are built and pushed by `.github/workflows/release.yml` on every merge to `main`
(`:main`, `:sha-<short>`) and on version tags (`v1.2.3` → `:1.2.3`, `:latest`). The web
image calls the API at `/api` and call signalling at `/rtc` on its own address, so one image
works on any domain; nothing about your domain is baked in.

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
- DNS: one name, for example `connect.example.com`, pointing at your reverse proxy. Web, API
  (`/api`) and call signalling (`/rtc`) all live on it. With Jitsi, a second name such as
  `meet.example.com`.
- A reverse proxy that owns that name and its TLS certificate (Nginx Proxy Manager, Traefik,
  Caddy, …), joined to the `publicweb` Docker network. SampConnect itself does no TLS.
- Firewall: 80/443 TCP for your proxy; for calls 7881 TCP, 7882 UDP, 3478 UDP and
  30000–30100 UDP (TURN relay).
  MongoDB and Redis are never published (they only exist on the internal network).
- Before the first start, run `sh scripts/check-ports.sh`. It lists any port the stack needs
  that another program already holds (see **Port already in use** below).

### Networks and ports

SampConnect publishes **no web port**. The `gateway` container serves one plain-HTTP site on
port 80 inside Docker, and your reverse proxy reaches it over the `publicweb` network as
`http://gateway:80`. The proxy owns the domain and the TLS certificate.

```
 browsers/phones ──HTTPS──► your proxy ──publicweb──► gateway:80 (nginx, plain HTTP)
                                                        /api/**  ──► api:4000 ──► mongo, redis
                                                        /rtc     ──► livekit:7880 (signalling)
                                                        /        ──► web:3000
                     host ports (call media only, all set in .env)
                     LIVEKIT_TCP_PORT  7881 ─┐
                     LIVEKIT_UDP_PORT  7882/udp (all call media)  ─ same network as the gateway: livekit
                     LIVEKIT_TURN_PORT 3478/udp                   (egress and the API reach it
                     LIVEKIT_TURN_RELAY_START-END 30000-30100/udp   as livekit:7880)
```

- **One address, one origin.** `/api/**` goes to the API (every API route is mounted under
  `/api`, Socket.IO at `/api/socket.io`), `/rtc` to LiveKit's signalling WebSocket, everything
  else to the web app. The browser sees one origin, so there is no CORS to configure: the API
  only answers same-origin browsers. The one exception is the Connect chat widget that
  organizations embed on their own websites; its allowed origins are set per module in
  **Integrations** (database), not in env.
- **`PUBLIC_WEB_URL` is the only address to set.** The API's public address is
  `PUBLIC_WEB_URL/api` and call signalling `PUBLIC_WEB_URL` as `wss://` (LiveKit clients add
  `/rtc`). `PUBLIC_API_URL` and `LIVEKIT_PUBLIC_URL` still override them if you need to.
- **Call media can't go through an HTTP proxy**, so those are the only ports the gateway
  publishes. LiveKit multiplexes the media of every call on `LIVEKIT_UDP_PORT` instead of a range
  of ports. The only range left is the TURN relay (30000–30100), below 32768 where Linux, macOS
  and Windows never hand out ports on their own. LiveKit and the Jitsi video bridge run inside the
  gateway's network namespace, so their ports come from the gateway without a proxy hop in the
  media path.
- **`publicweb` network.** Compose creates it if it doesn't exist. If your proxy already created
  it, set `PUBLIC_NETWORK_EXTERNAL=true`; set `PUBLIC_NETWORK` to use another name.
- The gateway takes the client address from `X-Forwarded-For` when the request comes from a
  private address (your proxy) and passes a single hop on, which the API's `trust proxy 1`
  expects, so rate limits and the audit log keep seeing real client IPs.
- **No proxy yet?** To try SampConnect on one machine, add the local file to `.env`:
  `COMPOSE_FILE=docker-compose.yml:deploy/local/docker-compose.local.yml`. It publishes the
  gateway on `http://localhost:8080` (loopback only, `LOCAL_HTTP_PORT`), which is also the
  default `PUBLIC_WEB_URL`. Don't use it in production.
- For local development, `docker compose -f docker-compose.dev.yml up -d` starts MongoDB and
  Redis on `127.0.0.1` (ports `MONGO_PORT`, `REDIS_PORT`) without touching the full stack. With
  `pnpm dev`, run `node scripts/dev-gateway.mjs` and open `http://localhost:8080`: it plays the
  gateway's part (`/api/**` and its WebSocket to the API on :4000, the rest to the web app on
  :3000), so development is one origin too.

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

Every published port moves the same way: `LIVEKIT_TCP_PORT`, `LIVEKIT_UDP_PORT`,
`LIVEKIT_TURN_PORT`, `LIVEKIT_TURN_RELAY_START`/`END`, with Jitsi `JITSI_JVB_PORT`, and with the
local file `LOCAL_HTTP_PORT`.
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
PUBLIC_WEB_URL=https://connect.example.com
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
docker compose exec gateway wget -qO- http://127.0.0.1/api/health/ready
# {"status":"ok","mongo":"ok","redis":"ok"}
```

## 4. HTTPS reverse proxy

Your proxy joins the `publicweb` network and sends the whole domain to `http://gateway:80`.
It does TLS; the gateway does the routing (`/api/**` to the API, `/rtc` to calls, the rest to
the web app). It must pass WebSocket upgrades (Socket.IO at `/api/socket.io`, call signalling
at `/rtc`).

- **Nginx Proxy Manager:** a Proxy Host for `connect.example.com`, scheme `http`, forward
  hostname `gateway`, port `80`, **Websockets Support** on, an SSL certificate of your choice.
  No custom locations are needed.
- **Caddy** in a container on `publicweb`:

  ```
  connect.example.com {
    reverse_proxy gateway:80
  }
  ```

- **Traefik:** a router with the rule ``Host(`connect.example.com`)`` and a service pointing at
  `http://gateway:80`.

With Jitsi, add a second host (for example `meet.example.com`) pointing at `http://gateway:8000`.

**Upgrading from separate web/API/RTC hosts:** remove `CORS_ORIGINS`, `PUBLIC_API_URL`,
`LIVEKIT_PUBLIC_URL`, `NEXT_PUBLIC_RTC_URL`, `WEB_PORT`, `API_PORT`, `LIVEKIT_HTTP_PORT`,
`JITSI_HTTP_PORT` and `HTTP_BIND_IP` from `.env` (`scripts/check-ports.sh` lists the ones it
finds), set `PUBLIC_WEB_URL` to your one domain and point it at `gateway:80`. Then:
re-register the SSO redirect URI (`https://connect.example.com/api/v1/auth/sso/callback`,
**Test connection** shows it), update webhook URLs you gave to outside services (client
inbox channels, Stripe) to their new `/api/...` address shown in Integrations, and set the
mobile app's server address to the same domain (people sign in once more).

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
