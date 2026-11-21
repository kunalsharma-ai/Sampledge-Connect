# User journeys

Each journey lists the acceptance criteria that tests verify. Status reflects this repo, not intent.

## J1. Organization onboarding (Built in Phase 1)

**Actor:** Priya, operations lead at a market research agency.

1. Opens `/register`, enters organization name, workspace URL slug (`acme-research`), her name, email and a 12+ character password.
2. Server creates tenant, owner user, membership, default workspace and a `#general` public channel, then signs her in on this device.
3. She lands in the workspace with `#general` open and an empty-state prompt to invite teammates.

Acceptance: slug uniqueness enforced (409 on clash); password hashed with argon2id; audit entry `tenant.created`; the session works immediately over REST and Socket.IO.

## J2. Inviting teammates (Built)

1. Priya opens Administration → Members, adds Ravi (member) with a temporary password. Email invitations and SSO provisioning are Planned.
2. Ravi signs in with workspace slug + email + password.

Acceptance: only owner/admin can invite (403 otherwise); invited user appears in directory; audit entry `member.invited`.

## J3. Direct message, both online (Built)

1. Ravi opens Priya from the directory and sends "Quota for wave 2 looks low".
2. The message appears instantly with a clock icon (queued → sending), then a single tick (sent) once the server acks.
3. Priya's open client receives it in real time and acks delivery; Ravi sees a double tick (delivered). When Priya views it, Ravi sees the read state.

Acceptance: status never shows sent before server ack; DM between the same two people is reused, not duplicated; typing indicator appears within 300 ms and clears after 6 s idle.

## J4. Composing offline, then reconnecting (Built: the critical journey)

1. Ravi's train enters a tunnel. The connectivity pill turns amber: "Offline: messages will send when you're back".
2. He sends three messages. Each is written to IndexedDB first and shown with a queued indicator.
3. He reloads the tab while offline. The service worker serves the cached app shell; the conversation and the three queued messages are still there.
4. Connectivity returns. The engine reconnects with exponential backoff + jitter, sends the outbox in order and runs cursor sync to fetch messages he missed.
5. One message had actually reached the server before the tunnel but the ack was lost. The resend returns `duplicate: true` and no duplicate appears for anyone.

Acceptance: after refresh the queue survives; no duplicates on resend; missed messages appear in correct order; nothing shows delivered without server confirmation.

## J5. Persistent failure and manual retry (Built)

1. A message is rejected with a non-retryable error (e.g., Ravi was removed from the channel). It moves to **Failed** with the reason and actions "Retry" and "Delete".
2. Retryable errors (network, 5xx, rate limited) keep retrying with backoff and never become failed silently; after the configured attempt limit they surface as Failed with Retry.

## J6. Session expiry while offline (Built)

1. Ravi's access token expires while queued messages exist. The engine refreshes using the rotating refresh token, then continues.
2. If the refresh token is revoked (device removed by admin), the outbox is paused (not deleted) and Ravi is asked to sign in again. After signing in as the **same user**, queued messages resume; if a different user signs in, the previous user's local database is not opened.

## J7. Multi-device reconciliation (Built)

1. Priya sends from her laptop; her phone (also signed in) receives the message through her personal room and through sync, keyed by `clientMessageId`, so it appears once with sent status.

## J8. Channels (Built)

1. Ravi creates public `#fieldwork-uk`; others can preview and join it. Priya creates private `#bid-pricing` and adds two people; non-members cannot discover it.

## J9. LAN-only operation (Deployment-supported)

An office runs the compose stack on a local server. When the internet uplink fails, devices on the LAN keep chatting through that server. Devices with no path to the server queue locally (J4).

## Planned journeys

Project-linked conversation from Samptrek (Phase 2), supplier escalation from SampleAudience (Phase 2), client message arriving from Telegram into the unified inbox with SLA timer (Phase 3), AI summary of a long thread (Phase 4), file upload to Nextcloud with resumable queue (Phase 1b).
