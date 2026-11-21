# Voice and video calls

Calls run entirely on infrastructure you host. There is no third-party media, signalling, STUN or TURN service.

## How it works

| Piece                                                              | Role                                                                                                                                                                                                                       |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LiveKit server** (`livekit` in `docker-compose.yml`, Apache-2.0) | Self-hosted SFU. Carries audio, video and screen share (WebRTC, DTLS-SRTP). Has a built-in TURN server for clients behind NAT.                                                                                             |
| **API** (`apps/api/src/calls`)                                     | Owns the call record in MongoDB (`calls` collection), checks conversation membership, rings invitees over Socket.IO and push, issues 10-minute join tokens scoped to one room, posts the call card into the chat.          |
| **Web** (`livekit-client`)                                         | Call buttons in the conversation header, incoming call card with ringtone, call stage (grid, active speaker, screen share, raise hand, mute, camera), minimized pill so the chat stays usable, call cards in the timeline. |

A conversation has at most one live call (unique partial index). Starting a call while one is live joins it.
Rooms are created by the API and `auto_create` is off, so a leftover token cannot reopen an ended call.
Room names embed the tenant id, so a token can never reach another tenant's call.

The call record is kept in step with the SFU in three ways: REST join/leave from clients, signed LiveKit webhooks
(`POST /v1/calls/livekit/webhook`, verified against the API secret and a SHA-256 of the body), and a sweeper
that every 10 s expires unanswered rings (`CALL_RING_TIMEOUT_SECONDS`, default 45) and reconciles live calls
with the SFU's participant list, so a closed tab or crashed phone never leaves a call "live".

A call ends when nobody is left in it, when the caller is alone and every invitee declined or missed it,
or when the caller or a conversation owner/moderator ends it for everyone. The chat card then shows
"Video call ended · 12m 03s", "Missed voice call" or "Voice call declined".

## API

| Method | Path                                            | Notes                                                                                                                  |
| ------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/calls/config`                              | `{ enabled, provider, ringTimeoutSeconds }`. Clients hide or disable call buttons when `enabled` is false.             |
| GET    | `/v1/calls/active`                              | Live calls in the caller's conversations.                                                                              |
| POST   | `/v1/conversations/:id/calls`                   | `{ media: 'audio' \| 'video' }`. Starts (or joins the live) call. Returns `{ call, join: { url, token, expiresAt } }`. |
| GET    | `/v1/conversations/:id/calls/active`            | `{ call }` or `{ call: null }`.                                                                                        |
| GET    | `/v1/calls/:callId`                             | Call record. Non-members get 404.                                                                                      |
| POST   | `/v1/calls/:callId/join`                        | Returns `{ call, join }`. 409 if the call ended.                                                                       |
| POST   | `/v1/calls/:callId/leave` · `/decline` · `/end` | `end` is for the caller or conversation owner/moderator.                                                               |

Socket events: `call:ringing` `{ call, callerId, conversationId, media, expiresAt }` to each invitee,
`call:updated` and `call:ended` (a `Call`) to the conversation room. Push data for a ringing call is
`{ type: 'call', callId, conversationId, media, callerId, expiresAt }`. Call cards are `messageType: 'system'`
messages whose `metadata.call` is `CallSystemMetadata` (`status`: started, ended, missed, declined); the card
is updated in place when the call ends, so it syncs like any edit.

## Configuration you must provide

| Variable              | Where                            | Example                                                                         |
| --------------------- | -------------------------------- | ------------------------------------------------------------------------------- |
| `LIVEKIT_API_SECRET`  | compose `.env` (API and LiveKit) | `openssl rand -base64 48` (32+ chars)                                           |
| `LIVEKIT_API_KEY`     | compose `.env`                   | `sampledge` (default)                                                           |
| `LIVEKIT_PUBLIC_URL`  | API                              | `wss://rtc.example.com` (what browsers and phones connect to)                   |
| `LIVEKIT_NODE_IP`     | LiveKit                          | The server's public IP (VPS) or LAN IP (on-premises)                            |
| `NEXT_PUBLIC_RTC_URL` | web build                        | Same as `LIVEKIT_PUBLIC_URL`; it is added to the page's Content-Security-Policy |

Open these ports on the server: TCP 7880 (signalling, put it behind your TLS reverse proxy as `wss://`),
TCP 7881, UDP 3478 (TURN), UDP 50000–50200 (media and TURN relay).

Browsers only allow camera and microphone on `https://` (or `localhost`), so production needs TLS on both
the web app and the SFU URL. For networks that block UDP entirely, enable LiveKit's TURN/TLS on 443 with your
certificate (`turn.tls_port`, `turn.domain`, `turn.cert_file`, `turn.key_file`).

Without the `LIVEKIT_*` variables the API runs normally, `GET /v1/calls/config` reports `enabled: false`,
and the call buttons are disabled with an explanation.

## Built now and planned

Built: 1:1 and group voice/video calls in any conversation, ringing with timeout, decline, join from chat,
screen share (with tab audio), raise hand, mute/camera, active speaker, end for everyone, call history cards,
incoming-call push data, reconnect handling, multi-replica safe sweeper.

Also built: scheduled meetings (`meetings.md`), external guests with a lobby (`guests.md`) and recordings
(`recordings.md`). Planned next: in-call chat panel, device picker, background blur, live captions. Mobile call screen
(`@livekit/react-native`, needs an Expo dev build).
