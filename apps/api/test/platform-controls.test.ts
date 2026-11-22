import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_TENANT_POLICY,
  PASSWORD_CHANGE_REQUIRED,
  type ActivityRetention,
  type ForcedPasswordReset,
  type PlatformActivityPage,
  type PlatformOrgPermissions,
  type PlatformPermissionDefaults,
  type Session,
  type TenantPermissionPolicy,
} from '@sampledge/contracts';
import { TenantDb } from '../src/database/tenant-db.js';
import { PlatformControlService } from '../src/platform/platform-control.service.js';
import {
  api,
  device,
  grantPlatformRole,
  inviteAndLogin,
  registerTenant,
  startHarness,
  type Harness,
} from './harness.js';

/** Super admin controls: permissions, passwords, activity (docs/super-admin.md). */
let h: Harness;
let hq: Awaited<ReturnType<typeof registerTenant>>;
let acme: Awaited<ReturnType<typeof registerTenant>>;
let beta: Awaited<ReturnType<typeof registerTenant>>;
let superAdmin: Session;
let platformAdmin: Session;
let ravi: Session; // member of Acme
let maya: Session; // member of Beta
const TEMP = 'temporary password 123';

const as = <T>(s: Session, method: string, path: string, body?: unknown) =>
  api<T>(h, method, path, { token: s.accessToken, body });
const login = (slug: string, email: string, password: string, extra: object = {}) =>
  api<Session & { error?: { code: string; details?: { reason: string } } }>(
    h,
    'POST',
    '/v1/auth/login',
    {
      body: { tenantSlug: slug, email, password, device: device(), ...extra },
    },
  );
const channel = (s: Session, name: string) =>
  as(s, 'POST', '/v1/conversations', { kind: 'channel_public', name, memberIds: [] });

beforeAll(async () => {
  h = await startHarness();
  hq = await registerTenant(h, 'SampConnect HQ');
  acme = await registerTenant(h, 'Acme Research');
  beta = await registerTenant(h, 'Beta Panels');
  superAdmin = hq.session;
  await grantPlatformRole(h, superAdmin, 'owner');
  platformAdmin = await inviteAndLogin(h, superAdmin, hq.slug, 'Ada Admin');
  await grantPlatformRole(h, platformAdmin, 'admin');
  ravi = await inviteAndLogin(h, acme.session, acme.slug, 'Ravi Kumar');
  maya = await inviteAndLogin(h, beta.session, beta.slug, 'Maya Chen');
}, 60_000);

afterAll(async () => {
  await h?.close();
});

