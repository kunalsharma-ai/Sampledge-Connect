# Help center

Everyone gets a **Help** entry: in the web sidebar (Work and Network) and the command palette
("Help center"), and on mobile under More > Help center. It has:

- **Overview**: search across guides and answers, recent questions, popular questions and topics.
- **Feature guides**: every entry in `FEATURE_HELP` (see [feature-help.md](feature-help.md)).
  Admin-only guides show only to owners and admins.
- **FAQs**: `HELP_FAQS` in `packages/contracts/src/help-faq.ts`, grouped by category, each linked
  to its feature guide. `searchFaqs()` is shared by web and mobile. Add an FAQ when you add a
  feature; the contracts test checks every `featureId` exists.
- **Ask a question**: raise a query to your organization's admins or to SampConnect support, with
  a topic and an optional feature. Network (personal) accounts can only ask SampConnect support.
- **My questions**: your questions with every reply and their status.
- **Team questions** (owners and admins): every question in the organization. Admins reply, set
  the status, or pass a question on to SampConnect support.

SampConnect support answers in the super admin console, **Support** tab (`support.view`, held by
the owner, admin and support platform roles).

## Data and API

`support_queries` (tenant collection, migration `054-support`), replies stored inline. Contracts in
`packages/contracts/src/support.ts`.

| Route | Who |
| --- | --- |
| `GET/POST /v1/support/queries` | anyone: own questions, ask (idempotent by `clientId`) |
| `GET/PATCH /v1/support/queries/:id`, `POST …/:id/replies` | asker, owners, admins |
| `GET /v1/support/admin/queries` | owners and admins |
| `GET /v1/platform/support/queries`, `POST …/:tenantId/:id/replies`, `PATCH …/:tenantId/:id` | `support.view` |

Statuses: `open`, `in_progress`, `answered`, `resolved`. A reply from an admin or support sets
`answered`; a reply from the asker reopens it. Askers may only set `resolved` or `open`.

## Sync

Every change emits `support:changed` to the asker, the organization's admins, and (when routed to
SampConnect support) the platform room, plus a push (`type: 'support'`) that opens the question on
mobile. Writes go through the offline queues (web `queueAction` with `support|…` keys, mobile
`support.act` work items), so questions and replies written offline show as "Waiting to send" and
send in order on reconnect. Lists are cached on the device and refreshed on reconnect.
