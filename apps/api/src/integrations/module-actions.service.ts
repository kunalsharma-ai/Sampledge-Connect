import { Injectable } from '@nestjs/common';
import {
  MODULE_CATALOG,
  RunRecordActionRequestSchema,
  type ModuleAction,
  type SampledgeModule,
  type WebhookEnvelope,
} from '@sampledge/contracts';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { TenantDb } from '../database/tenant-db.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { AuditService } from '../audit/audit.service.js';
import { WorkStore } from './collections.js';
import type { ModuleActionDoc } from './docs.js';
import { ModuleSettingsService } from './module-settings.service.js';
import { RecordsService } from './records.service.js';
import { signPayload } from './signing.js';

export const toModuleAction = (a: ModuleActionDoc): ModuleAction => ({
  actionId: a._id,
  module: a.module,
  type: a.type,
  record: a.record,
  payload: a.payload,
  status: a.status,
  statusCode: a.statusCode,
  error: a.error,
  requestedBy: a.requestedBy,
  createdAt: a.createdAt.toISOString(),
});

const STATUS_WORDS: Record<ModuleActionDoc['status'], string> = {
  sent: 'sent',
  failed: 'failed to send',
  test_mode: 'test mode, not sent',
  not_configured: 'not sent: the connection is not set up',
};

/**
 * Connect → module calls: POST {baseUrl}/connect/actions with a signed JSON envelope.
 * Every call is recorded. In test mode nothing leaves Connect and the row says `test_mode`,
 * with the exact payload that would have been sent.
 */
@Injectable()
export class ModuleActionsService {
  constructor(
    private readonly store: WorkStore,
    private readonly db: TenantDb,
    private readonly settings: ModuleSettingsService,
    private readonly records: RecordsService,
    private readonly conversations: ConversationsService,
    private readonly audit: AuditService,
  ) {}

  async run(
    tenantId: string,
    m: SampledgeModule,
    type: string,
    record: ModuleActionDoc['record'],
    payload: Record<string, unknown>,
    requestedBy: string,
  ): Promise<ModuleActionDoc> {
    const s = await this.settings.get(tenantId, m);
    const w = this.store.for(tenantId);
    const base: Omit<ModuleActionDoc, '_id' | 'tenantId' | 'status' | 'statusCode' | 'error'> = {
      module: m,
      type,
      record,
      payload,
      requestedBy,
      createdAt: new Date(),
    };
    if (!s.enabled)
      return w.module_actions.insertOne({
        ...base,
        status: 'not_configured',
        statusCode: null,
        error: `${MODULE_CATALOG[m].name} is not enabled`,
      });
    if (s.mode === 'test')
      return w.module_actions.insertOne({ ...base, status: 'test_mode', statusCode: null, error: null });
    const missing = this.settings.missing(s).filter((x) => !x.startsWith('Event signing'));
    if (missing.length)
      return w.module_actions.insertOne({
        ...base,
        status: 'not_configured',
        statusCode: null,
        error: `Missing: ${missing.join(', ')}`,
      });
    const doc = await w.module_actions.insertOne({
      ...base,
      status: 'failed',
      statusCode: null,
      error: 'pending',
    });
    return this.send(tenantId, doc);
  }

  private async send(tenantId: string, doc: ModuleActionDoc): Promise<ModuleActionDoc> {
    const s = await this.settings.get(tenantId, doc.module);
    const env: WebhookEnvelope = {
      id: doc._id,
      type: doc.type,
      tenantId,
      createdAt: doc.createdAt.toISOString(),
      data: { record: doc.record, ...doc.payload },
    };
    const body = JSON.stringify(env);
    let statusCode: number | null = null;
    let error: string | null = null;
    try {
      const res = await fetch(`${s.baseUrl}/connect/actions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${s.apiKey}`,
          'idempotency-key': doc._id,
          ...(s.signingSecret ? { 'sampledge-signature': signPayload(s.signingSecret, body) } : {}),
        },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      statusCode = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
      await res.body?.cancel().catch(() => {});
    } catch (e) {
      error = (e as Error).message.slice(0, 300);
    }
    const status = error ? 'failed' : 'sent';
    await this.store
      .for(tenantId)
      .module_actions.updateOne({ _id: doc._id }, { $set: { status, statusCode, error } });
    return { ...doc, status, statusCode, error };
  }

  async list(ctx: TenantContext, m?: SampledgeModule): Promise<ModuleAction[]> {
    const rows = await this.store
      .for(ctx.tenantId)
      .module_actions.find(m ? { module: m } : {}, { sort: { _id: -1 }, limit: 100 })
      .toArray();
    return rows.map(toModuleAction);
  }

  /** Re-sends a failed or not-configured action with the current settings. */
  async retry(ctx: TenantContext, actionId: string): Promise<ModuleAction> {
    const w = this.store.for(ctx.tenantId);
    const a = await w.module_actions.findOne({ _id: actionId });
    if (!a) throw notFound('Action');
    if (a.status === 'sent') throw new AppError('CONFLICT', 'This action was already sent');
    const again = await this.run(ctx.tenantId, a.module, a.type, a.record, a.payload, ctx.userId);
    return toModuleAction(again);
  }

  /**
   * A person runs a record action from the conversation (e.g. "Log to SampForce"). They must be
   * able to read the record's conversation; the action must be one the module offers there.
   */
  async runForRecord(ctx: TenantContext, linkId: string, body: unknown) {
    const req = parse(RunRecordActionRequestSchema, body);
    const w = this.store.for(ctx.tenantId);
    const rec = await w.linked_records.findOne({ _id: linkId });
    if (!rec || !rec.conversationId) throw notFound('Record');
    await this.conversations.authorize(ctx, rec.conversationId, 'message.send');
    const def = MODULE_CATALOG[rec.module].actions.find(
      (a) => a.type === req.action && !a.automatic && a.recordTypes.includes(rec.recordType),
    );
    if (!def) throw forbidden(`${MODULE_CATALOG[rec.module].name} has no such action here`);
    let message: { messageId: string; text: string; senderId: string; createdAt: string } | null =
      null;
    if (req.messageId) {
      const msg = await this.db.for(ctx.tenantId).messages.findOne({
        _id: req.messageId,
        conversationId: rec.conversationId,
        deletedAt: null,
      });
      if (!msg) throw notFound('Message');
      message = {
        messageId: msg._id,
        text: msg.content.text,
        senderId: msg.senderId,
        createdAt: msg.createdAt.toISOString(),
      };
    }
    const actor = await this.db.for(ctx.tenantId).users.findOne({ _id: ctx.userId });
    const action = await this.run(
      ctx.tenantId,
      rec.module,
      def.type,
      { type: rec.recordType, id: rec.externalId, title: rec.title },
      {
        note: req.note,
        message,
        by: { userId: ctx.userId, email: actor?.email ?? null, name: actor?.displayName ?? null },
      },
      ctx.userId,
    );
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'integration.action',
      target: { type: 'linked_record', id: rec._id },
      metadata: { module: rec.module, type: def.type, status: action.status },
    });
    await this.records.postCard(
      ctx.tenantId,
      rec.module,
      rec.conversationId,
      `${actor?.displayName ?? 'Someone'}: ${def.label} (${STATUS_WORDS[action.status]})`,
      {
        moduleAction: {
          module: rec.module,
          actionId: action._id,
          type: def.type,
          label: def.label,
          status: action.status,
          note: req.note,
          messageId: req.messageId ?? null,
        },
      },
    );
    return toModuleAction(action);
  }
}
