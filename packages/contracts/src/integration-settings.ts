import { z } from 'zod';

/**
 * Integration settings live in MongoDB, not env vars, and are edited from the admin
 * Integrations screen. Secrets are encrypted at rest (AES-256-GCM) and never returned.
 * Only bootstrap values (Mongo/Redis URLs, SETTINGS_ENCRYPTION_KEY) stay in env.
 *
 * Resolution order for a tenant: tenant settings → platform settings → legacy env fallback.
 */

export const INTEGRATION_FIELD_TYPES = [
  'string',
  'url',
  'email',
  'number',
  'boolean',
  'select',
  'secret',
] as const;
export type IntegrationFieldType = (typeof INTEGRATION_FIELD_TYPES)[number];

export interface IntegrationFieldDef {
  key: string;
  label: string;
  type: IntegrationFieldType;
  required?: boolean;
  /** Shown under the input. */
  help?: string;
  placeholder?: string;
  default?: string | number | boolean;
  /** For `select`. */
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
}

export const INTEGRATION_CATEGORIES = [
  'communication',
  'calls',
  'storage',
  'ai',
  'identity',
  'billing',
  'sampledge',
  'connectors',
] as const;
export type IntegrationCategory = (typeof INTEGRATION_CATEGORIES)[number];
export const INTEGRATION_CATEGORY_LABELS: Record<IntegrationCategory, string> = {
  communication: 'Email & notifications',
  calls: 'Calls & meetings',
  storage: 'Files & storage',
  ai: 'AI',
  identity: 'Sign-in & identity',
  billing: 'Billing & payments',
  sampledge: 'Sampledge modules',
  connectors: 'External messaging',
};

/** A provider is declared once (in contracts, or by the API module that owns it) and rendered generically. */
export interface IntegrationProviderDef {
  /** Stable id, lowercase: `smtp`, `livekit`, `push.expo`, `ai.model`, `sampledge.samptrek`… */
  id: string;
  label: string;
  description: string;
  category: IntegrationCategory;
  fields: IntegrationFieldDef[];
  /** Where it can be configured. Platform settings apply to every tenant that has none of its own. */
  scopes: ('tenant' | 'platform')[];
  /** Whether a "Test connection" check exists. */
  testable: boolean;
  /** Planned providers render as Planned and cannot be enabled. */
  planned?: boolean;
}

export type IntegrationValues = Record<string, string | number | boolean | null>;

export const IntegrationSourceSchema = z.enum(['tenant', 'platform', 'env']);
export type IntegrationSource = z.infer<typeof IntegrationSourceSchema>;

export const IntegrationTestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  testedAt: z.string().datetime(),
  latencyMs: z.number().int().nonnegative().nullable(),
});
export type IntegrationTestResult = z.infer<typeof IntegrationTestResultSchema>;

/** What the admin screen gets per provider. Secret values never leave the server. */
export interface IntegrationView {
  provider: IntegrationProviderDef;
  /** Effective state after resolution. */
  enabled: boolean;
  source: IntegrationSource | null;
  /** This scope's own saved settings (null when inheriting or unset). */
  saved: {
    enabled: boolean;
    values: IntegrationValues;
    /** Secret field keys that have a stored value. */
    secretsSet: string[];
    updatedAt: string;
    updatedBy: string | null;
  } | null;
  lastTest: IntegrationTestResult | null;
}

/**
 * PUT /v1/admin/integrations/:providerId  (tenant scope; `integrations.manage`)
 * PUT /v1/platform/integrations/:providerId  (platform scope; platform admins)
 * Secret fields: a string sets it, null clears it, omitting keeps the stored value.
 */
export const SaveIntegrationRequestSchema = z.object({
  enabled: z.boolean(),
  values: z.record(z.string(), z.union([z.string().max(8192), z.number(), z.boolean(), z.null()])),
});
export type SaveIntegrationRequest = z.infer<typeof SaveIntegrationRequestSchema>;

