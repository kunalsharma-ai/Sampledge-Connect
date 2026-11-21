# SampConnect mobile (`@sampledge/mobile`)

Native iOS and Android app for SampConnect, built with Expo SDK 58, React Native 0.88,
Expo Router and TypeScript. It shares wire contracts with the web app and API through
`@sampledge/contracts`, and is offline-first: every action is written to an encrypted on-device
SQLite database before the network is touched.

## Run it

Requirements: Node 26.13.1 (see the repo `.nvmrc`) and pnpm 12.

```bash
pnpm install                                   # from the repo root
pnpm --filter @sampledge/contracts build       # the app imports the built contracts
cd apps/mobile
npx expo run:ios      # or: npx expo run:android
```

A development build is required (not Expo Go) because the app enables SQLCipher through the
`expo-sqlite` config plugin. On the sign-in screen either enter a server address, workspace,
email and password, or choose **Explore the offline demo**, which seeds sample conversations
locally and never contacts a server (messages you send there stay queued, by design).

```bash
pnpm --filter @sampledge/mobile test        # offline engine tests (Vitest, real SQLite via node:sqlite)
pnpm --filter @sampledge/mobile typecheck
```

## Screenshots (web preview)

The app also builds for the web, only to preview it and take screenshots (it is not shipped to users there:
no SQLCipher in browsers, and tokens use localStorage via `*.web.ts` files). Phone-size screenshots of
the demo workspace:

```bash
pnpm web:export && pnpm screenshots   # needs Playwright with Chromium; writes screenshots/*.png
```

## End-to-end against a real API

With `apps/api` running locally (Mongo and Redis up, default `http://localhost:4000`) and an empty
database, this seeds a workspace (Northwind Research, four members, a channel and a DM), signs in as
Sam through the web preview and checks sign-in, cursor sync, a live Socket.IO message, an offline
queued send and recovery of a message missed while offline. It exits non-zero on any failure.
`scripts/e2e-offline-actions.cjs` covers the rest of the offline queue: pin, save, poll, task and
approval made offline (and across an app restart), delivered once on reconnect, then a change from
another device arriving live.

```bash
pnpm web:export
node scripts/e2e-seed.mjs
node scripts/serve-web.mjs dist-web 8099 &
node scripts/e2e-real-server.cjs screenshots/e2e   # API=… APP=… override the defaults
```

The calls part runs when the API has `LIVEKIT_*` set and a LiveKit server is up (for example
`docker compose up livekit`, or `livekit/livekit-server` with `--network host` and the webhook at
`http://127.0.0.1:4000/v1/calls/livekit/webhook`). It signs in a second phone as Priya, rings,
answers with a fake camera and microphone, and checks media, raised hand, end for everyone, the
join banner and decline. Without a media server it is skipped.

