import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminOverview, AuditPage, BillingPlan, Session } from '@sampledge/contracts';
import { AuditService } from '../src/audit/audit.service.js';
import { PlatformAdmins } from '../src/common/platform-admins.js';
import {
  api,
  device,
  inviteAndLogin,
  registerTenant,
  startHarness,
  type Harness,
} from './harness.js';

let h: Harness;
let owner: Session;
let ravi: Session;
let slug: string;

const page = (q = '') =>
  api<AuditPage>(h, 'GET', `/v1/admin/audit${q}`, { token: owner.accessToken });

beforeAll(async () => {
  h = await startHarness();
  const t = await registerTenant(h, 'Northwind Research');
  owner = t.session;
  slug = t.slug;
  ravi = await inviteAndLogin(h, owner, slug, 'Ravi Kumar');
  await inviteAndLogin(h, owner, slug, 'Mia Chen', 'admin');
  // A failed sign-in whose "email" looks like a spreadsheet formula.
  await api(h, 'POST', '/v1/auth/login', {
    body: {
      tenantSlug: slug,
      email: 'x@y.test',
      password: '=HYPERLINK("http://evil")',
      device: device(),
    },
  });
  await api(h, 'POST', '/v1/auth/login', {
    body: {
      tenantSlug: slug,
      email: ravi.user.email,
      password: 'wrong password!',
      device: device(),
    },
  });
});
afterAll(async () => {
  await h?.close();
});

describe('administration', () => {
  it('members can’t see the overview or the audit log', async () => {
    expect((await api(h, 'GET', '/v1/admin/overview', { token: ravi.accessToken })).status).toBe(
      403,
    );
    expect((await api(h, 'GET', '/v1/admin/audit', { token: ravi.accessToken })).status).toBe(403);
    expect(
      (await api(h, 'GET', '/v1/admin/audit/export', { token: ravi.accessToken })).status,
    ).toBe(403);
  });

  it('summarizes the organization', async () => {
    const r = await api<AdminOverview>(h, 'GET', '/v1/admin/overview', {
      token: owner.accessToken,
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      organization: { name: 'Northwind Research', slug },
      members: {
        total: 3,
        active: 3,
        byRole: { owner: 1, admin: 1, member: 1, guest: 0 },
        twoStepOn: 0,
      },
      plan: { name: null, status: 'none' },
      signIn: { ssoEnabled: false, passwordLogin: true },
    });
    expect(r.body.devices.active).toBeGreaterThanOrEqual(3);
    expect(r.body.security.map((e) => e.action)).toContain('auth.login_failed');
  });

  it('lists the audit log with names, labels and categories', async () => {
    const r = await page('?limit=100');
    const invited = r.body.items.find((e) => e.action === 'member.invited')!;
    expect(invited).toMatchObject({
      label: 'Added a member',
      category: 'members',
      actor: { userId: owner.user.userId, name: 'Priya Owner' },
    });
    expect(invited.target?.name).toMatch(/Ravi Kumar|Mia Chen/);
  });

  it('filters by category, person and text', async () => {
    const signIn = await page('?category=sign-in&limit=100');
    expect(signIn.body.items.length).toBeGreaterThan(0);
    expect(signIn.body.items.every((e) => e.category === 'sign-in')).toBe(true);
    const mine = await page(`?actorId=${ravi.user.userId}`);
    expect(mine.body.items.every((e) => e.actor?.userId === ravi.user.userId)).toBe(true);
    const failed = await page('?q=login_failed');
    expect(failed.body.items.map((e) => e.action)).toEqual([
      'auth.login_failed',
      'auth.login_failed',
    ]);
    expect((await page('?category=nonsense')).status).toBe(400);
  });

  it('pages without gaps or repeats', async () => {
    const all = (await page('?limit=200')).body.items.map((e) => e.id);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const r: { body: AuditPage } = await page(`?limit=3${cursor ? `&before=${cursor}` : ''}`);
      seen.push(...r.body.items.map((e) => e.id));
      cursor = r.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual(all);
  });

  it('exports CSV safely and records the export', async () => {
    // A value that a spreadsheet would run as a formula.
    await h.app.get(AuditService).record({
      tenantId: owner.tenant.tenantId,
      actorId: null,
      action: 'auth.login_failed',
      target: { type: 'device', id: '=HYPERLINK("http://evil.test","x")' },
    });
    const res = await fetch(`${h.url}/v1/admin/audit/export?category=sign-in`, {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
    expect(res.headers.get('content-disposition')).toMatch(/audit-log-\d{4}-\d{2}-\d{2}\.csv/);
    const csv = await res.text();
    expect(csv.split('\r\n')[0]).toContain('time,action,description');
    expect(csv).toContain('"Failed sign-in"');
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.test"",""x"")"`);
    expect(csv).not.toMatch(/,"=/);
    const latest = (await page('?limit=1')).body.items[0]!;
    expect(latest).toMatchObject({ action: 'audit.exported', label: 'Exported the audit log' });
    expect(latest.metadata.rows).toBeGreaterThan(0);
  });

  it('publishes public plans for the website without sign-in', async () => {
    (h.app.get(PlatformAdmins) as unknown as { emails: Set<string> }).emails.add(owner.user.email);
    const body = (name: string, pub: boolean) => ({
      name,
      currency: 'usd',
      monthlyPerSeat: 800,
      yearlyPerSeat: null,
      limits: { seats: null, storageGb: null, recordingHours: null },
      public: pub,
    });
    await api(h, 'POST', '/v1/platform/billing/plans', {
      token: owner.accessToken,
      body: body('Team', true),
    });
    await api(h, 'POST', '/v1/platform/billing/plans', {
      token: owner.accessToken,
      body: body('Secret', false),
    });
    const r = await api<BillingPlan[]>(h, 'GET', '/v1/billing/plans');
    expect(r.status).toBe(200);
    expect(r.body.map((p) => p.name)).toEqual(['Team']);
  });
});
