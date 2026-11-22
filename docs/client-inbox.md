# Client Inbox and external messaging connectors

Clients write to you from the apps they already use. Each message lands in one Client Inbox where agents reply, add internal notes, and track service levels. Connectors live in their own module (`apps/api/src/connectors`) and run their own outbound queue, so a provider outage never touches internal chat.

## Setting up a channel

Everything is configured in the web app under **Client Inbox → Channels**. No environment variables are needed per provider: credentials are entered on screen and stored encrypted in MongoDB (AES-256-GCM, bound to the tenant). The only server setting is the master key `SETTINGS_ENCRYPTION_KEY` (32 bytes, base64), which is required in production.

1. Click **Add channel** and pick a provider. Each card shows its mode, what it can do, and the credentials it needs.
2. Start in **Test mode**. Credentials are generated, webhooks are signed exactly as the real provider would sign them, and outbound replies are captured by a sandbox instead of being sent. Use **Simulate client message** to try the flow.
3. When you have the real credentials, choose **Go live**, paste them, and copy the webhook URL into the provider's console.
4. **Test connection** checks the credentials against the provider's API.

### Modes

| Mode    | Providers                                                                       | Meaning                                                                                                |
| ------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Two-way | Telegram, Slack, Microsoft Teams, Google Chat, LINE, Mattermost, Nextcloud Talk | Messages in and replies out, through the official API.                                                 |
| Limited | Discord, WeChat, QQ Bot                                                         | Official API with platform limits: Discord via the /support command; WeChat and QQ have reply windows. |
| Handoff | Signal, iMessage                                                                | No business API exists. Agents log the conversation and replies open the app with the text ready.      |

### What each connector handles

Webhook verification (provider signature, token or JWT), inbound parsing, identity mapping to a client profile, outbound send with delivery states, rate limits, retries with backoff (up to 8 attempts), a circuit breaker (opens after 5 failures for 60 s), auth-error detection (the channel turns to Error), credential rotation with a grace window for old webhook signatures, and audit logs that record field names but never secret values.

## The inbox

- **Conversations**: views for Mine, Unassigned, All open, Overdue and Resolved, filtered by channel and searchable.
- **Timeline**: client messages, replies with delivery state, internal notes (amber, never sent to the provider) and activity.
- **Client panel**: profile, identities across channels, assignee, team, status, priority, SLA, escalation, tags, and linked SampForce opportunities and Samptrek projects.
- **Templates**: type `/` and the shortcut in the composer. Variables: `{{client.firstName}}`, `{{client.name}}`, `{{client.company}}`, `{{agent.name}}`.
- **Dashboard** (owners and admins): open, unassigned, breached, median first reply, SLA met, volume by day and channel, and agent workload.
- **Settings** (owners and admins): SLA minutes per priority, due-soon warning, auto-assign, auto-escalate on breach, escalation contacts and inbox teams.

Every change syncs live to all of an agent's devices and to the other agents who can see the conversation. Replies, notes, ownership changes and read marks are saved on the device first and sent when it is online (see docs/sync-coverage.md). Read marks are personal to each agent.

Agents see conversations with no team, those of their own teams, and those assigned to them. Owners and admins see everything.

## Not built yet

- Attachments in and out of connectors (text only today).
- Discord Gateway (real-time DMs); Discord works through the /support command.
- WeChat encrypted (safe) mode; plain mode only verifies the query signature.
- LINE profile names (clients appear as "LINE user").
- Apple Messages for Business.
- The inbox on mobile.
- A dedicated worker process (the outbound queue runs inside the API with a Redis lock).
- Linked records are stored as unverified until the SampForce and Samptrek module adapters are connected.
