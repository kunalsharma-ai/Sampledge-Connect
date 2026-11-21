# Profiles and photos

Every member edits their own profile in **Settings → Profile** (also from the command palette:
"Edit profile and settings"). Changes show for everyone at once: the server emits
`directory:updated` to the whole organization, and every app refetches the directory.

## Fields

| Field | Limit | API field |
| --- | --- | --- |
| Name | 1–80 characters, required | `displayName` |
| Job title | 80 | `title` |
| Department | 80 | `department` |
| Phone | 32, digits, spaces and `+ ( ) - .` | `phone` |
| About you | 500 | `bio` |
| Time zone | IANA name, e.g. `Asia/Kolkata` | `timeZone` |
| Photo | PNG, JPEG or WebP, 160 KB after cropping | `avatarUrl` |

Role, status and email are changed by admins only, not here.

## API

- `PATCH /v1/me/profile` with any of the fields above. Omitted fields stay as they are; `""` or
  `null` clears a field. Unknown fields (e.g. `role`, `email`) are refused. Returns the
  updated `UserSummary`.
- `PUT /v1/me/avatar` with `{ "image": "data:image/webp;base64,..." }`. Apps crop to a 512 px
  square and compress first. The server checks the file's bytes (not its label) and accepts only
  PNG, JPEG and WebP, so SVG or HTML can never be served as a photo. Returns the `UserSummary`.
- `DELETE /v1/me/avatar` removes the photo (initials show again).
- `GET /v1/users/:id` returns one member's profile card; `GET /v1/users` returns everyone.
- `GET /v1/avatars/:tenantId/:key` serves the photo **without a session**, so `<img>` tags,
  notifications and native image caches can load it. The key is 128 random bits and changes with
  every new photo, so the URL can be cached forever and an old photo stops resolving once
  replaced or removed.

`UserSummary.avatarUrl` is a path such as `/v1/avatars/<tenantId>/<key>`; resolve it against the
API base URL. All profile fields are optional in the schema, so older servers and clients keep
working.

Editing your profile needs a connection; the apps say so while offline.
