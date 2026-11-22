# SampConnect Network

SampConnect Network is the social layer that crosses organizations. Everyone gets a **Connect ID**
(like a Teams ID, or a WhatsApp or Telegram contact). With it, people in different organizations,
and people with a free personal account, can find each other, connect, chat, post status updates
and build communities.

## How it is isolated

- All network data lives in one reserved tenant, `sampledge-network` (`kind: 'network'`), created by
  migration `033-network`. No organization's data is ever read from the network, and the network
  never reads organization data.
- A **work account** opens the network with `POST /v1/network/link`. This exchanges the work
  session for a network session for the same person, and the link is made once. The web app keeps
  both sessions (`current` and `network`) and switches with the **Work / Network** switcher in the
  rail. Each space has its own offline database on the device.
- A **personal account** belongs to no organization. It signs up at `/signup` (or from an invite,
  a public profile or a community page) and signs in with the normal login on the
  _Personal account_ tab, which uses `tenantSlug: 'sampledge-network'`.
- Network users have the `guest` role in the network tenant. They have no directory, can't create
  channels, and only see the conversations they belong to.
- `NetworkGate` (in `AuthGuard` and the socket handshake) allows network sessions only on network
  routes and chat. For linked accounts it checks, with a 15-second cache, that the home account is
  still active and the home organization still allows the network. Turning the network off or
  deactivating a member cuts access within seconds.

## Features

| Feature             | How it works                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connect ID          | A unique handle, editable in _People → Profile_. Search by handle, name, email or phone (each discoverable only if the person allows it).                                                                                                                                                                                                                                                    |
| Connection requests | Free. Each request has a circle (**business** or **friends**), and either side can change it later. Accept, decline or withdraw. Each pair can have one pending request.                                                                                                                                                                                                                     |
| Chat                | A direct message needs a connection and no block, both to start and on every send. Calls and files reuse the normal chat infrastructure.                                                                                                                                                                                                                                                     |
| Follow / unfollow   | Follow a person or a community without connecting. Registered users follow in-app. Visitors without an account follow from the public page, which offers a quick signup and then completes the follow.                                                                                                                                                                                       |
| Invites             | Invite by email (sent through the database `smtp` integration), by shareable link, or by SMS (opens the phone's SMS app with the link). The invitee gets a lightweight personal account, and accepting connects you automatically.                                                                                                                                                           |
| Status              | Text with a background, or a photo or video. The audience is connections, connections plus followers, public, or a selected list of people, and replies can be turned off. Statuses expire after 1–168 hours (24 by default). Viewers are recorded, and you can see who viewed yours. A reply goes to the poster's DM with a quote.                                                          |
| Communities         | Public (listed, with a shareable page) or private (invite links or approval only), and open or approval-to-join. Each starts with an **Announcements** group (only admins post) and a **General** group. There are roles (owner, admin, moderator, member), invites, invite links with expiry and use limits, join approval, ban and unban, transfer of ownership, extra groups, and follow. |
| Safety              | Block (which hides each side from the other and removes the connection), report a person, status, community or message (stored for review), and rate limits on search, requests, invites and posts.                                                                                                                                                                                          |
| Public pages        | `/n/<handle>` for a profile, `/c/<slug>` for a community, `/join/n/<token>` for an invite, and `/join/c/<token>` for a community link. They show only what the owner made public.                                                                                                                                                                                                            |

## Full synchronization

Every network action is idempotent and synced everywhere:

- Each mutation carries a `clientActionId` (or `clientStatusId` / `clientMessageId`). The server
  stores results in `network_actions` for 7 days, so a retried action returns the same result
  and never runs twice.
- After any change the server emits `network:changed { scope, id }` to every affected user on
  every device. The web app refetches just that scope.
- The web app caches every network list in IndexedDB, so the screens work offline. Actions taken
  offline go to a durable outbox, show a _Queued_ badge, and are sent in order once you are back
  online. A failure can be retried or discarded from _Home → Pending_.
- Signing out wipes the local data for both spaces.

## Mobile app

- **Spaces.** A work account opens the network from _More → SampConnect Network_ (the link needs a
  connection once; later switches work offline) and goes back with _Work: <organization>_. The
  app keeps both sessions in the keystore, each refreshing on its own, and each space has its own
  encrypted database, so chats and lists never mix. If the organization turns the network off,
  the network session's refresh is refused, the link is forgotten and the app returns to work.
- **Personal accounts.** The sign-in screen has an _Organization / Personal account_ choice. A
  personal account signs in without a workspace (`tenantSlug: 'sampledge-network'`), and _Create a
  free account_ calls `POST /v1/network/public/signup`.
- **Screens.** In the network space, Home shows requests waiting and recent chats, the _People_
  tab takes the place of the Client Inbox (Find, Requests, Connections, Followers), and a person's
  page has Connect (with a circle and a note), Accept / Decline / Withdraw, Message, Follow,
  Move between circles, Remove, Block and Report. _More_ has Invite (link, email or text from your
  own phone), Network profile and privacy, and Blocked people.
- **Status updates.** Home has a status strip: your own status, then each person with new ones.
  _New status_ posts text on a colour, or a photo or video with a caption, to an audience with an
  expiry and a replies switch. The viewer goes through a person's statuses with progress bars,
  records your view, and sends replies to their chat. On your own you see _Seen by_ (the viewers
  list) and _Delete_. A status made offline, photo or video included, shows at once with a
  _Queued_ tag; the file is kept on the phone, uploaded first on reconnect, then posted.
- **Communities.** Home lists yours, and _Communities_ (Home or More) has _My communities_ and
  _Discover_ (search public ones). A community's page has Join, Ask to join or Accept invitation,
  Follow, the public link, and Leave. Members see Groups (open a group as a chat, join open ones,
  and moderators add groups), Members (approve or deny people asking, change roles, remove, ban
  and unban), Invite (your connections, and invite links to share or revoke) and, for admins,
  Settings (name, description, rules, public and approval). A community or group made offline
  shows at once with a _Queued_ tag and is created on reconnect.
- **Offline and sync.** Every list is cached by path and shown offline. Every change goes through
  the phone's action queue as one ordered `net.act` (with the same `clientActionId` bodies as the
  web), shows at once with a _Queued_ tag, and is sent on reconnect. A refused change is dropped and
  a banner says why. `network:changed` refetches the cached lists of that scope, and a reconnect
  refetches all of them.
