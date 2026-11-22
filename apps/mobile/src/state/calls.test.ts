import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Call, CallRingingEvent } from '@sampledge/contracts';
import { TransportError, type ApiTransport } from '../sync/transport';
import { CallController } from './calls';

const ME = 'u-me';
const PEER = 'u-peer';
const call = (over: Partial<Call> = {}): Call => ({
  callId: 'call-1',
  conversationId: 'c1',
  media: 'video',
  status: 'live',
  startedBy: PEER,
  startedAt: '2026-11-21T10:00:00.000Z',
  endedAt: null,
  participants: [
    { userId: PEER, state: 'joined', joinedAt: '2026-11-21T10:00:00.000Z', leftAt: null },
    { userId: ME, state: 'ringing', joinedAt: null, leftAt: null },
  ],
  ...over,
});
const ringing = (expiresInMs = 45_000): CallRingingEvent => ({
  call: call(),
  callerId: PEER,
  conversationId: 'c1',
  media: 'video',
  expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
});
const join = { url: 'ws://sfu', token: 't', expiresAt: '2026-11-21T10:10:00.000Z' };

function setup(over: Partial<Record<keyof ApiTransport, unknown>> = {}) {
  const actions: string[] = [];
  const api = {
    callsConfig: async () => ({ enabled: true, provider: 'livekit', ringTimeoutSeconds: 45 }),
    activeCalls: async () => [call()],
    joinCall: async () => ({ call: call({ participants: [] }), join }),
    startCall: async () => ({ call: call({ startedBy: ME }), join }),
    callAction: async (_id: string, a: string) => {
      actions.push(a);
      return call({ status: a === 'end' ? 'ended' : 'live' });
    },
    ...over,
  } as unknown as ApiTransport;
  const calls = new CallController(api, ME);
  // Drive socket events directly.
  const emit = calls as unknown as { ring(e: CallRingingEvent): void };
  return { calls, actions, ring: (e: CallRingingEvent) => emit.ring(e) };
}

