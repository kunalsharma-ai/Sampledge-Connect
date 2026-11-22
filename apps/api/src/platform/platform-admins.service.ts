import { Injectable } from '@nestjs/common';
import {
  AddPlatformAdminSchema,
  PLATFORM_ROLE_INFO,
  UpdatePlatformAdminSchema,
  platformCan,
  platformPermissions,
  type PlatformAccount,
  type PlatformAdmin,
  type PlatformMe,
  type PlatformRole,
} from '@sampledge/contracts';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type { PlatformAdminDoc, UserDoc } from '../database/documents.js';
import { newId, TenantDb } from '../database/tenant-db.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { NetworkTenant } from '../network/network-tenant.js';
import { PlatformAdmins } from './platform-admins.js';
import { PlatformAudit } from './platform-audit.service.js';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Who runs SampConnect: platform admins and their roles (super admins only). */
@Injectable()
export class PlatformAdminsService {
  constructor(
    private readonly db: TenantDb,
    private readonly admins: PlatformAdmins,
    private readonly audit: PlatformAudit,
    private readonly realtime: RealtimePublisher,
    private readonly network: NetworkTenant,
  ) {}

  async me(ctx: TenantContext): Promise<PlatformMe> {
    if (await this.network.isNetwork(ctx.tenantId)) throw forbidden();
    const role = await this.admins.assert(ctx);
    const doc = await this.db.platformAdmins.findOne(
      { tenantId: ctx.tenantId, userId: ctx.userId },
      { projection: { bootstrap: 1 } },
    );
    return { role, permissions: platformPermissions(role), bootstrap: !!doc?.bootstrap };
  }

  async list(ctx: TenantContext): Promise<PlatformAdmin[]> {
    await this.admins.assert(ctx, 'overview.view');
    const rows = await this.db.platformAdmins.find({}, { sort: { addedAt: 1 } }).toArray();
    return this.toDtos(ctx, rows);
  }

  /** Work accounts matching an email or name, in any organization, to add as admins. */
  async accounts(ctx: TenantContext, q: string): Promise<PlatformAccount[]> {
    await this.admins.assert(ctx, 'admins.manage');
    const term = (q ?? '').trim();
    if (term.length < 2) return [];
    const netId = await this.network.id();
    const re = new RegExp(escapeRe(term), 'i');
    const users = await this.db.raw
      .collection<UserDoc>('users')
      .find(
        { tenantId: { $ne: netId }, status: 'active', $or: [{ email: re }, { displayName: re }] },
        { projection: { tenantId: 1, email: 1, displayName: 1 }, limit: 20 },
      )
      .toArray();
    const [orgs, existing] = await Promise.all([
      this.db.tenants
        .find(
          { _id: { $in: [...new Set(users.map((u) => u.tenantId))] } },
          { projection: { name: 1, slug: 1, kind: 1 } },
        )
        .toArray(),
      this.db.platformAdmins
        .find(
          { userId: { $in: users.map((u) => u._id) } },
          { projection: { userId: 1, tenantId: 1, role: 1 } },
        )
        .toArray(),
    ]);
    const org = new Map(orgs.map((o) => [o._id, o]));
    const role = new Map(existing.map((a) => [`${a.tenantId}:${a.userId}`, a.role]));
    return users
      .filter((u) => org.has(u.tenantId) && org.get(u.tenantId)!.kind !== 'network')
      .map((u) => ({
        tenantId: u.tenantId,
        orgName: org.get(u.tenantId)!.name,
        orgSlug: org.get(u.tenantId)!.slug,
        userId: u._id,
        name: u.displayName,
        email: u.email,
        role: role.get(`${u.tenantId}:${u._id}`) ?? null,
      }));
  }

  async add(ctx: TenantContext, body: unknown): Promise<PlatformAdmin> {
    await this.admins.assert(ctx, 'admins.manage');
    const req = parse(AddPlatformAdminSchema, body);
    const t = await this.db.tenants.findOne({ _id: req.tenantId });
    if (!t || t.kind === 'network') throw notFound('Organization');
    const u = await this.db.for(req.tenantId).users.findOne({ _id: req.userId });
    if (!u || u.status !== 'active') throw notFound('Account');
    const existing = await this.db.platformAdmins.findOne({
      tenantId: req.tenantId,
      userId: req.userId,
    });
    if (existing) {
      if (existing.role !== req.role) return this.setRole(ctx, existing._id, { role: req.role });
      return (await this.toDtos(ctx, [existing]))[0]!;
    }
    const doc: PlatformAdminDoc = {
      _id: newId(),
      tenantId: req.tenantId,
      userId: req.userId,
      email: u.email.toLowerCase(),
      role: req.role,
      addedAt: new Date(),
      addedBy: ctx.userId,
    };
    try {
      await this.db.platformAdmins.insertOne(doc);
    } catch (e) {
      if ((e as { code?: number }).code === 11000)
        throw new AppError('CONFLICT', 'That account is already a platform admin.');
      throw e;
    }
    await this.after(ctx, doc, 'platform.admin_added', { role: req.role, org: t.name });
    return (await this.toDtos(ctx, [doc]))[0]!;
  }

