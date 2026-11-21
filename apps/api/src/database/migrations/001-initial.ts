import type { Db } from 'mongodb';
import type { Migration } from './runner.js';

export const str = { bsonType: 'string' };
export const date = { bsonType: 'date' };
export const int = { bsonType: ['int', 'long'] };
export const nullable = (t: object) => ({ oneOf: [t, { bsonType: 'null' }] });

export async function ensureCollection(db: Db, name: string, schema: object) {
  const exists = await db.listCollections({ name }).hasNext();
  const validator = { $jsonSchema: schema };
  if (exists) await db.command({ collMod: name, validator, validationLevel: 'strict' });
  else
    await db.createCollection(name, {
      validator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
}

export const tenantScoped = (required: string[], properties: Record<string, object>) => ({
  bsonType: 'object',
  required: ['_id', 'tenantId', ...required],
  properties: { _id: str, tenantId: str, ...properties },
});

export const initialMigration: Migration = {
  id: '001-initial',
  async up(db) {
    await ensureCollection(db, 'tenants', {
      bsonType: 'object',
      required: ['_id', 'slug', 'name', 'status', 'plan', 'dataPlacement', 'createdAt'],
      properties: {
        _id: str,
        slug: { bsonType: 'string', pattern: '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$', maxLength: 40 },
        name: { bsonType: 'string', maxLength: 120 },
        status: { enum: ['active', 'suspended'] },
        plan: { enum: ['trial', 'starter', 'professional', 'business', 'enterprise'] },
        dataPlacement: str,
        createdAt: date,
      },
    });
    await db.collection('tenants').createIndex({ slug: 1 }, { unique: true });

    await ensureCollection(
      db,
      'users',
      tenantScoped(['email', 'passwordHash', 'displayName', 'status', 'createdAt'], {
        email: { bsonType: 'string', maxLength: 254 },
        passwordHash: str,
        displayName: { bsonType: 'string', maxLength: 120 },
        title: nullable(str),
        status: { enum: ['active', 'deactivated'] },
        createdAt: date,
      }),
    );
    await db.collection('users').createIndex({ tenantId: 1, email: 1 }, { unique: true });

    await ensureCollection(
      db,
      'memberships',
      tenantScoped(['userId', 'workspaceId', 'role'], {
        userId: str,
        workspaceId: str,
        role: { enum: ['owner', 'admin', 'member', 'guest'] },
      }),
    );
    await db
      .collection('memberships')
      .createIndexes([
        { key: { tenantId: 1, userId: 1, workspaceId: 1 }, unique: true },
        { key: { tenantId: 1, workspaceId: 1, role: 1 } },
      ]);

    await ensureCollection(
      db,
      'workspaces',
      tenantScoped(['name', 'slug', 'isDefault'], {
        name: str,
        slug: str,
        isDefault: { bsonType: 'bool' },
      }),
    );
    await db.collection('workspaces').createIndex({ tenantId: 1, slug: 1 }, { unique: true });

    await ensureCollection(
      db,
      'conversations',
      tenantScoped(['workspaceId', 'kind', 'createdBy', 'createdAt', 'lastChangeSequence'], {
        workspaceId: str,
        kind: { enum: ['dm', 'group', 'channel_public', 'channel_private'] },
        name: nullable({ bsonType: 'string', maxLength: 80 }),
        topic: nullable({ bsonType: 'string', maxLength: 250 }),
        dmKey: str,
        createdBy: str,
        createdAt: date,
        archivedAt: nullable(date),
        lastChangeSequence: { ...int, minimum: 0 },
        lastMessageAt: nullable(date),
      }),
    );
    await db.collection('conversations').createIndexes([
      {
        key: { tenantId: 1, dmKey: 1 },
        unique: true,
        partialFilterExpression: { dmKey: { $type: 'string' } },
      },
      { key: { tenantId: 1, workspaceId: 1, kind: 1, name: 1 } },
      { key: { tenantId: 1, lastMessageAt: -1 } },
    ]);

    await ensureCollection(
      db,
      'conversation_members',
      tenantScoped(['conversationId', 'userId', 'role', 'joinedAt'], {
        conversationId: str,
        userId: str,
        role: { enum: ['owner', 'moderator', 'member'] },
        joinedAt: date,
      }),
    );
    await db
      .collection('conversation_members')
      .createIndexes([
        { key: { tenantId: 1, conversationId: 1, userId: 1 }, unique: true },
        { key: { tenantId: 1, userId: 1 } },
      ]);

    await ensureCollection(
      db,
      'messages',
      tenantScoped(
        [
          'conversationId',
          'clientMessageId',
          'senderId',
          'messageType',
          'content',
          'serverSequence',
          'changeSequence',
          'createdAt',
        ],
        {
          conversationId: str,
          clientMessageId: str,
          senderId: str,
          senderDeviceId: str,
          messageType: { enum: ['text', 'system'] },
          content: {
            bsonType: 'object',
            required: ['text'],
            properties: {
              text: { bsonType: 'string', maxLength: 8000 },
              mentions: { bsonType: 'array', items: str },
            },
          },
          attachmentIds: { bsonType: 'array', items: str },
          replyToMessageId: nullable(str),
          serverSequence: { ...int, minimum: 1 },
          changeSequence: { ...int, minimum: 1 },
          createdAt: date,
          editedAt: nullable(date),
          deletedAt: nullable(date),
          metadata: { bsonType: 'object' },
        },
      ),
    );
    await db.collection('messages').createIndexes([
      // Idempotency: one message per client-generated id per tenant.
      { key: { tenantId: 1, clientMessageId: 1 }, unique: true, name: 'uniq_client_message_id' },
      {
        key: { tenantId: 1, conversationId: 1, serverSequence: 1 },
        unique: true,
        name: 'conversation_order',
      },
      { key: { tenantId: 1, conversationId: 1, changeSequence: 1 }, name: 'conversation_changes' },
    ]);

    await ensureCollection(
      db,
      'message_receipts',
      tenantScoped(['conversationId', 'userId', 'deliveredUpTo', 'readUpTo', 'updatedAt'], {
        conversationId: str,
        userId: str,
        deliveredUpTo: { ...int, minimum: 0 },
        readUpTo: { ...int, minimum: 0 },
        updatedAt: date,
      }),
    );
    await db
      .collection('message_receipts')
      .createIndex({ tenantId: 1, conversationId: 1, userId: 1 }, { unique: true });

    await ensureCollection(
      db,
      'devices',
      tenantScoped(['userId', 'deviceId', 'refreshTokenHash', 'refreshExpiresAt', 'createdAt'], {
        userId: str,
        deviceId: str,
        name: str,
        platform: str,
        refreshTokenHash: str,
        previousRefreshTokenHash: nullable(str),
        refreshExpiresAt: date,
        createdAt: date,
        lastSeenAt: date,
        revokedAt: nullable(date),
        revokedReason: nullable(str),
      }),
    );
    await db.collection('devices').createIndexes([
      { key: { tenantId: 1, userId: 1, deviceId: 1 }, unique: true },
      { key: { refreshTokenHash: 1 }, unique: true },
    ]);

    await ensureCollection(
      db,
      'sync_checkpoints',
      tenantScoped(['userId', 'deviceId', 'lastSyncAt'], {
        userId: str,
        deviceId: str,
        lastSyncAt: date,
      }),
    );
    await db
      .collection('sync_checkpoints')
      .createIndex({ tenantId: 1, userId: 1, deviceId: 1 }, { unique: true });

    await ensureCollection(
      db,
      'audit_logs',
      tenantScoped(['action', 'at'], {
        actorId: nullable(str),
        action: str,
        at: date,
        metadata: { bsonType: 'object' },
      }),
    );
    await db
      .collection('audit_logs')
      .createIndexes([
        { key: { tenantId: 1, at: -1 } },
        { key: { tenantId: 1, action: 1, at: -1 } },
      ]);
  },
};
