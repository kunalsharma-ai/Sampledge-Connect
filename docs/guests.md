# External guests (meeting invites by email, join links, lobby)

People outside your organization can be invited to a meeting by email. They need no account and
no app: they open a personal link in a browser, RSVP, add the meeting to their calendar and join
the call after someone in it lets them in from the lobby. Everything runs on your own servers:
mail goes through **your SMTP server**, media through your self-hosted LiveKit (see `calls.md`).

## How it works

1. The organizer adds guests by email when scheduling (or later, from the meeting details).
   People who have an account in the organization are refused as guests and must be added as
   attendees instead.
2. Each guest gets an email with a **calendar invite** (`invite.ics`, iTIP `METHOD:REQUEST`,
   which Outlook, Gmail and Apple Calendar show as an invitation) and a **personal join link**
   `PUBLIC_WEB_URL/join/<token>`.
3. Changing the time, title or agenda sends an **updated invitation** (same UID, higher
   `SEQUENCE`, so calendars replace the old copy). Moving the time resets guests' RSVPs.
   Cancelling sends a **cancellation** (`METHOD:CANCEL`) to every guest. Removing one guest sends
   them a cancellation, kills their link and drops them from the call if they're in it.
4. On the join page the guest sees the meeting (in their own time zone), RSVPs (going / maybe /
   not going; organizers see it live), downloads the `.ics` again, checks their camera and
   presses **Ask to join**.
5. Guests can join from 30 minutes before the start until 2 hours after the end. If nobody has
   started the call yet they wait; as soon as someone starts it they enter the **lobby**.
6. Everyone in the call sees the lobby (name, email, "guest from outside your organization") and
   can **Admit** or **Deny**. The first answer wins. Admitted guests connect with a 10-minute SFU
   token under the identity `guest:<id>`, shown as "Name (guest)". A guest who reloads the page
   rejoins without waiting again; a denied guest can't ask again in that call.
7. A guest who closes the page leaves the lobby at once (or after 30 seconds without a poll).
   Recording is shown to guests in the lobby and in the call.

Guests see only the meeting's title, agenda, time, organizer name and organization name. They
don't see other attendees' or guests' emails, the conversation's history or files.

## Meeting chat

Everyone in a call, guests included, can open **Chat** in the call controls. Messages go into
the meeting's own conversation, so members also see them in the timeline afterwards, with the
sender shown as "Name (guest)".

- A guest sees only text messages sent since the current call started, and only while they are
  admitted to it. Earlier history and later messages stay hidden from them.
- Attachments members send show to guests by file name only; guests can't open them or upload.
- A guest message is a normal `text` message whose `senderId` is `guest:<guestId>` (never a user
  id) and whose `metadata.guest` is `{ guestId, name }`. Apps should show `metadata.guest.name`.
- Guest messages share the `message_send` rate limit, keyed per guest.

## Email setup

Email is **off** until `SMTP_HOST` and `SMTP_FROM` are set. While it's off, guests are still
created and the meeting details show "Not emailed (email isn't set up)" with a **Copy link**
button, so the organizer can send the link any way they like. **Resend** works once SMTP is set.

| Variable           | Example                              | Notes                                                         |
| ------------------ | ------------------------------------ | ------------------------------------------------------------- |
| `SMTP_HOST`        | `mail.example.com`                   | Your mail server or relay.                                    |
| `SMTP_PORT`        | `587`                                | 587 with STARTTLS, or 465 with `SMTP_SECURE=true`.            |
| `SMTP_SECURE`      | `false`                              | `true` for TLS from the first byte (port 465).                |
| `SMTP_REQUIRE_TLS` | `true`                               | Refuse to send without STARTTLS. Recommended on the internet. |
| `SMTP_USER`        | `meetings@example.com`               | Optional; omit for an IP-allowlisted relay.                   |
| `SMTP_PASSWORD`    | (secret)                             | Required with `SMTP_USER`. Keep it in your server env only.   |
| `SMTP_FROM`        | `SampConnect <meetings@example.com>` | The sender guests see. Must be allowed by your SPF/DKIM.      |
| `PUBLIC_WEB_URL`   | `https://connect.example.com`        | Base of join links. Defaults to the first `CORS_ORIGINS`.     |