The last part covers membership: browsing and joining a public channel Sam is not in, creating
a group and a private channel from the people picker, adding and removing people from the
details screen, leaving, and signing out another device from Settings, Devices. Then meetings:
scheduling from suggested times, answers arriving live, the card in the meeting chat, an
invitation answered offline and delivered on reconnect, the server's reminder banner (waits up
to a minute for the reminder sweep), joining the meeting's call, working hours and cancelling. Then recordings: a voice message
recorded with the fake microphone (sent online, and recorded offline then delivered once on
reconnect), playback, the Recordings library with its filters, delete for everyone ("Voice
message deleted" in the chat), and, when the API can record calls, Record and Stop in a call,
the red indicator, the finished recording arriving in the chat and playing in the player. Last, external guests:
a guest added by email on the scheduling form (members are refused), the guest list with its
invite status and a copied join link, and two guests waiting in a live meeting call's lobby, one
admitted (gets a call token) and one denied. Then chat during a call (opening the call's
conversation, returning to the same call, and the unread count on Chat), and Integrations: a
member is told only admins can change them, and the owner saves SMTP settings with a password
that the server keeps encrypted and never returns, then runs Test connection. Then two-step
sign-in (code step, wrong code, recovery-code option, a real authenticator code), and pins and
saved messages (pin from the message sheet, another member's pin arriving live, the pinned
list with Unpin, Save for later and the Saved messages screen), polls (post, vote, a vote
arriving live, change a vote, close), and scheduled messages and announcement channels (Send
later, the scheduled list with Change time, Delete and Send now, the read-only composer for
members, and the owner's switch in details), and tasks and approvals (Create task from a
message with an assignee, due date and priority; Request approval with an amount and an
approver; both cards in the conversation; the approver deciding from To decide; ticking a task
done from the list), and the AI assistant (Ask with numbered sources, the status digest, search
by meaning opening the message, suggested replies filling the composer, Translate, a channel
summary shared only after Send, and the owner's on/off switch), and white-label branding (the
owner sets the name, logo, colors and sign-in message on the phone; the sign-in screen shows them
once the workspace is typed; members start on the organization theme; an enforced theme locks
Appearance), and administration (the owner's overview; adding a member, changing their role,
deactivating and reactivating them, checked against the server; the audit log by category and
for one person; everyone's devices).

Call recording needs the LiveKit egress worker next to the SFU, sharing its Redis, with
`RECORDINGS_SPOOL_DIR` on the API pointing at the folder egress writes to. Locally:
`livekit/egress` with `--network host --shm-size=1g --cap-add SYS_ADMIN -v <spool>:/out`.
LiveKit's `rtc.node_ip` must be a real interface address, not 127.0.0.1, or the recorder's
browser cannot connect and egress aborts with "Start signal not received".

## How offline-first works

| Piece              | File                                             | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local database     | `src/db/store.ts`, `src/db/migrations.ts`        | Conversations, messages, receipts, drafts and the outbox in SQLite. Versioned migrations; if a migration fails or the cache is from a newer app, it is rebuilt and unsent messages and drafts are carried over.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Encryption at rest | `src/db/expoDriver.ts`, `src/auth/session.ts`    | SQLCipher database keyed with a random per-install key kept in the iOS Keychain / Android Keystore (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`). Tokens live there too. Android backup is disabled.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Durable send queue | `LocalStore.enqueueSend`, `src/sync/outbox.ts`   | Message row and outbox row commit in one transaction before any network attempt, with a client UUIDv7 `clientMessageId` that the server uses as the idempotency key. Drained oldest first. Network errors back off with full jitter and retry forever; retryable server errors retry up to 8 times; permanent errors become `failed` with the reason, with manual retry or discard. Anything left `sending` after a crash is requeued.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Status             | `src/components/StatusIcon.tsx`                  | `draft`, `queued`, `sending`, `sent`, `delivered`, `read`, `failed`, each with its own glyph. Delivered and read come from receipt watermarks via `deriveConfirmedStatus`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Cursor sync        | `src/sync/syncEngine.ts`                         | `POST /v1/sync` with one `afterChangeSequence` cursor per conversation; pages until `hasMore` is false, picks up new conversations, purges revoked ones, then enforces the cache quota. Runs on connect, reconnect, foreground and pull to refresh. This is what recovers anything missed while offline.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Realtime           | `src/sync/realtime.ts`                           | Socket.IO with token auth and jittered reconnect. Events are applied idempotently by `changeSequence` but never move the cursor, so a dropped event is always recovered by sync. Sending prefers the socket ack and falls back to REST with the same `clientMessageId`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Multi-device       | `LocalStore.applyServerMessages`                 | Rows are keyed by `clientMessageId`, so a message sent from the web shows up once, and a local pending message is merged when the server copy arrives from any path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Session expiry     | `src/auth/session.ts`, `src/state/engine.ts`     | Access tokens refresh a minute before expiry. If the refresh token is rejected the app shows "Signed out by the server", keeps the cache readable and the queue intact, and resumes sending after sign-in.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Every other action | `src/db/work.ts`, `OutboxProcessor.drainActions` | Pins, saved messages, polls (create, vote, close), scheduled messages (create, change time, send now, delete), tasks (create, edit) and approvals (request, decide, cancel) are written to an `actions` queue (schema v12) and shown at once, then sent strictly in order on reconnect. Repeats collapse into the latest intent; edits to something created offline fold into its create, and later changes follow the server id it gets. Tasks, approvals, scheduled and saved lists are cached in `work_cache`, so they open offline, are re-read from the server after each reconnect, and update live from your other devices (`task:upsert`, `approval:upsert`, `scheduled:updated`, `bookmark:updated`, `poll:myVote`). Organization changes made elsewhere apply live too: `directory:updated` refreshes names and the people picker, `tenant:updated` reloads branding, the assistant's on/off state and the Integrations screen, and `project:changed` is passed on for the projects screen (Planned on mobile). A refused create is kept as "Not sent" with Try again and Discard; any other refused change is dropped (the server's copy shows again) with a short banner. Still online-only: meeting scheduling and edits, membership changes, archiving, admin and AI. |
| Quota              | `LocalStore.enforceQuota`                        | Keeps the newest 1,000 confirmed messages per conversation and 25,000 overall; never evicts unsent messages.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Indicators         | `src/components/Connectivity.tsx`                | Animated header dot plus an explicit banner for offline, reconnecting, signed-out and demo states, with the queued count.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## Design

Five themes from the product spec (Midnight Executive, Arctic Professional, Royal Graphite,
Emerald Enterprise, and a custom brand theme with light and dark variants), chosen under
More, Appearance and persisted on the device. "Match device" uses Midnight Executive in dark
mode and Arctic Professional in light mode. Muted text colours are derived with a WCAG
contrast check (see `src/theme/themes.test.ts`). Inter is the typeface. Animations use
Reanimated at 150 to 250 ms and switch off when the OS asks for reduced motion.

Navigation: bottom tabs for Home, Messages, Client Inbox, Activity and More. More is the
context drawer for the remaining product areas from the spec.

When `@sampledge/design-tokens` lands, `src/theme/themes.ts` should read the brand values
from it instead of its own `BASE` table.

## What is built and what is planned

Built: sign-in against the API contract, local demo workspace, conversation list with
filters and unread counts, conversations with optimistic sending, every message status,
retry and discard of unsent messages, draft autosave, typing indicators (when online), read
receipts, replies (quoted, tap to jump to the original), @mentions with a member picker and
offline edits and deletes of your own messages (queued like sends,
rolled back with the reason if the server refuses), reactions (chips under messages and a
quick row in the long-press sheet; offline toggles collapse into the last intent), photo and
file attachments (copied into app storage when picked, uploaded with the message when online,
opened through short-lived signed links), in-app notifications (Activity lists mentions of you
and replies to you from `GET /v1/notifications`, cached for offline use, with a tab badge, a live
banner when one arrives while you are elsewhere, and read marks that work offline and match your
other devices; opening a conversation clears its items), a per-conversation notification level
(all activity, @mentions only or nothing; set from the bell in the conversation header, works
offline and follows changes made on other devices), voice and video calls in any conversation
through the self-hosted LiveKit server (call buttons when the server has one configured, a
full-screen incoming call with accept, voice only or decline, a join banner for live calls,
mute, camera, raise hand, leave and end for everyone, call cards in the timeline that render
offline; media uses livekit-client, with @livekit/react-native on iOS and Android, so calls on a
phone need a dev build, not Expo Go), starting a direct message, group or channel (public or
private) from a people picker that works from the cached directory, browsing and joining public
channels (unjoined ones are read-only and stay out of your list and unread counts), a details
screen with members, add and remove people, leave, and archive for those allowed (the same
permission rules the server uses decide which buttons appear; these changes need a connection
and say so offline), a Devices screen that lists where you are signed in and signs other
devices out, server-side sign-out of this device (its refresh and push tokens stop working),
scheduled meetings (a Meetings screen with a two-week day strip, upcoming and past, cached on
the phone for the last week and next eight; scheduling with a people picker, length, video or
voice, suggested times where everyone is free and inside their working hours, a manual time grid
that marks clashes without showing anyone's meeting titles, up to three reminders and an agenda;
editing, rescheduling and cancelling for the organizer; Going, Maybe or Not going answers that
work offline and are sent when back online; Join, which opens 15 minutes before the start and
joins the meeting chat's call; meeting cards in the chat that open the meeting; a reminder
banner with Join; meeting pushes open the meeting; working hours in Settings; the next meeting
on Home), voice messages (tap the mic when the field is empty; records mono AAC on phones,
up to 30 minutes, with a red timer, discard and send; the clip is copied into app storage and
queued like any file, so it sends offline-safe; inline player with progress), video messages on
phones (Attach, Video message, through the system camera), inline players for audio and video
clips and call recordings (video opens a full-screen player with native controls and picture
in picture), "Recording deleted" in place of removed clips, call recording (Record and Stop on
the call screen when the server allows it, a red Recording indicator with who started it for
everyone in the call, and the finished recording delivered into the chat as a card with its
player), a Recordings library (More, Recordings, or a conversation's details) with filters for
voice, video, screen and calls, paging, playback and delete for those allowed, external meeting
guests (added by email when scheduling or editing, refused if they are in your organization;
the meeting shows each guest's answer and invite email status, and the organizer can share a
guest's personal join link or resend the invitation), the call lobby (everyone in the call sees
guests waiting with Admit and Deny, gets a nudge when one arrives, and sees admitted guests as
"Name (guest)"; guest messages in a meeting chat are named the same way), chat during a call
(Chat on the call screen with an unread count), Integrations for owners and admins (More,
Integrations: email, calls, push and AI connections stored encrypted in the server database
and applied at once, with Test connection; secrets can be replaced or removed but are never
shown), two-step sign-in (authenticator or recovery code), pins (a bar under the conversation
header with the newest pin, a pinned list, pin and unpin from the message sheet, kept on the
device so they show offline) and saved messages (Save for later, More, Saved messages), polls
(+ menu, Poll: multiple choice, anonymous, closing time; vote on the card with live results;
Close poll for the author and moderators), scheduled messages (+ menu, Send later, or hold the
send button; quick times or a day and time; the server sends them as you; a banner in the
conversation and More, Scheduled messages to send now, change the time or delete), announcement
channels (members get a read-only bar; owners and moderators switch it in details), tasks and
approvals (hold a message and choose Create task or Request approval; assignees or approvers,
due date, priority, category and amount; task and approval cards in the conversation open the
details; More, Tasks & Approvals lists My tasks, To decide, Created by me and Requested, with a
tick to finish a task, status changes, and Approve or Reject with a comment), the private AI
assistant (More, AI Assistant: Ask about your conversations with sources, search by meaning and
a status digest with suggested tasks; Summarize conversation in the + menu and conversation
details, Summarize meeting on a meeting; Suggest replies in the + menu; Translate on a message;
a summary is shared only after you press Send, with an extra tick for sensitive drafts; owners
and admins turn it on or off), white-label branding (the organization's logo and name on Home
and the sign-in screen, its sign-in message, and its theme: members start on it or always see it
when the owner says so; owners edit name, logo, colors, mode, sign-in message and support links in
More, Branding; the last copy is kept on the device), administration for owners and admins in
More, Administration (the organization at a glance: members, two-step share, devices, messages,
storage, plan, sign-in mode; members with search, add, role, reset two-step, deactivate and
reactivate, and their activity; the audit log with search, categories and paging; every device
with sign-out; lists refresh when you return to them and after each sync), on-device
search, themes, offline and storage settings, sign-out with a warning
when queued messages would be lost.

Planned (shown in the app with a "Planned" label and no sample data): Projects, Client
Inbox, recurring meetings, a Files library, resumable uploads, offline image caching,
push delivery to a device (the app registers its Expo push token and opens the conversation
when a push is tapped, but it needs an EAS project ID, APNs and FCM credentials, and
Mobile push (Expo) turned on in More, Integrations; Settings, Notifications shows what is missing), Analytics, the Sampledge module integrations, SSO (OIDC)
on mobile, a separate thread pane, screen recording from the phone, recording retention and export
settings (admin, on the web), and queued read receipts. Display names come from `GET /v1/users` after each sync (guests without directory access see short ids).

Not yet verified on a device or simulator. This cloud environment has no KVM (so no Android
emulator) and no macOS (so no iOS simulator). A device build needs either a local machine with
Android Studio or Xcode, or EAS Build with an Expo account (plus an Apple Developer account for
iOS and a Firebase project for Android push). The app is checked with type checks, unit tests,
and the end-to-end run above against a real API through the web preview.