describe('permissions set by the super admin', () => {
  it('starts from the built-in rules', async () => {
    const d = await as<PlatformPermissionDefaults>(superAdmin, 'GET', '/v1/platform/permissions');
    expect(d.status).toBe(200);
    expect(d.body.customized).toBe(false);
    expect(d.body.policy).toEqual(DEFAULT_TENANT_POLICY);
    const me = await as<{ permissions: string[] }>(ravi, 'GET', '/v1/me');
    expect(me.body.permissions).toContain('channel.public.create');
  });

  it('changes one organization only; owners there cannot undo it', async () => {
    const policy: TenantPermissionPolicy = {
      ...DEFAULT_TENANT_POLICY,
      member: DEFAULT_TENANT_POLICY.member.filter((p) => p !== 'channel.public.create'),
    };
    // Only super admins decide: a platform admin can look but not change.
    expect(
      (
        await as(
          platformAdmin,
          'PUT',
          `/v1/platform/orgs/${acme.session.tenant.tenantId}/permissions`,
          { policy },
        )
      ).status,
    ).toBe(403);
    const r = await as<PlatformOrgPermissions>(
      superAdmin,
      'PUT',
      `/v1/platform/orgs/${acme.session.tenant.tenantId}/permissions`,
      { policy },
    );
    expect(r.status).toBe(200);
    expect(r.body.inherits).toBe(false);
    expect((await channel(ravi, 'not-allowed')).status).toBe(403);
    expect((await channel(maya, 'still-fine')).status).toBe(201);
    const me = await as<{ permissions: string[] }>(ravi, 'GET', '/v1/me');
    expect(me.body.permissions).not.toContain('channel.public.create');
    // The organization sees in its own audit log that SampConnect changed it.
    const log = await as<{ items: { action: string }[] }>(acme.session, 'GET', '/v1/admin/audit');
    expect(log.body.items.map((i) => i.action)).toContain('tenant.permissions_changed_by_platform');
  });

  it('the platform default applies to every organization without its own rules', async () => {
    const policy: TenantPermissionPolicy = {
      ...DEFAULT_TENANT_POLICY,
      admin: DEFAULT_TENANT_POLICY.admin.filter((p) => p !== 'members.invite'),
    };
    const d = await as<PlatformPermissionDefaults>(superAdmin, 'PUT', '/v1/platform/permissions', {
      policy,
    });
    expect(d.status).toBe(200);
    expect(d.body.customized).toBe(true);
    expect(d.body.customOrganizations).toBe(1);
    const betaAdmin = await inviteAndLogin(h, beta.session, beta.slug, 'Bo Admin', 'admin');
    const inv = await as(betaAdmin, 'POST', '/v1/users', {
      email: `x@${beta.slug}.test`,
      displayName: 'X',
      role: 'member',
      temporaryPassword: TEMP,
    });
    expect(inv.status).toBe(403);
    // Back to the built-in rules for everyone; Acme goes back to the default too.
    await as(superAdmin, 'PUT', '/v1/platform/permissions', { policy: null });
    const back = await as<PlatformOrgPermissions>(
      superAdmin,
      'PUT',
      `/v1/platform/orgs/${acme.session.tenant.tenantId}/permissions`,
      { policy: null },
    );
    expect(back.body.inherits).toBe(true);
    expect((await channel(ravi, 'allowed-again')).status).toBe(201);
  });
});

