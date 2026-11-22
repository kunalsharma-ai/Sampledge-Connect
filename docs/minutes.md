# Minutes of meeting, chat export and multilingual transcripts

Everything here runs on the organization's own servers: the API renders the documents, the
organization's speech-to-text server transcribes, and its AI model server writes minutes and
translates. Settings are stored in the database and changed in admin screens, not in env.

## Minutes of meeting

After a call or meeting ends, anyone who was in it presses **Minutes** on the call card.

- **Draft.** The minutes are made from the call's recording transcripts (a translation into the
  chosen language is preferred when one exists), saved live captions when there was no recording,
  and chat sent during the call (5 minutes either side). They hold attendees with minutes present
  (members and guests), agenda, summary, decisions, action items (owner, due date, done) and open
  questions. With the AI assistant off, the draft has the attendees filled in and people write
  the rest (`engine: manual`).
- **Language.** The person picks the language the minutes are written in (default from admin
  settings). Languages other than English need the AI model server.
- **Review.** A draft is visible only to people who were in the call (plus organization admins and
  the conversation's owners and moderators). They edit every field together. Edits merge per field:
  changes to different fields both apply; the same field changed by two people at once is a
  conflict (409 with `details.fields`), and the app shows the other version.
- **Share.** Sharing posts a card in the conversation that everyone in it can open. Shared minutes
  stay editable by the same people. **Regenerate** rebuilds the draft from the sources;
  **Delete** removes them and the card says so.
- **Download** as PDF or Word in four templates:

  | Template  | Look                                                     |
  | --------- | -------------------------------------------------------- |
  | Classic   | Serif, centered header, ruled sections; formal boardroom |
  | Modern    | Brand colour accents, logo header (default)              |
  | Executive | Dark band header, small caps headings; for leadership    |
  | Compact   | Dense, two-page friendly; for internal stand-ups         |

  Documents use the organization's name, logo and brand colour (darkened when too light to read),
  show times in the downloader's time zone, mark drafts with a DRAFT watermark, number pages and
  can append the full transcript. Hindi, Arabic, Chinese and other scripts render with bundled
  fonts plus the Noto fonts in the API image (`PDF_FONTS` build argument in `apps/api/Dockerfile`).
  Word files name standard fonts and Word substitutes per script on the reader's computer.

## Chat export

The **Export** button in a conversation header downloads its messages as PDF, Word or plain text
(UTF-8, Windows line endings), optionally for a date range, with or without calls and other events,
and with recording transcripts under each recording. Up to 20,000 messages per export. Each export
is written to the audit log (`conversation.export`) with format and range.

Admins choose who can export (**Recordings › Settings & backup › Minutes and chat export**):
everyone in the conversation (default), conversation owners and moderators, organization admins
only, or nobody. Guests can never export.

## Multilingual transcripts

- The speech-to-text server (Whisper or compatible) detects the spoken language of each recording
  on its own.
- **Also translate to** (Integrations › Speech-to-text server) lists languages every transcript is
  translated into automatically, e.g. `en`.
- People can translate any transcript into another language from the transcript panel. English
  comes from Whisper's translate mode when there is no AI model server; every other language needs
  the AI model server, which translates line by line and keeps the timings.
- **Corrections.** People who were in the call (and moderators, admins, whoever recorded it)
  correct lines of the original or of a translation. Edits merge per line; the same line edited
  by two people at once is a conflict. Corrections made offline wait in the queue
  (`transcript|<attachmentId>|<language>`) and sync on reconnect. When the original is corrected,
  its translations are marked out of date with **Translate again**.
- **Mark checked** records that a person checked the transcript against the recording. Minutes and
  downloads say how many transcripts were checked.

### About accuracy

No automatic transcription or translation is 100% accurate, especially with accents, crosstalk,
domain terms and mixed languages. That is why transcripts, translations and minutes all have a
human review step: the people who were in the call correct lines and mark them checked before
minutes are shared. For legal or regulatory records, have a fluent person check the transcript.

### Speakers

Recording transcripts have no speaker labels. Admins can turn on **Keep live captions for minutes**:
caption lines are then saved with each speaker's name (everyone in the call sees a notice) and
used when there is no recording, so minutes can say who said what. Off by default; saved captions
are deleted after 30 days (1 to 365).

## Sync

| Action                                   | Live event                          | Offline                        |
| ---------------------------------------- | ----------------------------------- | ------------------------------ |
| Create, edit, share, delete minutes      | `minutes:changed` (conversation)    | Edits queued (`minutes\|<id>`) |
| Correct or check a transcript, translate | `transcript:changed` (conversation) | Corrections queued             |
| Minutes and export settings              | `tenant:updated` `minutes`          | Needs a connection (admin)     |
| Downloads and exports                    | -                                   | Need a connection              |

## API

| Endpoint                                             | Purpose                                              |
| ---------------------------------------------------- | ---------------------------------------------------- |
| `GET /v1/minutes/config`                             | Defaults, export policy, model available             |
| `GET/PUT /v1/admin/minutes-settings`                 | Admin settings                                       |
| `GET /v1/calls/:callId/minutes`                      | Minutes for a call, `canCreate`, `blockedReason`     |
| `POST /v1/calls/:callId/minutes`                     | Make (or `regenerate`) the draft, `language`         |
| `GET /v1/minutes?conversationId=`                    | List                                                 |
| `GET/PATCH/DELETE /v1/minutes/:id`                   | Read, edit (`baseRevision` + fields), delete         |
| `POST /v1/minutes/:id/share`                         | Share to the conversation                            |
| `GET /v1/minutes/:id/document`                       | `format=pdf\|docx`, `template`, `tz`, `transcript=1` |
| `GET/POST /v1/conversations/:id/export`              | May I export; download the export                    |
| `PATCH /v1/ai/transcripts/:attachmentId`             | Correct lines, mark checked                          |
| `POST /v1/ai/transcripts/:attachmentId/translations` | Translate (202, queued)                              |

Schemas are in `packages/contracts/src/minutes.ts` and `ai.ts`. Downloads are rate limited to 20 a
minute per person.
