# Administration and audit log

Owners and admins open **Administration** from the nav rail (or ⌘K → "Administration"). It replaces the old admin dialog and has four tabs.

## Overview

`GET /v1/admin/overview` (needs `audit.read`) returns, for the current organization:

- Members by role, how many have two-step verification on, active devices, messages in the last 7 days.
- Plan name, subscription status and storage used (from Billing).
- Whether single sign-on is set up and whether password sign-in is still allowed.
- Integrations connected and failing (from the database integration settings).
- The six latest security events (sign-ins, MFA changes, device revokes, SSO and role changes).

Shortcuts open Integrations, Billing, Branding and Recordings.

## Members and devices

- Search members, add a member (seat limits from the plan apply; guests don't use a seat), change role, reset two-step verification, deactivate and reactivate. Deactivating signs the person out of every device immediately.
- **Activity** on a member opens the audit log filtered to that person.
- Devices lists every signed-in session in the organization; any can be signed out.

## Audit log

`GET /v1/admin/audit` accepts:

| Param       | Meaning                                                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| `category`  | `sign-in`, `members`, `security`, `conversations`, `integrations`, `billing`, `organization`, `other` |
| `actorId`   | Only actions by this user                                                                             |
| `q`         | Text search in the action name, IP address and target id                                              |
| `from`/`to` | ISO dates                                                                                             |
| `before`    | Cursor from the previous page's `nextCursor`                                                          |
| `limit`     | 1–200, default 50                                                                                     |

Entries come back with a readable label, the actor's and target's names, and the raw metadata.

`GET /v1/admin/audit/export` takes the same filters and downloads a CSV (UTF-8 with BOM so Excel opens it correctly), up to 10,000 rows. Cells that begin with `=`, `+`, `-` or `@` are prefixed with `'` so spreadsheet apps don't run them as formulas. Every export is itself recorded as `audit.exported`.

## Marketing page and public pricing

The home page (`/`) lists what is built today and shows pricing from `GET /v1/billing/plans`, which returns only public, active plans from the database catalog (see [billing.md](billing.md)). Nothing is hardcoded: with no published plans the page shows "Pricing on request".