describe('passwords', () => {
  it('changing your own password signs your other devices out and shows to the super admin', async () => {
    const email = `ravi.kumar@${acme.slug}.test`;
    const second = (await login(acme.slug, email, TEMP)).body;
    expect(
      (
        await as(ravi, 'POST', '/v1/auth/password', {
          currentPassword: 'wrong one',
          newPassword: 'a brand new password',
        })
      ).status,
    ).toBe(403);
    const r = await as<{ signedOutDevices: number }>(ravi, 'POST', '/v1/auth/password', {
      currentPassword: TEMP,
      newPassword: 'a brand new password',
    });
    expect(r.status).toBe(200);
    expect(r.body.signedOutDevices).toBe(1);
    expect((await as(second, 'GET', '/v1/me')).status).toBe(401);
    expect((await as(ravi, 'GET', '/v1/me')).status).toBe(200);

    const act = await as<PlatformActivityPage>(
      superAdmin,
      'GET',
      `/v1/platform/activity?category=security&tenantId=${acme.session.tenant.tenantId}`,
    );
    expect(act.status).toBe(200);
    const actions = act.body.items.map((i) => i.action);
    expect(actions).toContain('auth.password_changed');
    expect(actions).toContain('auth.password_change_failed');
    const changed = act.body.items.find((i) => i.action === 'auth.password_changed')!;
    expect(changed.actor?.name).toBe('Ravi Kumar');
    expect(changed.org.name).toBe('Acme Research');
    // Never the password itself.
    expect(JSON.stringify(act.body)).not.toContain('a brand new password');
  });

  it('an admin reset makes the member choose a new password at next sign-in', async () => {
    const email = `maya.chen@${beta.slug}.test`;
    const r = await as(beta.session, 'POST', `/v1/users/${maya.user.userId}/password`, {
      temporaryPassword: 'given out by the admin',
    });
    expect(r.status).toBe(200);
    expect((await as(maya, 'GET', '/v1/me')).status).toBe(401);
    const first = await login(beta.slug, email, 'given out by the admin');
    expect(first.status).toBe(403);
    expect(first.body.error?.details?.reason).toBe(PASSWORD_CHANGE_REQUIRED);
    const ok = await login(beta.slug, email, 'given out by the admin', {
      newPassword: 'maya picked this one',
    });
    expect(ok.status).toBe(200);
    maya = ok.body;
    expect((await login(beta.slug, email, 'maya picked this one')).status).toBe(200);
  });

  it('a super admin can force a reset; nobody sees the password', async () => {
    const r = await as<ForcedPasswordReset>(
      superAdmin,
      'POST',
      `/v1/platform/orgs/${beta.session.tenant.tenantId}/people/${maya.user.userId}/password-reset`,
    );
    expect(r.status).toBe(200);
    expect(r.body.signedOutDevices).toBeGreaterThan(0);
    expect((await as(maya, 'GET', '/v1/me')).status).toBe(401);
    const email = `maya.chen@${beta.slug}.test`;
    const again = await login(beta.slug, email, 'maya picked this one');
    expect(again.body.error?.details?.reason).toBe(PASSWORD_CHANGE_REQUIRED);
    expect(
      (
        await login(beta.slug, email, 'maya picked this one', {
          newPassword: 'maya picked this one',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await login(beta.slug, email, 'maya picked this one', {
          newPassword: 'and now another one',
        })
      ).status,
    ).toBe(200);
    const act = await as<PlatformActivityPage>(
      superAdmin,
      'GET',
      `/v1/platform/activity?q=password&tenantId=${beta.session.tenant.tenantId}`,
    );
    expect(act.body.items.map((i) => i.action)).toEqual(
      expect.arrayContaining([
        'auth.password_reset_by_admin',
        'auth.password_reset_forced',
        'auth.password_change_required',
        'auth.password_changed',
      ]),
    );
  });
});

describe('activity across organizations', () => {
  it('lists every organization, pages, filters and exports', async () => {
    const all = await as<PlatformActivityPage>(superAdmin, 'GET', '/v1/platform/activity?limit=5');
    expect(all.status).toBe(200);
    expect(all.body.items).toHaveLength(5);
    expect(all.body.nextCursor).toBeTruthy();
    const next = await as<PlatformActivityPage>(
      superAdmin,
      'GET',
      `/v1/platform/activity?limit=5&before=${all.body.nextCursor}`,
    );
    expect(next.body.items[0]!.id).not.toBe(all.body.items[0]!.id);
    const orgs = new Set(
      (
        await as<PlatformActivityPage>(superAdmin, 'GET', '/v1/platform/activity?limit=200')
      ).body.items.map((i) => i.org.name),
    );
    expect([...orgs]).toEqual(expect.arrayContaining(['Acme Research', 'Beta Panels']));

    const res = await fetch(`${h.url}/v1/platform/activity/export?category=security`, {
      headers: { authorization: `Bearer ${superAdmin.accessToken}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const csv = await res.text();
    expect(csv).toContain('organization');
    expect(csv).toContain('auth.password_changed');
    // Members of an organization can't read anyone's activity here.
    expect((await as(ravi, 'GET', '/v1/platform/activity')).status).toBe(403);
  });

  it('keeps activity for as long as the super admin says', async () => {
    const db = h.app.get(TenantDb);
    const old = new Date(Date.now() - 400 * 86_400_000);
    await db.for(acme.session.tenant.tenantId).audit_logs.insertOne({
      actorId: null,
      action: 'auth.login',
      target: null,
      ip: null,
      userAgent: null,
      at: old,
      metadata: { marker: 'ancient' },
    });
    const before = await as<ActivityRetention>(
      superAdmin,
      'GET',
      '/v1/platform/activity/retention',
    );
    expect(before.body.days).toBeNull();
    expect(new Date(before.body.oldestAt!).getTime()).toBe(old.getTime());
    expect(
      (await as(platformAdmin, 'PUT', '/v1/platform/activity/retention', { days: 365 })).status,
    ).toBe(403);
    const r = await as<ActivityRetention>(superAdmin, 'PUT', '/v1/platform/activity/retention', {
      days: 365,
    });
    expect(r.status).toBe(200);
    expect(r.body.days).toBe(365);
    expect(new Date(r.body.oldestAt!).getTime()).toBeGreaterThan(old.getTime());
    expect(await h.app.get(PlatformControlService).applyRetention()).toBe(0);
  });
});
