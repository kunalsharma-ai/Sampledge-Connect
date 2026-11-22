# Super admin console

The super admin console is where the people who run SampConnect see and manage every
organization on the server: plans and billing, usage and health, suspensions and deletion,
reported Network content, platform integrations, platform admins and an audit log of what they
did. Nothing here needs a server setting or a restart.

- **Web:** the **Super admin** item in the left rail (only shown to platform admins).
- **Mobile:** More → Workspace → **Super admin** (only shown to platform admins). The phone covers
  the overview, organizations (plan, suspend, reactivate, delete, support view), platform admins
  and the audit log. The plan catalog, online payments and platform integrations are web only.

## Roles

Platform admins are work accounts (an organization + a person) stored in the `platform_admins`
collection. Each has one role:

| Role                     | Can                                                                         |
| ------------------------ | --------------------------------------------------------------------------- |
| Super admin (`owner`)    | Everything, including adding and removing platform admins and deleting orgs |
| Platform admin (`admin`) | Everything except platform admins and deleting organizations                |
| Billing (`billing`)      | Overview, organizations (read), plans, plan assignment and payments         |
| Support (`support`)      | Overview, organizations (read), the support view and the audit log          |
| Moderator (`moderator`)  | Overview and SampConnect Network reported content                           |

The permission list is `PLATFORM_PERMISSIONS` in `packages/contracts/src/platform.ts`, and
`platformCan(role, permission)` is the single check used by the API, web and mobile.

There is always at least one super admin: removing or demoting the last one returns 409.

## The first super admin (bootstrap)

`PLATFORM_ADMIN_EMAILS` in the API's env is only a bootstrap. While **nobody** holds the super
admin role, a listed account becomes super admin the first time it signs in or opens the console,
and is shown as "From the server's first super admin setting". After that the setting is ignored;
add everyone else in **Platform admins**.

Pin the entry to your organization so a same-named email in another organization can't claim it:

```
PLATFORM_ADMIN_EMAILS=sampconnect-hq:you@example.com
```

A bare email (`you@example.com`) still works but matches that email in any organization.

**Upgrading:** before this console, every email in `PLATFORM_ADMIN_EMAILS` was an operator. Now
only the first listed person to sign in becomes super admin; add the others in Platform admins
with the role they need.

## Organizations

- **List and search** by name or address, filtered by All, Active, Suspended or Being deleted,
  with plan, members, storage and last activity.
- **Create** an organization with its owner's name, email and a temporary password you give them,
  and optionally a plan.
- **Rename** it (its address stays the same).
- **Plan:** assign a plan and subscription state by hand (invoice, bank transfer). Organizations
  that pay online through Stripe change their own plan from Billing.
- **Suspend** with a reason. Everyone in it is signed out on every device at once (sockets are
  cut, refresh tokens stop working, the session status cache is cleared), and signing in shows
  "This organization’s access to SampConnect is suspended. Contact SampConnect support." Nothing is deleted.
  **Reactivate** lets them back in.
- **Delete** (super admins only): type the organization's address to confirm. People are signed
  out straight away and **everything is erased after 30 days** (`ORG_DELETION_GRACE_DAYS`) unless
  someone cancels. The hourly purge removes every document with that organization's id in every
  collection, its files, its platform admins and the organization itself, and writes
  "Erased an organization" to the audit log. Organizations with an active Stripe subscription
  must cancel it first.
- You can't suspend or delete the organization you are signed in from.

## Support view

The support view shows what support needs to troubleshoot: members (role, status, two-step,
devices, last seen), signed-in devices, integrations and whether they work, sign-in settings, and
recent sign-in failures and security events. It never shows messages, files or secrets, and it
never signs in as anyone. Opening it is written to the organization's own audit log
("SampConnect support opened the support view"), so their admins can see it.

## Audit log

Every super admin action is recorded in the global `platform_audit` collection: who (name, email
and their organization), what, which organization, the reason when there is one, and the IP
address. Filter by area (Organizations, Billing, Moderation, Admins, Integrations, Support).
Actions that affect an organization (suspension, reactivation, deletion, rename, support view)
are also written to that organization's own audit log.

## Live sync

Everything updates live on every platform admin's devices through `platform:changed`
(`{ area: 'orgs' | 'admins' | 'billing' | 'audit' | 'me', tenantId? }`), sent to the
`platform:admins` room. A person whose role changes or who is removed sees it at once. After a
reconnect, open console screens reload. Console actions need a connection; offline, they say so
instead of queueing, and the risky ones carry an idempotent `clientActionId`.

## API

All routes are under `/v1/platform` and need a platform role (`403` otherwise):
`GET me`, `GET overview`, `GET health`, `GET|POST orgs`, `GET|PATCH orgs/:id`,
`GET orgs/:id/support`, `POST orgs/:id/suspend`, `POST orgs/:id/reactivate`,
`POST|DELETE orgs/:id/deletion`, `PUT orgs/:id/plan`, `GET|POST admins`,
`PATCH|DELETE admins/:id`, `GET accounts?q=`, `GET audit`. The plan catalog
(`/v1/platform/billing/...`), platform integrations (`/v1/platform/integrations`) and Network
moderation keep their existing routes and now check the matching permission.

`apps/api/test/platform.test.ts` covers bootstrap, role limits, the last super admin, suspension
end to end, deletion and the purge, the support view, the audit log and live updates.
