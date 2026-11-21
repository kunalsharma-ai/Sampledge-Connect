# Chat themes

Chat themes change how conversations look: the background behind the timeline and the colors of message bubbles. They sit on top of the app theme (Midnight Executive, Arctic Professional and so on) and adapt to its light or dark mode.

## The 20 themes

| Category | Themes                                                                       |
| -------- | ---------------------------------------------------------------------------- |
| Classic  | App theme (default), Executive Navy, Graphite, Slate Teal, Monochrome        |
| Office   | Skyline Office, Boardroom, Library, Open Studio, Glass Atrium, Corner Office |
| Patterns | Blueprint, Linen, Ledger, Hexagon, Dot Matrix                                |
| Colors   | Aurora, Sandstone, Evergreen, Burgundy Club                                  |

Ids and names live in `@sampledge/contracts` (`CHAT_THEMES`). The visuals live in `@sampledge/design-tokens` (`CHAT_THEME_VISUALS`, `chatThemeStyle(id, appColors, mode)`). Office scenes and patterns are inline SVG, so they need no network and work offline. Contrast is enforced and tested: muted text on the background stays at 4.6:1 or better, and your bubble text at 4.5:1, in every built-in app theme in light and dark mode.

## Where to change it

Settings → Chat theme. Pick a tile. The change shows at once and follows you to every device.

Owners and admins see **Organization rules**. There they choose the default for everyone and can limit people to a set of themes. The default is always allowed. If a rule removes someone's chosen theme, they see the default until they pick again.

## API

| Call                        | What it does                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET /v1/me/chat-theme`     | `{ themeId, policy, effective }`                                                                   |
| `PUT /v1/me/chat-theme`     | `{ themeId \| null }`. Rejects a theme the organization doesn't allow (400).                       |
| `PUT /v1/admin/chat-themes` | Owners and admins. `{ defaultThemeId, allowed \| null }`. Audited as `tenant.chat_themes_updated`. |

## Sync

- Your choice: saved on the device, queued (`my-chat-theme`) and sent when online. Your other devices get `chat-theme:changed`.
- Organization rules: `tenant:updated` with area `chat_themes`. Every device refetches. Changing rules needs a connection.
- On reconnect the app refetches; a change still waiting in the queue wins over the server's older copy.

## Mobile

More → Chat theme has the same tiles, grouped by category, and owners and admins get **Organization rules** (Manage: tap to offer or hide a theme, long-press to make it the default; saving needs a connection). Conversations use the same colors from `chatThemeStyle`, and the scenes and patterns are drawn from the same SVG art with `react-native-svg`. Your pick is kept on the phone, queued as `theme.set` (target `my-chat-theme`) and sent on reconnect; `chat-theme:changed` and `tenant:updated` (`chat_themes`) refetch live.

Video call backgrounds (blur, company logo, office scenes) are part of meetings, not this feature.
