import { describe, expect, it } from 'vitest';
import { CORE_INTEGRATION_PROVIDERS, type IntegrationView } from '@sampledge/contracts';
import { draftFrom, validateDraft, valuesForSave } from './integrations';

const smtp = CORE_INTEGRATION_PROVIDERS.find((p) => p.id === 'smtp')!;
const view = (over: Partial<IntegrationView> = {}): IntegrationView => ({
  provider: smtp,
  enabled: false,
  source: null,
  saved: null,
  lastTest: null,
  ...over,
});

describe('integration drafts', () => {
  it('start from defaults and never carry secrets', () => {
    const d = draftFrom(view());
    expect(d.values.port).toBe('587');
    expect(d.values.security).toBe('starttls');
    expect(d.secrets.password).toEqual({ kind: 'keep' });
  });

  it('require fields only when enabled, and check formats', () => {
    const d = draftFrom(view());
    expect(validateDraft(smtp, d, [])).toEqual({});
    d.enabled = true;
    d.values.port = '70000';
    d.values.from = 'not an email';
    expect(validateDraft(smtp, d, [])).toEqual({
      host: 'Host is required.',
      port: 'At most 65535.',
      from: 'Enter an email address.',
    });
    d.values.host = 'mail.example.com';
    d.values.port = '587';
    d.values.from = 'Connect <no-reply@example.com>';
    expect(validateDraft(smtp, d, [])).toEqual({});
  });

  it('send secrets only when replaced or removed', () => {
    const d = draftFrom(
      view({
        saved: {
          enabled: true,
          values: { host: 'mail.example.com', port: 465, security: 'tls', from: 'a@b.co' },
          secretsSet: ['password'],
          updatedAt: '2026-11-21T10:00:00.000Z',
          updatedBy: null,
        },
      }),
    );
    expect(valuesForSave(smtp, d)).toEqual({
      host: 'mail.example.com',
      port: 465,
      security: 'tls',
      username: null,
      from: 'a@b.co',
    });
    d.secrets.password = { kind: 'replace', value: 's3cret' };
    expect(valuesForSave(smtp, d).password).toBe('s3cret');
    d.secrets.password = { kind: 'remove' };
    expect(valuesForSave(smtp, d).password).toBeNull();
  });
});
