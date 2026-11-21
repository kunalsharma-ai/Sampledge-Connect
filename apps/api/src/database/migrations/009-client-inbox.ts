import type { Migration } from './runner.js';
import { date, ensureCollection, int, nullable, str, tenantScoped } from './001-initial.js';

const PROVIDERS = [
  'telegram',
  'slack',
  'teams',
  'google_chat',
  'discord',
  'line',
  'mattermost',
  'nextcloud_talk',
  'wechat',
  'qq',
  'signal',
  'imessage',
];

/**
 * External messaging gateway and Client Inbox. Connector credentials live sealed in
 * `connectors`; notes have their own collection so the outbound worker can never read them.
 */
export const clientInboxMigration: Migration = {
  id: '009-client-inbox',
  async up(db) {
    await ensureCollection(
      db,
      'connectors',
      tenantScoped(['provider', 'name', 'environment', 'status', 'webhookKey', 'createdAt'], {
        provider: { enum: PROVIDERS },
        name: { bsonType: 'string', maxLength: 80 },
        environment: { enum: ['test', 'live'] },
        status: { enum: ['active', 'paused', 'error'] },
        credentials: nullable(str),
        previousCredentials: nullable(str),
        webhookKey: { bsonType: 'string', minLength: 32 },
        createdAt: date,
      }),
    );
    await db.collection('connectors').createIndexes([
      { key: { webhookKey: 1 }, name: 'by_webhook_key', unique: true },
      { key: { tenantId: 1, createdAt: 1 }, name: 'tenant_connectors' },
    ]);

    await ensureCollection(
      db,
      'client_profiles',
      tenantScoped(['name', 'tags', 'createdAt'], {
        name: { bsonType: 'string', maxLength: 120 },
        email: nullable(str),
        phone: nullable(str),
        tags: { bsonType: 'array', items: str },
        mergedInto: nullable(str),
        createdAt: date,
      }),
    );
    await db.collection('client_profiles').createIndexes([
      {
        key: { tenantId: 1, email: 1 },
        name: 'client_email',
        partialFilterExpression: { email: { $type: 'string' } },
      },
      {
        key: { tenantId: 1, phone: 1 },
        name: 'client_phone',
        partialFilterExpression: { phone: { $type: 'string' } },
      },
    ]);

    await ensureCollection(
      db,
      'external_accounts',
      tenantScoped(['connectorId', 'provider', 'externalUserId', 'clientId', 'createdAt'], {
        connectorId: str,
        provider: { enum: PROVIDERS },
        externalUserId: str,
        clientId: str,
        createdAt: date,
      }),
    );
    await db.collection('external_accounts').createIndexes([
      {
        key: { tenantId: 1, connectorId: 1, externalUserId: 1 },
        name: 'identity',
        unique: true,
      },
      { key: { tenantId: 1, clientId: 1 }, name: 'by_client' },
    ]);

    await ensureCollection(
      db,
      'external_conversations',
      tenantScoped(
        [
          'connectorId',
          'provider',
          'externalThreadId',
          'clientId',
          'status',
          'priority',
          'createdAt',
        ],
        {
          connectorId: str,
          provider: { enum: PROVIDERS },
          externalThreadId: str,
          clientId: str,
          status: { enum: ['open', 'pending', 'snoozed', 'resolved'] },
          priority: { enum: ['low', 'normal', 'high', 'urgent'] },
          assigneeId: nullable(str),
          teamId: nullable(str),
          slaDueAt: nullable(date),
          createdAt: date,
        },
      ),
    );
    await db.collection('external_conversations').createIndexes([
      {
        key: { tenantId: 1, connectorId: 1, externalThreadId: 1 },
        name: 'thread',
        unique: true,
      },
      { key: { tenantId: 1, status: 1, updatedAt: -1 }, name: 'inbox_list' },
      { key: { tenantId: 1, assigneeId: 1, status: 1 }, name: 'by_assignee' },
      { key: { tenantId: 1, clientId: 1 }, name: 'by_client' },
      // SLA sweeper (all tenants).
      {
        key: { slaDueAt: 1 },
        name: 'sla_due',
        partialFilterExpression: { slaDueAt: { $type: 'date' }, slaBreachedAt: null },
      },
    ]);

    await ensureCollection(
      db,
      'external_messages',
      tenantScoped(['conversationId', 'connectorId', 'direction', 'deliveryState', 'createdAt'], {
        conversationId: str,
        connectorId: str,
        direction: { enum: ['inbound', 'outbound'] },
        text: { bsonType: 'string', maxLength: 8000 },
        deliveryState: {
          enum: ['queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'handoff', 'test'],
        },
        attempts: int,
        createdAt: date,
      }),
    );
    await db.collection('external_messages').createIndexes([
      { key: { tenantId: 1, conversationId: 1, createdAt: 1 }, name: 'timeline' },
      {
        key: { tenantId: 1, connectorId: 1, externalMessageId: 1 },
        name: 'provider_dedupe',
        unique: true,
        partialFilterExpression: { externalMessageId: { $type: 'string' } },
      },
      {
        key: { tenantId: 1, clientMessageId: 1 },
        name: 'reply_idempotency',
        unique: true,
        partialFilterExpression: { clientMessageId: { $type: 'string' } },
      },
      // Outbound worker (all tenants).
      {
        key: { deliveryState: 1, nextAttemptAt: 1 },
        name: 'outbox',
        partialFilterExpression: { deliveryState: { $in: ['queued', 'sending'] } },
      },
    ]);

    await ensureCollection(
      db,
      'inbox_notes',
      tenantScoped(['conversationId', 'authorId', 'text', 'clientNoteId', 'createdAt'], {
        conversationId: str,
        authorId: str,
        text: { bsonType: 'string', maxLength: 8000 },
        clientNoteId: str,
        createdAt: date,
      }),
    );
    await db.collection('inbox_notes').createIndexes([
      { key: { tenantId: 1, conversationId: 1, createdAt: 1 }, name: 'timeline' },
      { key: { tenantId: 1, clientNoteId: 1 }, name: 'note_idempotency', unique: true },
    ]);

    await db
      .collection('inbox_activity')
      .createIndex({ tenantId: 1, conversationId: 1, createdAt: 1 }, { name: 'timeline' });
    await db.collection('inbox_templates').createIndex(
      { tenantId: 1, shortcut: 1 },
      {
        name: 'shortcut',
        unique: true,
        partialFilterExpression: { shortcut: { $type: 'string' } },
      },
    );
    await db
      .collection('inbox_settings')
      .createIndex({ tenantId: 1 }, { name: 'one_per_tenant', unique: true });
  },
};
