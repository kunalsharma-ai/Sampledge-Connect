import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Session, UserSummary } from '@sampledge/contracts';
import {
  api,
  connect,
  inviteAndLogin,
  nextEvent,
  registerTenant,
  startHarness,
  type ClientSocket,
  type Harness,
} from './harness.js';

let h: Harness;
let owner: Session;
let ravi: Session;
let raviSocket: ClientSocket;

// 1x1 PNG and a minimal JPEG/WebP header are enough: the server checks the bytes, not the label.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const dataUrl = (b: Buffer, type = 'png') => `data:image/${type};base64,${b.toString('base64')}`;

beforeAll(async () => {
  h = await startHarness();
  const t = await registerTenant(h, 'Profiles Co');
  owner = t.session;
  ravi = await inviteAndLogin(h, owner, t.slug, 'Ravi Kumar');
  raviSocket = await connect(h, ravi.accessToken);
});
afterAll(async () => {
  raviSocket?.disconnect();
  await h?.close();
});

describe('profile', () => {
  it('edits name, title, department, phone, bio and time zone; everyone sees it live', async () => {
    const live = nextEvent(raviSocket, 'directory:updated', (e) => e.userId === owner.user.userId);
    const r = await api<UserSummary>(h, 'PATCH', '/v1/me/profile', {
      token: owner.accessToken,
      body: {
        displayName: 'Priya Raman',
        title: 'Research Director',
        department: 'Fieldwork',
        phone: '+91 98765 43210',
        bio: 'Runs fieldwork across APAC.',
        timeZone: 'Asia/Kolkata',
      },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      displayName: 'Priya Raman',
      title: 'Research Director',
      department: 'Fieldwork',
      phone: '+91 98765 43210',
      bio: 'Runs fieldwork across APAC.',
      timeZone: 'Asia/Kolkata',
      avatarUrl: null,
    });
    await live;
    const dir = await api<UserSummary[]>(h, 'GET', '/v1/users', { token: ravi.accessToken });
    expect(dir.body.find((u) => u.userId === owner.user.userId)).toMatchObject({
      displayName: 'Priya Raman',
      department: 'Fieldwork',
    });
    const card = await api<UserSummary>(h, 'GET', `/v1/users/${owner.user.userId}`, {
      token: ravi.accessToken,
    });
    expect(card.body.bio).toBe('Runs fieldwork across APAC.');
  });

  it('clears fields with empty text and rejects bad input', async () => {
    const r = await api<UserSummary>(h, 'PATCH', '/v1/me/profile', {
      token: owner.accessToken,
      body: { bio: '', phone: null },
    });
    expect(r.body).toMatchObject({ bio: null, phone: null, title: 'Research Director' });
    for (const body of [
      { timeZone: 'Mars/Olympus' },
      { displayName: '' },
      { phone: 'call me' },
      { role: 'owner' },
      { email: 'x@evil.test' },
    ])
      expect(
        (await api(h, 'PATCH', '/v1/me/profile', { token: ravi.accessToken, body })).status,
      ).toBe(400);
  });
});

describe('profile photo', () => {
  it('uploads, serves publicly by key, replaces and removes', async () => {
    const live = nextEvent(raviSocket, 'directory:updated', (e) => e.userId === owner.user.userId);
    const set = await api<UserSummary>(h, 'PUT', '/v1/me/avatar', {
      token: owner.accessToken,
      body: { image: dataUrl(PNG) },
    });
    expect(set.status).toBe(200);
    expect(set.body.avatarUrl).toMatch(/^\/v1\/avatars\/[a-f0-9]{24}\/[a-f0-9]{32}$/);
    await live;

    const img = await fetch(h.url + set.body.avatarUrl);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(img.headers.get('cache-control')).toContain('immutable');
    expect(Buffer.from(await img.arrayBuffer()).equals(PNG)).toBe(true);

    // A new photo gets a new key; the old URL stops working.
    const again = await api<UserSummary>(h, 'PUT', '/v1/me/avatar', {
      token: owner.accessToken,
      body: { image: dataUrl(PNG) },
    });
    expect(again.body.avatarUrl).not.toBe(set.body.avatarUrl);
    expect((await fetch(h.url + set.body.avatarUrl)).status).toBe(404);

    const removed = await api<UserSummary>(h, 'DELETE', '/v1/me/avatar', {
      token: owner.accessToken,
    });
    expect(removed.body.avatarUrl).toBeNull();
    expect((await fetch(h.url + again.body.avatarUrl)).status).toBe(404);
  });

  it('refuses files that are not PNG, JPEG or WebP, whatever they claim to be', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    for (const image of [
      dataUrl(html, 'png'),
      `data:image/svg+xml;base64,${svg.toString('base64')}`,
      'not a data url',
    ])
      expect(
        (await api(h, 'PUT', '/v1/me/avatar', { token: ravi.accessToken, body: { image } }))
          .status,
      ).toBe(400);
    const big = Buffer.concat([PNG, Buffer.alloc(170 * 1024)]);
    expect(
      (
        await api(h, 'PUT', '/v1/me/avatar', {
          token: ravi.accessToken,
          body: { image: dataUrl(big) },
        })
      ).status,
    ).toBe(400);
  });

  it('does not serve another organization’s photo under a different tenant id', async () => {
    const set = await api<UserSummary>(h, 'PUT', '/v1/me/avatar', {
      token: ravi.accessToken,
      body: { image: dataUrl(PNG) },
    });
    const key = set.body.avatarUrl!.split('/').pop();
    expect((await fetch(`${h.url}/v1/avatars/0123456789abcdef01234567/${key}`)).status).toBe(404);
  });
});
