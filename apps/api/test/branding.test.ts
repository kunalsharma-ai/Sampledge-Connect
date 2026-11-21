import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BrandingView, PublicBranding, Session, TotpSetup } from '@sampledge/contracts';
import { api, inviteAndLogin, registerTenant, startHarness, type Harness } from './harness.js';

let h: Harness;
let owner: Session;
let ravi: Session;
let slug: string;
// 1×1 transparent PNG
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const svg = (body: string) =>
  `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`).toString('base64')}`;
const put = (s: Session, body: unknown) =>
  api<BrandingView>(h, 'PUT', '/v1/branding', { token: s.accessToken, body });

beforeAll(async () => {
  h = await startHarness();
  const t = await registerTenant(h, 'Northwind Research');
  owner = t.session;
  slug = t.slug;
  ravi = await inviteAndLogin(h, owner, slug, 'Ravi Kumar');
});
afterAll(async () => {
  await h?.close();
});

describe('white-label branding', () => {
  it('starts with the product name and default colors', async () => {
    const r = await api<BrandingView>(h, 'GET', '/v1/branding', { token: owner.accessToken });
    expect(r.body).toMatchObject({
      displayName: 'Sampledge Connect',
      appName: null,
      logo: null,
      organizationName: 'Northwind Research',
      enforceTheme: false,
      canManage: true,
      updatedAt: null,
    });
    expect(
      (await api<BrandingView>(h, 'GET', '/v1/branding', { token: ravi.accessToken })).body
        .canManage,
    ).toBe(false);
  });

  it('only the owner can change it, and inputs are checked', async () => {
    expect((await put(ravi, { appName: 'Hijack' })).status).toBe(403);
    expect((await put(owner, { primary: 'red' })).status).toBe(400);
    expect((await put(owner, { logo: 'https://example.com/logo.png' })).status).toBe(400);
    expect((await put(owner, { logo: svg('<script>alert(1)</script>') })).status).toBe(400);
    expect((await put(owner, { logo: svg('<rect onload="x()"/>') })).status).toBe(400);
    const big = `data:image/png;base64,${Buffer.alloc(300 * 1024, 1).toString('base64')}`;
    expect((await put(owner, { logo: big })).status).toBe(400);
  });

  it('saves the brand and everyone in the organization gets it', async () => {
    const r = await put(owner, {
      appName: 'Northwind Connect',
      logo: PNG,
      primary: '#0F766E',
      secondary: '#F59E0B',
      mode: 'light',
      useBrandTheme: true,
      enforceTheme: true,
      loginMessage: 'Use your Northwind email.',
      supportEmail: 'IT@northwind.example',
      hidePoweredBy: true,
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      displayName: 'Northwind Connect',
      supportEmail: 'it@northwind.example',
      enforceTheme: true,
    });
    const member = await api<BrandingView>(h, 'GET', '/v1/branding', { token: ravi.accessToken });
    expect(member.body).toMatchObject({
      displayName: 'Northwind Connect',
      logo: PNG,
      mode: 'light',
    });
  });

  it('shows only safe fields on the sign-in page', async () => {
    const r = await api<PublicBranding>(h, 'GET', `/v1/branding/public/${slug}`);
    expect(r.body).toEqual({
      organizationName: 'Northwind Research',
      displayName: 'Northwind Connect',
      logo: PNG,
      primary: '#0F766E',
      secondary: '#F59E0B',
      mode: 'light',
      loginMessage: 'Use your Northwind email.',
      hidePoweredBy: true,
    });
    expect((await api(h, 'GET', '/v1/branding/public/no-such-workspace')).status).toBe(404);
  });

  it('names authenticator entries after the brand', async () => {
    const s = await api<TotpSetup>(h, 'POST', '/v1/auth/mfa/totp/setup', {
      token: ravi.accessToken,
    });
    expect(decodeURIComponent(s.body.otpauthUrl)).toContain(
      'otpauth://totp/Northwind Connect (Northwind Research):',
    );
  });

  it('records the change in the audit log', async () => {
    const r = await api<{ action: string; metadata: { changed: string[] } }[]>(
      h,
      'GET',
      '/v1/audit-logs?limit=20',
      { token: owner.accessToken },
    );
    const e = r.body.find((x) => x.action === 'tenant.branding_updated');
    expect(e?.metadata.changed).toEqual(expect.arrayContaining(['appName', 'logo', 'primary']));
  });
});
