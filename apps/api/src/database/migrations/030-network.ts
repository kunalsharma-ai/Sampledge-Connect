import { ObjectId, type Db } from 'mongodb';
import { NETWORK_TENANT_SLUG } from '@sampledge/contracts';
import type { Migration } from './runner.js';
import { date, ensureCollection, nullable, str, tenantScoped } from './001-initial.js';

const bool = { bsonType: 'bool' };
const int = { bsonType: ['int', 'long'] };

/**
 * Creates the reserved Sampledge Network tenant (idempotent) and returns its id.
 * Also called at boot, so a database restored without it still works.
 */
export async function ensureNetworkTenant(
  db: Db,
): Promise<{ tenantId: string; workspaceId: string }> {
  const tenants = db.collection<{ _id: string; slug: string; kind?: string }>('tenants');
  await tenants.updateOne(
    { slug: NETWORK_TENANT_SLUG },
    {
      $setOnInsert: {
        _id: new ObjectId().toHexString(),
        slug: NETWORK_TENANT_SLUG,
        name: 'Sampledge Network',
        status: 'active',
        plan: 'enterprise',
        branding: null,
        dataPlacement: 'shared',
        createdAt: new Date(),
      },
      $set: { kind: 'network' },
    },
    { upsert: true },
  );
  const tenant = (await tenants.findOne({ slug: NETWORK_TENANT_SLUG }))!;
  const workspaces = db.collection<{ _id: string; tenantId: string; slug: string }>('workspaces');
  await workspaces.updateOne(
    { tenantId: tenant._id, slug: 'main' },
    {
      $setOnInsert: {
        _id: new ObjectId().toHexString(),
        tenantId: tenant._id,
        name: 'Sampledge Network',
        slug: 'main',
        isDefault: true,
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );
  const ws = (await workspaces.findOne({ tenantId: tenant._id, slug: 'main' }))!;
  return { tenantId: tenant._id, workspaceId: ws._id };
}

/** Sampledge Network: identities, connections, follows, statuses and communities. */
export const networkMigration: Migration = {
  id: '030-network',
  async up(db) {
    await ensureNetworkTenant(db);

    await ensureCollection(
      db,
      'network_profiles',
      tenantScoped(['userId', 'handle', 'displayName', 'kind', 'privacy', 'createdAt'], {
        userId: str,
        handle: { bsonType: 'string', pattern: '^[a-z][a-z0-9._]*[a-z0-9]$', maxLength: 30 },
        displayName: str,
        kind: { enum: ['work', 'personal'] },
        homeTenantId: nullable(str),
        homeUserId: nullable(str),
        email: nullable(str),
        phone: nullable(str),
        privacy: { bsonType: 'object' },
        createdAt: date,
      }),
    );
    await db.collection('network_profiles').createIndexes([
      { key: { tenantId: 1, userId: 1 }, name: 'one_per_user', unique: true },
      { key: { tenantId: 1, handle: 1 }, name: 'handle', unique: true },
      {
        key: { tenantId: 1, homeTenantId: 1, homeUserId: 1 },
        name: 'one_per_work_account',
        unique: true,
        partialFilterExpression: { homeUserId: { $type: 'string' } },
      },
      { key: { tenantId: 1, email: 1 }, name: 'by_email' },
      { key: { tenantId: 1, phone: 1 }, name: 'by_phone', sparse: true },
      { key: { tenantId: 1, homeTenantId: 1 }, name: 'by_home' },
    ]);

    await ensureCollection(
      db,
      'network_requests',
      tenantScoped(['fromUserId', 'toUserId', 'pairKey', 'status', 'createdAt'], {
        fromUserId: str,
        toUserId: str,
        pairKey: str,
        circle: { enum: ['business', 'friends'] },
        status: { enum: ['pending', 'accepted', 'declined', 'cancelled'] },
        createdAt: date,
        respondedAt: nullable(date),
      }),
    );
    await db.collection('network_requests').createIndexes([
      {
        key: { tenantId: 1, pairKey: 1 },
        name: 'one_pending_per_pair',
        unique: true,
        partialFilterExpression: { status: 'pending' },
      },
      { key: { tenantId: 1, toUserId: 1, status: 1, createdAt: -1 }, name: 'incoming' },
      { key: { tenantId: 1, fromUserId: 1, status: 1, createdAt: -1 }, name: 'outgoing' },
    ]);

    await ensureCollection(
      db,
      'network_connections',
      tenantScoped(['userId', 'otherUserId', 'circle', 'connectedAt'], {
        userId: str,
        otherUserId: str,
        circle: { enum: ['business', 'friends'] },
        connectedAt: date,
      }),
    );
    await db.collection('network_connections').createIndexes([
      { key: { tenantId: 1, userId: 1, otherUserId: 1 }, name: 'pair', unique: true },
      { key: { tenantId: 1, otherUserId: 1 }, name: 'reverse' },
    ]);

    await ensureCollection(
      db,
      'network_follows',
      tenantScoped(['followerId', 'targetType', 'targetId', 'createdAt'], {
        followerId: str,
        targetType: { enum: ['user', 'community'] },
        targetId: str,
        createdAt: date,
      }),
    );
    await db.collection('network_follows').createIndexes([
      {
        key: { tenantId: 1, followerId: 1, targetType: 1, targetId: 1 },
        name: 'one_follow',
        unique: true,
      },
      { key: { tenantId: 1, targetType: 1, targetId: 1 }, name: 'followers' },
    ]);

    await ensureCollection(
      db,
      'network_blocks',
      tenantScoped(['userId', 'blockedUserId', 'createdAt'], {
        userId: str,
        blockedUserId: str,
        createdAt: date,
      }),
    );
    await db.collection('network_blocks').createIndexes([
      { key: { tenantId: 1, userId: 1, blockedUserId: 1 }, name: 'one_block', unique: true },
      { key: { tenantId: 1, blockedUserId: 1 }, name: 'blocked_by' },
    ]);

    await ensureCollection(
      db,
      'network_reports',
      tenantScoped(['reporterId', 'targetType', 'targetId', 'reason', 'status', 'createdAt'], {
        reporterId: str,
        targetType: { enum: ['user', 'status', 'community', 'message'] },
        targetId: str,
        reason: str,
        status: { enum: ['open', 'reviewed'] },
        createdAt: date,
      }),
    );
    await db
      .collection('network_reports')
      .createIndex({ tenantId: 1, status: 1, createdAt: -1 }, { name: 'queue' });

    await ensureCollection(
      db,
      'network_invites',
      tenantScoped(['inviterId', 'tokenHash', 'channel', 'status', 'createdAt', 'expiresAt'], {
        inviterId: str,
        tokenHash: str,
        channel: { enum: ['email', 'link', 'sms'] },
        status: { enum: ['pending', 'accepted'] },
        createdAt: date,
        expiresAt: date,
      }),
    );
    await db.collection('network_invites').createIndexes([
      { key: { tokenHash: 1 }, name: 'token', unique: true },
      { key: { tenantId: 1, inviterId: 1, createdAt: -1 }, name: 'mine' },
    ]);

    await ensureCollection(
      db,
      'network_statuses',
      tenantScoped(['authorId', 'clientStatusId', 'kind', 'audience', 'createdAt', 'expiresAt'], {
        authorId: str,
        clientStatusId: str,
        kind: { enum: ['text', 'image', 'video'] },
        text: str,
        attachmentId: nullable(str),
        audience: { enum: ['connections', 'followers', 'public', 'selected'] },
        userIds: { bsonType: 'array', items: str },
        allowReplies: bool,
        createdAt: date,
        expiresAt: date,
      }),
    );
    await db.collection('network_statuses').createIndexes([
      { key: { tenantId: 1, clientStatusId: 1 }, name: 'idempotent', unique: true },
      { key: { tenantId: 1, authorId: 1, expiresAt: -1 }, name: 'by_author' },
      { key: { expiresAt: 1 }, name: 'expire', expireAfterSeconds: 0 },
    ]);

    await ensureCollection(
      db,
      'network_status_views',
      tenantScoped(['statusId', 'authorId', 'viewerId', 'viewedAt'], {
        statusId: str,
        authorId: str,
        viewerId: str,
        viewedAt: date,
      }),
    );
    await db.collection('network_status_views').createIndexes([
      { key: { tenantId: 1, statusId: 1, viewerId: 1 }, name: 'one_view', unique: true },
      { key: { tenantId: 1, viewerId: 1 }, name: 'by_viewer' },
      { key: { viewedAt: 1 }, name: 'expire', expireAfterSeconds: 8 * 86_400 },
    ]);

    await ensureCollection(
      db,
      'network_actions',
      tenantScoped(['userId', 'clientActionId', 'createdAt'], {
        userId: str,
        clientActionId: str,
        createdAt: date,
      }),
    );
    await db.collection('network_actions').createIndexes([
      { key: { tenantId: 1, userId: 1, clientActionId: 1 }, name: 'once', unique: true },
      { key: { createdAt: 1 }, name: 'expire', expireAfterSeconds: 7 * 86_400 },
    ]);

    await ensureCollection(
      db,
      'communities',
      tenantScoped(['slug', 'name', 'visibility', 'joinPolicy', 'ownerId', 'createdAt'], {
        slug: { bsonType: 'string', pattern: '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$', maxLength: 40 },
        name: str,
        visibility: { enum: ['public', 'private'] },
        joinPolicy: { enum: ['open', 'approval'] },
        ownerId: str,
        announcementsConversationId: str,
        createdAt: date,
      }),
    );
    await db.collection('communities').createIndexes([
      { key: { tenantId: 1, slug: 1 }, name: 'slug', unique: true },
      { key: { tenantId: 1, visibility: 1, name: 1 }, name: 'discover' },
    ]);

    await ensureCollection(
      db,
      'community_members',
      tenantScoped(['communityId', 'userId', 'role', 'status', 'joinedAt'], {
        communityId: str,
        userId: str,
        role: { enum: ['owner', 'admin', 'moderator', 'member'] },
        status: { enum: ['active', 'pending', 'invited', 'banned'] },
        joinedAt: date,
      }),
    );
    await db.collection('community_members').createIndexes([
      { key: { tenantId: 1, communityId: 1, userId: 1 }, name: 'one_per_user', unique: true },
      { key: { tenantId: 1, userId: 1, status: 1 }, name: 'mine' },
      { key: { tenantId: 1, communityId: 1, status: 1 }, name: 'roster' },
    ]);

    await ensureCollection(
      db,
      'community_links',
      tenantScoped(['communityId', 'tokenHash', 'createdBy', 'uses', 'createdAt'], {
        communityId: str,
        tokenHash: str,
        createdBy: str,
        expiresAt: nullable(date),
        maxUses: nullable(int),
        uses: int,
        revokedAt: nullable(date),
        createdAt: date,
      }),
    );
    await db.collection('community_links').createIndexes([
      { key: { tokenHash: 1 }, name: 'token', unique: true },
      { key: { tenantId: 1, communityId: 1 }, name: 'by_community' },
    ]);

    await db
      .collection('conversations')
      .createIndex(
        { tenantId: 1, communityId: 1 },
        { name: 'by_community', partialFilterExpression: { communityId: { $type: 'string' } } },
      );
  },
};
