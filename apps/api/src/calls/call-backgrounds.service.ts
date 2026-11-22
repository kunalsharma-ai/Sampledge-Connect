import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  CALL_BACKGROUND_MAX_BYTES,
  CALL_BACKGROUND_MAX_ORGANIZATION,
  CALL_BACKGROUND_MAX_PERSONAL,
  CallBackgroundChoiceSchema,
  CallBackgroundPolicySchema,
  tenantCan,
  type CallBackgroundChoice,
  type CallBackgroundPolicy,
  type CallBackgroundState,
  type CallBackgroundUpload,
} from '@sampledge/contracts';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type { CallBackgroundImageDoc } from '../database/documents.js';
import { TenantDb } from '../database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { BrandingService } from '../branding/branding.service.js';

const DEFAULT_POLICY: CallBackgroundPolicy = CallBackgroundPolicySchema.parse({});
const LIST_FIELDS = { _id: 1, userId: 1, scope: 1, name: 1, createdAt: 1 } as const;
type ImageRow = Pick<CallBackgroundImageDoc, '_id' | 'userId' | 'scope' | 'name' | 'createdAt'>;

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

/** A display name from the uploaded file's name (header), without the extension. */
function cleanName(raw: unknown, fallback: string): string {
  let v = typeof raw === 'string' ? raw : '';
  try {
    v = decodeURIComponent(v);
  } catch {
    /* keep as sent */
  }
  v = v
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim();
  return (v || fallback).slice(0, 60);
}

