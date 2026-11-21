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

## Planned

- Single sign-on with OIDC (Microsoft Entra ID, Google Workspace, Okta), set up from
  Integrations.
- Passkeys and security keys (WebAuthn).
- An organization policy that requires two-step verification for admins or everyone.
