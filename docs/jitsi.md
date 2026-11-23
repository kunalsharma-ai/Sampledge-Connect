# Jitsi Meet calls (branded as SampConnect)

SampConnect can run calls and meetings on your own **Jitsi Meet** server instead of (or as well
as) LiveKit. Jitsi is open source (Apache-2.0) and fully self-hosted: nothing goes to meet.jit.si,
8x8 or any other outside service. People never see Jitsi's name or logo: the server ships with
SampConnect's logo, name and favicon, and each organization's own logo and colours are applied
inside the call.

## What people see

- **Web**: the call opens inside SampConnect (full screen, like today's call screen). Around Jitsi,
  SampConnect keeps the conversation title, people count, the **lobby** for outside guests
  (Admit/Deny), the conversation **chat**, **Minimize** (the call keeps going while you use the app),
  **Leave** and **End for all**. Jitsi's own hang-up button also leaves.
- **Phones (Expo app)**: the same call in a WebView on the call screen, with Chat, Leave and End for
  all underneath and the lobby above. Needs a dev or store build (react-native-webview).
- **Guests from outside** (invite links, `/join/<token>`): after the host admits them from the lobby,
  they join the Jitsi call on the same page, starting with the microphone and camera they chose.
- Inside the call: the organization's logo top left, its brand colour on buttons, a dark SampConnect
  background, SampConnect's 24 photo backgrounds under "Select background", no Jitsi watermark,
  no "download the app" page, no invite dialogs, no gravatar, analytics or public STUN.

Ringing, missed-call cards, "Video call ended · 12m 03s" cards, live updates on every device and
push for incoming calls work exactly as with LiveKit, because SampConnect still owns the call record.

Not available on Jitsi calls yet: SampConnect recording (LiveKit Egress), SampConnect live captions,
SampConnect's own backgrounds and appearance controls (Jitsi has its own background picker). Calls
already running keep the engine they started on.

## Set it up

1. Add to `.env` (each is a long random value):

   ```
   JITSI_PUBLIC_URL=https://meet.example.com     # what browsers and phones open
   JITSI_APP_ID=sampconnect
   JITSI_APP_SECRET=...        # openssl rand -base64 48
   JITSI_JICOFO_PASSWORD=...   # openssl rand -hex 16
   JITSI_JVB_PASSWORD=...      # openssl rand -hex 16
   JITSI_ADVERTISE_IP=203.0.113.10   # the server's public (or LAN) IP
   ```

2. Turn it on and start it. Add this line to `.env`, then run `docker compose up -d`:

   ```bash
   COMPOSE_FILE=docker-compose.yml:deploy/jitsi/docker-compose.jitsi.yml   # Windows: use ; not :
   ```

   The Jitsi services live in that file, so their secrets are only needed when you use it. Like the
   rest of the stack they publish no ports of their own: the `gateway` publishes them (see
   "Networks and ports" in [deploy.md](deploy.md)).

3. Put `JITSI_PUBLIC_URL` behind your TLS reverse proxy (to port `JITSI_HTTP_PORT`, default 8000,
   or to `gateway:8000` on the `publicweb` network, with WebSocket upgrade for `/xmpp-websocket`
   and `/colibri-ws/`). Open **UDP 10000** (`JITSI_JVB_PORT`) for media. On a host without IPv6 set
   `JITSI_ENABLE_IPV6=0`.
4. In SampConnect: **Integrations → Calls (Jitsi Meet)**: server URL, app ID, app secret, and
   **Use Jitsi Meet for** (every call, or only when LiveKit isn't set up). **Test connection**,
   then **Save**. It applies at once on every device; no restart. Settings are stored encrypted in
   the database (platform admins can set a default for all organizations, an organization can use
   its own server).

The public meet.jit.si is refused on purpose: it can't check SampConnect's signed joins (anyone with
the link could join) and can't show your branding.

## How it works

| Piece                                                                | What it does                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy/jitsi/`                                                      | Branding baked into the server: SampConnect wordmark as the logo, favicon, page title, `custom-interface_config.js` (app name, no Jitsi watermark or promos) and `custom-config.js` (no welcome or pre-join page, no deep linking, no third-party requests, no peer-to-peer, trimmed toolbar). |
| `docker-compose.yml` (`jitsi-*` services)                            | jitsi/web, prosody, jicofo, jvb `stable-10314`. JWT auth on, guests off, public STUN off.                                                                                                                                                                                                      |
| API `calls/jitsi.ts`                                                 | Signs a join token (HS256 with the app secret, `iss`/`aud` = app ID, `sub` = organization, `room` = call, 4 h). Rooms are `<server>/<organizationId>/<callId>`.                                                                                                                                |
| `GET /v1/calls/jitsi/branding`                                       | Jitsi's `brandingDataUrl`. Jitsi calls it with `?conferenceFqn=<organizationId>/<room>` and gets the organization's logo, colours (`customTheme.palette`), background and SampConnect's photo backgrounds. Public with CORS `*`; it holds only what the sign-in page already shows.            |
| `POST /v1/calls/:callId/presence`, `POST /v1/guest/:token/presence`  | Jitsi doesn't tell SampConnect who is in a room, so apps say "still here" every 20 s. The sweeper marks anyone silent for 60 s as left, and ends the call when nobody is left.                                                                                                                 |
| Web `JitsiCallStage`, guest `GuestJitsiCall`, mobile `JitsiCallView` | Show the signed page, answer Jitsi's postMessage handshake (`readJitsiMessage` in contracts) and leave on `video-conference-left` / `video-ready-to-close`.                                                                                                                                    |

`GET /v1/calls/config` reports `provider: 'jitsi'` (with `recordingEnabled` and `captionsEnabled`
false). Join responses carry `join.engine: 'jitsi'` and `join.url` (the page to open, with the token).

The web app's Content-Security-Policy allows `frame-src https:` and its Permissions-Policy lets
frames ask for the camera and microphone, because the Jitsi address is set in the database, not at
build time. Only frames from https sites can load, and the browser still asks the person.

## Capacity

One 2-core, 4 GB server comfortably carries around 50 to 100 people in calls (Jitsi forwards media,
it doesn't mix it). For more, add videobridges (`jitsi-jvb` replicas on other machines pointed at
the same prosody).
