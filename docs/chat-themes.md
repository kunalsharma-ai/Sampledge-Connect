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

Own pictures on mobile: Chat theme → **Use your own picture** (all chats) or a conversation's Details → **Chat background** (that conversation; it wins). The photo comes from the phone's library, is shrunk to a 2560 px long edge as JPEG and kept on the phone only (device key-value storage), never uploaded. The editor has opacity, brightness, contrast, saturation, warmth, blur and dim sliders, the seven filters, tap-to-focus with zoom for cropping, and rotate and flip (baked into the saved JPEG). Colors use the shared `chatBackgroundColorMatrix` through react-native-svg's `FeColorMatrix`, so a picture looks the same as on the web. When the organization turns own pictures off (`customImagesAllowed(policy)` is false), pictures stay saved but are hidden.

## Your own picture

Anyone can put a picture from their own device behind their chats. On a computer they pick a file or drop it on the control. On a phone the browser offers the photo library or the camera. Nothing is uploaded and there is nothing to set up.

- **Where:** Settings → Chat theme → _Your own picture_ (all chats), or a conversation's details → _Background for this chat_ (that chat only, wins over the all-chats picture).
- **Kept on the device:** the picture and its edits live in the browser's offline database (`db.meta`, keys `chatBackground:all` and `chatBackground:c:<conversationId>`). They don't follow you to other devices; each device has its own. The phone app does the same with its photo library.
- **Prepared on the device:** shrunk to 2560 px on the long edge and saved as JPEG, which also drops location and camera metadata.
- **Photo editor:** crop (drag, zoom, position), rotate, flip, filters (Original, Mono, Sepia, Vivid, Fade, Noir, Cool), brightness, contrast, saturation, warmth, opacity, blur and dim. Rotate and flip are baked into the saved picture; everything else is applied when drawing, so it can be changed later.
- **Same look everywhere:** settings use `ChatBackgroundAdjustSchema`, and colour edits use `chatBackgroundColorMatrix()` (an SVG feColorMatrix) from `@sampledge/contracts`, which the web and phone apps both use.
- **Readable:** the dim wash and the area under a faded picture use the chat theme's own colour, and names, times and dates get a soft halo in that colour. Bubble colours still come from the chat theme.
- **Organization switch:** owners and admins can turn personal pictures off in _Organization rules_ (`allowCustomImages`, missing means on). When off, pictures are hidden but kept on people's devices, and come back if the switch is turned on again.

Video call backgrounds (blur, company logo, office scenes) are part of meetings, not this feature.
