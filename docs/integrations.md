# Integrations

Every third-party connection (email, calls, push, AI model servers, Sampledge modules,
external messaging connectors) is configured in **Administration → Integrations** and
stored in MongoDB. Nothing needs a server restart or an env change to connect a service.

Only bootstrap values stay in env: `MONGO_URL`, `REDIS_URL`, the JWT keys and
`SETTINGS_ENCRYPTION_KEY`.

## How settings resolve

For a tenant, the effective settings for a provider are, in order:

1. The tenant's own saved settings.
2. The platform default (set by operators listed in `PLATFORM_ADMIN_EMAILS`).
3. Legacy env values (for example `SMTP_HOST`, `LIVEKIT_*`, `PUSH_PROVIDER=expo`), kept so
   existing deployments keep working. The screen shows "Server environment" for these.

Removing a tenant's saved settings falls back to the next level.

## Secrets

- Secret fields are encrypted with AES-256-GCM using `SETTINGS_ENCRYPTION_KEY`
  (32 bytes, base64; `openssl rand -base64 32`). Format: `v1:<keyId>:<iv>:<tag>:<data>`.
- Secrets are never returned by the API. The screen shows "Stored securely" with Replace
  and Remove.
- Without the key in development, a fixed development key is used and a warning is logged.
  Production refuses to start without it.
- Changing the key makes stored secrets unreadable: the screen reports the decryption
  failure and the admin re-enters them.

## Hot reload

A save publishes on the Redis channel `integration-settings:changed`. Every API node drops
its cache (otherwise 60 s) and calls `onChange` listeners, so the change applies at once.

## API

| Method | Path                                      | Who                                              |
| ------ | ----------------------------------------- | ------------------------------------------------ |
| GET    | `/v1/admin/integrations`                  | `integrations.manage` (owner, admin)             |
| PUT    | `/v1/admin/integrations/:providerId`      | same; body `{enabled, values}`                   |
| POST   | `/v1/admin/integrations/:providerId/test` | same; optional `{values}` tests an unsaved draft |
| DELETE | `/v1/admin/integrations/:providerId`      | same; removes the tenant's settings              |
| *      | `/v1/platform/integrations/...`           | platform operators                               |

In `values`, a secret field set to a string replaces it, `null` or `""` removes it, and an
omitted field keeps the stored value. Updates, resets and tests are written to the audit log
(`integration.updated`, `integration.reset`, `integration.tested`) without secret values.

## Adding a provider (server modules)

```ts
constructor(private readonly settings: IntegrationSettingsService) {}
onModuleInit() {
  this.settings.register(
    { id: 'sampledge.samptrek', label: 'Samptrek', description: '…', category: 'sampledge',
      scopes: ['tenant'], testable: true,
      fields: [{ key: 'baseUrl', label: 'Base URL', type: 'url', required: true },
               { key: 'apiKey', label: 'API key', type: 'secret', required: true }] },
    { test: async (values) => ({ ok: true, message: 'Reached Samptrek' }) },
  );
}
// read: await this.settings.get(tenantId, 'sampledge.samptrek') → {enabled, values, source} | null
// react to changes: this.settings.onChange('sampledge.samptrek', (tenantId) => …)
```

Field types: `string`, `url`, `email`, `number`, `boolean`, `select`, `secret`. Categories:
`communication`, `calls`, `storage`, `ai`, `identity`, `sampledge`, `connectors`. Other
modules can encrypt their own stored secrets with `encryptSecret` / `decryptSecret` from
`apps/api/src/integration-settings/cipher.ts`.

## Built-in providers

| Provider            | Used by                      | Test                                       |
| ------------------- | ---------------------------- | ------------------------------------------ |
| `smtp`              | Meeting invites, guest links | Connects and authenticates (no mail sent)  |
| `livekit`           | Calls, meetings, recordings  | Authenticated RoomService call             |
| `push.expo`         | Mobile push                  | Authenticated receipts request             |
| `push.web`          | Browser notifications        | Checks the VAPID key pair                  |
| `storage.nextcloud` | Chat files and recordings    | Writes, reads back and deletes a test file |

Mobile push reads these settings today. The calls and email senders are being switched over
from env in the meetings work; until then they keep using env.
