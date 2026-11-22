import { Injectable } from '@nestjs/common';
import type {
  ConnectorAdapter,
  HttpRequest,
  HttpResponse,
  HttpTransport,
} from './adapters/types.js';
import { ProviderError } from './adapters/types.js';

const TIMEOUT_MS = 10_000;

/** Replaces every known secret value (and secret headers) with •••• so captured requests are safe to show. */
export function redact(
  req: HttpRequest,
  secrets: string[],
): { method: string; url: string; headers: Record<string, string>; body: unknown } {
  const long = secrets.filter((s) => s && s.length >= 6).sort((a, b) => b.length - a.length);
  const scrub = (s: string) => long.reduce((acc, x) => acc.split(x).join('••••'), s);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers))
    headers[k] = req.secretHeaders?.includes(k) ? '••••' : scrub(v);
  let body: unknown = req.body;
  if (body !== undefined) {
    const text = scrub(typeof body === 'string' ? body : JSON.stringify(body));
    try {
      body = typeof req.body === 'string' ? text : JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { method: req.method, url: scrub(req.url), headers, body };
}

/** Real provider calls, with a hard timeout so a slow provider cannot hold a worker. */
export class LiveTransport implements HttpTransport {
  readonly sandbox = false;
  async request(req: HttpRequest): Promise<HttpResponse> {
    let res: Response;
    try {
      res = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body:
          req.body === undefined
            ? undefined
            : typeof req.body === 'string'
              ? req.body
              : JSON.stringify(req.body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (e) {
      throw new ProviderError(`Network error: ${(e as Error).message}`, 'retry');
    }
    const text = await res.text().catch(() => '');
    let json: unknown = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text.slice(0, 500) };
    }
    return { status: res.status, headers: Object.fromEntries(res.headers.entries()), json };
  }
}

/** Test mode: records each request (redacted) and answers like the provider would. Nothing leaves the server. */
export class SandboxTransport implements HttpTransport {
  readonly sandbox = true;
  readonly captured: (ReturnType<typeof redact> & { at: Date })[] = [];
  constructor(
    private readonly adapter: ConnectorAdapter,
    private readonly secrets: string[],
  ) {}
  async request(req: HttpRequest): Promise<HttpResponse> {
    this.captured.push({ ...redact(req, this.secrets), at: new Date() });
    return { status: 200, headers: {}, json: this.adapter.sandboxResponse(req) };
  }
}

/** Builds transports. Integration tests replace `live` to stand in for a provider. */
@Injectable()
export class ConnectorHttp {
  live: () => HttpTransport = () => new LiveTransport();
  sandbox(adapter: ConnectorAdapter, secrets: string[]) {
    return new SandboxTransport(adapter, secrets);
  }
}
