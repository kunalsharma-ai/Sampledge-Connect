# Greeting cards

People can send a ready-made card for a festival or special moment in any chat: Diwali, Holi, Eid, Raksha Bandhan, Onam, Christmas, New Year, Lunar New Year, Halloween, Earth Day, Yoga Day, birthdays, work anniversaries, promotions, welcomes, farewells, get-well wishes, condolences and more.

## What's in the catalogue

84 occasions and 335 messages in six categories.

| Category                        | Occasions                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Festivals of India (26)         | Diwali, Holi, Raksha Bandhan, Janmashtami, Ganesh Chaturthi, Navratri, Durga Puja, Dussehra, Bhai Dooj, Chhath Puja, Makar Sankranti, Pongal, Lohri, Baisakhi, Onam, Ugadi and Gudi Padwa, Maha Shivratri, Ram Navami, Guru Nanak Jayanti, Eid ul-Fitr, Eid al-Adha, Buddha Purnima, Mahavir Jayanti, Navroz, Independence Day, Republic Day |
| Festivals around the world (24) | New Year, Christmas, Lunar New Year, Ramadan, Easter, Hanukkah, Thanksgiving, Valentine's Day, Women's Day, Mother's Day, Father's Day, Friendship Day, Teachers' Day, Mid-Autumn Festival, Chuseok, Rosh Hashanah, Passover, Kwanzaa, St Patrick's Day, Carnival, Halloween, Día de Muertos, Songkran, Loy Krathong                         |
| Special days (14)               | Earth Day, World Environment Day, International Yoga Day, Labour Day, Children's Day, Nurses Day, Doctors' Day, World Mental Health Day, International Day of Peace, World Kindness Day, International Men's Day, Grandparents' Day, Pride, National Day (any country)                                                                       |
| Life moments                    | Birthday, wedding, engagement, anniversary, new baby, graduation, new home, good luck                                                                                                                                                                                                                                                        |
| At work                         | Work anniversary, promotion, welcome aboard, farewell, congratulations, thank you, great work, retirement, project launch                                                                                                                                                                                                                    |
| Care and support                | Get well soon, condolences, thinking of you                                                                                                                                                                                                                                                                                                  |

Every occasion has two or three headlines and three or four messages in different tones: **Warm**, **For colleagues and clients**, **Playful** and **Poetic** (condolences have no playful message). The catalogue lives in `@sampledge/contracts` (`GREETING_OCCASIONS`), so web and phone offer the same cards.

**Coming up** lists festivals that usually fall this month or next. Lunar festivals move each year, so this is a hint, not a calendar.

## Styles

Five styles, each drawn as original SVG artwork for every occasion (`greetingCardLook()` in `@sampledge/design-tokens`): **Radiant** (rich colour and glow), **Elegant** (ivory paper, gold frame, serif headline), **Festive** (patterns, bunting and confetti), **Minimal** (calm and clean) and **Midnight** (night sky with gold light). Condolence cards are always muted: no confetti or bunting in any style. The art is generated on the device, so cards need no network and look the same on web and mobile.

## Sending and editing

- **Web:** the gift button in the message box. **Phone:** the **+** menu → Greeting card.
- Pick an occasion (search works with names and words like "rakhi", "deepavali", "bakrid"), a style and a message, or press **Surprise me**.
- Everything is editable before sending: headline, who it's for ("Dear Priya," is filled in for a direct message), and the message itself. The preview updates as you type.
- After sending, the message text can be edited or the card deleted like any message.

## How it works

A greeting card is an ordinary text message. `content.text` is the card's message, and `metadata.greeting` (`GreetingCardSchema`: occasion, style, headline, to) says how to draw it. Because of that, cards are saved on the device first, shown at once, queued while offline and sent on reconnect, are idempotent on `clientMessageId`, sync live to every device (`message:new`), show in search, and older apps still show the text. Notifications read "🪔 Happy Diwali: May every diya…".

`POST /v1/conversations/:id/messages` accepts `greeting`. The server refuses it (400) when greeting cards are off or the category is hidden, and a card can't also be a forward.

## Organization rules

Administration → **Greeting cards** (web and phone), for owners and admins (`themes.manage`):

- **Offer greeting cards** on or off. Off hides the card button for everyone; cards already sent stay in chats.
- **Categories** to offer, for example hiding festivals in a client-facing workspace.

| Call                       | What it does                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/greetings/policy` | `{ policy: { enabled, hiddenCategories } }`. Missing means on, everything offered.                                        |
| `PUT /v1/admin/greetings`  | Replaces the rules. Audited as `tenant.greetings_updated`; `tenant:updated` area `greetings` refreshes every device live. |

Changing the rules needs a connection; each device caches the last rules it saw so the picker works offline.
