import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CallBackgroundState, Session } from '@sampledge/contracts';
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

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const state = async (s: Session) =>
  (await api<CallBackgroundState>(h, 'GET', '/v1/me/call-background', { token: s.accessToken }))
    .body;
const putImage = (s: Session, bytes: Buffer, type = 'image/png') =>
  fetch(h.url + '/v1/me/call-background/image', {
    method: 'PUT',
    headers: { authorization: `Bearer ${s.accessToken}`, 'content-type': type },
    body: bytes,
  });

beforeAll(async () => {
  h = await startHarness();
  const t = await registerTenant(h);
  owner = t.session;
  ravi = await inviteAndLogin(h, owner, t.slug, 'Ravi Kumar');
  raviSocket = await connect(h, ravi.accessToken);
});
afterAll(async () => {
  raviSocket?.disconnect();
  await h?.close();
});

describe('call backgrounds', () => {
  it('starts with no choice and the organization default', async () => {
    const s = await state(ravi);
    expect(s.choice).toBeNull();
    expect(s.effective).toEqual({ kind: 'none' });
    expect(s.customImageUrl).toBeNull();
    expect(s.policy).toEqual({
      defaultChoice: { kind: 'none' },
      enforceLogo: false,
      canManage: false,
    });
    expect(s.brand.primary).toMatch(/^#/);
  });

  it('saves my choice and tells all my devices', async () => {
    const ev = nextEvent(raviSocket, 'meetings:changed', (e) => e.area === 'call_background');
    const res = await api<CallBackgroundState>(h, 'PUT', '/v1/me/call-background', {
      token: ravi.accessToken,
      body: { kind: 'preset', presetId: 'library' },
    });
    expect(res.status).toBe(200);
    expect(res.body.effective).toEqual({ kind: 'preset', presetId: 'library' });
    await ev;
    expect((await state(ravi)).choice).toEqual({ kind: 'preset', presetId: 'library' });
    // Unknown presets and a personal image that doesn't exist are refused.
    for (const body of [{ kind: 'preset', presetId: 'nope' }, { kind: 'custom' }, { kind: 'x' }])
      expect(
        (await api(h, 'PUT', '/v1/me/call-background', { token: ravi.accessToken, body })).status,
      ).toBe(400);
  });

  it('uploads my own image, serves it by an unguessable link, and removes it', async () => {
    const ev = nextEvent(raviSocket, 'meetings:changed', (e) => e.area === 'call_background');
    const res = await putImage(ravi, PNG);
    expect(res.status).toBe(200);
    const s = (await res.json()) as CallBackgroundState;
    expect(s.choice).toEqual({ kind: 'custom' });
    expect(s.customImageUrl).toMatch(/^\/v1\/call-backgrounds\/[a-f0-9]{24}\/[a-f0-9]{32}$/);
    await ev;
    const img = await fetch(h.url + s.customImageUrl!);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await img.arrayBuffer()).equals(PNG)).toBe(true);
    // Not an image, or too big.
    expect((await putImage(ravi, Buffer.from('hello'), 'image/png')).status).toBe(400);
    expect((await putImage(ravi, Buffer.alloc(2 * 1024 * 1024 + 10, 1), 'image/jpeg')).status).toBe(
      400,
    );
    // A new image replaces the old one; the old link stops working.
    const again = (await (await putImage(ravi, PNG)).json()) as CallBackgroundState;
    expect(again.customImageUrl).not.toBe(s.customImageUrl);
    expect((await fetch(h.url + s.customImageUrl!)).status).toBe(404);
    const removed = await api<CallBackgroundState>(h, 'DELETE', '/v1/me/call-background/image', {
      token: ravi.accessToken,
    });
    expect(removed.body.customImageUrl).toBeNull();
    expect(removed.body.choice).toBeNull();
    expect((await fetch(h.url + again.customImageUrl!)).status).toBe(404);
  });

  it('admins set the default and can require the company logo', async () => {
    expect(
      (
        await api(h, 'PUT', '/v1/admin/call-backgrounds', {
          token: ravi.accessToken,
          body: { enforceLogo: true },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api(h, 'PUT', '/v1/admin/call-backgrounds', {
          token: owner.accessToken,
          body: { defaultChoice: { kind: 'custom' } },
        })
      ).status,
    ).toBe(400);
    let ev = nextEvent(raviSocket, 'tenant:updated', (e) => e.area === 'calls');
    const set = await api<CallBackgroundState>(h, 'PUT', '/v1/admin/call-backgrounds', {
      token: owner.accessToken,
      body: { defaultChoice: { kind: 'blur' } },
    });
    expect(set.status).toBe(200);
    expect(set.body.policy.canManage).toBe(true);
    await ev;
    expect((await state(ravi)).effective).toEqual({ kind: 'blur' });

    ev = nextEvent(raviSocket, 'tenant:updated', (e) => e.area === 'calls');
    await api(h, 'PUT', '/v1/admin/call-backgrounds', {
      token: owner.accessToken,
      body: { defaultChoice: { kind: 'blur' }, enforceLogo: true },
    });
    await ev;
    await api(h, 'PUT', '/v1/me/call-background', {
      token: ravi.accessToken,
      body: { kind: 'none' },
    });
    const s = await state(ravi);
    expect(s.choice).toEqual({ kind: 'none' });
    expect(s.effective).toEqual({ kind: 'logo' });
  });

  it('attachment uploads with an image or audio type still stream through', async () => {
    // Regression guard: binary bodies are read per route, never by a global parser.
    for (const [bytes, mimeType] of [
      [PNG, 'image/png'],
      [Buffer.alloc(700 * 1024, 7), 'audio/webm'],
    ] as const) {
      const conv = await api<{ conversationId: string }>(h, 'POST', '/v1/conversations', {
        token: owner.accessToken,
        body: { kind: 'dm', memberIds: [ravi.user.userId] },
      });
      const t = await api<{ uploadId: string; uploadUrl: string }>(h, 'POST', '/v1/uploads', {
        token: owner.accessToken,
        body: {
          conversationId: conv.body.conversationId,
          fileName: mimeType.startsWith('audio') ? 'voice.webm' : 'pixel.png',
          mimeType,
          sizeBytes: bytes.length,
        },
      });
      expect(t.status).toBe(201);
      const put = await fetch(h.url + t.body.uploadUrl, {
        method: 'PUT',
        headers: { authorization: `Bearer ${owner.accessToken}`, 'content-type': mimeType },
        body: bytes,
      });
      expect(put.status).toBe(200);
    }
  });
});
