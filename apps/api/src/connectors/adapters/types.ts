import type { ConnectorDescriptor, ConnectorProvider } from '@sampledge/contracts';

export type Credentials = Record<string, string>;

/** The request as it arrived at the public webhook endpoint. */
export interface WebhookRequest {
  method: 'GET' | 'POST';
  /** Lower-cased header names. */
  headers: Record<string, string>;
  query: Record<string, string>;
  /** Exact bytes received (signatures are computed over these). */
  rawBody: Buffer;
}

/** A normalized inbound message, whatever the provider. */
export interface InboundMessage {
  externalMessageId: string;
  externalThreadId: string;
  /** Data the adapter needs later to reply in this thread (serviceUrl, replyToken...). */
  replyContext: Record<string, string>;
  from: {
    externalUserId: string;
    displayName: string;
    handle: string | null;
    email?: string | null;
    phone?: string | null;
  };
  text: string;
  attachments: {
    name: string;
    mimeType: string | null;
    sizeBytes: number | null;
    externalRef: string | null;
  }[];
  /** Thread title (channel name...) when the provider has one. */
  subject?: string | null;
  sentAt: Date;
}

export interface ParsedWebhook {
  messages: InboundMessage[];
  /**
   * Body the provider expects back (Slack url_verification challenge, Discord PONG,
   * WeChat "success", QQ validation). Defaults to 200 {"ok":true}.
   */
  response?: { status: number; body: unknown; contentType?: string };
}

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT';
  url: string;
  headers: Record<string, string>;
  /** JSON-encoded unless it is already a string. */
  body?: unknown;
  /** Header names whose values are secrets (redacted in the sandbox log). */
  secretHeaders?: string[];
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  json: unknown;
}

export interface HttpTransport {
  readonly sandbox: boolean;
  request(req: HttpRequest): Promise<HttpResponse>;
}

/** Cached provider access token (sealed by the caller). */
export interface TokenCache {
  get(): Promise<string | null>;
  set(token: string, expiresInSeconds: number): Promise<void>;
}

export interface OutboundContext {
  credentials: Credentials;
  http: HttpTransport;
  tokens: TokenCache;
  externalThreadId: string;
  replyContext: Record<string, string>;
  /** Client's handle on handoff channels (phone number...). */
  clientHandle: string | null;
  testMode: boolean;
}

export type SendResult =
  { kind: 'sent'; externalMessageId: string | null } | { kind: 'handoff'; url: string };

/** Provider error mapped onto retry policy. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'retry' | 'auth' | 'fatal',
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export class WebhookRejected extends Error {}

/**
 * A connector plugin. Adapters are pure: no database, no Nest. They speak the provider's
 * official API through an HttpTransport the gateway hands them (live or sandbox).
 */
export interface ConnectorAdapter {
  readonly provider: ConnectorProvider;
  readonly descriptor: ConnectorDescriptor;
  /** Credentials for test mode (random secrets and fake tokens; never valid at the provider). */
  testCredentials(): Credentials;
  /** Throws WebhookRejected when the request is not authentic. Absent for handoff channels. */
  verifyWebhook?(req: WebhookRequest, credentials: Credentials): Promise<void> | void;
  parseWebhook?(req: WebhookRequest, credentials: Credentials): ParsedWebhook;
  /** Builds a request exactly as the provider would send it, signed with test credentials. */
  buildTestWebhook?(
    input: { fromName: string; fromHandle: string; text: string; threadId: string; email?: string },
    credentials: Credentials,
    webhookUrl: string,
  ): Promise<WebhookRequest> | WebhookRequest;
  send(text: string, ctx: OutboundContext): Promise<SendResult>;
  /** What the provider would answer, for requests captured by the sandbox in test mode. */
  sandboxResponse(req: HttpRequest): unknown;
  /** Cheap authenticated call (getMe, auth.test...) to check credentials. */
  testConnection(
    ctx: Omit<OutboundContext, 'externalThreadId' | 'replyContext' | 'clientHandle'>,
  ): Promise<string>;
}
