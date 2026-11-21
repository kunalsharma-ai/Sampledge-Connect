# Private AI assistant

The assistant is optional, self-hosted and never on the chat path. Chat, sync and the offline
queue do not call it, and every AI failure stays inside the AI screen or card that asked.

## Engines

| Engine   | When                                                                             | What it does                                                                                                                            |
| -------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Built-in | Default. No model server configured, or the model server failed on this call.    | Extractive summaries, keyword action items, decisions, open questions, suggested replies, hashed-vector search. Nothing leaves the API. |
| Model    | An admin set **Administration › Integrations › AI model server** and enabled it. | Written summaries and answers, translation, better replies, optional model embeddings for search.                                       |
| Off      | An admin turned the assistant off (switch on the AI Assistant screen).           | Every `/v1/ai` call returns 403. Chat is unaffected.                                                                                    |

The model server is any OpenAI-compatible endpoint you host: Ollama (`http://ollama:11434`),
vLLM (`http://vllm:8000/v1`), LocalAI or llama.cpp server. Settings live in the database
(integration id `ai.model`, tenant or platform scope, API key encrypted at rest), never in env.
**Test connection** runs a tiny completion (and an embedding when an embedding model is set).

Example with Ollama on the same Docker network:

```
docker run -d --name ollama --network <compose network> -v ollama:/root/.ollama ollama/ollama
docker exec ollama ollama pull llama3.1:8b
docker exec ollama ollama pull nomic-embed-text
```

Then in Integrations: Server URL `http://ollama:11434`, chat model `llama3.1:8b`, embedding model
`nomic-embed-text`. An 8B model needs about 8 GB RAM (or a GPU) for usable speed.

## Features and endpoints

All under `/v1/ai`, all authenticated, rate limited per user (`ai`: 40 per minute).

| Feature                          | Endpoint                                                | Notes                                                                       |
| -------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------- |
| Status                           | `GET /status`                                           | Engine, model, per-feature level, whether the caller can manage, last error |
| On/off for the organization      | `PUT /settings` `{enabled}`                             | `ai.manage` (owners, admins); audited                                       |
| Conversation summary             | `POST /conversations/:id/summary` `{range}`             | `unread`, `day`, `week`, `recent`; cached per message range                 |
| Suggested replies                | `POST /conversations/:id/replies`                       | Put into the composer; the person still presses send                        |
| Meeting summary                  | `POST /meetings/:id/summary`                            | Agenda, meeting chat and call recording transcripts                         |
| Semantic search                  | `POST /search` `{query, conversationId?}`               | Over every conversation the caller can read                                 |
| Ask                              | `POST /ask` `{question, history}`                       | Answer with numbered sources; history is client-held, never stored          |
| Translation                      | `POST /translate` `{messageId, targetLanguage}`         | Needs a model; `text: null` in built-in mode                                |
| Status digest / task suggestions | `POST /digest` `{conversationIds?, sinceHours}`         | Per conversation: summary, status, linked project status; suggested tasks   |
| Duplicate detection              | `POST /duplicates` `{text}`                             | "Has this been asked already?"                                              |
| Notification priority            | `GET /notifications/priority`                           | Rules: mention, DM, urgency words, questions, age                           |
| Drafts                           | `POST /proposals`, `/proposals/:id/confirm`, `/dismiss` | See below                                                                   |
| Transcript of a recording        | `GET /transcripts/:attachmentId`, `POST` to queue       | Same access as playing the recording; see Transcripts below                 |

## Transcripts

Call recordings, voice messages and recorded video can be transcribed by the organization's own
speech-to-text server. Audio never goes anywhere else. Configure it in **Administration ›
Integrations › Speech-to-text server** (integration id `ai.transcription`, stored in the
database, API key encrypted): server URL, model, optional language, and whether call recordings
(default on) and voice messages (default off) are transcribed automatically. **Test connection**
sends 0.4 s of silence.

Any server with the OpenAI-compatible `POST /v1/audio/transcriptions` works:

| Server                                | Example                                                                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Speaches (faster-whisper), CPU or GPU | `docker run -d --name speaches --network <net> ghcr.io/speaches-ai/speaches:latest-cpu`, URL `http://speaches:8000`, model `Systran/faster-whisper-small` |
| whisper.cpp server                    | `whisper-server -m ggml-small.bin --host 0.0.0.0 --port 8080 --inference-path /v1/audio/transcriptions`, URL `http://whisper:8080`                        |
| LocalAI                               | URL `http://localai:8080`, model `whisper-1` (as named in LocalAI)                                                                                        |

How it works:

- A worker in the API checks every 20 seconds. It queues recent call recordings (and voice
  messages when enabled), sends each file to the server (`verbose_json`, up to 200 MB, two jobs
  per organization at a time), and stores the text and timed segments in `ai_transcripts`.
  People can press **Transcript** under any recording to queue it or read it.
