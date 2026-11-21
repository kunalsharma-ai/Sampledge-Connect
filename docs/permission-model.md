# Permission model

Source of truth: `packages/contracts/src/permissions.ts` (unit tested). The API imports the same functions, so docs, client hints and server enforcement cannot drift.

## Layers, evaluated in order

1. **Authentication.** A valid, unexpired access JWT whose device session (`sid`) is not revoked.
2. **Tenant isolation.** `tenantId` is taken from the token. The API loads the user's membership for that tenant; a deactivated user or a mismatch is rejected. No endpoint accepts a tenant id from the client except the unauthenticated login/registration routes, which take a tenant _slug_ and resolve it server-side.
3. **Tenant role** (`owner`, `admin`, `member`, `guest`) gates tenant-wide actions.
4. **Conversation role** (`owner`, `moderator`, `member`) gates actions inside a conversation.
5. **Resource state** (archived conversations are read-only; editing a message requires being its sender).

Project-level (Samptrek), module-level and plan-level (subscription) permissions are **Planned** and will slot in as an additional layer between 3 and 4.

## Tenant roles

| Permission                                     | owner | admin | member | guest |
| ---------------------------------------------- | :---: | :---: | :----: | :---: |
| tenant.manage (branding, plan, retention)      |   ✓   |       |        |       |
| members.invite / members.manage                |   ✓   |   ✓   |        |       |
| devices.revoke.any, audit.read                 |   ✓   |   ✓   |        |       |
| directory.read                                 |   ✓   |   ✓   |   ✓    |       |
| conversation.dm.create                         |   ✓   |   ✓   |   ✓    |   ✓   |
| conversation.group.create                      |   ✓   |   ✓   |   ✓    |       |
| channel.public.create / channel.private.create |   ✓   |   ✓   |   ✓    |       |
| channel.public.join                            |   ✓   |   ✓   |   ✓    |       |

Guests are intended for external collaborators such as SampleAudience suppliers: they only see conversations they were explicitly added to.

## Conversation roles

| Permission                                       | owner | moderator | member |
| ------------------------------------------------ | :---: | :-------: | :----: |
| conversation.read, message.send                  |   ✓   |     ✓     |   ✓    |
| message.edit.own, message.delete.own             |   ✓   |     ✓     |   ✓    |
| message.delete.any                               |   ✓   |     ✓     |        |
| members.add, members.remove, conversation.rename |   ✓   |     ✓     |        |
| conversation.archive                             |   ✓   |           |        |

Special rules:

- Public channels are **readable** by any non-guest tenant member without joining; writing requires joining.
- Tenant owners/admins **cannot read private conversations they are not in.** They can moderate (delete any message, archive) only in conversations they are members of. Compliance access to private conversations will be a separate, audited legal-hold workflow (Planned).
- DMs have two `owner` members and cannot gain members; adding someone creates a new group.
- Archived conversations allow read, but not send/edit/add/rename.

## Enforcement points

| Where                                              | What                                                                                                                                            |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `AuthGuard` (REST) / gateway handshake (Socket.IO) | Verifies JWT, checks device session not revoked, attaches `TenantContext { tenantId, userId, sessionId, role }`                                 |
| `TenantDb`                                         | Every collection access is through a wrapper that adds `tenantId` to filters and documents; raw collections are not exported to feature modules |
| Services                                           | Call `tenantCan` / `conversationCan` with membership loaded from MongoDB (cached 60s in Redis)                                                  |
| Socket rooms                                       | Sockets only join rooms for conversations that pass `conversation.read`; membership changes add/remove rooms live                               |
| Sync                                               | Only returns conversations passing `conversation.read`; lists revoked ones so clients purge them                                                |

Every denial returns `FORBIDDEN` (or `NOT_FOUND` where existence itself is sensitive, e.g. private conversations) and security-relevant denials are audit logged.
