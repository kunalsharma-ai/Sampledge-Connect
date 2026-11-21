import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WidgetSession } from '@sampledge/contracts';
import { WidgetClient } from './client.js';

const session: WidgetSession = {
  accessToken: 'a',
  accessTokenExpiresIn: 900,
  refreshToken: 'r',
  sessionId: 's',
  deviceId: 'd',
  userId: 'u1',
  tenantId: 't1',
  conversationId: 'c1',
};

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    map: m,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('WidgetClient outbox', () => {
  it('needs a conversation', () => {
    expect(
      () => new WidgetClient({ apiUrl: 'http://x', session: { ...session, conversationId: null } }),
    ).toThrow(/conversationId/);
  });

  it('stores a message before sending, and restores it after a reload', () => {
    vi.stubGlobal('navigator', { onLine: false });
    const storage = memoryStorage();
    const fetch = vi.fn();
    const a = new WidgetClient({ apiUrl: 'http://x', session, storage, fetch });
    a.send('  hello  ');
    a.send('   ');
    expect(fetch).not.toHaveBeenCalled();
    expect(a.getState().pending.map((p) => p.text)).toEqual(['hello']);
    expect([...storage.map.keys()]).toEqual(['sampledge.widget.outbox:t1:u1:c1']);

    const b = new WidgetClient({ apiUrl: 'http://x', session, storage, fetch });
    expect(b.getState().pending).toHaveLength(1);
    expect(b.getState().pending[0]!.text).toBe('hello');

    b.discard(b.getState().pending[0]!.clientMessageId);
    expect(b.getState().pending).toHaveLength(0);
    expect(storage.map.size).toBe(0);
  });

  it('ignores a corrupt stored outbox', () => {
    const storage = memoryStorage();
    storage.setItem('sampledge.widget.outbox:t1:u1:c1', '{not json');
    const c = new WidgetClient({ apiUrl: 'http://x', session, storage, fetch: vi.fn() });
    expect(c.getState().pending).toEqual([]);
  });
});
