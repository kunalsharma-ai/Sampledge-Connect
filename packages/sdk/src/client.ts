import type {
  CreateWidgetSessionRequest,
  EnsureRecordConversationRequest,
  IdentityLink,
  LinkIdentityRequest,
  LinkedRecord,
  Message,
  ModuleEventInput,
  ModuleEventResult,
  PostRecordMessageRequest,
  SampledgeModule,
  WidgetSession,
} from '@sampledge/contracts';
import { signPayload } from './signature.js';

export interface ConnectClientOptions {
  /** Connect API base URL, e.g. https://connect.example.com */
  baseUrl: string;
  /** The Connect API key for your module (Integrations → Sampledge modules → Keys). */
  apiKey: string;
  /** The event signing secret saved for your module in Connect. Required for sendEvent. */
  signingSecret?: string;
  /** Inject fetch (tests, proxies). Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Per-request timeout in ms (default 10 s). */
  timeoutMs?: number;
}

/** An error response from Connect, with its stable error code (see contracts ERROR_CODES). */
export class ConnectError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ConnectError';
  }
  /** Worth retrying later with the same idempotency key / eventId. */
  get retryable() {
    return this.status === 429 || this.status >= 500 || this.status === 0;
  }
}

/**
 * Server-side client for a Sampledge module (Samptrek, SampForce...). Never ship the API key or
 * signing secret to a browser: browsers get a widget session from your server instead.
 */
export class ConnectClient {
  private readonly base: string;
  private readonly f: typeof fetch;

  constructor(private readonly opts: ConnectClientOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, '');
    this.f = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
    rawBody?: string,
  ): Promise<T> {
    let res: Response;
    try {
      res = await this.f(this.base + path, {
        method,
        headers: {
          authorization: `Bearer ${this.opts.apiKey}`,
          ...(body !== undefined || rawBody ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
      });
    } catch (e) {
      throw new ConnectError(0, 'NETWORK', `Could not reach Connect: ${(e as Error).message}`);
    }
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : undefined;
    if (!res.ok) {
      const err = ((json as { error?: object } | undefined)?.error ?? {}) as {
        code?: string;
        message?: string;
        details?: unknown;
      };
      throw new ConnectError(res.status, err.code ?? 'HTTP_ERROR', err.message ?? `HTTP ${res.status}`, err.details);
    }
    return json as T;
  }

  /** Which tenant and module this key belongs to. A cheap connection check. */
  me() {
    return this.request<{
      module: SampledgeModule;
      moduleName: string;
      tenantId: string;
      tenantName: string | null;
      signingSecretSet: boolean;
    }>('GET', '/v1/integration/me');
  }

  /**
   * Send an event (project.created, quota.alert, expense.submitted...). Signed with the signing
   * secret. Safe to retry: the same eventId is processed once and returns the stored result.
   */
  async sendEvent(event: ModuleEventInput): Promise<ModuleEventResult> {
    if (!this.opts.signingSecret) throw new Error('signingSecret is required to send events');
    const raw = JSON.stringify(event);
    return this.request<ModuleEventResult>(
      'POST',
      '/v1/integration/events',
      undefined,
      { 'sampledge-signature': await signPayload(this.opts.signingSecret, raw) },
      raw,
    );
  }

  /** Find or create the conversation for one of your records, and add people to it. */
  ensureRecord(req: EnsureRecordConversationRequest) {
    return this.request<LinkedRecord>('PUT', '/v1/integration/records', req);
  }

  getRecord(recordType: string, externalId: string) {
    return this.request<LinkedRecord>('GET', `/v1/integration/records/${enc(recordType)}/${enc(externalId)}`);
  }

  /** Post into a record's conversation as your module (idempotent per idempotencyKey). */
  postMessage(recordType: string, externalId: string, req: PostRecordMessageRequest) {
    return this.request<{ duplicate: boolean; conversationId: string; messageId: string | null; unmatchedPeople?: string[] }>(
      'POST',
      `/v1/integration/records/${enc(recordType)}/${enc(externalId)}/messages`,
      req,
    );
  }

  /** Recent messages of a record's conversation, newest first (linked conversation history). */
  history(recordType: string, externalId: string, limit = 50) {
    return this.request<{ record: LinkedRecord; messages: Message[] }>(
      'GET',
      `/v1/integration/records/${enc(recordType)}/${enc(externalId)}/messages?limit=${limit}`,
    );
  }

  /** Map one of your user ids to a Connect user (by Connect user id or email). */
  linkIdentity(req: LinkIdentityRequest) {
    return this.request<IdentityLink>('PUT', '/v1/integration/identities', req);
  }

  getIdentity(externalUserId: string) {
    return this.request<IdentityLink>('GET', `/v1/integration/identities/${enc(externalUserId)}`);
  }

  /**
   * Shared sign-on for the embedded chat widget: call this from your server for your signed-in
   * user and hand the result to <ConnectChat session=… /> in their browser.
   */
  createWidgetSession(req: CreateWidgetSessionRequest) {
    return this.request<WidgetSession>('POST', '/v1/integration/widget-sessions', req);
  }
}

const enc = encodeURIComponent;
