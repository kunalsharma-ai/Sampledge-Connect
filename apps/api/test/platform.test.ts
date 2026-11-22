import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoClient } from 'mongodb';
import {
  uuidv7,
  type PlatformAccount,
  type PlatformAdmin,
  type PlatformAuditPage,
  type PlatformMe,
  type PlatformOrg,
  type PlatformOrgDetail,
  type PlatformOrgPage,
  type PlatformOverview,
  type PlatformSupportView,
  type Session,
  type AuditPage,
} from '@sampledge/contracts';
import { OrgPurgeWorker } from '../src/platform/org-purge.worker.js';
import {
  api,
  connect,
  device,
  inviteAndLogin,
  nextEvent,
  registerTenant,
  startHarness,
  type Harness,
} from './harness.js';

/** The super admin console (docs/super-admin.md). */
let h: Harness;
let hq: Awaited<ReturnType<typeof registerTenant>>;
let acme: Awaited<ReturnType<typeof registerTenant>>;
let owner: Session; // the bootstrap super admin
let support: Session; // a colleague made "support"
const act = () => ({ clientActionId: uuidv7() });

const as = <T>(s: Session, method: string, path: string, body?: unknown) =>
  api<T>(h, method, path, { token: s.accessToken, body });

beforeAll(async () => {
  // A throwaway database, so the bootstrap email decides who the first super admin is.
  const slug = `hq-${Date.now().toString(36)}`;
  h = await startHarness({ PLATFORM_ADMIN_EMAILS: `${slug}:priya@${slug}.test` });
  // registerTenant picks its own slug, so register HQ by hand with the pinned one.
  const r = await api<Session>(h, 'POST', '/v1/auth/register', {
    body: {
      organizationName: 'SampConnect HQ',
      tenantSlug: slug,
      ownerName: 'Priya Owner',
      ownerEmail: `priya@${slug}.test`,
      password: 'correct horse battery staple',
      device: device(),
    },
  });
  expect(r.status).toBe(201);
  hq = { session: r.body, slug, password: 'correct horse battery staple' };
  owner = r.body;
  acme = await registerTenant(h, 'Acme Research');
  support = await inviteAndLogin(h, owner, slug, 'Sam Support');
}, 60_000);

afterAll(async () => {
  await h?.close();
});

describe('platform admins', () => {
  it('bootstraps the first super admin from the pinned setting, and nobody else', async () => {
    const me = await as<PlatformMe>(owner, 'GET', '/v1/platform/me');
    expect(me.status).toBe(200);
    expect(me.body.role).toBe('owner');
    expect(me.body.bootstrap).toBe(true);
    expect(me.body.permissions).toContain('admins.manage');
    // Same email in another organization is not a match: the entry is pinned to the HQ slug.
    expect((await as(acme.session, 'GET', '/v1/platform/me')).status).toBe(403);
    expect((await as(support, 'GET', '/v1/platform/overview')).status).toBe(403);
  });

  it('adds a colleague with a role; the role limits what they can do', async () => {
    const found = await as<PlatformAccount[]>(owner, 'GET', '/v1/platform/accounts?q=sam.support');
    expect(found.status).toBe(200);
    const sam = found.body.find((a) => a.userId === support.user.userId)!;
    expect(sam).toBeTruthy();
    expect(sam.role).toBeNull();
    const added = await as<PlatformAdmin>(owner, 'POST', '/v1/platform/admins', {
      tenantId: sam.tenantId,
      userId: sam.userId,
      role: 'support',
    });
    expect(added.status).toBe(201);
    expect(added.body.role).toBe('support');

    expect((await as<PlatformMe>(support, 'GET', '/v1/platform/me')).body.role).toBe('support');
    expect((await as(support, 'GET', '/v1/platform/orgs')).status).toBe(200);
    expect(
      (await as(support, 'GET', `/v1/platform/orgs/${acme.session.tenant.tenantId}/support`))
        .status,
    ).toBe(200);
    // Read-only: no suspending, no admin changes, no plan catalog.
    expect(
      (
        await as(support, 'POST', `/v1/platform/orgs/${acme.session.tenant.tenantId}/suspend`, {
          ...act(),
          reason: 'test',
        })
      ).status,
    ).toBe(403);
    expect((await as(support, 'GET', '/v1/platform/billing/plans')).status).toBe(403);
    expect((await as(support, 'GET', '/v1/platform/accounts?q=pri')).status).toBe(403);
  });

  it('always keeps one super admin', async () => {
    const list = await as<PlatformAdmin[]>(owner, 'GET', '/v1/platform/admins');
    const me = list.body.find((a) => a.you)!;
    const demote = await as(owner, 'PATCH', `/v1/platform/admins/${me.adminId}`, { role: 'admin' });
    expect(demote.status).toBe(409);
    expect((await as(owner, 'DELETE', `/v1/platform/admins/${me.adminId}`)).status).toBe(409);
  });
});

