# Sampledge Connect mobile (`@sampledge/mobile`)

Native iOS and Android app for Sampledge Connect, built with Expo SDK 58, React Native 0.88,
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

```bash
pnpm web:export
node scripts/e2e-seed.mjs
node scripts/serve-web.mjs dist-web 8099 &
node scripts/e2e-real-server.cjs screenshots/e2e   # API=… APP=… override the defaults
```

## How offline-first works

| Piece              | File                                           | What it does                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local database     | `src/db/store.ts`, `src/db/migrations.ts`      | Conversations, messages, receipts, drafts and the outbox in SQLite. Versioned migrations; if a migration fails or the cache is from a newer app, it is rebuilt and unsent messages and drafts are carried over.                                                                                                                                                                                                                        |
| Encryption at rest | `src/db/expoDriver.ts`, `src/auth/session.ts`  | SQLCipher database keyed with a random per-install key kept in the iOS Keychain / Android Keystore (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`). Tokens live there too. Android backup is disabled.                                                                                                                                                                                                                                         |
| Durable send queue | `LocalStore.enqueueSend`, `src/sync/outbox.ts` | Message row and outbox row commit in one transaction before any network attempt, with a client UUIDv7 `clientMessageId` that the server uses as the idempotency key. Drained oldest first. Network errors back off with full jitter and retry forever; retryable server errors retry up to 8 times; permanent errors become `failed` with the reason, with manual retry or discard. Anything left `sending` after a crash is requeued. |
| Status             | `src/components/StatusIcon.tsx`                | `draft`, `queued`, `sending`, `sent`, `delivered`, `read`, `failed`, each with its own glyph. Delivered and read come from receipt watermarks via `deriveConfirmedStatus`.                                                                                                                                                                                                                                                             |
| Cursor sync        | `src/sync/syncEngine.ts`                       | `POST /v1/sync` with one `afterChangeSequence` cursor per conversation; pages until `hasMore` is false, picks up new conversations, purges revoked ones, then enforces the cache quota. Runs on connect, reconnect, foreground and pull to refresh. This is what recovers anything missed while offline.                                                                                                                               |
| Realtime           | `src/sync/realtime.ts`                         | Socket.IO with token auth and jittered reconnect. Events are applied idempotently by `changeSequence` but never move the cursor, so a dropped event is always recovered by sync. Sending prefers the socket ack and falls back to REST with the same `clientMessageId`.                                                                                                                                                                |
| Multi-device       | `LocalStore.applyServerMessages`               | Rows are keyed by `clientMessageId`, so a message sent from the web shows up once, and a local pending message is merged when the server copy arrives from any path.                                                                                                                                                                                                                                                                   |
| Session expiry     | `src/auth/session.ts`, `src/state/engine.ts`   | Access tokens refresh a minute before expiry. If the refresh token is rejected the app shows "Signed out by the server", keeps the cache readable and the queue intact, and resumes sending after sign-in.                                                                                                                                                                                                                             |
| Quota              | `LocalStore.enforceQuota`                      | Keeps the newest 1,000 confirmed messages per conversation and 25,000 overall; never evicts unsent messages.                                                                                                                                                                                                                                                                                                                           |
| Indicators         | `src/components/Connectivity.tsx`              | Animated header dot plus an explicit banner for offline, reconnecting, signed-out and demo states, with the queued count.                                                                                                                                                                                                                                                                                                              |

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
receipts, on-device search, themes, offline and storage settings, sign-out with a warning
when queued messages would be lost.

Planned (shown in the app with a "Planned" label and no sample data): Projects, Client
Inbox, Meetings, Files and attachments (with resumable upload), Tasks and Approvals,
Notifications and push, AI Assistant, Analytics, Integrations, Administration, SSO (OIDC)
on mobile, threads, reactions, edits and deletes from mobile (edits and deletes from other
clients already display), voice messages, polls, and queued read receipts. Display names come from `GET /v1/users` after each sync (guests without directory access see short ids).

Not yet verified on a device or simulator: this change was checked with type checks, unit
tests and Android and iOS release bundle exports, not by running the app.
