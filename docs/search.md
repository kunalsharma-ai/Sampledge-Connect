# Universal Search

One search box for everything a person can open: messages (including file names and poll
questions), files, people, channels and chats, tasks and meetings.

## Where

- Web: **Universal Search** in the navigation, `Ctrl/Cmd + Shift + F`, or type in the `⌘K`
  palette and pick "Search everything for …".
- API: `GET /v1/search` (schemas in `packages/contracts/src/search.ts`).

## Query

| Parameter         | Meaning                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `q`               | Words to find. Every word must appear (partial words match). Quotes keep a phrase together. |
| `types`           | Comma list of `messages,people,conversations,files,tasks,meetings` (default all).           |
| `from`            | Messages and files from this person.                                                        |
| `in`              | Only inside this conversation.                                                              |
| `hasFile`         | `true`: only messages that carry an attachment.                                             |
| `after`, `before` | ISO dates for messages, files and meetings.                                                 |
| `limit`, `offset` | Per type (limit 1–50). Each group returns `more: true` when there is another page.          |

Typed operators are resolved by the client: `from:@ravi`, `in:#fieldwork`, `has:file`,
`before:2026-11-01`, `after:2026-10-01`, `"exact phrase"` (`parseSearchOperators`).

Each hit carries `matches`, character ranges for highlighting; messages carry a `snippet` window
around the first match.

## Who sees what

Scope is computed before any query: conversations the caller is a member of plus public
channels in their workspace (the same rule as opening them), tasks they can see, meetings they
organise or attend or that sit in a readable conversation. Guests only find people they share a
conversation with. Another organization's data is never reachable. Each query is capped at
2.5 seconds of database time.

## Offline

`searchLocalMessages` in `@sampledge/offline` searches the messages cached in IndexedDB with
the same matching rules, including messages not sent yet. The web shows these results at once,
then replaces them with the server's answer when online, and labels them clearly while offline.

## Recent searches

`GET /v1/search/recent` and `PUT /v1/search/recent {recent: string[]}` (idempotent, max 10,
deduplicated). Every change emits `search:recent` to the person's own devices. The web saves
changes through the durable action queue (`search-recent` key), so they work offline.

## Mobile

The app's Search tab has the same box, filter chips and tabs (All, Messages, People, Channels &
chats, Files, Tasks, Meetings) with highlighted results. Typed operators are resolved on the
phone (`buildSearch` in `apps/mobile/src/lib/search.ts`) against cached people and
conversations. While offline it searches the messages stored in the phone's database, including
ones not sent yet, and labels them "Messages on this phone". Recent searches are kept on the
phone, saved through the action queue (`search.recent`, coalesced to the latest list) and
replaced live by `search:recent` from other devices.
