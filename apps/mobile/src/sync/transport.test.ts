import { describe, expect, it } from 'vitest';
import { HttpTransport, TransportError } from './transport';

function transport(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const t = new HttpTransport({
    baseUrl: 'https://api.example.com',
    getAccessToken: async () => 'tok',
    fetchImpl: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return respond(url, init);
    }) as unknown as typeof fetch,
  });
  return { t, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const req = {
  conversationId: 'c 1',
  clientMessageId: '0190a000-0000-7000-8000-000000000001',
  content: { text: 'hi', mentions: [] },
};

describe('HttpTransport', () => {
  it('posts with a bearer token and unwraps the ack envelope', async () => {
    const { t, calls } = transport(() =>
      json(201, {
        ok: true,
        data: { clientMessageId: req.clientMessageId, duplicate: false, message: {} },
      }),
    );
    const ack = await t.sendMessage(req);
    expect(ack.duplicate).toBe(false);
    expect(calls[0]!.url).toBe('https://api.example.com/v1/conversations/c%201/messages');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('maps error envelopes and status codes to retryable or permanent errors', async () => {
    const limited = transport(() =>
      json(429, {
        ok: false,
        error: { code: 'RATE_LIMITED', message: 'slow down', retryAfterMs: 1500 },
      }),
    ).t;
    const e1 = await limited.sendMessage(req).catch((e: TransportError) => e);
    expect(e1).toBeInstanceOf(TransportError);
    expect((e1 as TransportError).retryable).toBe(true);
    expect((e1 as TransportError).retryAfterMs).toBe(1500);

    const forbidden = transport(() => json(403, { message: 'nope' })).t;
    const e2 = (await forbidden.sendMessage(req).catch((e) => e)) as TransportError;
    expect(e2.code).toBe('FORBIDDEN');
    expect(e2.retryable).toBe(false);

    const expired = transport(() => new Response('', { status: 401 })).t;
    expect(((await expired.sync({}).catch((e) => e)) as TransportError).isAuth).toBe(true);
  });

  it('reports fetch failures as network errors', async () => {
    const down = transport(() => {
      throw new TypeError('Network request failed');
    }).t;
    const e = (await down.sync({}).catch((x) => x)) as TransportError;
    expect(e.kind).toBe('network');
    expect(e.retryable).toBe(true);
  });
});
