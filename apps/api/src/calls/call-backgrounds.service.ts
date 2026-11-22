import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  CALL_BACKGROUND_MAX_BYTES,
  CallBackgroundChoiceSchema,
  CallBackgroundPolicySchema,
  tenantCan,
  type CallBackgroundChoice,
  type CallBackgroundPolicy,
  type CallBackgroundState,
} from '@sampledge/contracts';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { TenantDb } from '../database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { BrandingService } from '../branding/branding.service.js';

const DEFAULT_POLICY: CallBackgroundPolicy = CallBackgroundPolicySchema.parse({});

/** PNG, JPEG or WebP from the first bytes; anything else is refused. */
function sniffImage(b: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length > 12 &&
    b.subarray(0, 4).toString('ascii') === 'RIFF' &&
    b.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp';
  return null;
}

/**
 * Virtual backgrounds in calls. Each person's choice (and their own image) is saved to their
 * account so every device uses it; admins set the organization default and can require the
 * company logo background. The video itself is processed on the device, never on the server.
 */
@Injectable()
export class CallBackgroundsService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly realtime: RealtimePublisher,
  ) {}

  async policy(tenantId: string): Promise<CallBackgroundPolicy> {
    const s = await this.db.for(tenantId).tenant_settings.findOne({});
    const r = CallBackgroundPolicySchema.safeParse(s?.callBackgrounds ?? {});
    return r.success ? r.data : DEFAULT_POLICY;
  }

  async state(ctx: TenantContext): Promise<CallBackgroundState> {
    const t = this.db.for(ctx.tenantId);
    const [pref, policy, tenant] = await Promise.all([
      t.call_background_prefs.findOne({ userId: ctx.userId }),
      this.policy(ctx.tenantId),
      this.db.tenants.findOne({ _id: ctx.tenantId }),
    ]);
    const parsed = pref?.choice ? CallBackgroundChoiceSchema.safeParse(pref.choice) : null;
    let choice: CallBackgroundChoice | null = parsed?.success ? parsed.data : null;
    // A personal image that was removed falls back to the default.
    if (choice?.kind === 'custom' && !pref?.imageKey) choice = null;
    const brand = BrandingService.resolve(tenant);
    const effective: CallBackgroundChoice = policy.enforceLogo
      ? { kind: 'logo' }
      : (choice ?? policy.defaultChoice);
    return {
      choice,
      effective,
      customImageUrl: pref?.imageKey
        ? `/v1/call-backgrounds/${ctx.tenantId}/${pref.imageKey}`
        : null,
      policy: { ...policy, canManage: tenantCan(ctx.role, 'members.manage') },
      brand: {
        name: tenant?.name ?? '',
        logo: brand.logo,
        primary: brand.primary,
        secondary: brand.secondary,
      },
    };
  }

  async choose(ctx: TenantContext, body: unknown): Promise<CallBackgroundState> {
    const choice = parse(CallBackgroundChoiceSchema, body);
    const t = this.db.for(ctx.tenantId);
    if (choice.kind === 'custom') {
      const pref = await t.call_background_prefs.findOne({ userId: ctx.userId });
      if (!pref?.imageKey)
        throw new AppError(
          'VALIDATION_FAILED',
          'Upload an image first to use it as your background',
        );
    }
    await t.call_background_prefs.updateOne(
      { userId: ctx.userId },
      { $set: { choice, updatedAt: new Date() } },
      { upsert: true },
    );
    this.changed(ctx);
    return this.state(ctx);
  }

  /** My own background image (raw PNG/JPEG/WebP body). Replaces the previous one and selects it. */
  async upload(ctx: TenantContext, body: unknown): Promise<CallBackgroundState> {
    if (!Buffer.isBuffer(body) || body.length === 0)
      throw new AppError('VALIDATION_FAILED', 'Send the image as PNG, JPEG or WebP');
    if (body.length > CALL_BACKGROUND_MAX_BYTES)
      throw new AppError('VALIDATION_FAILED', 'The image must be 2 MB or smaller');
    const mimeType = sniffImage(body);
    if (!mimeType) throw new AppError('VALIDATION_FAILED', 'Use a PNG, JPEG or WebP image');
    const t = this.db.for(ctx.tenantId);
    const key = randomBytes(16).toString('hex');
    await t.call_background_images.insertOne({
      _id: key,
      userId: ctx.userId,
      mimeType,
      data: body,
      size: body.length,
      createdAt: new Date(),
    });
    const prev = await t.call_background_prefs.findOne({ userId: ctx.userId });
    await t.call_background_prefs.updateOne(
      { userId: ctx.userId },
      { $set: { imageKey: key, choice: { kind: 'custom' }, updatedAt: new Date() } },
      { upsert: true },
    );
    if (prev?.imageKey) await t.call_background_images.deleteMany({ _id: prev.imageKey });
    this.changed(ctx);
    return this.state(ctx);
  }

  async removeImage(ctx: TenantContext): Promise<CallBackgroundState> {
    const t = this.db.for(ctx.tenantId);
    const prev = await t.call_background_prefs.findOne({ userId: ctx.userId });
    if (prev?.imageKey) {
      const usingIt = prev.choice?.kind === 'custom';
      await t.call_background_prefs.updateOne(
        { userId: ctx.userId },
        { $set: { imageKey: null, ...(usingIt ? { choice: null } : {}), updatedAt: new Date() } },
      );
      await t.call_background_images.deleteMany({ _id: prev.imageKey });
      this.changed(ctx);
    }
    return this.state(ctx);
  }

  async setPolicy(ctx: TenantContext, body: unknown): Promise<CallBackgroundState> {
    if (!tenantCan(ctx.role, 'members.manage'))
      throw forbidden('Only owners and admins can change call backgrounds for the organization');
    const policy = parse(CallBackgroundPolicySchema, body);
    await this.db
      .for(ctx.tenantId)
      .tenant_settings.updateOne(
        {},
        { $set: { callBackgrounds: policy, updatedAt: new Date(), updatedBy: ctx.userId } },
        { upsert: true },
      );
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'calls.backgrounds.update',
      metadata: { ...policy },
    });
    this.realtime.toTenant(ctx.tenantId, 'tenant:updated', { area: 'calls' });
    return this.state(ctx);
  }

  /** Serves a personal background without a session (128-bit random key, like profile photos). */
  async image(tenantId: string, key: string) {
    if (!/^[a-f0-9]{24}$/.test(tenantId) || !/^[a-f0-9]{32}$/.test(key)) throw notFound('Image');
    const a = await this.db.for(tenantId).call_background_images.findOne({ _id: key });
    if (!a) throw notFound('Image');
    const data = Buffer.isBuffer(a.data)
      ? a.data
      : Buffer.from((a.data as unknown as { buffer: ArrayBuffer }).buffer);
    return { mimeType: a.mimeType, data };
  }

  private changed(ctx: TenantContext) {
    this.realtime.toUser(ctx.tenantId, ctx.userId, 'meetings:changed', { area: 'call_background' });
  }
}
