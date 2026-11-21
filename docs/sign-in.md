# Sign-in security

## Two-step verification (TOTP)

Anyone who signs in with a password can turn on two-step verification from **Settings → Two-step
verification**. It works with any authenticator app that supports RFC 6238 time-based codes
(Google Authenticator, Microsoft Authenticator, 1Password, Authy and others).

1. **Set up** shows a QR code and the key for manual entry. The secret is stored sealed with
   `SETTINGS_ENCRYPTION_KEY` and stays pending until confirmed.
2. Entering the first code turns it on and shows **ten recovery codes** once. Only their SHA-256
   hashes are stored. Each one works once.
3. From then on, `POST /v1/auth/login` with a correct password answers
   `{ mfaRequired: true, challengeId, methods, expiresAt }` instead of a session. The client
   finishes with `POST /v1/auth/mfa/verify { challengeId, code }`, which returns the session.

Rules:

- A challenge lasts 5 minutes, works once, and is dropped after 5 wrong codes (the person
  enters their password again). Codes are also rate limited per account.
- A code is never accepted twice: the last used 30-second step is stored, and only later
  steps count. One step of clock drift either way is allowed.
- Turning it off needs the password and a current code (or a recovery code). New recovery
  codes need a current authenticator code, and they replace the old ones.
- Admins can **Reset 2-step** for someone who lost both their phone and their codes
  (Administration → Members). They then sign in with their password and set it up again.
- Every step is audit logged: `auth.mfa_enabled`, `auth.mfa_disabled`, `auth.mfa_challenge`,
  `auth.mfa_failed`, `auth.mfa_recovery_code_used`, `auth.mfa_recovery_codes_regenerated`,
  `auth.mfa_reset_by_admin`. Logins record their method (`password` or `password+totp`).

### API

| Route                              | Who            | Does                                    |
| ---------------------------------- | -------------- | --------------------------------------- |
| `GET /v1/auth/mfa`                 | signed in      | Status and recovery codes left          |
| `POST /v1/auth/mfa/totp/setup`     | signed in      | New pending secret, otpauth URL, QR SVG |
| `POST /v1/auth/mfa/totp/enable`    | signed in      | Confirms with a code; recovery codes    |
| `POST /v1/auth/mfa/disable`        | signed in      | Needs password and code                 |
| `POST /v1/auth/mfa/recovery-codes` | signed in      | Replaces recovery codes                 |
| `POST /v1/auth/mfa/verify`         | public         | Second login step                       |
| `POST /v1/users/:id/mfa/reset`     | members.manage | Clears someone's two-step setup         |

## Single sign-on (OIDC)

Any OpenID Connect provider works: Microsoft Entra ID, Google Workspace, Okta, Keycloak,
Auth0. It is set up per organization in **Administration → Integrations → Sign-in & identity →
Single sign-on (OIDC)**, stored in the database like every other integration (the client secret
is encrypted). Nothing goes in env.

1. In your provider, create a web application and register the redirect URI
   `https://<your-api-host>/v1/auth/sso/callback`. **Test connection** shows the exact URI.
   Set `PUBLIC_API_URL` so it doesn't depend on the request's host header.
2. In Connect, enter the issuer URL (for Entra ID:
   `https://login.microsoftonline.com/<tenant-id>/v2.0`), client ID and client secret, then
   **Test connection**. It reads `<issuer>/.well-known/openid-configuration`.
3. Choose the options:
   - **Allowed email domains**: only these addresses can sign in. Empty accepts any address
     the provider marks as verified.
   - **Add people on first sign-in**: off by default, so only existing members can use SSO.
     On, new people join as members of the default workspace and #general.
   - **Also allow password sign-in**: turn it off to make the organization SSO-only. The owner
     can always sign in with a password, so a broken provider can't lock you out.

When the workspace has SSO on, the login page shows the button as soon as the workspace name
is typed.

How it works:

- Authorization code flow with PKCE (S256), a random `state` (10 minutes, single use) and a
  `nonce` checked in the ID token. The token request uses `client_secret_basic`.
- The ID token is verified against the provider's JWKS: signature, issuer, audience (the client
  ID) and expiry. Connect matches people by their verified email.
- Connect then issues its own device session, exactly like a password login. The browser gets
  it through a one-time code in the URL fragment (`/login#sso=…`, valid 60 seconds, single use),
  never the tokens themselves. Errors come back as `/login#sso_error=…`.
- People are only sent back to the web app's own origins (`PUBLIC_WEB_URL`, `CORS_ORIGINS`).
- Connect's own two-step verification isn't asked for SSO logins. Your provider's MFA policy
  applies instead.
- Audit log: logins record method `sso`; failures are `auth.sso_failed` with the reason;
  people added on first sign-in are `member.created_by_sso`.

| Route                          | Does                                      |
| ------------------------------ | ----------------------------------------- |
| `GET /v1/auth/sso/:slug`       | Whether SSO is on, button label, password |
| `GET /v1/auth/sso/:slug/start` | Redirects to the provider                 |
| `GET /v1/auth/sso/callback`    | Provider returns here; redirects to web   |
| `POST /v1/auth/sso/exchange`   | One-time code → session                   |

## Planned

- SSO on the mobile app (it uses password sign-in for now).
- SAML 2.0 and SCIM provisioning.
- Passkeys and security keys (WebAuthn).
- An organization policy that requires two-step verification for admins or everyone.