/** POST …/:providerId/test. With `values`, tests the unsaved draft merged over what is stored. */
export const TestIntegrationRequestSchema = z.object({
  values: SaveIntegrationRequestSchema.shape.values.optional(),
});

/** Built-in providers. Modules register more at runtime on the API side. */
export const CORE_INTEGRATION_PROVIDERS: IntegrationProviderDef[] = [
  {
    id: 'smtp',
    label: 'Email (SMTP)',
    description: 'Outgoing email through your own mail server: meeting invites and guest links.',
    category: 'communication',
    scopes: ['tenant', 'platform'],
    testable: true,
    fields: [
      {
        key: 'host',
        label: 'Host',
        type: 'string',
        required: true,
        placeholder: 'smtp.example.com',
      },
      { key: 'port', label: 'Port', type: 'number', default: 587, min: 1, max: 65535 },
      {
        key: 'security',
        label: 'Security',
        type: 'select',
        default: 'starttls',
        options: [
          { value: 'starttls', label: 'STARTTLS (port 587)' },
          { value: 'tls', label: 'TLS (port 465)' },
          { value: 'none', label: 'None (not recommended)' },
        ],
      },
      { key: 'username', label: 'Username', type: 'string' },
      { key: 'password', label: 'Password', type: 'secret' },
      {
        key: 'from',
        label: 'From address',
        type: 'email',
        required: true,
        placeholder: 'Connect <no-reply@example.com>',
      },
    ],
  },
  {
    id: 'livekit',
    label: 'Calls (LiveKit)',
    description: 'Self-hosted audio and video calls, screen sharing and recording.',
    category: 'calls',
    scopes: ['tenant', 'platform'],
    testable: true,
    fields: [
      { key: 'publicUrl', label: 'Public URL (wss://)', type: 'url', required: true },
      {
        key: 'apiUrl',
        label: 'Server API URL',
        type: 'url',
        help: 'Defaults to the public URL over https.',
      },
      { key: 'apiKey', label: 'API key', type: 'string', required: true },
      { key: 'apiSecret', label: 'API secret', type: 'secret', required: true },
    ],
  },
  {
    id: 'sms',
    label: 'Text messages (SMS)',
    description:
      'Sends SampConnect Network invites by text message to people who are not on SampConnect yet.',
    category: 'communication',
    scopes: ['tenant', 'platform'],
    testable: true,
    fields: [
      {
        key: 'provider',
        label: 'Provider',
        type: 'select',
        required: true,
        default: 'twilio',
        options: [
          { value: 'twilio', label: 'Twilio' },
          { value: 'vonage', label: 'Vonage (Nexmo)' },
          { value: 'webhook', label: 'Your own SMS gateway (HTTPS)' },
        ],
      },
      {
        key: 'accountId',
        label: 'Account SID or API key',
        type: 'string',
        help: 'Twilio: Account SID (AC…). Vonage: API key. Not used for your own gateway.',
      },
      {
        key: 'secret',
        label: 'Auth token, API secret or gateway token',
        type: 'secret',
        required: true,
        help: 'Your own gateway receives it as "Authorization: Bearer <token>".',
      },
      {
        key: 'from',
        label: 'Sender',
        type: 'string',
        help: 'A phone number in international format (+14155550100) or an approved sender name. Twilio also accepts a Messaging Service SID (MG…).',
      },
      {
        key: 'webhookUrl',
        label: 'Gateway URL',
        type: 'url',
        help: 'Your own gateway only. We POST JSON { to, from, text } and expect a 2xx reply.',
        placeholder: 'https://sms.example.com/send',
      },
    ],
  },
  {
    id: 'push.expo',
    label: 'Mobile push (Expo)',
    description: 'Push notifications to the iOS and Android apps through Expo Push.',
    category: 'communication',
    scopes: ['tenant', 'platform'],
    testable: true,
    fields: [
      {
        key: 'accessToken',
        label: 'Expo access token',
        type: 'secret',
        help: 'Optional; required if enhanced push security is on.',
      },
      { key: 'showPreviews', label: 'Show message text in pushes', type: 'boolean', default: true },
    ],
  },
];
