import { describe, expect, it } from 'vitest';
import { isJitsiLeftEvent, readJitsiMessage } from './calls.js';

const msg = (o: object) =>
  JSON.stringify({ postis: true, scope: 'jitsi_meet_external_api_0', ...o });

describe('Jitsi page messages', () => {
  it('echoes the ready handshake with the same id and scope', () => {
    const { reply, event } = readJitsiMessage(msg({ method: '__ready__', params: '123.4' }));
    expect(event).toBeNull();
    expect(JSON.parse(reply!)).toEqual({
      postis: true,
      scope: 'jitsi_meet_external_api_0',
      method: '__ready__',
      params: '123.4',
    });
  });

  it('reads event names, and knows which ones mean the person left', () => {
    const left = readJitsiMessage(
      msg({
        method: 'message',
        params: { type: 'event', data: { name: 'video-conference-left' } },
      }),
    );
    expect(left).toEqual({ reply: null, event: 'video-conference-left' });
    expect(isJitsiLeftEvent(left.event)).toBe(true);
    expect(isJitsiLeftEvent('video-conference-joined')).toBe(false);
  });

  it('ignores anything else (other scopes, plain strings, objects without postis)', () => {
    expect(readJitsiMessage('hello')).toEqual({ reply: null, event: null });
    expect(readJitsiMessage({ method: '__ready__' })).toEqual({ reply: null, event: null });
    expect(
      readJitsiMessage(
        JSON.stringify({ postis: true, scope: 'other', method: '__ready__', params: 1 }),
      ),
    ).toEqual({ reply: null, event: null });
  });
});
