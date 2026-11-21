# White-label branding

Each organization can present Connect under its own name, logo and colors. The settings are
stored with the organization in the database (no env, no rebuild) and apply to everyone the
next time their app loads.

Where: **Branding** in the navigation (owners edit; admins can view).

## What you can set

| Setting                      | Where it shows                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| App name                     | Browser tab, sign-in page, guest meeting emails, authenticator app entries. Empty keeps "Sampledge Connect". |
| Logo                         | Navigation rail, sign-in page. PNG, JPEG, WebP or SVG up to 256 KB.                                          |
| Primary and secondary colors | The organization theme. Contrast is corrected automatically to meet WCAG AA.                                 |
| Dark or light base           | The organization theme.                                                                                      |
| Start everyone on this theme | Members switch to the organization theme once (and again after you change it); they can switch back.         |
| Always use this theme        | Members can't pick another theme; Settings says the organization sets it.                                    |
| Sign-in message              | Under the workspace field on the sign-in page.                                                               |
| Support email and page       | Settings → "Need help? Contact …".                                                                           |
| Hide "Sampledge Connect"     | Removes the product name from emails ("Sent by Northwind Research.") and the sign-in page.                   |

The sign-in page picks up the brand as soon as someone types the workspace name: logo, name,
colors and message. It only ever gets these public fields; support contacts and settings stay
private (`GET /v1/branding/public/:slug`).

## Safety

- The logo is stored as a data URL with the organization, so it works offline and needs no file
  storage. It's always shown with `<img>`, where SVG scripts never run, and SVGs containing
  scripts, event handlers or `javascript:` links are refused anyway.
- Only the owner can change branding (`tenant.manage`). Every change is audit logged as
  `tenant.branding_updated` with the list of changed fields.
- The brand is cached on each device, so it shows before the network answers and offline.

## API

| Route                           | Who       | Does                                  |
| ------------------------------- | --------- | ------------------------------------- |
| `GET /v1/branding`              | signed in | The organization's branding           |
| `PUT /v1/branding`              | owner     | Save it (all fields, defaults filled) |
| `GET /v1/branding/public/:slug` | public    | Name, logo, colors, sign-in message   |

## Planned

- Custom domains per organization (sign in at `chat.northwind.com`) with their own app icon
  and PWA name.
- Branding on the mobile app (the API is ready).
- Branded email templates beyond guest meeting invites.
