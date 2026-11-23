import { describe, expect, it } from 'vitest';
import { bridgeEvent, JITSI_BRIDGE_SCRIPT } from './jitsiBridge';

describe('Jitsi WebView bridge', () => {
  it('reads only the events the bridge forwards', () => {
    expect(bridgeEvent(JSON.stringify({ sampconnect: 'jitsi', event: 'ready-to-close' }))).toBe(
      'ready-to-close',
    );
    expect(bridgeEvent('{"event":"x"}')).toBeNull();
    expect(bridgeEvent('not json')).toBeNull();
  });

  it('answers each handshake id once (no ping-pong with its own echo)', () => {
    const listeners: ((e: { data: unknown }) => void)[] = [];
    const posted: string[] = [];
    const forwarded: string[] = [];
    const win = {
      addEventListener: (_: string, f: (e: { data: unknown }) => void) => listeners.push(f),
      postMessage: (m: string) => {
        posted.push(m);
        listeners.forEach((f) => f({ data: m }));
      },
      ReactNativeWebView: { postMessage: (m: string) => forwarded.push(m) },
    } as Record<string, unknown>;
    new Function('window', JITSI_BRIDGE_SCRIPT)(win);
    const ping = JSON.stringify({
      postis: true,
      scope: 'jitsi_meet_external_api_0',
      method: '__ready__',
      params: 'a1',
    });
    listeners.forEach((f) => f({ data: ping }));
    listeners.forEach((f) => f({ data: ping }));
    expect(posted).toHaveLength(1);
    const ev = JSON.stringify({
      postis: true,
      scope: 'jitsi_meet_external_api_0',
      method: 'message',
      params: { type: 'event', data: { name: 'video-conference-left' } },
    });
    listeners.forEach((f) => f({ data: ev }));
    expect(forwarded.map(bridgeEvent)).toEqual(['video-conference-left']);
  });
});