describe('calls', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('loads config and live calls', async () => {
    const t = setup();
    await t.calls.refresh();
    expect(t.calls.state.config?.enabled).toBe(true);
    expect(t.calls.state.live.c1?.callId).toBe('call-1');
  });

  it('rings until it expires', () => {
    const t = setup();
    t.ring(ringing(5_000));
    expect(t.calls.state.incoming?.callerId).toBe(PEER);
    vi.advanceTimersByTime(5_001);
    expect(t.calls.state.incoming).toBeNull();
  });

  it('stops ringing when answered elsewhere or the call ends', () => {
    const t = setup();
    t.ring(ringing());
    t.calls.applyCall(
      call({
        participants: [
          { userId: PEER, state: 'joined', joinedAt: null, leftAt: null },
          { userId: ME, state: 'joined', joinedAt: null, leftAt: null },
        ],
      }),
    );
    expect(t.calls.state.incoming).toBeNull();
    t.ring(ringing());
    t.calls.applyCall(call({ status: 'ended' }));
    expect(t.calls.state.incoming).toBeNull();
    expect(t.calls.state.live.c1).toBeUndefined();
  });

  it('accepts into the call and leaves it', async () => {
    const t = setup();
    t.ring(ringing());
    const cur = await t.calls.accept();
    expect(cur?.join.token).toBe('t');
    expect(t.calls.state.incoming).toBeNull();
    expect(t.calls.state.current?.call.callId).toBe('call-1');
    await t.calls.leave();
    expect(t.calls.state.current).toBeNull();
    expect(t.actions).toEqual(['leave']);
  });

  it('declines', async () => {
    const t = setup();
    t.ring(ringing());
    await t.calls.decline();
    expect(t.actions).toEqual(['decline']);
    expect(t.calls.state.incoming).toBeNull();
  });

  it('closes the call screen when the call ends for everyone', async () => {
    const t = setup();
    await t.calls.start('c1', 'audio');
    t.calls.applyCall(call({ status: 'ended' }));
    expect(t.calls.state.current).toBeNull();
  });

  it('explains why a call could not start', async () => {
    const t = setup({
      startCall: async () => {
        throw new TransportError('offline', 'network');
      },
    });
    expect(await t.calls.start('c1', 'video')).toBeNull();
    expect(t.calls.state.error).toMatch(/offline/i);
  });

  it('starts and stops recording, and shows it to everyone from the call record', async () => {
    const rec = { status: 'active' as const, startedBy: ME, startedAt: '2026-11-21T10:01:00.000Z' };
    const asked: string[] = [];
    const t = setup({
      startCallRecording: async () => {
        asked.push('start');
        return call({ startedBy: ME, recording: rec });
      },
      stopCallRecording: async () => {
        asked.push('stop');
        return call({ startedBy: ME, recording: { ...rec, status: 'stopping' } });
      },
    });
    expect(await t.calls.setRecording(true)).toBe(false); // not in a call
    await t.calls.start('c1', 'video');
    expect(await t.calls.setRecording(true)).toBe(true);
    expect(t.calls.state.current?.call.recording?.status).toBe('active');
    await t.calls.setRecording(false);
    expect(t.calls.state.current?.call.recording?.status).toBe('stopping');
    // Someone else's device: the socket update carries the indicator.
    t.calls.applyCall(call({ startedBy: ME, recording: null }));
    expect(t.calls.state.current?.call.recording).toBeNull();
    expect(asked).toEqual(['start', 'stop']);
  });

  it('sends a caption clip for the call you are in', async () => {
    const sent: string[] = [];
    const t = setup({
      transcribeCaption: async (callId: string, clip: Blob) => {
        sent.push(`${callId} ${clip.type} ${clip.size}`);
        return { text: '  Hello team  ' };
      },
    });
    const clip = new Blob([new Uint8Array(10)], { type: 'audio/webm' });
    expect(await t.calls.transcribeCaption(clip)).toBe(''); // not in a call
    await t.calls.start('c1', 'video');
    expect(await t.calls.transcribeCaption(clip)).toBe('Hello team');
    expect(sent).toEqual([`${t.calls.state.current!.call.callId} audio/webm 10`]);
  });

  it('says why recording could not start', async () => {
    const t = setup({
      startCallRecording: async () => {
        throw new TransportError(
          'Call recording is turned off for your organization',
          'api',
          'FORBIDDEN',
        );
      },
    });
    await t.calls.start('c1', 'video');
    expect(await t.calls.setRecording(true)).toBe(false);
    expect(t.calls.state.error).toContain('turned off');
  });

  it('admits a guest from the lobby, and settles when someone else answered first', async () => {
    const waiting = {
      guestId: 'g1',
      meetingId: 'm1',
      name: 'Ana Ruiz',
      email: 'ana@client.com',
      requestedAt: '2026-11-21T10:02:00.000Z',
    };
    let conflict = false;
    const asked: string[] = [];
    const t = setup({
      startCall: async () => ({ call: call({ startedBy: ME, lobby: [waiting] }), join }),
      lobbyDecision: async (_c: string, g: string, d: string) => {
        asked.push(`${g}:${d}`);
        if (conflict) throw new TransportError('Already answered', 'api', 'CONFLICT');
        return call({
          startedBy: ME,
          lobby: [],
          guests: [{ ...waiting, state: 'admitted', decidedBy: ME, joinedAt: null }],
        });
      },
      getCall: async () => call({ startedBy: ME, lobby: [] }),
    });
    await t.calls.start('c1', 'video');
    expect(t.calls.state.current?.call.lobby).toHaveLength(1);
    expect(await t.calls.decideGuest('g1', 'admit')).toBe(true);
    expect(t.calls.state.current?.call.lobby).toEqual([]);
    expect(t.calls.state.current?.call.guests?.[0]?.state).toBe('admitted');

    conflict = true;
    expect(await t.calls.decideGuest('g1', 'deny')).toBe(false);
    expect(t.calls.state.error).toBeNull();
    expect(asked).toEqual(['g1:admit', 'g1:deny']);
  });
});
