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

Connect the API to the media server in **Integrations → Calls (LiveKit)**: public URL, API URL,
API key and secret (stored encrypted), with **Test connection**. Platform operators set the
default for everyone; an organization can bring its own server (calls and meetings work;
recording needs the platform server, see `integrations.md`). Saving takes effect at once on
every API node. The env variables below still work as a fallback and are what the bundled
LiveKit container reads.

| Variable              | Where                            | Example                                                                                                                |
| --------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `LIVEKIT_API_SECRET`  | compose `.env` (API and LiveKit) | `openssl rand -base64 48` (32+ chars)                                                                                  |
| `LIVEKIT_API_KEY`     | compose `.env`                   | `sampledge` (default)                                                                                                  |
| `LIVEKIT_PUBLIC_URL`  | API                              | `wss://rtc.example.com` (what browsers and phones connect to)                                                          |
| `LIVEKIT_NODE_IP`     | LiveKit                          | The server's public IP (VPS) or LAN IP (on-premises). Never `127.0.0.1`: egress fails with "Start signal not received" |
| `NEXT_PUBLIC_RTC_URL` | web build                        | Same as `LIVEKIT_PUBLIC_URL`; it is added to the page's Content-Security-Policy                                        |

Open these ports on the server: TCP 7880 (signalling, put it behind your TLS reverse proxy as `wss://`),
TCP 7881, UDP 3478 (TURN), UDP 50000–50200 (media and TURN relay).

Browsers only allow camera and microphone on `https://` (or `localhost`), so production needs TLS on both
the web app and the SFU URL. For networks that block UDP entirely, enable LiveKit's TURN/TLS on 443 with your
certificate (`turn.tls_port`, `turn.domain`, `turn.cert_file`, `turn.key_file`).

Without a media server (Integrations or `LIVEKIT_*`) the API runs normally, `GET /v1/calls/config`
reports `enabled: false`, and the call buttons are disabled with an explanation.

## Built now and planned

Built: 1:1 and group voice/video calls in any conversation, ringing with timeout, decline, join from chat,
screen share (with tab audio), raise hand, mute/camera, active speaker, end for everyone, call history cards,
incoming-call push data, reconnect handling, multi-replica safe sweeper.

Also built: scheduled meetings (`meetings.md`), external guests with a lobby (`guests.md`) and recordings
(`recordings.md`), chat inside calls (`guests.md`) and live captions (below). Mobile call screen
(`@livekit/react-native`, needs an Expo dev build). On the phone, **Flip** switches between the
front and back camera mid-call (the preview is mirrored only for the front camera), and **Audio**
chooses where the call plays: speaker, earpiece, wired headset or Bluetooth on Android; phone or
speaker on iPhone, plus the system picker for Bluetooth and AirPlay. Video calls start on the speaker
and voice calls on the earpiece; a connected headset or Bluetooth device is used first. Background
blur stays web-only.

## Live captions

Anyone in a call (members and admitted guests) can press the captions button to see live captions.
Captions use the organization's own speech-to-text server, the same one saved in Integrations as
**Speech-to-text server** for recording transcripts (`ai.md`). Without one, the button is hidden.

How it works, with nothing leaving your servers and nothing stored:

1. Turning captions on sets the participant attribute `captions: "1"`. Everyone else sees a notice that
   speech is being transcribed.
2. While anyone has captions on, each person's app records its own microphone in 4-second clips and
   skips clips that are silent (so muted or quiet people send nothing).
3. Each clip goes to `POST /v1/calls/:callId/captions` (members, must be in the live call) or
   `POST /v1/guest/:token/captions` (admitted guests) as raw audio (`audio/webm`, `ogg`, `mp4`, `mpeg`,
   `wav`, `aac`, up to 512 KB). The API forwards it to the speech-to-text server and returns `{ text }`.
   Rate limit: 40 clips a minute per person. 503 when no server is set up.
4. The speaker's app shares `{ id, name, text }` with the call on the LiveKit data channel (reliable,
   topic `captions`). Lines show with the speaker's name for 9 seconds.

