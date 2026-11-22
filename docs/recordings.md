# Recordings

Everything is self-hosted: clips are recorded in the browser, call recordings are made by
LiveKit Egress running next to the SFU, and every file is stored in the tenant's attachment
storage (MongoDB GridFS, or Nextcloud when an admin turns it on; see storage.md).
Nothing is sent to a third-party service.

## What can be recorded

| Kind     | Where                               | Format                                                                                         |
| -------- | ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `voice`  | Composer: microphone button         | WebM/Opus (Chrome, Edge, Firefox), M4A/AAC (Safari, mobile)                                    |
| `video`  | Composer: camera button             | WebM VP8/VP9 + Opus (Chrome, Edge, Firefox), MP4 H.264 + AAC (Safari, mobile)                  |
| `screen` | Composer: screen button (computers) | Same as video. Records the chosen screen, window or tab, its audio when offered, and the mic   |
| `call`   | Call controls: "Record this call"   | MP4 (H.264 + AAC) for video calls, M4A (AAC) for voice calls; speaker layout with screen share |

Chat clips are capped at 30 minutes and 100 MB, can be paused, reviewed and re-recorded, then
sent at once or added to a message. Call recordings default to a 2 GB / 4 hour limit
(`RECORDING_MAX_BYTES`, `RECORDING_MAX_MINUTES`).

## Consent

While a call is recorded, every participant sees a red **Recording** badge with who started it
(`call.recording`, pushed with `call:updated`). Anyone in the call can start or stop it, and
admins can switch call recording off for the whole organization.

## Retention, deletion and backup

- **Manual delete**: the person who recorded it, a conversation owner/moderator, or a tenant
  admin (`DELETE /v1/recordings/:id`). The bytes are removed; the message shows
  "Recording deleted" on every device (`attachments[i].deletedAt`, synced offline).
- **Automatic delete**: admins choose Off, 30/90/180/365 days or a custom number of days
  (`PUT /v1/admin/recording-settings`). An hourly job (Redis-locked) deletes older recordings
  and records an audit event. Each recording shows its deletion date.
- **Backup**: anyone can download a recording (`&download=1` on its signed link). Admins can
  download every recording in a date range as one ZIP, in folders per conversation, with a
  `manifest.csv` (`POST /v1/admin/recordings/export`, up to 4 GB per ZIP, signed 30-minute link).

## API

| Endpoint                                           | Who                          |
| -------------------------------------------------- | ---------------------------- |
| `POST /v1/uploads` with `recording`, `durationMs`  | members (clips)              |
| `GET /v1/recordings?conversationId=&kind=&before=` | members                      |
| `DELETE /v1/recordings/:id`                        | recorder, moderators, admins |
| `GET/PUT /v1/admin/recording-settings`             | owners, admins               |
| `POST /v1/admin/recordings/export`                 | owners, admins               |
| `POST /v1/calls/:id/recording/start` and `/stop`   | people in the call           |

Signed file links support HTTP Range requests so audio and video can seek.

## Running the recorder

`docker compose up -d` starts `egress` (livekit/egress) with a `recordings-spool` volume shared
with the API. The pieces that must line up:

1. LiveKit and egress share Redis (`redis:` in both configs).
2. The API has `RECORDINGS_SPOOL_DIR` (its path to the volume) and
   `LIVEKIT_EGRESS_OUTPUT_DIR` (egress's path to the same volume, `/out`).
3. `LIVEKIT_NODE_IP` must be an address egress's Chrome can reach. Do not use `127.0.0.1`
   when egress runs in another container: its WebRTC connection fails and the recording
   reports "Start signal not received". Use the server's LAN or public IP.
4. Each concurrent recording needs about 2 CPU cores and 2 GB RAM. The egress container needs
   `shm_size: 1g` (set in `docker-compose.yml`); Chrome crashes with Docker's 64 MB default.

Flow: start → egress joins as a hidden participant → `egress_updated` (active) → stop, call end
or time limit → egress writes the file → `egress_ended` webhook (or the API's sweeper, which
re-checks with `ListEgress` if a webhook is lost) → the API moves the file into storage, posts
it in the conversation as a **Call recording** card and deletes the spool copy.

## Minutes and chat export settings

The **Settings & backup** panel also holds the organization's minutes and chat export settings:
who can export chats, the default minutes template and language, and whether live captions are
kept for minutes. See `minutes.md`.
