import type { IntegrationProviderDef } from '@sampledge/contracts';
import type { IntegrationSettingsService } from '../integration-settings/integration-settings.service.js';

export const OIDC_PROVIDER: IntegrationProviderDef = {
  id: 'sso.oidc',
  label: 'Single sign-on (OIDC)',
  description:
    'Sign in with your identity provider: Microsoft Entra ID, Google Workspace, Okta, Keycloak, Auth0 or any OpenID Connect service.',
  category: 'identity',
  scopes: ['tenant'],
  testable: true,
  fields: [
    {
      key: 'issuer',
      label: 'Issuer URL',
      type: 'url',
      required: true,
      placeholder: 'https://login.microsoftonline.com/<tenant-id>/v2.0',
      help: 'Connect reads <issuer>/.well-known/openid-configuration.',
    },
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    { key: 'clientSecret', label: 'Client secret', type: 'secret', required: true },
    {
      key: 'buttonLabel',
      label: 'Button label',
      type: 'string',
      default: 'Continue with single sign-on',
    },
    {
      key: 'allowedDomains',
      label: 'Allowed email domains',
      type: 'string',
      placeholder: 'northwind.com, northwind.co.uk',
      help: 'Comma separated. Leave empty to accept any address your provider vouches for.',
    },
    {
      key: 'createUsers',
      label: 'Add people on first sign-in',
      type: 'boolean',
      default: false,
      help: 'Off: only existing members can use SSO. On: new people join as members.',
    },
    {
      key: 'allowPasswordLogin',
      label: 'Also allow password sign-in',
      type: 'boolean',
      default: true,
      help: 'Off: members must use SSO. The organization owner can always use a password, so you can’t lock yourself out.',
    },
  ],
};

export interface OidcSettings {
  issuer: string;
  clientId: string;
  clientSecret: string;
  buttonLabel: string;
  allowedDomains: string[];
  createUsers: boolean;
  allowPasswordLogin: boolean;
}

/** The workspace's SSO settings, or null when SSO is off or incomplete. */
export async function readOidcSettings(
  settings: IntegrationSettingsService,
  tenantId: string,
): Promise<OidcSettings | null> {
  const s = await settings.get(tenantId, OIDC_PROVIDER.id).catch(() => null);
  if (!s?.enabled || !s.values.issuer || !s.values.clientId || !s.values.clientSecret) return null;
  return {
    issuer: String(s.values.issuer).replace(/\/+$/, ''),
    clientId: String(s.values.clientId),
    clientSecret: String(s.values.clientSecret),
    buttonLabel: String(s.values.buttonLabel || 'Continue with single sign-on'),
    allowedDomains: String(s.values.allowedDomains ?? '')
      .split(',')
      .map((x) => x.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean),
    createUsers: s.values.createUsers === true,
    allowPasswordLogin: s.values.allowPasswordLogin !== false,
  };
}

/** SSO-only workspaces refuse passwords, except for the owner so nobody gets locked out. */
export async function passwordLoginAllowed(
  settings: IntegrationSettingsService,
  tenantId: string,
  role: string,
): Promise<boolean> {
  if (role === 'owner') return true;
  const s = await readOidcSettings(settings, tenantId);
  return !s || s.allowPasswordLogin;
}
