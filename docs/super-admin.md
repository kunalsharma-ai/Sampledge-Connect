# Super admin console

The super admin console is where the people who run SampConnect see and manage every
organization on the server: plans and billing, usage and health, suspensions and deletion,
what each organization's people may do, every organization's activity (including password
changes), reported Network content, platform integrations, platform admins and an audit log of
what they did. Nothing here needs a server setting or a restart.

- **Web:** the **Super admin** item in the left rail (only shown to platform admins).
- **Mobile:** More → Workspace → **Super admin** (only shown to platform admins). The phone covers
  the overview, organizations (plan, suspend, reactivate, delete, support view, force a new
  password), activity, permissions, platform admins and the audit log. The plan catalog, online
  payments, platform integrations, activity export and how long activity is kept are web only.

## Roles

Platform admins are work accounts (an organization + a person) stored in the `platform_admins`
collection. Each has one role:

| Role                     | Can                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| Super admin (`owner`)    | Everything, including permissions, activity retention, platform admins and deleting orgs |
| Platform admin (`admin`) | Everything except permissions, retention, platform admins and deleting organizations     |
| Billing (`billing`)      | Overview, organizations (read), plans, plan assignment and payments                      |
| Support (`support`)      | Overview, organizations (read), the support view, all activity and the audit log         |
| Moderator (`moderator`)  | Overview and SampConnect Network reported content                                        |

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

## Permissions: what each organization's people may do

Super admins decide what owners, admins, members and guests may do in every organization
(Super admin → **Permissions**), and can give one organization its own rules (its page →
**Permissions**). Organization owners can't change these; SampConnect is the top authority.

- Each organization uses its own rules if a super admin set them, otherwise the default for every
  organization, otherwise SampConnect's standard (`TENANT_ROLE_GRANTS`).
- The matrix covers every organization-level control: managing the organization, adding people,
  changing roles and resetting passwords, signing devices out, the audit log, integrations,
  recordings and minutes, the Client Inbox, messaging channels, the AI assistant,
  organization-wide analytics, chat theme rules, everyone's tasks and approvals, the directory,
  and starting conversations and channels (`TENANT_PERMISSIONS` with labels in
  `TENANT_PERMISSION_INFO`).
- The server enforces it on every request: the signed-in person's grants are resolved with
  their session (`TenantContext.grants`, cached 30 seconds in Redis with a version that every
  change bumps), and every check goes through `tenantCan(ctx, permission)`. `GET /v1/me`
  returns `permissions` for the apps. A change takes effect within 30 seconds everywhere.
- Changing an organization's rules is written to its own audit log ("Permissions changed by
  SampConnect"). Conversation-level rules (who may post or moderate inside one conversation)
  are unchanged.

Only super admins change permissions; platform admins and support can look.

## Passwords

Nobody can see a password: SampConnect only stores a one-way hash (Argon2id). What super admins
see instead is every password event in every organization, under **Activity → Passwords &
security**, with who, when, the IP address and the device:

| Event                                            | When                                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------------------- |
| Changed their password (`auth.password_changed`) | Someone changed their own (Settings → Password), or chose a new one after a reset |
| Wrong current password when changing it          | A failed attempt to change it                                                     |
| Reset someone's password                         | An owner or admin gave a member a temporary password                              |
| SampConnect required a new password              | A super admin forced a reset                                                      |
| Asked to set a new password                      | Sign-in stopped until a new password is chosen                                    |
| Failed sign-in                                   | Wrong password (already recorded)                                                 |

- **Change your own** (web Settings → Password, mobile More → Settings → Password,
  `POST /v1/auth/password`): needs the current password; your other devices are signed out.
- **Admin reset** (Administration → Members → Reset password, `POST /v1/users/:id/password`):
  needs `members.manage`; only owners reset owners. The person is signed out everywhere and
  must choose their own password at the next sign-in.
- **Force a new password** (super admin, organization page → Support view → Force new password,
  `POST /v1/platform/orgs/:id/people/:userId/password-reset`): signs the person out of every
  device; their next sign-in asks for a new password (login answers 403 with
  `details.reason: 'password_change_required'`, and the apps show a New password field and send
  `newPassword`). It must differ from the old one.

## Activity in every organization

Super admin → **Activity** shows every organization's audit log in one place, newest first, and
live: sign-ins and failed sign-ins, password changes and resets, two-step changes, people and
role changes, devices signed out, exports, integrations, billing, recordings and AI use. Search,
filter by kind and date, open one organization's activity from its page, and **Export CSV**
(up to 50,000 rows; the export itself is audited). Message contents and passwords are never
recorded.

**Keep for** sets how long organization activity is kept (forever by default, or 90 days to
5 years). An hourly job deletes older entries. The super admins' own audit log is always kept.
Only super admins change it.

## Audit log

Every super admin action is recorded in the global `platform_audit` collection: who (name, email
and their organization), what, which organization, the reason when there is one, and the IP
address. Filter by area (Organizations, Billing, Moderation, Admins, Integrations, Support).
Actions that affect an organization (suspension, reactivation, deletion, rename, support view)
are also written to that organization's own audit log.

## Live sync

Everything updates live on every platform admin's devices through `platform:changed`
(`{ area: 'orgs' | 'admins' | 'billing' | 'audit' | 'me' | 'permissions' | 'activity', tenantId? }`), sent to the
`platform:admins` room. A person whose role changes or who is removed sees it at once. After a
reconnect, open console screens reload. Console actions need a connection; offline, they say so
instead of queueing, and the risky ones carry an idempotent `clientActionId`.

## API

All routes are under `/v1/platform` and need a platform role (`403` otherwise):
`GET me`, `GET overview`, `GET health`, `GET|POST orgs`, `GET|PATCH orgs/:id`,
`GET orgs/:id/support`, `POST orgs/:id/suspend`, `POST orgs/:id/reactivate`,
`POST|DELETE orgs/:id/deletion`, `PUT orgs/:id/plan`, `GET|POST admins`,
`PATCH|DELETE admins/:id`, `GET accounts?q=`, `GET audit`, `GET|PUT permissions`,
`GET|PUT orgs/:id/permissions`, `POST orgs/:id/people/:userId/password-reset`, `GET activity`,
`GET activity/export`, `GET|PUT activity/retention`. The plan catalog
(`/v1/platform/billing/...`), platform integrations (`/v1/platform/integrations`) and Network
moderation keep their existing routes and now check the matching permission.

`apps/api/test/platform.test.ts` covers bootstrap, role limits, the last super admin, suspension
end to end, deletion and the purge, the support view, the audit log and live updates.
`apps/api/test/platform-controls.test.ts` covers permissions per organization and as the
default, password change, admin reset and forced reset, activity paging, filtering, export and
retention.
