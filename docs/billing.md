# Billing

Connect never hardcodes a price. The people who run the server (platform operators) keep a
plan catalog in the database, and customers pick from it. Payments go through Stripe when it is
set up; without it, operators assign plans by hand and bill by invoice.

## Who does what

| Who                                                         | Where                                           | Can                                                |
| ----------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------- |
| Platform operator (email listed in `PLATFORM_ADMIN_EMAILS`) | Billing → Plan catalog, Organizations, Payments | Create and edit plans, assign plans, set up Stripe |
| Organization owner                                          | Billing → Your plan                             | Pick a plan, pay, open the Stripe portal, invoices |
| Organization admin                                          | Billing → Your plan                             | See the plan, usage and invoices (read only)       |

`PLATFORM_ADMIN_EMAILS` is the only billing value in env: it's a bootstrap value that says who
the operators are. Everything else (plans, prices, Stripe keys) lives in the database.

## Plans

A plan has a name, description, currency (ISO code such as `usd`, `inr`, `eur`), a price per
member per month, an optional price per member per year, limits (members, file storage in GB,
recording hours; empty means unlimited), feature bullets, a trial length, and two switches:
**Offered to customers** (public) and **Active**. Hidden plans can still be assigned by an
operator, for custom deals.

Amounts are stored as whole numbers in the currency's smallest unit (cents, paise), so Connect
never rounds. The form takes normal amounts (`499` for ₹499) and converts them.

A price of 0 makes a free plan: it starts at once, with no payment step.

## Paying online (Stripe)

1. In Stripe, copy a secret key. Start with a test key (`sk_test_…`): nobody is charged.
2. Add a webhook endpoint at `https://<your-api-host>/v1/billing/stripe/webhook` for
   `checkout.session.completed`, `customer.subscription.created/updated/deleted` and
   `invoice.created/finalized/paid/payment_failed/voided/marked_uncollectible`. Copy its signing
   secret (`whsec_…`).
3. In Connect: **Billing → Payments**, paste both, tick **Take payments online**, **Save**, then
   **Test connection**. The keys are stored encrypted (the `billing.stripe` platform integration).

You don't create products or prices in Stripe. At checkout Connect sends the catalog price for
the chosen plan and period, the number of members as the quantity, and the plan's trial (once per
organization). Changing plans later updates the Stripe subscription in place, prorated.

What Connect records from Stripe, only through signed webhooks (the signature and a 5 minute
timestamp window are checked against the raw request body):

- the subscription: plan, status (trial, active, payment due, canceled), period end, members
  billed, cancel at period end;
- invoices: number, status, total and links to Stripe's hosted invoice and PDF.

Owners change cards, download receipts and cancel in Stripe's customer portal (**Manage
payment**).

## Members and limits

- A member takes a seat; guests don't. Deactivated people don't.
- With a plan that has a member limit, adding someone past the limit (invite, reactivation,
  changing a guest to a member, or first sign-in through SSO) is refused with a message that
  points to Billing.
- When people join or leave, the quantity billed in Stripe follows automatically (prorated).
- File storage and recording hours are shown against the plan's limits. They aren't enforced yet.

## Paying by invoice

Without Stripe, owners can still start free plans. For paid plans, an operator opens **Billing →
Organizations** and picks the plan for that organization. Organizations that pay online can't be
changed there, so Connect and Stripe never disagree.

## Audit log

`billing.plan_created`, `billing.plan_updated`, `billing.checkout_started`,
`billing.plan_changed`, `billing.subscription_updated`, `billing.invoice_paid`,
`billing.invoice_open`, `billing.plan_assigned_by_operator`.

## API

| Route                                  | Who       | Does                                              |
| -------------------------------------- | --------- | ------------------------------------------------- |
| `GET /v1/billing`                      | admins    | Plan, subscription, usage, catalog, invoices      |
| `POST /v1/billing/checkout`            | owner     | `{planId, interval}` → Stripe URL, or done (free) |
| `POST /v1/billing/portal`              | owner     | Stripe customer portal URL                        |
| `POST /v1/billing/stripe/webhook`      | Stripe    | Signed events                                     |
| `GET/POST /v1/platform/billing/plans`  | operators | List and create plans                             |
| `PUT /v1/platform/billing/plans/:id`   | operators | Edit a plan                                       |
| `GET /v1/platform/billing/tenants`     | operators | Organizations with their plan and members         |
| `PUT /v1/platform/billing/tenants/:id` | operators | Assign a plan by hand                             |

## Planned

- Enforcing storage and recording limits.
- Other payment providers (Razorpay for India), tax IDs on invoices.
- Billing on the mobile app.
