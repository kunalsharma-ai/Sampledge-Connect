import type { Migration } from './runner.js';
import { date, ensureCollection, nullable, str, tenantScoped } from './001-initial.js';

/**
 * Phase 2: Sampledge module integrations and work items (docs/sampledge-modules.md, docs/work.md).
 * Module connection settings themselves live in integration_settings (010).
 */
export const sampledgeModulesMigration: Migration = {
  id: '011-sampledge-modules',
  async up(db) {
    // In-app notifications gain module alerts, task assignments and approval requests.
    await ensureCollection(
      db,
      'notifications',
      tenantScoped(
        ['userId', 'kind', 'conversationId', 'messageId', 'actorId', 'preview', 'createdAt'],
        {
          userId: str,
          kind: { enum: ['mention', 'reply', 'alert', 'task', 'approval'] },
          conversationId: str,
          messageId: str,
          actorId: str,
          preview: { bsonType: 'string', maxLength: 200 },
          createdAt: date,
          readAt: nullable(date),
        },
      ),
    );

    const MODULES = ['samptrek', 'sampleaudience', 'sampcode', 'sampbidx', 'sampforce', 'sampcrew', 'talk2tax'];
    const moduleEnum = { enum: MODULES };

    await ensureCollection(
      db,
      'module_keys',
      tenantScoped(['module', 'prefix', 'hash', 'createdAt'], {
        module: moduleEnum,
        prefix: str,
        hash: { bsonType: 'string', pattern: '^[0-9a-f]{64}$' },
        createdAt: date,
        revokedAt: nullable(date),
      }),
    );
    await db.collection('module_keys').createIndexes([
      { key: { hash: 1 }, name: 'by_hash', unique: true },
      { key: { tenantId: 1, module: 1, revokedAt: 1 }, name: 'active' },
    ]);

    await ensureCollection(db, 'module_bots', tenantScoped(['module', 'userId'], { module: moduleEnum, userId: str }));
    await db.collection('module_bots').createIndex({ tenantId: 1, module: 1 }, { unique: true, name: 'one_per_module' });

    await ensureCollection(
      db,
      'integration_events',
      tenantScoped(['module', 'eventId', 'type', 'status', 'receivedAt'], {
        module: moduleEnum,
        eventId: { bsonType: 'string', maxLength: 200 },
        type: str,
        status: { enum: ['processed', 'ignored', 'failed'] },
        receivedAt: date,
      }),
    );
    await db.collection('integration_events').createIndexes([
      { key: { tenantId: 1, module: 1, eventId: 1 }, name: 'idempotency', unique: true },
      { key: { tenantId: 1, module: 1, _id: -1 }, name: 'log' },
    ]);

    await ensureCollection(
      db,
      'identity_links',
      tenantScoped(['module', 'externalUserId', 'userId', 'matchedBy', 'createdAt'], {
        module: moduleEnum,
        externalUserId: { bsonType: 'string', maxLength: 128 },
        userId: str,
        matchedBy: { enum: ['email', 'manual'] },
        createdAt: date,
      }),
    );
    await db.collection('identity_links').createIndexes([
      { key: { tenantId: 1, module: 1, externalUserId: 1 }, name: 'one_per_external', unique: true },
      { key: { tenantId: 1, userId: 1 }, name: 'by_user' },
    ]);

    await ensureCollection(
      db,
      'linked_records',
      tenantScoped(['module', 'recordType', 'externalId', 'title', 'sensitivity', 'createdAt'], {
        module: moduleEnum,
        recordType: str,
        externalId: { bsonType: 'string', maxLength: 128 },
        title: { bsonType: 'string', maxLength: 200 },
        conversationId: nullable(str),
        sensitivity: { enum: ['standard', 'restricted'] },
        createdAt: date,
      }),
    );
    await db.collection('linked_records').createIndexes([
      { key: { tenantId: 1, module: 1, recordType: 1, externalId: 1 }, name: 'one_per_record', unique: true },
      { key: { tenantId: 1, conversationId: 1 }, name: 'by_conversation' },
    ]);

    await ensureCollection(
      db,
      'module_actions',
      tenantScoped(['module', 'type', 'status', 'createdAt'], {
        module: moduleEnum,
        type: str,
        status: { enum: ['sent', 'failed', 'test_mode', 'not_configured'] },
        createdAt: date,
      }),
    );
    await db.collection('module_actions').createIndex({ tenantId: 1, module: 1, _id: -1 }, { name: 'log' });

    await ensureCollection(
      db,
      'webhook_subscriptions',
      tenantScoped(['url', 'events', 'secretEnc', 'active', 'createdAt'], {
        url: { bsonType: 'string', maxLength: 2048 },
        events: { bsonType: 'array', minItems: 1 },
        secretEnc: str,
        active: { bsonType: 'bool' },
        createdAt: date,
      }),
    );
    await db.collection('webhook_subscriptions').createIndex({ tenantId: 1, active: 1, events: 1 }, { name: 'matching' });

    await ensureCollection(
      db,
      'webhook_deliveries',
      tenantScoped(['subscriptionId', 'event', 'eventId', 'body', 'status', 'attempts', 'createdAt'], {
        subscriptionId: str,
        status: { enum: ['pending', 'delivered', 'failed', 'dead'] },
        body: { bsonType: 'string', maxLength: 300_000 },
        createdAt: date,
      }),
    );
    await db.collection('webhook_deliveries').createIndexes([
      { key: { status: 1, nextAttemptAt: 1 }, name: 'due' },
      { key: { tenantId: 1, subscriptionId: 1, _id: -1 }, name: 'by_subscription' },
      { key: { tenantId: 1, subscriptionId: 1, eventId: 1 }, name: 'once_per_event', unique: true },
      // Delivered rows are kept 30 days for the delivery log.
      { key: { createdAt: 1 }, name: 'ttl', expireAfterSeconds: 30 * 86400 },
    ]);

    const workRecord = nullable({
      bsonType: 'object',
      required: ['module', 'recordType', 'externalId', 'title'],
      properties: { module: moduleEnum, recordType: str, externalId: str, title: str },
    });
    await ensureCollection(
      db,
      'tasks',
      tenantScoped(['title', 'kind', 'status', 'priority', 'assigneeIds', 'createdBy', 'origin', 'createdAt'], {
        title: { bsonType: 'string', maxLength: 200 },
        description: { bsonType: 'string', maxLength: 4000 },
        kind: { enum: ['task', 'bug', 'follow_up', 'escalation'] },
        status: { enum: ['open', 'in_progress', 'blocked', 'done', 'cancelled'] },
        priority: { enum: ['low', 'normal', 'high', 'urgent'] },
        assigneeIds: { bsonType: 'array', maxItems: 100 },
        createdBy: str,
        dueAt: nullable(date),
        conversationId: nullable(str),
        record: workRecord,
        origin: { enum: ['connect', 'module'] },
        createdAt: date,
      }),
    );
    await db.collection('tasks').createIndexes([
      { key: { tenantId: 1, assigneeIds: 1, status: 1 }, name: 'mine' },
      { key: { tenantId: 1, createdBy: 1, status: 1 }, name: 'created' },
      { key: { tenantId: 1, conversationId: 1, status: 1 }, name: 'by_conversation' },
      { key: { tenantId: 1, 'record.module': 1, 'record.externalId': 1 }, name: 'by_record' },
      {
        key: { tenantId: 1, requestKey: 1 },
        name: 'idempotency',
        unique: true,
        partialFilterExpression: { requestKey: { $type: 'string' } },
      },
    ]);

    await ensureCollection(
      db,
      'approvals',
      tenantScoped(['title', 'category', 'requesterId', 'approverIds', 'policy', 'decisions', 'status', 'origin', 'createdAt'], {
        title: { bsonType: 'string', maxLength: 200 },
        category: { enum: ['general', 'pricing', 'survey', 'expense', 'budget', 'invoice', 'leave'] },
        requesterId: str,
        approverIds: { bsonType: 'array', minItems: 1, maxItems: 100 },
        policy: { enum: ['any', 'all'] },
        decisions: { bsonType: 'array' },
        status: { enum: ['pending', 'approved', 'rejected', 'cancelled'] },
        conversationId: nullable(str),
        record: workRecord,
        origin: { enum: ['connect', 'module'] },
        createdAt: date,
      }),
    );
    await db.collection('approvals').createIndexes([
      { key: { tenantId: 1, approverIds: 1, status: 1 }, name: 'to_decide' },
      { key: { tenantId: 1, requesterId: 1 }, name: 'requested' },
      { key: { tenantId: 1, conversationId: 1, status: 1 }, name: 'by_conversation' },
      {
        key: { tenantId: 1, requestKey: 1 },
        name: 'idempotency',
        unique: true,
        partialFilterExpression: { requestKey: { $type: 'string' } },
      },
    ]);

    await ensureCollection(
      db,
      'projects',
      tenantScoped(['name', 'status', 'source', 'milestones', 'createdAt'], {
        name: { bsonType: 'string', maxLength: 120 },
        status: { enum: ['active', 'on_hold', 'at_risk', 'completed', 'cancelled'] },
        source: { enum: ['connect', 'samptrek'] },
        externalId: nullable(str),
        conversationId: nullable(str),
        milestones: { bsonType: 'array', maxItems: 50 },
        createdAt: date,
      }),
    );
    await db.collection('projects').createIndexes([
      {
        key: { tenantId: 1, source: 1, externalId: 1 },
        name: 'one_per_external',
        unique: true,
        partialFilterExpression: { externalId: { $type: 'string' } },
      },
      { key: { tenantId: 1, conversationId: 1 }, name: 'by_conversation' },
    ]);
  },
};
