import { Injectable } from '@nestjs/common';
import { tenantCan, type InboxChangedEvent, type TenantRole } from '@sampledge/contracts';
import type { ExternalConversationDoc } from '../database/documents.js';
import { TenantDb } from '../database/tenant-db.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import type { TenantContext } from '../common/tenant-context.js';
import { forbidden } from '../common/errors.js';

export interface InboxScope {
  supervisor: boolean;
  teamIds: string[];
}

/**
 * Who may see an inbox conversation: supervisors (owner/admin) see all; agents see
 * conversations with no owning team, conversations of their teams, and anything assigned to them.
 */
@Injectable()
export class InboxAccess {
  constructor(
    private readonly db: TenantDb,
    private readonly realtime: RealtimePublisher,
  ) {}

  async scope(ctx: TenantContext): Promise<InboxScope> {
    if (!tenantCan(ctx.role, 'inbox.access'))
      throw forbidden('You do not have access to the Client Inbox');
    const supervisor = tenantCan(ctx.role, 'inbox.supervise');
    const s = await this.db.for(ctx.tenantId).inbox_settings.findOne({});
    const teamIds = (s?.teams ?? [])
      .filter((t) => t.memberIds.includes(ctx.userId))
      .map((t) => t.teamId);
    return { supervisor, teamIds };
  }

  filter(ctx: TenantContext, scope: InboxScope) {
    if (scope.supervisor) return {};
    return {
      $or: [{ teamId: null }, { teamId: { $in: scope.teamIds } }, { assigneeId: ctx.userId }],
    };
  }

  canSee(ctx: TenantContext, scope: InboxScope, c: ExternalConversationDoc): boolean {
    return (
      scope.supervisor ||
      c.teamId === null ||
      scope.teamIds.includes(c.teamId) ||
      c.assigneeId === ctx.userId
    );
  }

  /** Users to notify when a conversation changes. */
  async audience(
    tenantId: string,
    c: Pick<ExternalConversationDoc, 'teamId' | 'assigneeId'>,
  ): Promise<string[]> {
    const t = this.db.for(tenantId);
    const [memberships, settings] = await Promise.all([
      t.memberships
        .find(
          { role: { $in: ['owner', 'admin', 'member'] } },
          { projection: { userId: 1, role: 1 } },
        )
        .toArray(),
      c.teamId ? t.inbox_settings.findOne({}) : Promise.resolve(null),
    ]);
    const team = c.teamId
      ? new Set(settings?.teams.find((x) => x.teamId === c.teamId)?.memberIds ?? [])
      : null;
    return memberships
      .filter(
        (m) =>
          tenantCan(m.role as TenantRole, 'inbox.supervise') ||
          !team ||
          team.has(m.userId) ||
          m.userId === c.assigneeId,
      )
      .map((m) => m.userId);
  }

  emitTo(tenantId: string, userId: string, e: InboxChangedEvent) {
    this.realtime.toUser(tenantId, userId, 'inbox:changed', e);
  }

  async emit(tenantId: string, c: ExternalConversationDoc, reason: InboxChangedEvent['reason']) {
    try {
      for (const userId of await this.audience(tenantId, c))
        this.realtime.toUser(tenantId, userId, 'inbox:changed', { conversationId: c._id, reason });
    } catch {
      /* best effort: clients refetch on focus */
    }
  }
}
