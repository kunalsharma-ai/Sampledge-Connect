# Sync coverage

SampConnect keeps every device of a person, and everyone a change concerns, in step. This page
lists each user action, how it reaches other devices live, and what happens when the device is
offline. `apps/api/test/live-sync.test.ts` checks the live part end to end (two devices of one
person plus another member); `packages/offline/src/engine.test.ts` checks the offline queue.

## How it works

- **Live:** the server emits a socket event to the people a change concerns. Conversation events
  go to the conversation room, personal ones to the person's own room (all their devices),
  organization-wide ones to the tenant room (`t:<tenantId>:all`).
- **Offline:** messages go through the outbox. Every other change goes through the durable
  **action queue** (`SyncEngine.queueAction`): saved in IndexedDB first, shown at once, sent oldest
  first when connected, retried with backoff, and coalesced by key (`pin|<messageId>`,
  `vote|<messageId>`, `task|<taskId>` …), so toggling twice offline sends only the last state.
  Requests are idempotent PUT/PATCH/DELETE or natural-key POSTs, so a retry never doubles up.
- **Refused changes** (for example, the message was deleted meanwhile) are marked failed, a toast
  says so, and the Sync Center lists them with Retry and Discard.
- **Reconnect:** cursor sync catches up messages; the engine emits `reconnected`, and every
  cached list (saved, tasks, approvals, projects, notifications, directory, settings screens)
  refetches, so a missed live event is never permanent.

## Actions

| Action                                          | Live event                                              | Offline (web)                          |
| ----------------------------------------------- | ------------------------------------------------------- | -------------------------------------- |
| Send message, reply, thread reply               | `message:new`                                           | Outbox                                 |
| Edit own message                                | `message:updated`                                       | Queued, shown with "not synced yet"    |
| Delete message (own, or as moderator)           | `message:updated`                                       | Queued                                 |
| React                                           | `message:updated`                                       | Reaction queue                         |
| Read receipts                                   | `receipt:updated`                                       | Queued watermark                       |
| Pin / unpin                                     | `message:updated`                                       | Queued                                 |
| Save / unsave message                           | `bookmark:updated` (own devices only)                   | Queued                                 |
| Vote in poll                                    | `message:updated`, `poll:myVote` (own devices)          | Queued                                 |
| Create poll, schedule message                   | `message:new`, `scheduled:updated`                      | Needs a connection                     |
| Notification level                              | `conversation:upsert` (own devices)                     | Queued                                 |
| Mark notifications read                         | `notification:read`                                     | Queued                                 |
| Create / change conversation, members           | `conversation:upsert`, `conversation:revoked`           | Needs a connection                     |
| Task status and edits                           | `task:upsert`                                           | Queued (edits merge)                   |
| Approve / reject                                | `approval:upsert`                                       | Queued                                 |
| Create task, approval, project                  | `task:upsert`, `approval:upsert`, `project:changed`     | Needs a connection                     |
| Module record linked or updated (module event)  | `record:changed` to the conversation                    | Details panel refetches on reconnect   |
| Run a record action (e.g. Log to SampForce)     | `record:changed` `action`, action card as `message:new` | Needs a connection                     |
| Meeting create / change / RSVP                  | `meeting:upsert`                                        | RSVP queued; create needs a connection |
| Working hours                                   | `meetings:changed` `working_hours` (own devices)        | Needs a connection                     |
| Booking page create / change / delete           | `meetings:changed` `booking_pages` (every host)         | Needs a connection                     |
| Book a slot (public page)                       | `meeting:upsert` to the hosts                           | Needs a connection by nature           |
| Call recording added, any recording deleted     | `recording:changed` (conversation members)              | Delete needs a connection              |
| Live captions on/off, caption lines             | LiveKit attribute `captions` and data topic `captions`  | Live only (not stored)                 |
| Calls                                           | `call:ringing`, `call:updated`, `call:ended`            | Needs a connection by nature           |
| Invite / change member, edit profile            | `directory:updated`                                     | Needs a connection (admin)             |
| Branding                                        | `tenant:updated` `branding`                             | Needs a connection (admin)             |
| Billing, integrations, AI, recordings settings  | `tenant:updated` with that area                         | Needs a connection (admin)             |
| Recent searches (add, remove, clear)            | `search:recent` (own devices only)                      | Queued                                 |
| Forward a message (with its files)              | `message:new` in each target conversation               | Queued (outbox, like any send)         |
| Turn forwarding on/off (private channel, group) | `conversation:updated`                                  | Needs a connection (moderators)        |
| Availability, custom status, quiet hours        | `directory:updated` (everyone in the organization)      | Queued, shown at once on this device   |
| Typing, presence                                | `typing:update`, `presence:update`                      | Ephemeral, not queued                  |

"Needs a connection" actions are disabled offline with a clear label, never silently lost.
Creating things that get a server id (polls, tasks, projects, meetings) is planned for the queue
with client-generated ids.

Call device choices and background blur are saved per device on purpose (each device has its own
camera and microphone), so they are not synced.

## Mobile

The mobile app uses the same events and its own durable action queue (see `apps/mobile/db/work.ts`)
for pins, saved messages, polls, scheduled messages, tasks and approvals.
