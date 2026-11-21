import type { Migration } from './runner.js';
import { date, ensureCollection, int, nullable, str, tenantScoped } from './001-initial.js';

const bool = { bsonType: 'bool' };
const num = { bsonType: ['int', 'long', 'double'] };

/** Phase 4: plan catalog (global), one subscription per tenant, invoices. */
export const billingMigration: Migration = {
  id: '021-billing',
  async up(db) {
    await ensureCollection(db, 'billing_plans', {
      bsonType: 'object',
      required: ['_id', 'name', 'currency', 'monthlyPerSeat', 'limits', 'active', 'updatedAt'],
      properties: {
        _id: str,
        name: str,
        description: str,
        currency: { bsonType: 'string', pattern: '^[a-z]{3}$' },
        monthlyPerSeat: int,
        yearlyPerSeat: nullable(int),
        limits: { bsonType: 'object' },
        features: { bsonType: 'array', items: str },
        trialDays: int,
        public: bool,
        active: bool,
        sortOrder: int,
        updatedAt: date,
        updatedBy: nullable(str),
      },
    });
    await db
      .collection('billing_plans')
      .createIndex({ active: 1, sortOrder: 1 }, { name: 'catalog' });

    await ensureCollection(
      db,
      'billing_subscriptions',
      tenantScoped(['status', 'interval', 'seats', 'updatedAt'], {
        planId: nullable(str),
        status: { enum: ['none', 'trialing', 'active', 'past_due', 'canceled'] },
        interval: { enum: ['month', 'year'] },
        seats: int,
        trialEndsAt: nullable(date),
        currentPeriodEnd: nullable(date),
        cancelAtPeriodEnd: bool,
        provider: { enum: ['manual', 'stripe', null] },
        stripeCustomerId: nullable(str),
        stripeSubscriptionId: nullable(str),
        stripeItemId: nullable(str),
        trialUsed: bool,
        updatedAt: date,
      }),
    );
    await db.collection('billing_subscriptions').createIndexes([
      { key: { tenantId: 1 }, name: 'one_per_tenant', unique: true },
      { key: { stripeCustomerId: 1 }, name: 'by_customer', sparse: true },
    ]);

    await ensureCollection(
      db,
      'billing_invoices',
      tenantScoped(['provider', 'providerInvoiceId', 'status', 'currency', 'total', 'createdAt'], {
        provider: { enum: ['stripe', 'manual'] },
        providerInvoiceId: str,
        number: nullable(str),
        status: { enum: ['draft', 'open', 'paid', 'void', 'uncollectible'] },
        currency: str,
        total: num,
        periodStart: nullable(date),
        periodEnd: nullable(date),
        createdAt: date,
        url: nullable(str),
        pdfUrl: nullable(str),
      }),
    );
    await db.collection('billing_invoices').createIndexes([
      { key: { tenantId: 1, createdAt: -1 }, name: 'recent' },
      { key: { provider: 1, providerInvoiceId: 1 }, name: 'one_per_invoice', unique: true },
    ]);
  },
};
