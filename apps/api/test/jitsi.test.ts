import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jwtVerify } from 'jose';
import type {
  Call,
  CallJoinResponse,
  CallsConfig,
  Conversation,
  IntegrationTestResult,
  Session,
} from '@sampledge/contracts';
import { CallsService } from '../src/calls/calls.service.js';
import { api, inviteAndLogin, registerTenant, startHarness, type Harness } from './harness.js';

const SECRET = 'jitsi-test-secret-jitsi-test-secret-0123';
const SERVER = 'https://meet.example.test';

let h: Harness;
let owner: Session;
let ravi: Session;
let group: Conversation;

const saveJitsi = (s: Session, values: Record<string, unknown>, enabled = true) =>
  api(h, 'PUT', '/v1/admin/integrations/jitsi', {
    token: s.accessToken,
    body: { enabled, values },
  });

beforeAll(async () => {
  h = await startHarness();
  const t = await registerTenant(h);
  owner = t.session;
  ravi = await inviteAndLogin(h, owner, t.slug, 'Ravi Kumar');
  const g = await api<Conversation>(h, 'POST', '/v1/conversations', {
    token: owner.accessToken,
    body: { kind: 'dm', memberIds: [ravi.user.userId] },
  });
  group = g.body;
});
afterAll(async () => {
  await h.close();
});

describe('Jitsi Meet call engine', () => {
  it('refuses the public meet.jit.si server in Test connection', async () => {
    const res = await api<IntegrationTestResult>(h, 'POST', '/v1/admin/integrations/jitsi/test', {
      token: owner.accessToken,
      body: { values: { serverUrl: 'https://meet.jit.si', appId: 'x', appSecret: 'y' } },
    });
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toMatch(/public server/);
  });

  it('switches the organization to Jitsi once it is saved, and signs a join for the room', async () => {
    const before = await api<CallsConfig>(h, 'GET', '/v1/calls/config', {
      token: owner.accessToken,
    });
    expect(before.body).toMatchObject({ enabled: false, provider: null });

    expect(
      (await saveJitsi(owner, { serverUrl: SERVER, appId: 'sampconnect', appSecret: SECRET }))
        .status,
    ).toBe(200);
    const cfg = await api<CallsConfig>(h, 'GET', '/v1/calls/config', { token: ravi.accessToken });
    expect(cfg.body).toMatchObject({
      enabled: true,
      provider: 'jitsi',
      recordingEnabled: false,
      captionsEnabled: false,
    });

    const res = await api<CallJoinResponse>(
      h,
      'POST',
      `/v1/conversations/${group.conversationId}/calls`,
      { token: owner.accessToken, body: { media: 'audio' } },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { call, join } = res.body;
    expect(join.engine).toBe('jitsi');
    const tenant = owner.tenant.tenantId.toLowerCase();
    const url = new URL(join.url);
    expect(`${url.origin}${url.pathname}`).toBe(`${SERVER}/${tenant}/${call.callId}`);
    expect(url.searchParams.get('jwt')).toBe(join.token);
    // Overrides in the hash: no pre-join page or app promotion, audio calls start camera-off.
    const hash = new URLSearchParams(url.hash.slice(1));
    expect(hash.get('config.startWithVideoMuted')).toBe('true');
    expect(hash.get('config.disableDeepLinking')).toBe('true');
    expect(hash.get('jitsi_meet_external_api_id')).toBe('0');

    const { payload } = await jwtVerify(join.token, new TextEncoder().encode(SECRET), {
      issuer: 'sampconnect',
      audience: 'sampconnect',
    });
    expect(payload.sub).toBe(tenant);
    expect(payload.room).toBe(call.callId);
    expect(payload.context).toMatchObject({
      user: { id: owner.user.userId, moderator: 'true' },
    });
    expect(payload.exp! - payload.iat!).toBeGreaterThanOrEqual(3600);
  });

  it('keeps people in the call while their app reports presence, and ends it when they go quiet', async () => {
    const live = (
      await api<{ call: Call }>(
        h,
        'GET',
        `/v1/conversations/${group.conversationId}/calls/active`,
        {
          token: owner.accessToken,
        },
      )
    ).body.call!;
    const joined = await api<CallJoinResponse>(h, 'POST', `/v1/calls/${live.callId}/join`, {
      token: ravi.accessToken,
    });
    expect(joined.body.join.engine).toBe('jitsi');

    const svc = h.app.get(CallsService);
    const t0 = Date.now();
    // 40 s later both are still confirming: nothing changes.
    await api(h, 'POST', `/v1/calls/${live.callId}/presence`, { token: owner.accessToken });
    await api(h, 'POST', `/v1/calls/${live.callId}/presence`, { token: ravi.accessToken });
    await svc.sweep(new Date(t0 + 40_000));
    let call = (await api<Call>(h, 'GET', `/v1/calls/${live.callId}`, { token: owner.accessToken }))
      .body;
    expect(call.status).toBe('live');
    expect(call.participants.filter((p) => p.state === 'joined')).toHaveLength(2);

    // Recording belongs to SampConnect's own call screen, not Jitsi calls.
    const rec = await api<{ error: { code: string } }>(
      h,
      'POST',
      `/v1/calls/${live.callId}/recording/start`,
      { token: owner.accessToken },
    );
    expect(rec.status).toBeGreaterThanOrEqual(400);

    // Two minutes of silence (tabs closed): both are marked as left and the call ends.
    await svc.sweep(new Date(t0 + 120_000));
    call = (await api<Call>(h, 'GET', `/v1/calls/${live.callId}`, { token: owner.accessToken }))
      .body;
    expect(call.status).toBe('ended');
  });

  it('serves the organization’s logo and colours to the Jitsi page, with CORS', async () => {
    await api(h, 'PUT', '/v1/branding', {
      token: owner.accessToken,
      body: { primary: '#0EA5E9', secondary: '#F59E0B', appName: 'Acme Connect' },
    });
    const tenant = owner.tenant.tenantId.toLowerCase();
    const res = await fetch(
      `${h.url}/v1/calls/jitsi/branding?conferenceFqn=${encodeURIComponent(`${tenant}/abc`)}`,
    );
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await res.json()) as {
      customTheme: { palette: { action01: string } };
      labels: { appName: string };
    };
    expect(body.customTheme.palette.action01.toLowerCase()).toBe('#0ea5e9');
    expect(body.labels.appName).toBe('Acme Connect');

    // An unknown organization gets SampConnect's defaults, not an error.
    const other = await fetch(`${h.url}/v1/calls/jitsi/branding?conferenceFqn=nope/abc`);
    expect(other.status).toBe(200);
  });

  it('goes back to LiveKit (or off) when Jitsi is switched off', async () => {
    await saveJitsi(owner, { serverUrl: SERVER, appId: 'sampconnect' }, false);
    const cfg = await api<CallsConfig>(h, 'GET', '/v1/calls/config', { token: owner.accessToken });
    expect(cfg.body).toMatchObject({ enabled: false, provider: null });
  });
});