When the last person turns captions off, clips stop. `GET /v1/calls/config` has `captionsEnabled`, and the
guest join state has `captions`, so apps know whether to show the button. A server like Speaches
(faster-whisper) on a small GPU keeps captions about 4 to 6 seconds behind speech; on CPU use a small
model.

On mobile, the **Captions** button in a call does the same: it sets the `captions` attribute and shows
everyone's caption lines over the controls, with the speaker's name. Sending your own speech needs
MediaRecorder, which the web build has but the native WebRTC module does not yet, so a phone shows
everyone else's captions and says "your own speech isn't captioned from this phone yet" (planned).

## Devices and backgrounds

The settings button in a call (members and guests) picks the microphone, camera and speaker, and the
background. Switching happens mid-call without dropping. Devices are saved on that device (browser
storage) and used for the next call; a guest's lobby preview uses the saved camera too.
Speaker choice shows only in browsers that can route audio (Chrome, Edge).

Background effects run entirely in the browser: MediaPipe selfie segmentation (Apache 2.0) over WebGL,
through `@livekit/track-processors`. The model (`public/vision/selfie_segmenter.tflite`, 250 KB) is in
the repository and the WebAssembly runtime is copied from `node_modules` into `public/vision` when the
web app builds (`scripts/copy-vision-assets.mjs`), so nothing loads from a CDN. The web CSP allows
`'wasm-unsafe-eval'` for this, which permits compiling WebAssembly only. Blur stays on when the camera
is turned off and on again. Browsers without WebGL or insertable streams show "Not supported".

### Backgrounds

Choices: none, blur, 20 prebuilt backgrounds (15 office scenes such as a skyline office, boardroom,
library, glass meeting room, reception and mountain or seaside views, and 5 simple ones), your own
image, and the company background.

- **Prebuilt images** are original artwork shipped with the web app (`apps/web/public/backgrounds`,
  1280x720 plus 320x180 thumbnails, about 1 MB in total). They are drawn by
  `apps/web/scripts/make-call-backgrounds.mjs`, so they can be changed or added there and regenerated
  (needs Playwright). The list is `CALL_BACKGROUND_PRESETS` in the contracts.
- **Your own images**: up to 12 per person (PNG, JPEG or WebP, shrunk in the browser to at most
  1920x1080, 2 MB each), stored with your account and shown under **Yours** with a remove button.
  They are served from unguessable links like profile photos.
- **Company library**: admins upload up to 40 backgrounds in **Administration → Calls** that everyone
  in the organization can pick (shown under **Company**); one of them can be the default.
- **Company background**: drawn in the browser from Branding (logo, colors and organization name),
  so changing Branding updates it in every call. The logo sits inside the middle of the frame so it
  stays visible when a call tile crops the picture.

Members' choice is saved to their account, so every device uses it, and a change on one device is
applied to a call in progress on another. A choice made offline is sent on reconnect. Guests from
outside pick blur or a prebuilt image, remembered in their browser.

Admins set this in **Administration → Calls**: the default background for people who haven't picked
one, and **Require the company background**, which puts everyone in the organization on the company
background and locks the picker (external guests keep their own). Changes reach calls in progress.

Your own preview is mirrored like a mirror, so text in the background reads backwards to you; everyone
else sees it the right way round.

<<<<<<< HEAD

