import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChatThemeState, Session } from '@sampledge/contracts';
import {
  api,
  connect,
  inviteAndLogin,
  nextEvent,
  registerTenant,
  startHarness,
  type Harness,
} from './harness.js';

let h: Harness;
let owner: Session;
let ravi: Session;

beforeAll(async () => {
  h = await startHarness();
  const t = await registerTenant(h);
  owner = t.session;
  ravi = await inviteAndLogin(h, owner, t.slug, 'Ravi Kumar');
});
afterAll(() => h.close());

const state = async (s: Session) =>
  (await api<ChatThemeState>(h, 'GET', '/v1/me/chat-theme', { token: s.accessToken })).body;

describe('chat themes', () => {
  it('starts on the app theme and syncs a choice to your other devices', async () => {
    expect(await state(ravi)).toMatchObject({ themeId: null, effective: 'default' });
    const sock = await connect(h, ravi.accessToken);
    const live = nextEvent(sock, 'chat-theme:changed', (e) => e.themeId === 'library');
    const r = await api<ChatThemeState>(h, 'PUT', '/v1/me/chat-theme', {
      token: ravi.accessToken,
      body: { themeId: 'library' },
    });
    expect(r.status).toBe(200);
    expect(r.body.effective).toBe('library');
    await live;
    expect((await state(ravi)).themeId).toBe('library');
    // Only your own: someone else still sees their own default.
    expect((await state(owner)).effective).toBe('default');
    sock.disconnect();
  });

  it('lets admins set the default and limit the choice', async () => {
    const member = await api(h, 'PUT', '/v1/admin/chat-themes', {
      token: ravi.accessToken,
      body: { defaultThemeId: 'boardroom', allowed: ['boardroom'] },
    });
    expect(member.status).toBe(403);

    const sock = await connect(h, ravi.accessToken);
    const live = nextEvent(sock, 'tenant:updated', (e) => e.area === 'chat_themes');
    const r = await api<ChatThemeState>(h, 'PUT', '/v1/admin/chat-themes', {
      token: owner.accessToken,
      body: { defaultThemeId: 'executive-navy', allowed: ['blueprint', 'skyline-office'] },
    });
    expect(r.status).toBe(200);
    // The default is always allowed.
    expect(r.body.policy.allowed).toEqual(['executive-navy', 'blueprint', 'skyline-office']);
    await live;
    // Ravi's earlier pick is no longer offered: he sees the default, his choice is kept.
    expect(await state(ravi)).toMatchObject({ themeId: 'library', effective: 'executive-navy' });
    const refused = await api(h, 'PUT', '/v1/me/chat-theme', {
      token: ravi.accessToken,
      body: { themeId: 'library' },
    });
    expect(refused.status).toBe(400);
    expect(
      (
        await api(h, 'PUT', '/v1/me/chat-theme', {
          token: ravi.accessToken,
          body: { themeId: 'blueprint' },
        })
      ).status,
    ).toBe(200);
    sock.disconnect();
  });

  it('rejects unknown themes', async () => {
    const r = await api(h, 'PUT', '/v1/me/chat-theme', {
      token: ravi.accessToken,
      body: { themeId: 'neon-party' },
    });
    expect(r.status).toBe(400);
  });
});
