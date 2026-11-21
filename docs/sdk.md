# Sampledge Connect SDK and chat widget

There are two workspace packages for module teams:

- `@sampledge/connect-sdk` is for the module's **server**. It signs events, provides contextual chat, maps identities, creates widget sessions and verifies webhooks. It has no dependencies and uses Web Crypto, so it runs on Node 20+, Deno, Bun and edge runtimes.
- `@sampledge/chat-widget` is a React component that embeds a record's Connect conversation in the module's own UI. It updates live over Socket.IO and has an outbox that survives reloads.

Both are tested against the real API in `apps/api/test/sdk.test.ts` and `apps/api/test/chat-widget.test.ts`. Event types and payloads are listed per module in [sampledge-modules.md](sampledge-modules.md) and in `MODULE_CATALOG` (`@sampledge/contracts`).

## Server SDK

```ts
import { ConnectClient, ConnectError, verifySignature } from '@sampledge/connect-sdk';

const connect = new ConnectClient({
  baseUrl: 'https://connect.example.com', // your Connect API
  apiKey: process.env.CONNECT_API_KEY!, // issued under Integrations → module → Keys & test
  signingSecret: process.env.CONNECT_SIGNING_SECRET!, // shown once with the key
});
```

The module keeps its Connect key and secret in its own secret store. On the Connect side they are stored in the database (the key hashed, the secret encrypted), never in env.

### Send an event

```ts
const result = await connect.sendEvent({
  eventId: 'milestone-MS-7-due-2026-11-24', // idempotency key: resending is safe
  type: 'milestone.due',
  record: { type: 'milestone', id: 'MS-7', title: 'Questionnaire sign-off', url: 'https://…' },
  parent: { type: 'project', id: 'PRJ-1042', title: 'Northwind brand tracker Q1' },
  people: [{ externalUserId: 'u-17', email: 'ravi@acme.com' }],
  summary: 'Questionnaire sign-off is due tomorrow',
  data: { dueAt: '2026-11-24T17:00:00Z', status: 'due' },
});
// result.actions → ['card.posted', 'notified'], result.unmatchedPeople → []
```

`sendEvent` signs the exact bytes it sends. Calls throw a `ConnectError` with `status`, `code` and `retryable`. Retry only when `retryable` is true (network errors, 429 and 5xx), and always with the same `eventId`.

### Contextual chat

```ts
const { conversationId } = await connect.ensureRecord({
  record: { type: 'bid', id: 'BID-903', title: 'Contoso U&A' },
  members: [{ email: 'dana@acme.com' }],
});
await connect.postMessage('bid', 'BID-903', {
  text: 'Pricing approved by finance.',
  notify: [{ email: 'dana@acme.com' }],
  idempotencyKey: 'bid-903-pricing-approved',
});
const recent = await connect.history('bid', 'BID-903', 20);
```

### Identity mapping

```ts
await connect.linkIdentity({ externalUserId: 'u-17', email: 'ravi@acme.com' });
const link = await connect.getIdentity('u-17'); // { userId, matchedBy: 'manual' | 'email', … }
```

### Verify what Connect sends you

Outbound module actions (`POST {your base URL}/connect/actions`) and webhooks carry the same `Sampledge-Signature` header:

```ts
const check = await verifySignature(secret, rawBody, req.headers['sampledge-signature']);
if (check !== 'ok') return res.status(401).end(); // 'missing' | 'stale' | 'mismatch'
const { id, type, data } = JSON.parse(rawBody); // e.g. type 'task.created' or 'approval.decided'
```

Answer with any 2xx. Make the handler idempotent on `id`.

## Chat widget

On your server, sign the current user in:

```ts
const session = await connect.createWidgetSession({
  user: { externalUserId: 'u-17', email: 'ravi@acme.com' },
  record: { type: 'project', id: 'PRJ-1042', title: 'Northwind brand tracker Q1' },
  deviceName: 'Samptrek web',
});
```

The session is a normal Connect device session for the mapped user. It shows in their device list, can be revoked, and sees only what that user can see.

In your React app:

```tsx
import { ConnectChat } from '@sampledge/chat-widget';

<ConnectChat
  apiUrl="https://connect.example.com"
  session={session}
  renewSession={() => fetch('/api/connect-session').then((r) => r.json())}
  theme="arctic-professional"
  connectWebUrl="https://connect.example.com"
  height={520}
/>;
```

Your web origin must be listed under the module's **Chat widget origins** in Integrations. That setting is the CORS allowlist and is read from the database.

The widget refreshes tokens by itself, receives messages live, and keeps unsent messages in a local outbox that survives a reload. Failed messages offer Retry and Discard. Module and task cards render compactly. "Open in Connect" deep-links to `/app?c=<conversationId>`.

For a custom UI, `@sampledge/chat-widget/client` exports the headless `WidgetClient`, and `useConnectChat` exposes the same state to React.

## Planned

- Publishing the packages to a registry. Today they are workspace packages.
- Conversation-scoped widget tokens.
- A non-React embed (web component).