| Method                                                                                               | Path                                                                | Who            | Notes                                                  |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------- | ------------------------------------------------------ |
| GET                                                                                                  | `/v1/me/call-background`                                            | member         | Choice, what applies now, own image link, rules, brand |
| PUT                                                                                                  | `/v1/me/call-background`                                            | member         | `{kind: none, blur, preset (+presetId), custom, logo}` |
| PUT                                                                                                  | `/v1/me/call-background`                                            | member         | also `{kind: 'upload', imageId}` (mine or company)     |
| POST                                                                                                 | `/v1/me/call-backgrounds?name=`                                     | member         | Raw PNG/JPEG/WebP body, 2 MB; adds and selects it      |
| DELETE                                                                                               | `/v1/me/call-backgrounds/:imageId`                                  | member         | Removes one of mine                                    |
| PUT                                                                                                  | `/v1/me/call-background/image`                                      | member         | Older single-image form of the POST above              |
| DELETE                                                                                               | `/v1/me/call-background/image`                                      | member         | Older form: removes my latest image                    |
| PUT                                                                                                  | `/v1/me/call-appearance`                                            | member         | My look (see Appearance below)                         |
| PUT                                                                                                  | `/v1/admin/call-backgrounds`                                        | owner, admin   | `{defaultChoice, enforceLogo}`                         |
| POST                                                                                                 | `/v1/admin/call-backgrounds/images?name=`                           | owner, admin   | Adds to the company library                            |
| DELETE                                                                                               | `/v1/admin/call-backgrounds/images/:imageId`                        | owner, admin   | Removes it (a default using it goes back to none)      |
| GET                                                                                                  | `/v1/call-backgrounds/:tenantId/:key`                               | anyone w/ link | The image, 128-bit random key, changes on every upload |
| =======                                                                                              |
| On mobile, **More → Call background** shows the same choices: none, blur, the company background     |
| (drawn from Branding), your own image and the 20 prebuilt scenes (their 320x180 thumbnails ship in   |
| the app). Picking one, uploading your image (shrunk on the phone to fit 1920x1080 as JPEG, under     |
| 2 MB) and removing it are queued offline as `callbg.set`, `callbg.image` and `callbg.imageRemove` on |
| one target, so they reach the server in the order you made them. The image waits in app storage      |
| until it is sent. The screen follows `meetings:changed {area: 'call_background'}` and                |
| `tenant:updated {area: 'calls'                                                                       | 'branding'}` live. Owners and admins get **Manage** for the default |
| and **Require the company background** (needs a connection). Applying a background to a phone's own  |
| camera is planned: native WebRTC has no segmentation yet, so a phone sends the camera as it is, and  |
| the screen says so.                                                                                  |

| Method | Path                                  | Who            | Notes                                                  |
| ------ | ------------------------------------- | -------------- | ------------------------------------------------------ |
| GET    | `/v1/me/call-background`              | member         | Choice, what applies now, own image link, rules, brand |
| PUT    | `/v1/me/call-background`              | member         | `{kind: none, blur, preset (+presetId), custom, logo}` |
| PUT    | `/v1/me/call-background/image`        | member         | Raw PNG/JPEG/WebP body, 2 MB; selects it               |
| DELETE | `/v1/me/call-background/image`        | member         | Removes it (back to the default if it was in use)      |
| PUT    | `/v1/admin/call-backgrounds`          | owner, admin   | `{defaultChoice, enforceLogo}`                         |
| GET    | `/v1/call-backgrounds/:tenantId/:key` | anyone w/ link | The image, 128-bit random key, changes on every upload |

> > > > > > > origin/main

Live updates: `meetings:changed {area: 'call_background'}` to all of my devices, and
`tenant:updated {area: 'calls'}` (rules) or `{area: 'branding'}` (logo, colors) to everyone.

### Appearance

The **Appearance** tab in call settings changes how you look on camera, for everyone in the call:

- **Looks** (one tap): Natural, Fresh, Warm, Cool, Vivid, Soft glow, Studio, Black and white, Noir
  and Vintage (`CALL_LOOK_FILTERS` in the contracts, shared with mobile).
- **Light and colour**: brightness, contrast, colour (saturation), warmth and low light (lifts dark
  areas in a dim room).
- **Touch-up**: smooth skin (edge-preserving, stronger on skin tones) and sharpness.
- **Face shaping**: slim face, bigger eyes and slimmer nose. The face is found with the MediaPipe face
  landmarker (`public/vision/face_landmarker.task`, Apache 2.0) on the device; the settings show
  "Face found" once it is tracking. Moves are averaged and capped so the picture never folds.
- **Enhance** sets a natural touch-up in one tap; **Reset** goes back to the camera picture.

Everything runs on the device in one WebGL pass, before the background step, so looks and backgrounds
combine (`apps/web/lib/camera-effects.ts`). With no look and no background the camera is not
processed at all. Members' look is saved to their account (`appearance` in
`GET /v1/me/call-background`), applied live on their other devices and queued while offline; guests'
look stays in their browser.

When an admin turns on **Keep live captions for minutes**, caption lines are saved with speaker
names for the minutes and the captions notice says so. See `minutes.md`.
