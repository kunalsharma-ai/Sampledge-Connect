# Forwarding, status and do-not-disturb

## Message forwarding

- **Forward** appears on every text message you can read (hover toolbar). Pick up to 10
  conversations (`MAX_FORWARD_TARGETS`) and add an optional comment.
- API: an ordinary send with `forwardOf: <messageId>` (`POST /v1/conversations/:id/messages`,
  socket `message:send`). `content.text` is the comment and may be empty.
- The server checks that you can read the source (a 404 otherwise, so private ids never leak),
  refuses deleted messages and polls, and stores a snapshot in `metadata.forwarded`
  (`ForwardedSnapshot`: messageId, conversationId, senderId, text, createdAt, from).
  Forwarding a forward keeps the first original.
- Files are copied as new attachment rows in the target conversation (`copyOf` points to the
  original). Bytes are shared and only erased when no live row uses them.
- **Permissions:** owners and moderators of private channels and groups can turn forwarding off
  (`PUT /v1/conversations/:id/forwarding {allowed}`; `allowForwarding: false` on the
  conversation). Messages from there can then only be re-shared inside the same conversation
  (403 "Forwarding is turned off in that conversation"). Public channels and DMs always allow it.
- **Offline:** each forward goes through the outbox like any send. It shows straight away with
  the original quoted and is sent on reconnect. Push previews read "Forwarded: …".

## Availability, custom status, quiet hours

- `PUT /v1/me/status` `{availability: auto|busy|away|dnd, emoji, text, expiresAt}` replaces your
  status. `expiresAt` clears it automatically (it can't be in the past). `GET /v1/me/status`
  returns `{status, dndSchedule, dndActive}`.
- `PUT /v1/me/dnd-schedule` `{enabled, timeZone (IANA), days 0–6, start, end}` sets recurring
  quiet hours; an end before the start runs past midnight.
- Both are on `UserSummary` (`userStatus`, `dndSchedule`) from `GET /v1/users`, and each change
  emits `directory:updated` to the organization, so every member and all your devices update.
- **Do-not-disturb** (by hand or schedule) suppresses push notifications only: message pushes,
  call ringing and work pushes. In-app notifications, unread counts and calls in the app still
  arrive.
- Web: your avatar in the navigation rail opens availability, status message (with presets and
  "clear after"), quiet hours and clear. Settings has Status and Quiet hours cards (phones).
  Dots: green available, amber away, red busy or do-not-disturb, grey offline. Members lists
  and DM headers show status messages.
- **Offline:** both PUTs go through the action queue (keys `my-status`, `my-dnd-schedule`) and
  show on this device at once.
- Shared helpers in `@sampledge/contracts`: `effectiveStatus`, `inDndSchedule`, `dndActive`.