Deliverability: send from a domain you control with SPF, DKIM and DMARC set up, or invites
land in spam. The calendar invite's ORGANIZER is the organizer's own email address.

Each guest's latest email outcome (`sending`, `sent`, `failed` with the server's reason,
`not_configured`) is stored on the guest and shown to everyone in the meeting.

### Trying it without a mail server

`docker compose --profile mail-test up` starts **Mailpit**, a local test mailbox. Set
`SMTP_HOST=mailpit`, `SMTP_PORT=1025`, `SMTP_FROM="SampConnect <meetings@example.test>"`
and read every message at <http://localhost:8025>. Nothing leaves the machine. The integration
tests use an in-process SMTP server the same way.

## Security

- A link is `<guestId>.<signature>`: an HMAC-SHA256 (keyed from `FILES_URL_SECRET`) over tenant,
  meeting, guest and a per-guest nonce. Links can't be guessed, edited or moved to another
  meeting; a wrong or withdrawn link is a plain 404. Without `FILES_URL_SECRET` (development only)
  links stop working when the API restarts.
- The join page sends `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` and `no-store`, so
  the token doesn't leak to other sites, search engines or shared caches.
- Guest endpoints are rate-limited per IP (`guest_link`, 240 requests a minute: the page polls
  every 3 seconds).
- Admit and deny need someone **in** the call (an invited member who hasn't joined can't).
- A guest only ever gets a token for the live call of their own meeting's chat, and only inside
  the join window.

## API

Organizer and members (signed in):

| Method | Path                                      | Notes                                                    |
| ------ | ----------------------------------------- | -------------------------------------------------------- |
| POST   | `/v1/meetings`                            | `guests: [{ email, name? }]` (max 100).                  |
| PATCH  | `/v1/meetings/:id`                        | `addGuests: [{ email, name? }]`, `removeGuestIds: [id]`. |
| GET    | `/v1/meetings/:id/guests/:guestId/link`   | Organizer only: `{ url }`.                               |
| POST   | `/v1/meetings/:id/guests/:guestId/resend` | Organizer only. 503 when SMTP isn't configured.          |
| POST   | `/v1/calls/:callId/lobby/:guestId/admit`  | Anyone currently in the call.                            |
| POST   | `/v1/calls/:callId/lobby/:guestId/deny`   | Anyone currently in the call.                            |

`Meeting.guests[]`: `{ guestId, email, name, response, invite: { status, at, error } }`.
`Call.lobby[]`: `{ guestId, meetingId, name, email, requestedAt }`; `Call.guests[]`: `{ guestId,
meetingId, name, email, state: admitted | joined | left | denied, decidedBy, joinedAt }`. Both
arrive with the usual `call:updated` event.

Guests (the link token is the credential, no account):

| Method | Path                            | Notes                                                       |
| ------ | ------------------------------- | ----------------------------------------------------------- |
| GET    | `/v1/guest/:token`              | `GuestMeetingView`.                                         |
| POST   | `/v1/guest/:token/rsvp`         | `{ response: 'accepted' \| 'tentative' \| 'declined' }`     |
| GET    | `/v1/guest/:token/calendar.ics` | The invite as a file.                                       |
| GET    | `/v1/guest/:token/lobby`        | `GuestJoinState` `{ state, callId, recording, join }`.      |
| POST   | `/v1/guest/:token/lobby`        | `{ name }`: ask to join (repeat while waiting).             |
| POST   | `/v1/guest/:token/lobby/leave`  | Leave the lobby.                                            |
| GET    | `/v1/guest/:token/chat`         | `{ messages: GuestChatMessage[] }`. 403 unless admitted.    |
| POST   | `/v1/guest/:token/chat`         | `{ text }` (1–4000). Returns the chat. 403 unless admitted. |

States: `too_early`, `not_started`, `ready`, `waiting`, `admitted` (with `join: { url, token,
expiresAt }`), `denied`, `ended`, `cancelled`.

## Planned

Reading guests' calendar replies (iTIP REPLY) by email, the lobby on mobile. Recurring meetings with guests and public booking pages: see `meetings.md`.
