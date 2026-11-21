# Sampledge modules (Phase 2)

Connect is the communication layer for the Sampledge suite. Each module (Samptrek, SampleAudience, Sampcode, SampBidX, SampForce, SampCrew, Talk2Tax) talks to Connect through one gateway. Modules send signed events and call a contextual chat API. Connect sends back tasks, decisions and CRM actions.

The real module APIs aren't available yet, so every module starts in **test mode**. In test mode Connect accepts and processes the module's events for real. Outbound calls are recorded as `test_mode` and nothing is sent. Nothing is simulated silently: test events and test-mode actions are labelled wherever they appear.

## Configure a module (admin, no env vars)

All connection settings live in MongoDB, in the shared encrypted integration-settings store (see [integrations.md](integrations.md)). The provider ids are `sampledge.<module>`, for example `sampledge.samptrek`. Configure them under **Integrations → Sampledge modules → _module_**:

| Field                | Used for                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| Mode                 | `test` (default) processes events and sends nothing; `live` also calls the module                   |
| API base URL         | Connect calls `{base}/connect/actions` (outbound actions) and `{base}/connect/health` (test)        |
| API key (secret)     | Sent by Connect as `Authorization: Bearer …` when calling the module                                |
| Event signing secret | HMAC-SHA256 key the module signs its events with                                                    |
| New record channels  | Public or private channels for new records. HR and finance records are always private.              |
| Chat widget origins  | Comma-separated origins allowed to embed the chat widget (CORS), read from the database each minute |

Below the form, the module panel has these tabs:

- **Keys & test.** Issue the module's **Connect API key**, and optionally a new signing secret. Both are shown once; the key is stored as a SHA-256 hash. You can also send a realistic **test event** through the real pipeline. Its card is marked "Test event" and you're the only person on it.
- **Event log.** Every event received, what Connect did with it, and the people it named who have no Connect account.
- **People.** Identity links between module user ids and Connect users. Matching by email happens automatically; you can add manual links.
- **Sent to module.** Outbound actions with their status (`sent`, `failed`, `test_mode`, `not_configured`) and a retry button.
- **Webhooks.** Signed outbound webhooks, with a delivery log and test sends.

The readiness box says exactly what live mode still needs.

## Event flow

`POST /v1/integration/events` with `Authorization: Bearer <Connect API key>` and `Sampledge-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.rawBody">`. Signatures older than 300 s are rejected.

1. **Idempotency.** `eventId` is unique per tenant and module. A repeat returns `duplicate: true` and does nothing. A failed event can be retried by resending it.
2. **Identity.** `people[]` and `actor` are resolved through identity links first, then by email to an active user. An email match is saved as a link. People without an account are listed in `unmatchedPeople`.
3. **Conversation.** The module catalogue (`packages/contracts/src/modules-catalog.ts`) says where each event type goes: the record's own channel, its parent's channel (a milestone goes into its project's channel), or a shared module channel such as `#announcements`. Channels are created on first use under a per-record Redis lock, and the people involved are added. Restricted records (SampCrew employee, leave and HR cases; Talk2Tax invoices, expenses, budgets and payments) always get private channels.
4. **Card.** The module's bot account posts a system message with `metadata.module`: event label, tone, record link, up to 8 facts, and the linked task or approval. The web timeline renders it as a card.
5. **Work.** Depending on the event, Connect creates a **task** (assigned to `people`), an **approval** (`people` are the approvers), or upserts the **project** and milestone list (Samptrek). Identity sync (SampCrew `employee.synced`) only links people.
6. **Notify.** The people involved get an in-app notification (`alert`, `task` or `approval`) and a push.

The result lists every step it took, for example `["conversation.created","card.posted","approval.created","notified"]`.

## What each module gets

| Module         | Events (examples)                                                                                    | Back to the module                     |
| -------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Samptrek       | project created/updated/escalated, milestone due/reached, task assigned, deadline approaching, file  | tasks created from chat                |
| SampleAudience | supplier onboarded, feasibility request, delivery update, quota alert, supplier issue, performance   | "Message supplier" action              |
| Sampcode       | survey created, QA issue (bug task), test link shared, survey approval, launch ready, incident       | tasks, approval decisions              |
| SampBidX       | bid created, pricing approval, quotation updated, proposal sent, bid deadline, escalation            | approval decisions                     |
| SampForce      | lead, opportunity, client message logged, follow-up due, deal stage, deal won, client assigned, file | "Log to SampForce", "Create follow-up" |
| SampCrew       | announcements, policies, onboarding, leave requested/decided, HR case, employee sync                 | leave decisions                        |
| Talk2Tax       | invoice, payment reminder/overdue, expense, budget approval, finance notice, attachment              | approval decisions                     |

Each module's full feature list, with how Connect delivers each feature, is shown in its admin panel and defined in the catalogue.

## Outbound actions

Connect POSTs `{ id, type, tenantId, createdAt, data }` to `{baseUrl}/connect/actions`, signed with the module's signing secret. The body uses the same envelope as webhooks. There are two kinds:

- **Automatic.** `task.created`, when a task is made in a conversation linked to the module's record, and `approval.decided`, when an approval the module raised is decided.
- **User actions.** For example "Log to SampForce", offered on linked records in the conversation's Details panel. Running one posts a small card in the conversation.

Behaviour depends on the mode:

- Test mode records the action as `test_mode`.
- If the module is off or missing a URL or key, the action is recorded as `not_configured`.
- Failures are recorded with the HTTP status and can be retried from the admin panel.

## Webhooks

Admins can subscribe URLs to these events: `message.created` (linked conversations only), `task.created`, `task.updated`, `approval.requested`, `approval.decided` and `record.linked`. Subscriptions can be filtered by module. Deliveries go through a durable Mongo outbox and are signed with the subscription's secret, which is shown once. Failed deliveries are retried after 10 s, 1 min, 5 min, 30 min, 2 h and 6 h, then marked dead. Delivery rows expire after 30 days.

## Live sync across devices

| Change                                                           | How other devices learn about it                                             | After being offline                          |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------- |
| A module record is linked to a conversation, or its facts change | `record:changed` `{conversationId, linkId, reason}` to the conversation room | Details panel refetches records on reconnect |
| Someone runs a record action (e.g. Log to SampForce)             | `record:changed` with `reason: 'action'`, plus the action card as a message  | Messages sync as usual; records refetch      |
| Module cards                                                     | Ordinary system messages (`message:new`)                                     | Message gap recovery                         |
| Tasks and approvals                                              | `task:upsert` / `approval:upsert` to everyone involved                       | Lists refetch on reconnect (cached offline)  |

## Security notes

- Module keys are scoped to one tenant and one module, stored hashed, revocable, and rate-limited (600 requests a minute). Issuing a key, revoking it and linking an identity are all audit-logged.
- Signatures are verified over the raw request body with a constant-time compare.
- Widget sessions are ordinary device sessions for the mapped user. They see only what that user can see and appear in their device list.
- Restricted records never go to public channels. Tasks and approvals check conversation membership before assigning anyone.

## Planned

- Retries with backoff for outbound module actions. Today a failed action is retried by hand; the webhook queue is already durable.
- Conversation-scoped widget tokens. Today a widget session is the user's full session.
- Tasks, approvals and projects screens on mobile.
- The real module endpoints, which need each module team to implement `/connect/actions` and `/connect/health`.