- A failed job is retried up to three times, then shows the reason ("Speech-to-text server
  returned HTTP 500") with **Try again**. Server error bodies are never shown.
- Finished transcripts feed conversation and meeting summaries (decisions, action items, open
  questions), the status digest, semantic search and ask. Search results from a transcript are
  marked **Transcript** and show the matching sentence.
- Deleting a recording (by a person or the retention policy) deletes its transcript and removes
  it from search.
- Transcripts have no speaker labels yet: lines are attributed to the person who started the
  recording.
- Sizing: faster-whisper `small` on 4 CPU cores runs at roughly real time; a GPU is 10–30× faster.

## Suggested tasks become real tasks only when you confirm

Action items in summaries, meeting summaries and the status digest have **Create task**. It opens
the normal task form (Tasks & Approvals, docs/work.md), prefilled with the text, the suggested
assignee (when they can be assigned in that conversation), a due date worked out from the hint
("by Thursday", "EOD", "next week", "Dec 3", in your time zone) and the source message. Nothing is
created until the person presses **Create**, which calls `POST /v1/tasks` as them, with its normal
access checks and an idempotency key. The assistant has no endpoint that creates tasks.

A suggestion the person doesn't need can be dismissed with **×** ("Not needed"), and brought back
with **Undo**. Dismissals are private to the person and kept for 180 days:

| Route                                     | What it does                                |
| ----------------------------------------- | ------------------------------------------- |
| `GET /v1/ai/suggestions/dismissed`        | The caller's dismissed suggestion ids       |
| `PUT /v1/ai/suggestions/:id/dismissed`    | Dismiss (idempotent); emits `ai:suggestion` |
| `DELETE /v1/ai/suggestions/:id/dismissed` | Undo (idempotent); emits `ai:suggestion`    |

The id is `aiSuggestionId(conversationId, messageId, text)` from `@sampledge/contracts`, so every
device and the server compute the same one.

## Sync across devices and offline

AI output follows the person across their devices (see docs/sync-coverage.md):

- Drafts: creating, sending or dismissing a draft emits `ai:proposal` to the person's own room.
  A draft open on another device closes with a note ("Sent from another device").
- Sending and dismissing a draft go through the durable action queue (`aiproposal|<id>`), so they
  work offline. Offline, the edited text is checked for sensitive topics on the device the same
  way the server checks it, and the tick is required before it is queued. Confirm and dismiss are
  idempotent, so a retry never sends twice, and the server rechecks everything when it arrives.
- Dismissed suggestions go through the queue too (`aisuggestion|<id>`) and emit `ai:suggestion`.
- Summaries, the digest and search are computed on request and cached on the server, so there is
  no per-device state to sync; every device sees the same cached summary.

## Project status (Samptrek and Connect projects)

Each digest row whose conversation is a project channel carries `project`: name, source
(`samptrek` or `connect`), status, next milestone, missed milestones, open and overdue tasks,
pending approvals and plain `concerns` ("Marked at risk", "1 milestone missed", "2 overdue
tasks", "Past its due date"). A concern marks the row **Needs attention**, and projects with a
concern are included even when their channel was quiet. Projects come from `ProjectsService.list`,
so only projects whose channel the caller can read appear.

## Access rules

- AI reads only what the caller can read **at the time of the call**, through the same checks as
  chat (`ConversationsService.authorize` / `listReadable`). Private conversations the caller left,
  public channels for guests, and other tenants are never in scope. Unreadable ids get 404, so
  they are not confirmed to exist.
- Search re-reads every hit before returning it, so a message deleted (or a conversation left)
  after indexing never appears.
- Summary cache entries are keyed by conversation and message range and are only served after the
  access check passes.
- Every AI call is audited (`ai.summary`, `ai.search`, `ai.ask`, …) with counts, never content.

## Confirm before acting

The assistant never sends, deletes, approves or changes anything on its own. The only way AI
output becomes a message is a draft the person confirms:

1. `POST /proposals` stores a draft (30 minutes) and classifies it. Drafts about money or pricing,
   HR, people outside the organization (including any conversation with guests), or deleting and
   cancelling things are `sensitive`.
2. `POST /proposals/:id/confirm {confirm: true}` sends it as the person, re-checking that they may
   still post there. Sensitive drafts also need `acknowledgeRisk: true`; an edit that makes a draft
   sensitive is caught at confirm time. Confirming twice sends once (the draft carries its own
   idempotency key).
3. Only the author can confirm or dismiss their draft.

Financial, HR, client-facing and destructive **actions** (approving a bid, sending to a client
channel, deleting) are not available to the assistant at all in this release; they arrive with the
Sampledge modules and the client inbox, behind the same confirmation step.

## Prompt injection

Message text is data. It is placed inside tagged blocks after rules that tell the model never to
follow instructions inside them, model output is parsed as data (JSON with a schema, invented
message ids dropped) and never executed, and nothing the model returns can trigger an action
without the person's confirmation.

## Vector index

`ai_embeddings` holds one vector per message per embedding model; `ai_index_state` tracks how far
each conversation is indexed by `changeSequence`, so edits re-embed and deletes drop vectors. A
background indexer covers active conversations every minute, and each search first catches up the
conversations in its scope. Search compares up to 25,000 of the newest vectors in scope in
process. For larger tenants, swap in a vector database (Qdrant, pgvector, MongoDB `$vectorSearch`)
behind the same `vectorSearch` method.

## Planned

- Speaker labels (diarization) in transcripts, and live captions during calls.
- AI on mobile (the API above is ready; the mobile app adds the screens).
- Streaming answers.