/**
 * Virtual backgrounds in calls. Each person's choice and their own images are saved to their
 * account so every device uses them; admins add backgrounds for everyone, set the default and
 * can require the company logo background. Video is processed on the device, never here.
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

  /** The organization's images and mine, newest first (images from before scopes are mine). */
  private async images(tenantId: string, userId: string): Promise<ImageRow[]> {
    return (await this.db
      .for(tenantId)
      .call_background_images.find(
        { $or: [{ scope: 'org' }, { userId, scope: { $in: ['user', null] } }] },
        { projection: LIST_FIELDS, sort: { createdAt: -1 } },
      )
      .toArray()) as ImageRow[];
  }

  async state(ctx: TenantContext): Promise<CallBackgroundState> {
    const t = this.db.for(ctx.tenantId);
    const [pref, policy, tenant, rows] = await Promise.all([
      t.call_background_prefs.findOne({ userId: ctx.userId }),
      this.policy(ctx.tenantId),
      this.db.tenants.findOne({ _id: ctx.tenantId }),
      this.images(ctx.tenantId, ctx.userId),
    ]);
    const url = (id: string) => `/v1/call-backgrounds/${ctx.tenantId}/${id}`;
    const uploads: CallBackgroundUpload[] = [
      ...rows.filter((r) => r.scope === 'org'),
      ...rows.filter((r) => r.scope !== 'org'),
    ].map((r, i) => ({
      imageId: r._id,
      url: url(r._id),
      name: r.name ?? `Background ${i + 1}`,
      owner: r.scope === 'org' ? 'organization' : 'mine',
      createdAt: r.createdAt.toISOString(),
    }));
    const mine = uploads.filter((u) => u.owner === 'mine');
    const exists = (id: string) => uploads.some((u) => u.imageId === id);

    const parsed = pref?.choice ? CallBackgroundChoiceSchema.safeParse(pref.choice) : null;
    let choice: CallBackgroundChoice | null = parsed?.success ? parsed.data : null;
    // Older "custom" meant my latest image; an image that was removed falls back to the default.
    if (choice?.kind === 'custom')
      choice = mine[0] ? { kind: 'upload', imageId: mine[0].imageId } : null;
    if (choice?.kind === 'upload' && !exists(choice.imageId)) choice = null;
    let fallback = policy.defaultChoice;
    if (fallback.kind === 'upload' && !exists(fallback.imageId)) fallback = { kind: 'none' };

    const brand = BrandingService.resolve(tenant);
    return {
      choice,
      effective: policy.enforceLogo ? { kind: 'logo' } : (choice ?? fallback),
      customImageUrl: mine[0]?.url ?? null,
      uploads,
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
    let choice = parse(CallBackgroundChoiceSchema, body);
    const t = this.db.for(ctx.tenantId);
    if (choice.kind === 'custom' || choice.kind === 'upload') {
      const rows = await this.images(ctx.tenantId, ctx.userId);
      const wanted = choice.kind === 'upload' ? choice.imageId : null;
      const pick = wanted
        ? rows.find((r) => r._id === wanted)
        : rows.find((r) => r.scope !== 'org');
      if (!pick)
        throw new AppError(
          'VALIDATION_FAILED',
          'Upload an image first to use it as your background',
        );
      choice = { kind: 'upload', imageId: pick._id };
    }
    await t.call_background_prefs.updateOne(
      { userId: ctx.userId },
      { $set: { choice, updatedAt: new Date() } },
      { upsert: true },
    );
    this.changed(ctx);
    return this.state(ctx);
  }

  private async store(
    ctx: TenantContext,
    body: unknown,
    scope: 'user' | 'org',
    name: unknown,
  ): Promise<string> {
    if (!Buffer.isBuffer(body) || body.length === 0)
      throw new AppError('VALIDATION_FAILED', 'Send the image as PNG, JPEG or WebP');
    if (body.length > CALL_BACKGROUND_MAX_BYTES)
      throw new AppError('VALIDATION_FAILED', 'The image must be 2 MB or smaller');
    const mimeType = sniffImage(body);
    if (!mimeType) throw new AppError('VALIDATION_FAILED', 'Use a PNG, JPEG or WebP image');
    const t = this.db.for(ctx.tenantId);
    const filter =
      scope === 'org'
        ? { scope: 'org' as const }
        : { userId: ctx.userId, scope: { $in: ['user' as const, null] } };
    const count = await t.call_background_images.countDocuments(filter);
    const max = scope === 'org' ? CALL_BACKGROUND_MAX_ORGANIZATION : CALL_BACKGROUND_MAX_PERSONAL;
    if (count >= max)
      throw new AppError(
        'VALIDATION_FAILED',
        `You can keep up to ${max} backgrounds here. Remove one to add another.`,
      );
    const key = randomBytes(16).toString('hex');
    await t.call_background_images.insertOne({
      _id: key,
      userId: ctx.userId,
      scope,
      name: cleanName(name, scope === 'org' ? 'Company background' : 'My background'),
      mimeType,
      data: body,
      size: body.length,
      createdAt: new Date(),
    });
    return key;
  }

  /** Adds one of my own backgrounds (raw PNG/JPEG/WebP body) and selects it. */
  async upload(ctx: TenantContext, body: unknown, name?: unknown): Promise<CallBackgroundState> {
    const key = await this.store(ctx, body, 'user', name);
    await this.db
      .for(ctx.tenantId)
      .call_background_prefs.updateOne(
        { userId: ctx.userId },
        { $set: { choice: { kind: 'upload', imageId: key }, updatedAt: new Date() } },
        { upsert: true },
      );
    this.changed(ctx);
    return this.state(ctx);
  }

  /** Removes one of my backgrounds (or, with no id, my most recent one). */
  async removeImage(ctx: TenantContext, imageId?: string): Promise<CallBackgroundState> {
    const t = this.db.for(ctx.tenantId);
    const mine = (await this.images(ctx.tenantId, ctx.userId)).filter((r) => r.scope !== 'org');
    const target = imageId ? mine.find((r) => r._id === imageId) : mine[0];
    if (imageId && !target) throw notFound('Background');
    if (target) {
      await t.call_background_images.deleteMany({ _id: target._id });
      this.changed(ctx);
    }
    return this.state(ctx);
  }

  /** Admins add a background to the organization library (everyone can pick it). */
  async addOrganizationImage(
    ctx: TenantContext,
    body: unknown,
    name?: unknown,
  ): Promise<CallBackgroundState> {
    this.requireAdmin(ctx);
    const key = await this.store(ctx, body, 'org', name);
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'calls.backgrounds.update',
      metadata: { added: key },
    });
    this.realtime.toTenant(ctx.tenantId, 'tenant:updated', { area: 'calls' });
    return this.state(ctx);
  }

  async removeOrganizationImage(ctx: TenantContext, imageId: string): Promise<CallBackgroundState> {
    this.requireAdmin(ctx);
    const t = this.db.for(ctx.tenantId);
    const r = await t.call_background_images.deleteMany({ _id: imageId, scope: 'org' });
    if (!r.deletedCount) throw notFound('Background');
    // A default that pointed at it goes back to none.
    const p = await this.policy(ctx.tenantId);
    if (p.defaultChoice.kind === 'upload' && p.defaultChoice.imageId === imageId)
      await t.tenant_settings.updateOne(
        {},
        { $set: { callBackgrounds: { ...p, defaultChoice: { kind: 'none' } } } },
      );
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'calls.backgrounds.update',
      metadata: { removed: imageId },
    });
    this.realtime.toTenant(ctx.tenantId, 'tenant:updated', { area: 'calls' });
    return this.state(ctx);
  }

  async setPolicy(ctx: TenantContext, body: unknown): Promise<CallBackgroundState> {
    this.requireAdmin(ctx);
    const policy = parse(CallBackgroundPolicySchema, body);
    if (policy.defaultChoice.kind === 'upload') {
      const img = await this.db
        .for(ctx.tenantId)
        .call_background_images.findOne(
          { _id: policy.defaultChoice.imageId, scope: 'org' },
          { projection: { _id: 1 } },
        );
      if (!img)
        throw new AppError(
          'VALIDATION_FAILED',
          'The default must be one of the organization’s backgrounds',
        );
    }
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

  /** Serves a background image without a session (128-bit random key, like profile photos). */
  async image(tenantId: string, key: string) {
    if (!/^[a-f0-9]{24}$/.test(tenantId) || !/^[a-f0-9]{32}$/.test(key)) throw notFound('Image');
    const a = await this.db.for(tenantId).call_background_images.findOne({ _id: key });
    if (!a) throw notFound('Image');
    const data = Buffer.isBuffer(a.data)
      ? a.data
      : Buffer.from((a.data as unknown as { buffer: ArrayBuffer }).buffer);
    return { mimeType: a.mimeType, data };
  }

  private requireAdmin(ctx: TenantContext) {
    if (!tenantCan(ctx.role, 'members.manage'))
      throw forbidden('Only owners and admins can change call backgrounds for the organization');
  }

  private changed(ctx: TenantContext) {
    this.realtime.toUser(ctx.tenantId, ctx.userId, 'meetings:changed', { area: 'call_background' });
  }
}