  async setRole(ctx: TenantContext, adminId: string, body: unknown): Promise<PlatformAdmin> {
    await this.admins.assert(ctx, 'admins.manage');
    const { role } = parse(UpdatePlatformAdminSchema, body);
    const doc = await this.db.platformAdmins.findOne({ _id: adminId });
    if (!doc) throw notFound('Platform admin');
    if (doc.role === role) return (await this.toDtos(ctx, [doc]))[0]!;
    if (doc.role === 'owner') await this.keepAnOwner(adminId);
    await this.db.platformAdmins.updateOne({ _id: adminId }, { $set: { role } });
    const next = { ...doc, role };
    await this.after(ctx, next, 'platform.admin_role_changed', { from: doc.role, to: role });
    return (await this.toDtos(ctx, [next]))[0]!;
  }

  async remove(ctx: TenantContext, adminId: string): Promise<void> {
    await this.admins.assert(ctx, 'admins.manage');
    const doc = await this.db.platformAdmins.findOne({ _id: adminId });
    if (!doc) return;
    if (doc.role === 'owner') await this.keepAnOwner(adminId);
    await this.db.platformAdmins.deleteOne({ _id: adminId });
    await this.after(ctx, doc, 'platform.admin_removed', { role: doc.role }, true);
  }

  /** Someone must always be able to manage platform admins. */
  private async keepAnOwner(exceptId: string) {
    const others = await this.db.platformAdmins.countDocuments({
      role: 'owner',
      _id: { $ne: exceptId },
    });
    if (!others)
      throw new AppError(
        'CONFLICT',
        'There must always be at least one super admin. Make someone else a super admin first.',
      );
  }

  private async after(
    ctx: TenantContext,
    doc: PlatformAdminDoc,
    action: string,
    metadata: Record<string, unknown>,
    removed = false,
  ) {
    this.admins.forget(doc.tenantId, doc.userId);
    const role: PlatformRole | null = removed ? null : doc.role;
    this.realtime.setPlatformRooms(doc.tenantId, doc.userId, {
      platform: !!role,
      moderators: platformCan(role, 'moderation'),
    });
    this.realtime.toUser(doc.tenantId, doc.userId, 'platform:changed', { area: 'me' });
    this.realtime.toPlatform('platform:changed', { area: 'admins' });
    await this.audit.record({
      ctx,
      action,
      tenantId: doc.tenantId,
      target: { type: 'platform_admin', id: doc._id, label: doc.email },
      metadata: {
        ...metadata,
        roleLabel: role ? PLATFORM_ROLE_INFO[role].label : null,
      },
    });
  }

  private async toDtos(ctx: TenantContext, rows: PlatformAdminDoc[]): Promise<PlatformAdmin[]> {
    const tenants = await this.db.tenants
      .find(
        { _id: { $in: [...new Set(rows.map((r) => r.tenantId))] } },
        { projection: { name: 1, slug: 1 } },
      )
      .toArray();
    const org = new Map(tenants.map((t) => [t._id, t]));
    const users = await Promise.all(
      rows.map((r) =>
        this.db
          .for(r.tenantId)
          .users.findOne({ _id: r.userId }, { projection: { displayName: 1, email: 1, mfa: 1 } }),
      ),
    );
    const adders = await Promise.all(
      rows.map((r) =>
        r.addedBy
          ? this.db.raw
              .collection<UserDoc>('users')
              .findOne({ _id: r.addedBy }, { projection: { displayName: 1 } })
          : null,
      ),
    );
    return rows.map((r, i) => ({
      adminId: r._id,
      role: r.role,
      tenantId: r.tenantId,
      orgName: org.get(r.tenantId)?.name ?? 'Deleted organization',
      orgSlug: org.get(r.tenantId)?.slug ?? '',
      userId: r.userId,
      name: users[i]?.displayName ?? r.email,
      email: users[i]?.email ?? r.email,
      twoStep: !!users[i]?.mfa?.enabledAt,
      addedAt: r.addedAt.toISOString(),
      addedByName: adders[i]?.displayName ?? null,
      bootstrap: !!r.bootstrap,
      you: r.tenantId === ctx.tenantId && r.userId === ctx.userId,
    }));
  }
}