- **Organization-only features.** In the network space the app does not call routes the server's
  `NetworkGate` refuses (meetings, tasks, approvals, scheduled messages, AI, branding...): the
  transport refuses them locally and those entries are hidden.

## Admin controls

_Administration → SampConnect Network_ (`GET/PUT /v1/admin/network`, stored in
`tenant_settings.networkPolicy`):

- **Allow SampConnect Network**: the off switch for the whole organization.
- **Only connect with these domains**: an allowlist of email domains for connections.
- **Personal accounts**, **Communities** and **Status updates**: each can be switched off.

Every network action by a member (link, request, connect, block, report, invite, community
change) is written to the organization's audit log with who, what and when, never message
content. Usage counts appear on the same screen.

## API

All routes are under `/v1/network` with a network session, unless noted.

- `GET|POST /link` (work session): link status, and open the network
- `GET|PATCH /me`, `GET /search?q=`, `GET /people/:id`
- `GET|POST /requests`, `POST /requests/:id/respond`, `DELETE /requests/:id`
- `GET /connections`, `PUT /connections/:userId/circle`, `DELETE /connections/:userId`
- `GET /follows`, `PUT|DELETE /follows/:type/:id` (`type` is `user` or `community`)
- `GET /blocks`, `PUT|DELETE /blocks/:userId`, `POST /reports`
- `GET|POST /invites`, `POST /invites/:token/accept`
- `GET /statuses`, `POST /status-media`, `POST /statuses`, `PUT /statuses/:id/view`,
  `GET /statuses/:id/viewers`, `POST /statuses/:id/reply`, `DELETE /statuses/:id`
- `GET|POST /communities`, `GET /communities/discover`, `GET|PATCH /communities/:id`,
  `POST /communities/:id/{join,leave,decline,invite}`, `GET /communities/:id/members`,
  `POST /communities/:id/members/:userId/{approve,deny,owner}`,
  `PUT /communities/:id/members/:userId/role`, `DELETE /communities/:id/members/:userId` (with
  `?ban=true` to ban), `DELETE /communities/:id/bans/:userId`,
  `GET|POST /communities/:id/links`, `DELETE /communities/:id/links/:linkId`,
  `POST /community-links/:token/join`, `POST /communities/:id/groups`,
  `POST /communities/:id/groups/:conversationId/{join,members,leave}`,
  `DELETE /communities/:id/groups/:conversationId`
- Public, no session: `POST /v1/network/public/signup`, `GET /v1/network/public/profiles/:handle`,
  `GET /v1/network/public/communities/:slug`, `GET /v1/network/public/invites/:token`,
  `GET /v1/network/public/community-links/:token`
- Admin (work session, owner or admin): `GET|PUT /v1/admin/network`

Types and schemas are in `packages/contracts/src/network.ts`.

## Planned

- Sending SMS invites through an SMS provider (today the phone's own SMS app sends the link)
- A moderation console for reports (reports are stored and audited, but there is no review screen yet)
- Presence for people other than your connections, and group chats outside communities
