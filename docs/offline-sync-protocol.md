# Offline-first engine and sync protocol

Code: `packages/offline` (client), `apps/api/src/messages`, `apps/api/src/sync` (server). Contracts: `packages/contracts/src/{messages,sync,receipts,socket-events}.ts`.

## Guarantees

| Guarantee                                           | Mechanism                                                                                                                                             |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| A composed message survives refresh, crash, offline | Written to IndexedDB (`messages` + `outbox`) in one Dexie transaction before any network call                                                         |
| No duplicates on resend                             | `clientMessageId` (UUIDv7) is an idempotency key; unique index `(tenantId, clientMessageId)`; server returns the original with `duplicate: true`      |
| Never "sent" before server confirmation             | Status moves to `sent` only from a successful ack or from sync returning that `clientMessageId`                                                       |
| Missed real-time events are recovered               | Cursor sync on connect/reconnect/online/focus and on detected gaps                                                                                    |
| Deterministic order                                 | Display order is `serverSequence` (per conversation, assigned at insert). Local unsent messages render after confirmed ones, ordered by creation time |

Not guaranteed (and never claimed): delivery to a remote user while there is no network path; background sending while the app is closed (Background Sync is used opportunistically where the browser supports it).

## Local database (Dexie) schema, version 2

Database name: `sampledge-connect:{tenantId}:{userId}`. One database per signed-in identity, so another user on the same browser never opens it.

| Table           | Primary key               | Indexes                                                                                     | Content                                                         |
| --------------- | ------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `messages`      | `clientMessageId`         | `[conversationId+serverSequence]`, `[conversationId+localCreatedAt]`, `messageId`, `status` | Server messages and local pending ones                          |
| `outbox`        | `clientMessageId`         | `[state+nextAttemptAt]`, `conversationId`, `createdAt`                                      | Pending operations with attempts, next attempt time, last error |
| `conversations` | `conversationId`          | `lastMessageAt`                                                                             | Conversation metadata snapshot                                  |
| `cursors`       | `conversationId`          |                                                                                             | Highest applied `changeSequence`                                |
| `receipts`      | `[conversationId+userId]` | `conversationId`                                                                            | Delivery/read watermarks                                        |
| `meta`          | `key`                     |                                                                                             | Schema version, deviceId, last sync time                        |
| `reactionQueue` | `messageId\|emoji`        | `nextAttemptAt`, `messageId`                                                                | Pending reaction intents (v2)                                   |

Migrations: Dexie version upgrades with `upgrade()` functions. If opening fails (corruption, failed upgrade), the engine exports the `outbox` rows it can read, deletes the database, recreates it and re-inserts the outbox, then performs a full sync (cache recovery).

## Outbox state machine

```
            enqueue()
               │
               ▼
   ┌──────► queued ──── send attempt ────► sending
   │           ▲                             │
   │           │ retryable error             ├── ack ok ──► (removed; message = sent)
   │           │ (attempt < max)             │
   │           └─────────────────────────────┤
   │                                         ├── non-retryable / attempt ≥ max ──► failed
   │ retry() (manual)                        │
   └──────────────────────────── failed ◄────┘
                                  │ discard()
                                  ▼ (removed; message deleted locally)
```

- `SESSION_EXPIRED`: the item returns to `queued` without counting an attempt; the engine pauses and asks the host app to refresh the session.
- `RATE_LIMITED`: waits `retryAfterMs` (or backoff, whichever is larger).
- Items are sent **in order per conversation**; a failed item blocks nothing else, but a retrying item delays later items of the same conversation to preserve order.
- On startup, any item left in `sending` (tab closed mid-send) is reset to `queued`; idempotency makes this safe.

Backoff: full jitter, `random(0, min(60s, 500ms × 2^attempt))`, floor 250 ms. Default max attempts before `failed`: 8 (about 2 minutes of trying), after which the user sees Retry.

## Sync request/response

```
POST /v1/sync
{ "cursors": [{ "conversationId": "c1", "afterChangeSequence": 41 }], "limitPerConversation": 200 }

200 OK
{
  "conversations": [ ...every conversation the caller can read... ],
  "results": [{ "conversationId": "c1", "changes": [ ...messages with changeSequence > 41, ascending... ],
                "nextCursor": 57, "hasMore": false, "receipts": [ ... ] }],
  "revokedConversationIds": [],
  "serverTime": "2026-11-21T09:00:00.000Z"
}
```