describe('organizations', () => {
  it('lists and searches organizations with usage and plan', async () => {
    const all = await as<PlatformOrgPage>(owner, 'GET', '/v1/platform/orgs');
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(2); // the Network's reserved tenant is never listed
    const q = await as<PlatformOrgPage>(owner, 'GET', '/v1/platform/orgs?q=acme');
    expect(q.body.items.map((o) => o.slug)).toEqual([acme.slug]);
    expect(q.body.items[0]!.members).toBe(1);
    expect(q.body.items[0]!.lastActiveAt).not.toBeNull();
  });

  it('creates an organization whose owner signs in with the temporary password', async () => {
    const slug = `globex-${Date.now().toString(36)}`;
    const r = await as<PlatformOrg>(owner, 'POST', '/v1/platform/orgs', {
      name: 'Globex',
      slug,
      ownerName: 'Gloria',
      ownerEmail: `gloria@${slug}.test`,
      temporaryPassword: 'temporary password 123',
    });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('active');
    const login = await api<Session>(h, 'POST', '/v1/auth/login', {
      body: {
        tenantSlug: slug,
        email: `gloria@${slug}.test`,
        password: 'temporary password 123',
        device: device(),
      },
    });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('owner');
    const dup = await as(owner, 'POST', '/v1/platform/orgs', {
      name: 'Globex again',
      slug,
      ownerName: 'G',
      ownerEmail: `g@${slug}.test`,
      temporaryPassword: 'temporary password 123',
    });
    expect(dup.status).toBe(409);
  });

  it('shows the organization and its support view, and tells the organization', async () => {
    const id = acme.session.tenant.tenantId;
    const d = await as<PlatformOrgDetail>(owner, 'GET', `/v1/platform/orgs/${id}`);
    expect(d.status).toBe(200);
    expect(d.body.admins.map((a) => a.role)).toEqual(['owner']);
    expect(d.body.overview.members.active).toBe(1);
    const s = await as<PlatformSupportView>(owner, 'GET', `/v1/platform/orgs/${id}/support`);
    expect(s.status).toBe(200);
    expect(s.body.members[0]!.email).toContain('priya@');
    expect(s.body.devices.length).toBeGreaterThan(0);
    // No message content anywhere in the support view.
    expect(JSON.stringify(s.body)).not.toMatch(/"text"|"body"/);
    const orgLog = await as<AuditPage>(acme.session, 'GET', '/v1/admin/audit');
    expect(orgLog.body.items.some((e) => e.action === 'tenant.support_viewed')).toBe(true);
  });

  it('suspends an organization: live sockets are cut and nobody gets back in until reactivated', async () => {
    const id = acme.session.tenant.tenantId;
    const sock = await connect(h, acme.session.accessToken);
    const watcher = await connect(h, owner.accessToken);
    const expired = nextEvent(sock, 'session:expired');
    const live = nextEvent(watcher, 'platform:changed', (e) => e.area === 'orgs');
    const r = await as<PlatformOrg>(owner, 'POST', `/v1/platform/orgs/${id}/suspend`, {
      ...act(),
      reason: 'Unpaid invoices',
    });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('suspended');
    expect(r.body.suspension?.reason).toBe('Unpaid invoices');
    expect((await expired).reason).toBe('revoked');
    expect((await live).tenantId).toBe(id);
    watcher.close();
    sock.close();

    expect((await as(acme.session, 'GET', '/v1/me')).status).toBe(401);
    const refresh = await api(h, 'POST', '/v1/auth/refresh', {
      body: { refreshToken: acme.session.refreshToken },
    });
    expect(refresh.status).toBe(401);
    const login = await api<{ error: { message: string } }>(h, 'POST', '/v1/auth/login', {
      body: {
        tenantSlug: acme.slug,
        email: `priya@${acme.slug}.test`,
        password: acme.password,
        device: device(),
      },
    });
    expect(login.status).toBe(403);
    expect(login.body.error.message).toMatch(/suspended/);
    // You can't lock yourself out.
    expect(
      (
        await as(owner, 'POST', `/v1/platform/orgs/${hq.session.tenant.tenantId}/suspend`, {
          ...act(),
          reason: 'oops',
        })
      ).status,
    ).toBe(409);

    const back = await as<PlatformOrg>(owner, 'POST', `/v1/platform/orgs/${id}/reactivate`);
    expect(back.body.status).toBe('active');
    const again = await api<Session>(h, 'POST', '/v1/auth/login', {
      body: {
        tenantSlug: acme.slug,
        email: `priya@${acme.slug}.test`,
        password: acme.password,
        device: device(),
      },
    });
    expect(again.status).toBe(200);
    acme.session = again.body;
  });

  it('schedules a deletion with the typed address, can cancel it, and erases it when due', async () => {
    const victim = await registerTenant(h, 'Initech');
    const id = victim.session.tenant.tenantId;
    const wrong = await as(owner, 'POST', `/v1/platform/orgs/${id}/deletion`, {
      ...act(),
      confirmSlug: 'nope',
    });
    expect(wrong.status).toBe(400);
    expect(
      (
        await as(support, 'POST', `/v1/platform/orgs/${id}/deletion`, {
          ...act(),
          confirmSlug: victim.slug,
        })
      ).status,
    ).toBe(403);

    const s = await as<PlatformOrg>(owner, 'POST', `/v1/platform/orgs/${id}/deletion`, {
      ...act(),
      confirmSlug: victim.slug,
    });
    expect(s.status).toBe(200);
    expect(s.body.status).toBe('suspended');
    const days = (new Date(s.body.deletionScheduledFor!).getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(30);

    const c = await as<PlatformOrg>(owner, 'DELETE', `/v1/platform/orgs/${id}/deletion`);
    expect(c.body.status).toBe('active');
    expect(c.body.deletionScheduledFor).toBeNull();

    await as(owner, 'POST', `/v1/platform/orgs/${id}/deletion`, {
      ...act(),
      confirmSlug: victim.slug,
    });
    const worker = h.app.get(OrgPurgeWorker);
    expect(await worker.run(new Date())).toEqual([]); // not due yet
    expect(await worker.run(new Date(Date.now() + 31 * 86_400_000))).toEqual([id]);

    expect((await as(owner, 'GET', `/v1/platform/orgs/${id}`)).status).toBe(404);
    const mongo = await MongoClient.connect(process.env.MONGO_URL ?? 'mongodb://localhost:27017');
    try {
      const db = mongo.db(h.dbName);
      for (const c of ['users', 'conversations', 'messages', 'devices', 'audit_logs'])
        expect(await db.collection(c).countDocuments({ tenantId: id })).toBe(0);
    } finally {
      await mongo.close();
    }
    const log = await as<PlatformAuditPage>(owner, 'GET', '/v1/platform/audit?area=organizations');
    const actions = log.body.items.map((e) => e.action);
    expect(actions).toContain('platform.org_purged');
    expect(actions).toContain('platform.org_deletion_cancelled');
    const purged = log.body.items.find((e) => e.action === 'platform.org_purged')!;
    expect(purged.org?.name).toBe('Initech');
    expect(purged.actor).toBeNull();
  });
});

describe('overview and audit', () => {
  it('totals usage and health across organizations', async () => {
    const o = await as<PlatformOverview>(owner, 'GET', '/v1/platform/overview');
    expect(o.status).toBe(200);
    expect(o.body.organizations.total).toBe(3); // HQ, Acme, Globex
    expect(o.body.people.active).toBeGreaterThanOrEqual(4);
    expect(o.body.signups).toHaveLength(30);
    expect(o.body.health.mongo.ok).toBe(true);
    expect(o.body.health.redis.ok).toBe(true);
    expect(o.body.health.migrations.pending).toEqual([]);
  });

  it('records who did what, filterable and paged', async () => {
    const all = await as<PlatformAuditPage>(owner, 'GET', '/v1/platform/audit?limit=3');
    expect(all.body.items).toHaveLength(3);
    expect(all.body.nextCursor).not.toBeNull();
    const next = await as<PlatformAuditPage>(
      owner,
      'GET',
      `/v1/platform/audit?limit=3&before=${all.body.nextCursor}`,
    );
    expect(next.body.items[0]!.id).not.toBe(all.body.items[2]!.id);
    const admins = await as<PlatformAuditPage>(owner, 'GET', '/v1/platform/audit?area=admins');
    const added = admins.body.items.find((e) => e.action === 'platform.admin_added')!;
    expect(added.actor?.name).toBe('Priya Owner');
    expect(added.metadata.role).toBe('support');
    expect(admins.body.items.some((e) => e.action === 'platform.admin_bootstrapped')).toBe(true);
  });

  it('removing an admin takes their access away live', async () => {
    const list = await as<PlatformAdmin[]>(owner, 'GET', '/v1/platform/admins');
    const sam = list.body.find((a) => a.userId === support.user.userId)!;
    const sock = await connect(h, support.accessToken);
    const me = nextEvent(sock, 'platform:changed', (e) => e.area === 'me');
    expect((await as(owner, 'DELETE', `/v1/platform/admins/${sam.adminId}`)).status).toBe(200);
    await me;
    sock.close();
    expect((await as(support, 'GET', '/v1/platform/me')).status).toBe(403);
  });
});
