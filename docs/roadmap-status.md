# Roadmap and implementation status

This file is the honest ledger: if a feature is not listed as Built, it does not work yet.

## Phase 1: product foundation

| Area   | Item                                                                              | Status                     |
| ------ | --------------------------------------------------------------------------------- | -------------------------- |
| Step 1 | Architecture, journeys, permission model, data model, threat model, sync protocol | Built (docs)               |
| Step 2 | Design tokens, five themes, typography, motion tokens, component library          | Built                      |
| Step 3 | Tenant registration, password login, JWT + rotating refresh, devices, revocation  | In progress                |
| Step 3 | OIDC/SSO, MFA (TOTP/WebAuthn)                                                     | Planned                    |
| Step 4 | MongoDB collections, validators, indexes, migrations                              | In progress                |
| Step 5 | DM, group, channels, send/edit/delete, receipts, typing, presence over Socket.IO  | In progress                |
| Step 6 | Dexie cache, outbox, backoff, sync, gap recovery, quota, session expiry           | In progress                |
| Step 7 | Premium three-column interface                                                    | In progress (core screens) |
|        | Threads, reactions, pins, bookmarks, polls, voice, scheduled messages, forwarding | Planned                    |
| Step 8 | Nextcloud files                                                                   | Planned (Phase 1b)         |

## Phase 2 to 4

Sampledge SDK and the seven module adapters (Samptrek, SampleAudience, Sampcode, SampBidX, SampForce, SampCrew, Talk2Tax); connector gateway and unified client inbox; private AI; billing and white-label: all Planned.
