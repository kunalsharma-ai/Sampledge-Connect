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
| Meeting summary                  | `POST /meetings/:id/summary`                            | Agenda + meeting chat. Recordings are not transcribed yet (Planned)         |
| Semantic search                  | `POST /search` `{query, conversationId?}`               | Over every conversation the caller can read                                 |
| Ask                              | `POST /ask` `{question, history}`                       | Answer with numbered sources; history is client-held, never stored          |
| Translation                      | `POST /translate` `{messageId, targetLanguage}`         | Needs a model; `text: null` in built-in mode                                |
| Status digest / task suggestions | `POST /digest` `{conversationIds?, sinceHours}`         | Per conversation: summary, on track / needs attention / quiet; tasks        |
| Duplicate detection              | `POST /duplicates` `{text}`                             | "Has this been asked already?"                                              |
| Notification priority            | `GET /notifications/priority`                           | Rules: mention, DM, urgency words, questions, age                           |
| Drafts                           | `POST /proposals`, `/proposals/:id/confirm`, `/dismiss` | See below                                                                   |

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

- Call and meeting transcripts (self-hosted speech-to-text such as Whisper), then transcript summaries.
- Create tasks from suggested tasks (Tasks & Approvals, Phase 2) and project status from linked
  Samptrek projects (Phase 2).
- AI on mobile (the API above is ready; the mobile app adds the screens).
- Streaming answers.
