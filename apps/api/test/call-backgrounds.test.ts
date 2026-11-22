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
const postImage = (
  s: Session,
  bytes: Buffer,
  name = 'mine.png',
  type = 'image/png',
  path = '/v1/me/call-backgrounds',
) =>
  fetch(`${h.url}${path}?name=${name}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${s.accessToken}`, 'content-type': type },
    body: bytes,
  });
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

  it('keeps several of my own images, serves them by unguessable links, and removes them', async () => {
    const ev = nextEvent(raviSocket, 'meetings:changed', (e) => e.area === 'call_background');
    const res = await postImage(ravi, PNG, 'Lake%20house.png');
    expect(res.status).toBe(201);
    const s = (await res.json()) as CallBackgroundState;
    expect(s.uploads).toHaveLength(1);
    const first = s.uploads[0]!;
    expect(first).toMatchObject({ owner: 'mine', name: 'Lake house' });
    expect(first.url).toMatch(/^\/v1\/call-backgrounds\/[a-f0-9]{24}\/[a-f0-9]{32}$/);
    expect(s.choice).toEqual({ kind: 'upload', imageId: first.imageId });
    expect(s.customImageUrl).toBe(first.url);
    await ev;
    const img = await fetch(h.url + first.url);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await img.arrayBuffer()).equals(PNG)).toBe(true);
    // Not an image, or too big.
    expect((await postImage(ravi, Buffer.from('hello'))).status).toBe(400);
    expect(
      (await postImage(ravi, Buffer.alloc(2 * 1024 * 1024 + 10, 1), 'big.jpg', 'image/jpeg'))
        .status,
    ).toBe(400);
    // A second image is added (the first stays), via the older PUT route too.
    const again = (await (await putImage(ravi, PNG)).json()) as CallBackgroundState;
    expect(again.uploads.map((u) => u.owner)).toEqual(['mine', 'mine']);
    const second = again.uploads[0]!;
    expect(again.choice).toEqual({ kind: 'upload', imageId: second.imageId });
    // Going back to the first one; someone else's image can't be picked.
    const back = await api<CallBackgroundState>(h, 'PUT', '/v1/me/call-background', {
      token: ravi.accessToken,
      body: { kind: 'upload', imageId: first.imageId },
    });
    expect(back.body.effective).toEqual({ kind: 'upload', imageId: first.imageId });
    expect(
      (
        await api(h, 'PUT', '/v1/me/call-background', {
          token: owner.accessToken,
          body: { kind: 'upload', imageId: first.imageId },
        })
      ).status,
    ).toBe(400);
    // Removing the one in use falls back to the default; its link stops working.
    const removed = await api<CallBackgroundState>(
      h,
      'DELETE',
      `/v1/me/call-backgrounds/${first.imageId}`,
      { token: ravi.accessToken },
    );
    expect(removed.body.uploads.map((u) => u.imageId)).toEqual([second.imageId]);
    expect(removed.body.choice).toBeNull();
    expect((await fetch(h.url + first.url)).status).toBe(404);
    // The older DELETE removes my most recent image.
    const none = await api<CallBackgroundState>(h, 'DELETE', '/v1/me/call-background/image', {
      token: ravi.accessToken,
    });
    expect(none.body.uploads).toEqual([]);
    expect(none.body.customImageUrl).toBeNull();
  });

  it('admins keep a company library everyone can pick from, and can make one the default', async () => {
    expect(
      (await postImage(ravi, PNG, 'x.png', 'image/png', '/v1/admin/call-backgrounds/images'))
        .status,
    ).toBe(403);
    const ev = nextEvent(raviSocket, 'tenant:updated', (e) => e.area === 'calls');
    const add = await postImage(
      owner,
      PNG,
      'HQ lobby.png',
      'image/png',
      '/v1/admin/call-backgrounds/images',
    );
    expect(add.status).toBe(201);
    await ev;
    const lib = ((await add.json()) as CallBackgroundState).uploads.filter(
      (u) => u.owner === 'organization',
    );
    expect(lib).toHaveLength(1);
    expect(lib[0]!.name).toBe('HQ lobby');
    const hq = lib[0]!.imageId;
    // Ravi sees it and can pick it.
    const r = await state(ravi);
    expect(r.uploads.find((u) => u.imageId === hq)?.owner).toBe('organization');
    const picked = await api<CallBackgroundState>(h, 'PUT', '/v1/me/call-background', {
      token: ravi.accessToken,
      body: { kind: 'upload', imageId: hq },
    });
    expect(picked.body.effective).toEqual({ kind: 'upload', imageId: hq });
    // It can be the organization default; a personal image can't.
    const mine = ((await (await postImage(owner, PNG)).json()) as CallBackgroundState).uploads.find(
      (u) => u.owner === 'mine',
    )!;
    expect(
      (
        await api(h, 'PUT', '/v1/admin/call-backgrounds', {
          token: owner.accessToken,
          body: { defaultChoice: { kind: 'upload', imageId: mine.imageId } },
        })
      ).status,
    ).toBe(400);
    const def = await api<CallBackgroundState>(h, 'PUT', '/v1/admin/call-backgrounds', {
      token: owner.accessToken,
      body: { defaultChoice: { kind: 'upload', imageId: hq } },
    });
    expect(def.status).toBe(200);
    // Removing it clears the default and anyone's choice of it.
    const del = await api<CallBackgroundState>(
      h,
      'DELETE',
      `/v1/admin/call-backgrounds/images/${hq}`,
      {
        token: owner.accessToken,
      },
    );
    expect(del.body.policy.defaultChoice).toEqual({ kind: 'none' });
    const after = await state(ravi);
    expect(after.choice).toBeNull();
    expect(after.uploads.some((u) => u.imageId === hq)).toBe(false);
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

  it('saves how I look on camera, keeps my background, and tells my devices', async () => {
    const before = await state(owner);
    expect(before.appearance).toMatchObject({ filter: 'natural', brightness: 0, smoothing: 0 });
    const ev = nextEvent(raviSocket, 'meetings:changed', (e) => e.area === 'call_background');
    const res = await api<CallBackgroundState>(h, 'PUT', '/v1/me/call-appearance', {
      token: ravi.accessToken,
      body: { filter: 'mono', brightness: 20, smoothing: 60, faceSlim: 30 },
    });
    expect(res.status).toBe(200);
    expect(res.body.appearance).toEqual({
      filter: 'mono',
      brightness: 20,
      contrast: 0,
      saturation: 0,
      warmth: 0,
      lowLight: 0,
      sharpness: 0,
      smoothing: 60,
      faceSlim: 30,
      eyes: 0,
      nose: 0,
    });
    await ev;
    const s = await state(ravi);
    expect(s.appearance.filter).toBe('mono');
    expect(s.choice).not.toBeNull();
    // Out of range, unknown filters and fractions are refused.
    for (const body of [
      { brightness: 101 },
      { filter: 'sparkle' },
      { smoothing: -1 },
      { eyes: 1.5 },
    ])
      expect(
        (await api(h, 'PUT', '/v1/me/call-appearance', { token: ravi.accessToken, body })).status,
      ).toBe(400);
    // Saving a look never changes the background.
    const fresh = await api<CallBackgroundState>(h, 'PUT', '/v1/me/call-appearance', {
      token: owner.accessToken,
      body: { warmth: -40 },
    });
    expect(fresh.body.appearance.warmth).toBe(-40);
    expect(fresh.body.choice).toEqual(before.choice);
    await api(h, 'PUT', '/v1/me/call-appearance', { token: owner.accessToken, body: {} });
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
