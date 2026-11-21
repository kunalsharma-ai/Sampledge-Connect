# Tasks, approvals and projects ("conversation to action")

Tasks, approvals and projects are Connect's own records, so they work with no module connected. When one is created in a conversation linked to a module record (a Samptrek project, a Talk2Tax expense and so on), it carries that record, and the module is told through its outbound action. See [sampledge-modules.md](sampledge-modules.md).

## Tasks

- **From chat.** Hover any message and choose the ✓ icon, "Create task". The dialog is prefilled from the message. The task keeps a short excerpt of the message, so it still has context if the message is deleted. You can also create a task from the Details panel or the Tasks screen.
- **Fields.** Title, details, type (task, bug, follow-up, escalation), priority, due date and assignees. In a private conversation, assignees must be members; in a public channel, anyone in the workspace can be assigned.
- **What happens.**
  - A task card is posted in the conversation and kept current as the status changes.
  - Assignees get a `task` notification and a push.
  - In a linked conversation the module gets `task.created`. The task shows whether that was sent, sent in test mode, or not configured.
- **Idempotent.** The client sends a `clientRequestId`, so a retried create makes one task.
- **API.** `GET /v1/tasks?scope=mine|created|conversation|record|all&status=active|done|any`, `POST /v1/tasks`, `GET` and `PATCH /v1/tasks/:id`. The creator, the assignees and admins can update a task.

## Approvals

- **From chat.** Hover a message and choose the stamp icon, "Request approval". Modules raise approvals from events such as SampBidX pricing, Talk2Tax expenses and budgets, Sampcode survey sign-off, and SampCrew leave.
- **Fields.**
  - Category: general, pricing, survey, expense, budget, invoice or leave.
  - An optional amount, stored in minor units with an ISO currency.
  - Approvers, and a rule: **any one** approver settles it, or **everyone** must approve (any reject settles it).
- **Deciding.** Approvers can decide from the card in the conversation, from the Details panel, or from **Tasks & Approvals → To decide**. Each decision can carry a comment.
  - A second decision on a settled approval gets `409`.
  - Concurrent decisions are serialized with optimistic concurrency.
  - Every decision is audit-logged.
  - The requester is notified when it settles.
  - A module approval sends `approval.decided` back to the module.
- **Cancel.** The requester can cancel a pending request.
- **API.** `GET /v1/approvals?scope=to_decide|requested|conversation|record|all`, `POST /v1/approvals`, `GET /v1/approvals/:id`, `POST /v1/approvals/:id/decision`, `POST /v1/approvals/:id/cancel`.

## Projects

- **Samptrek projects** are created and kept current by `project.*` and `milestone.*` events. Each has its project channel.
- **Connect projects** are made on the Projects screen. Creating one creates the channel too, public or private, with the chosen members.
- **Counts.** Open tasks, overdue tasks and pending approvals are counted from the work in the project's channel. You see only projects whose channel you can read.
- **API.** `GET` and `POST /v1/projects`, `GET /v1/projects/:id`.

## From AI suggestions

AI summaries and the status digest offer **Create task** on suggested action items. It opens this
same form prefilled (assignee, due date, source message); the person reviews it and presses Create.
See [ai.md](ai.md).

## Live updates and offline

The server emits `task:upsert` and `approval:upsert` over Socket.IO to everyone involved. The web app patches its lists live and caches them in the signed-in identity's IndexedDB, so they still show offline (read only). Creating tasks and deciding approvals need a connection, and the buttons say so.

## Planned

- Tasks and approvals screens on mobile. Mobile already shows the notifications.
- Recurring tasks, subtasks and approval delegation.
