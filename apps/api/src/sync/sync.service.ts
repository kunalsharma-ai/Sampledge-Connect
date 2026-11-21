import { Injectable } from '@nestjs/common';
import { SyncRequestSchema, type SyncResponse } from '@sampledge/contracts';
import { parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { TenantDb } from '../database/tenant-db.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { toMessage, toReceipt } from '../messages/message.mapper.js';

/** Window used for conversations the client has never synced. */
const INITIAL_WINDOW = 50;

@Injectable()
export class SyncService {
  constructor(
    private readonly db: TenantDb,
    private readonly conversations: ConversationsService,
  ) {}

  /**
   * Cursor sync (docs/offline-sync-protocol.md). For every readable conversation,
   * return changes with changeSequence > cursor, ascending, up to the limit.
   */
  async sync(ctx: TenantContext, input: unknown): Promise<SyncResponse> {
    const req = parse(SyncRequestSchema, input);
    const t = this.db.for(ctx.tenantId);
    const readable = await this.conversations.listReadable(ctx);
    const readableIds = new Set(readable.map((c) => c.conversationId));
    const cursorBy = new Map(req.cursors.map((c) => [c.conversationId, c.afterChangeSequence]));
    const revokedConversationIds = req.cursors
      .map((c) => c.conversationId)
      .filter((id) => !readableIds.has(id));

    const results = await Promise.all(
      readable.map(async (c) => {
        const after =
          cursorBy.get(c.conversationId) ?? Math.max(0, c.lastChangeSequence - INITIAL_WINDOW);
        if (after >= c.lastChangeSequence) {
          return {
            conversationId: c.conversationId,
            changes: [],
            nextCursor: after,
            hasMore: false,
            receipts: [],
          };
        }
        const docs = await t.messages
          .find(
            { conversationId: c.conversationId, changeSequence: { $gt: after } },
            { sort: { changeSequence: 1 }, limit: req.limitPerConversation + 1 },
          )
          .toArray();
        const hasMore = docs.length > req.limitPerConversation;
        const page = hasMore ? docs.slice(0, req.limitPerConversation) : docs;
        // Never jump to lastChangeSequence: that counter is incremented before the insert,
        // so a message can be in flight at that number. Cursors only advance to what was returned.
        const nextCursor = page.at(-1)?.changeSequence ?? after;
        const receipts = await t.message_receipts
          .find({ conversationId: c.conversationId })
          .toArray();
        return {
          conversationId: c.conversationId,
          changes: page.map(toMessage),
          nextCursor,
          hasMore,
          receipts: receipts.map(toReceipt),
        };
      }),
    );

    await t.sync_checkpoints.updateOne(
      { userId: ctx.userId, deviceId: ctx.deviceId },
      {
        $set: { lastSyncAt: new Date() },
        $setOnInsert: { userId: ctx.userId, deviceId: ctx.deviceId },
      } as never,
      { upsert: true },
    );

    return {
      conversations: readable,
      results: results.filter(
        (r) => r.changes.length > 0 || r.receipts.length > 0 || !cursorBy.has(r.conversationId),
      ),
      revokedConversationIds,
      serverTime: new Date().toISOString(),
    };
  }
}
