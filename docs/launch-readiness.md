# Launch readiness

What is checked automatically before every merge, what it found, and the numbers measured.
Run everything locally with the commands in each section.

## Security

`apps/api/test/security.test.ts` (runs in `pnpm test:integration`):

- **Every route needs a session.** The test lists all ~185 HTTP routes from the running app
  and calls each without a token; anything other than 401 fails, unless the route is on a
  short public list where each entry says how it authenticates instead (signed webhook, guest
  link token, signed file URL, metrics token) or why it's public (pricing, sign-in branding).
  A new route that forgets its guard fails CI.
- **Admin routes need the role.** A member calls every admin, operator and integrations route
  and must get 403.
- **Tokens:** a swapped payload, `alg: none`, an HS256 confusion token and garbage are all 401.
- **Input:** JSON bodies over 256 KB get 413; query operators (`{"$ne": null}`) in sign-in
  are rejected as invalid input; unknown origins get no CORS headers.
- **Enumeration:** a wrong password and an unknown email give the identical response.
- **Brute force:** repeated wrong passwords are rate limited (429 within 20 tries).
- **Headers:** HSTS, `nosniff`, `frame-ancestors 'none'` CSP on the API, no `x-powered-by`.
- Existing suites cover tenant isolation (`tenancy.test.ts`), session revocation, SSO state
  and PKCE (`sso.test.ts`), signed webhooks and module keys.

CI also runs `pnpm audit --prod --audit-level high`. At launch: no high or critical
advisories in shipped dependencies (nodemailer was updated to clear a moderate one; one
moderate advisory remains in an Expo build tool used only when building the mobile app).

The STRIDE analysis is in [threat-model.md](threat-model.md).

## Performance

`apps/api/test/performance.test.ts`:

- **Indexes:** every hot query (message history, sync, conversation lists, receipts,
  notifications, audit log, devices, directory) is explained against MongoDB and must use an
  index with no in-memory sort. This found three sorted lists without a matching index
  (audit log, devices, directory), added in migration `031-launch-indexes`.
- **Latency budget with 20,000 messages in one conversation** (p95, 30 calls each; CI fails
  above 250 ms, `PERF_BUDGET_MS` to change):

| Call                        | p95 measured |
| --------------------------- | ------------ |
| Latest 50 messages          | 13 ms        |
| 50 messages from the middle | 7 ms         |
| Conversation list           | 8 ms         |
| Sync (200 new changes)      | 25 ms        |

**Load test** (`node apps/api/scripts/load-test.mjs --users 10 --connections 300 --seconds 20 --rate 20`),
one API process on 4 vCPU with MongoDB and Redis on the same machine:

| Measure                                                               | p50   | p95   | p99   |
| --------------------------------------------------------------------- | ----- | ----- | ----- |
| Send → stored acknowledgement (398 sends)                             | 14 ms | 18 ms | 24 ms |
| Send → received on every other device (119,002 deliveries, none lost) | 11 ms | 16 ms | 20 ms |
| History while under load                                              | 7 ms  | 12 ms | 12 ms |
| Sync while under load                                                 | 11 ms | 19 ms | 19 ms |

Run the load test against your own staging server before go-live; the sizing table in
[deploy.md](deploy.md) is based on these numbers with headroom.

## Accessibility

`apps/web/e2e/a11y.spec.ts` runs axe-core (WCAG 2.0/2.1/2.2 A and AA) on the home page,
sign-in, registration, messages, and 12 workspace screens, in Midnight Executive (dark) and
Arctic Professional (light), at desktop and phone size. Serious and critical issues fail the
`accessibility` CI job.

```bash
WEB_URL=http://localhost:8080 API_URL=http://localhost:8080/api pnpm --filter @sampledge/web e2e
```

Fixed for launch:

- Small grey text (timestamps, hints) was 4.1–4.4:1 in the light theme. The subtle text tone
  is now computed per theme to reach 4.5:1 on every background, including custom brand
  themes; the design-token tests enforce it.
- On phones, admins had no way to reach Administration, Integrations, Billing, Branding or
  Recordings. The bottom bar now has **More**, which opens every other screen.
- Icon-only buttons on phones (New task, New project, New meeting, Mark all read, Retention
  & backup) had no accessible name.
- Composer toolbar buttons could shrink below the 24 px touch target.
- The ⌘K button's name didn't include its visible text; the Tasks tab list contained a
  checkbox.

Not covered by automation, to check by hand before launch: screen reader pass (VoiceOver and
NVDA) through sign-in, sending a message and joining a call; keyboard-only use of the call
screen; 200% zoom.

## CI/CD

| Workflow                   | When                      | Does                                                        |
| -------------------------- | ------------------------- | ----------------------------------------------------------- |
| `ci.yml` → `build-test`    | every PR and push to main | audit, format, build, typecheck, unit and integration tests |
| `ci.yml` → `accessibility` | every PR and push to main | starts API + web on Mongo and Redis, runs the axe suite     |
| `release.yml`              | push to main, `v*` tags   | builds and pushes API and web images to GHCR                |
| `release.yml` (build only) | PRs touching Dockerfiles  | builds both images without pushing                          |
| Dependabot                 | weekly / monthly          | npm, GitHub Actions and Docker base image updates           |

Deploying: [deploy.md](deploy.md). Watching it run: [monitoring.md](monitoring.md).
