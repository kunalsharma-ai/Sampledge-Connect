import type {
  IntegrationFieldDef,
  IntegrationProviderDef,
  IntegrationValues,
  IntegrationView,
} from '@sampledge/contracts';

/**
 * The admin Integrations form, as plain data. Non-secret values are edited as strings or
 * booleans. Secrets are never sent to the phone: each one is "keep" (leave the stored value),
 * "replace" (with what the admin typed) or "remove".
 */
export type SecretEdit = { kind: 'keep' } | { kind: 'replace'; value: string } | { kind: 'remove' };

export interface IntegrationDraft {
  enabled: boolean;
  values: Record<string, string | boolean>;
  secrets: Record<string, SecretEdit>;
}

const toText = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export function draftFrom(view: IntegrationView): IntegrationDraft {
  const values: IntegrationDraft['values'] = {};
  const secrets: IntegrationDraft['secrets'] = {};
  for (const f of view.provider.fields) {
    if (f.type === 'secret') {
      secrets[f.key] = { kind: 'keep' };
      continue;
    }
    const saved = view.saved?.values[f.key];
    const v = saved !== undefined && saved !== null ? saved : f.default;
    values[f.key] = f.type === 'boolean' ? v === true : toText(v);
  }
  return { enabled: view.saved?.enabled ?? view.enabled, values, secrets };
}

function hasSecret(f: IntegrationFieldDef, d: IntegrationDraft, secretsSet: readonly string[]) {
  const e = d.secrets[f.key] ?? { kind: 'keep' };
  if (e.kind === 'replace') return e.value.length > 0;
  if (e.kind === 'remove') return false;
  return secretsSet.includes(f.key);
}

/** Field errors by key; empty when the draft can be saved. Checks only enabled providers. */
export function validateDraft(
  provider: IntegrationProviderDef,
  d: IntegrationDraft,
  secretsSet: readonly string[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!d.enabled) return errors;
  for (const f of provider.fields) {
    if (f.type === 'secret') {
      if (f.required && !hasSecret(f, d, secretsSet)) errors[f.key] = `${f.label} is required.`;
      continue;
    }
    if (f.type === 'boolean') continue;
    const raw = toText(d.values[f.key]).trim();
    if (!raw) {
      if (f.required) errors[f.key] = `${f.label} is required.`;
      continue;
    }
    if (f.type === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) errors[f.key] = 'Enter a number.';
      else if (f.min !== undefined && n < f.min) errors[f.key] = `At least ${f.min}.`;
      else if (f.max !== undefined && n > f.max) errors[f.key] = `At most ${f.max}.`;
    } else if (f.type === 'url' && !/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(raw)) {
      errors[f.key] = 'Enter a full address, like https://… or wss://…';
    } else if (f.type === 'email' && !/@[^@\s]+\.[^@\s>]+>?$/.test(raw)) {
      errors[f.key] = 'Enter an email address.';
    } else if (f.type === 'select' && f.options && !f.options.some((o) => o.value === raw)) {
      errors[f.key] = 'Pick one of the options.';
    }
  }
  return errors;
}

/** The `values` body for PUT and for testing a draft: secrets only when they change. */
export function valuesForSave(
  provider: IntegrationProviderDef,
  d: IntegrationDraft,
): IntegrationValues {
  const out: IntegrationValues = {};
  for (const f of provider.fields) {
    if (f.type === 'secret') {
      const e = d.secrets[f.key] ?? { kind: 'keep' };
      if (e.kind === 'replace' && e.value) out[f.key] = e.value;
      if (e.kind === 'remove') out[f.key] = null;
      continue;
    }
    const v = d.values[f.key];
    if (f.type === 'boolean') out[f.key] = v === true;
    else {
      const raw = toText(v).trim();
      out[f.key] = raw === '' ? null : f.type === 'number' ? Number(raw) : raw;
    }
  }
  return out;
}

export const SOURCE_LABEL: Record<'tenant' | 'platform' | 'env', string> = {
  tenant: 'Set for this organization',
  platform: 'Using the platform default',
  env: 'Using the server environment',
};