Conversations without a client cursor start at `afterChangeSequence = max(0, lastChangeSequence - limit)` (recent window); older history loads on scroll-back.

Edits and deletes bump `changeSequence` so they flow through the same cursor. Deleted messages are returned as tombstones (`deletedAt` set, `content.text` emptied) so every device converges.

## Reactions

A reaction is an idempotent intent, not an append-only operation: `PUT /v1/messages/:id/reactions/:emoji` adds the caller's reaction and `DELETE` removes it (or `reaction:set { messageId, emoji, op }` over the socket). Repeating either is a no-op that returns the current message without bumping anything.

- **Server:** reactions live on the message document. A real change runs inside the conversation lock, bumps the message's `changeSequence` and is broadcast as `message:updated`. Cursor sync therefore carries reactions with no new sync field; a missed event is recovered like any other change.
- **Wire shape:** `message.reactions: [{ emoji, userIds, count }]` in first-reacted order. `userIds` is capped at 20; `count` is the full total. A message holds at most 50 distinct emoji; one emoji grapheme per reaction.
- **Client:** `engine.react(message, emoji, op)` writes to `reactionQueue` keyed by `messageId|emoji`, so toggling offline coalesces to the final intent. The UI renders `overlayReactions(serverReactions, pending, me)`, so the change shows instantly and never flickers back during sync. The queue flushes after messages with the same backoff; a rejected intent (message deleted, no access) is dropped and the server state wins.

## Attachments

Bytes never travel through the sync protocol. Uploading needs a connection; sending the message that references the upload can still be queued offline.

1. `POST /v1/uploads { conversationId, fileName, mimeType, sizeBytes, sha256?, width?, height? }` returns `{ uploadId, uploadUrl, expiresAt, attachment }` (ticket valid 15 min; requires `message.send`).
2. `PUT {uploadUrl}` with the raw bytes (`Content-Type: application/octet-stream`, bearer token). The server enforces the declared size and, when given, the SHA-256.
3. `POST /v1/uploads/:uploadId/complete` returns the `Attachment` with `status: 'ready'` (idempotent).
4. Send the message with `attachmentIds` (max 10; text may be empty when files are attached). Each upload is the sender's own, in that conversation, and usable once. The message carries `attachments: Attachment[]`, an immutable metadata snapshot.
5. Download: `GET /v1/attachments/:id/url` returns a signed URL valid 10 minutes that needs no auth header (so `<img src>` works). Images, PDF and plain text are served inline; everything else as a download with `nosniff` and a sandbox CSP.

Limits: 100 MB per file; executable and script extensions are refused. Storage sits behind a `FileStorage` interface: MongoDB GridFS is built; Nextcloud (WebDAV) is planned. Malware scanning and a sweeper for abandoned pending uploads are planned.

## Conflict handling

- **Send vs send:** idempotency key; server order wins.
- **Edit vs edit** (two devices): last write by server arrival wins; each edit bumps `changeSequence`, every device converges to the highest.
- **Edit vs delete:** delete wins (tombstone has higher `changeSequence`; edits on a deleted message are rejected with `CONFLICT`).
- **Queued send to a conversation the user lost access to:** server returns `FORBIDDEN` → item `failed` with reason; content stays local until the user discards it.

## Quota management

The engine calls `navigator.storage.persist()` on first sign-in and checks `navigator.storage.estimate()` after sync. Above 80% usage it evicts the oldest **confirmed** messages beyond the most recent 500 per conversation (never outbox rows, never unsent messages) and resets those conversations' history-loaded markers.

## Offline security

- Logout deletes the identity's database and Cache Storage entries holding API responses.
- Device revocation: next contact returns `UNAUTHENTICATED` with `revoked`; the client wipes local data.
- Access tokens live in memory; the refresh token is stored in IndexedDB (needed to resume offline sessions). Moving refresh tokens to an HttpOnly cookie for web is Planned (see threat model).
- IndexedDB is not encrypted by browsers; at-rest protection relies on OS disk encryption. Optional client-side encryption with a WebCrypto key is Planned.
