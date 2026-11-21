# Threat model (Phase 1)

Method: STRIDE over the Phase 1 data flows. Aligned with OWASP ASVS 5 Level 2 as the target; items marked Planned are known gaps.

## Assets

Message content and history; identities and credentials; tenant configuration; local device caches; audit logs.

## Trust boundaries

1. Browser/device ↔ API (internet or LAN)
2. API ↔ MongoDB / Redis (private network)
3. Tenant A data ↔ Tenant B data (logical, same database)
4. User's device ↔ other people with physical access to it

## Threats and mitigations

| #   | Threat                                                             | Mitigation                                                                                                                                                                                                                                                              | Status                     |
| --- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| T1  | **Cross-tenant data leakage** via a forged `tenantId` in a request | tenantId only from verified JWT; `TenantDb` wrapper injects it into every filter/insert; no tenant id in DTOs; integration test attempts cross-tenant reads/writes by guessing ids                                                                                      | Built                      |
| T2  | Cross-tenant leakage via Socket.IO rooms                           | Room names include tenantId; joins only after server-side authorization; no client-initiated room join                                                                                                                                                                  | Built                      |
| T3  | Reading a private conversation by id                               | `NOT_FOUND` for non-members, membership checked on every message read/write                                                                                                                                                                                             | Built                      |
| T4  | Credential stuffing / brute force                                  | argon2id hashing; per-IP and per-account rate limits on login (Redis); generic error messages                                                                                                                                                                           | Built                      |
| T5  | Stolen access token                                                | 15 min lifetime; EdDSA signature; session id checked against revocation on socket connect and REST (cached)                                                                                                                                                             | Built                      |
| T6  | Stolen refresh token                                               | Rotation on every use; reuse of a rotated token revokes the whole device session family                                                                                                                                                                                 | Built                      |
| T7  | **Offline device compromise** (lost laptop with cached chats)      | Device revocation wipes local data on next contact; logout deletes IndexedDB; OS disk encryption recommended in deployment guide. Browser IndexedDB is not encrypted; WebCrypto-encrypted cache and remote wipe without network are not possible / Planned respectively | Partial                    |
| T8  | XSS exfiltrating tokens or cached messages                         | Messages rendered as text (no raw HTML); strict CSP and security headers on web and API; access token only in memory                                                                                                                                                    | Built (CSP on web: Built)  |
| T9  | CSRF                                                               | API uses bearer tokens, not cookies, so CSRF does not apply today; when refresh moves to an HttpOnly cookie, SameSite=strict + CSRF token                                                                                                                               | Planned with cookie change |
| T10 | Message spoofing (sending as another user)                         | `senderId` taken from token, never from body                                                                                                                                                                                                                            | Built                      |
| T11 | Replay / duplicate injection                                       | Idempotency on `(tenantId, clientMessageId)`                                                                                                                                                                                                                            | Built                      |
| T12 | Denial of service via message flood or socket storms               | Per-user send rate limits; payload size limits; reconnect jitter on clients                                                                                                                                                                                             | Built (basic)              |
| T13 | Audit tampering                                                    | Append-only collection written by API only; export/WORM storage Planned                                                                                                                                                                                                 | Partial                    |
| T14 | Secrets leakage                                                    | Secrets only via env/secret store; `.env` gitignored; config refuses weak JWT keys                                                                                                                                                                                      | Built                      |
| T15 | Malicious file uploads                                             | Files are not in Phase 1a; ClamAV scanning in files-service                                                                                                                                                                                                             | Planned                    |
| T16 | Insider admin reading private chats                                | Admins cannot read private conversations they are not in; legal-hold access will be audited                                                                                                                                                                             | Built (restriction)        |

## Explicit non-claims

- Sampledge Connect does **not** provide end-to-end encryption. Data is encrypted in transit (TLS, terminated at the reverse proxy) and at rest only if MongoDB/disk encryption is configured by the operator.
- No guarantee of delivery without a network path.
