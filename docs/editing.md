# Editing in SampConnect

People can fix what they wrote almost everywhere, on web and mobile. Every edit is saved on the
device first and sent through the offline queue, so it shows at once, works without a
connection, and reaches everyone's devices live once the server confirms it. If the server
refuses a queued edit (the rules changed, someone voted, someone decided), the change is rolled
back on the device and the reason is shown.

## Messages

- **Edit** your own messages (and add a caption to a file you sent without words). The message
  shows "(edited)" for everyone.
- **Edit history.** Every edit keeps the text it replaced (`message_edits`). Click "(edited)" on
  web, or long-press the message → **Edit history** on mobile, to see every version, newest
  first. Deleting a message also erases its history.
- **Audit.** Each edit writes `message.edited` (who, which message, which version, when) to the
  organization's audit log. The text itself is never copied into the audit log. SampConnect
  super admins see these entries in Super admin → Activity.

### Rules (Administration → Messages)

Owners and admins (permission `messages.manage`) set, in the database, for the whole
organization:

| Setting                      | Default  | What it does                                                                                    |
| ---------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| People can edit messages     | On       | Off hides Edit everywhere and the server refuses edits. Deleting your own messages still works. |
| Time limit                   | No limit | 5 min, 15 min, 1 hour, 24 hours or 7 days after sending.                                        |
| Who can see earlier versions | Everyone | Or only the sender, the conversation's owners and moderators, and organization admins.          |

Changes apply live (`tenant:updated` area `messages`). API: `GET /v1/message-editing`,
`PUT /v1/admin/message-editing`, `GET /v1/messages/:id/edits`.

### Super admin override

The super admin permission matrix has **Edit their own messages** (`messages.edit`) and **Set
message editing rules** (`messages.manage`) under Conversations. Taking `messages.edit` away
from a role stops that role editing in that organization, whatever its own switch says.
Policies saved before these permissions existed keep the built-in grants (a saved policy now
records the permissions it was saved with, `_known`).

## Everything else you can edit

| What                                                 | Who                           | Where                                                        | Rules                                                                |
| ---------------------------------------------------- | ----------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| Group name                                           | Owners and moderators         | Web: Details → pencil. Mobile: Details → Rename group        | Empty goes back to the members' names                                |
| Channel name and description                         | Owners and moderators         | Web: Details → pencil. Mobile: Details → Edit name…          | Same name rules as creating a channel                                |
| Task (title, details, priority, due, assignees)      | Creator, assignees, admins    | Web: Tasks → pencil. Mobile: task → Edit                     | Module tasks change in their module                                  |
| Approval request (title, details, amount, decide-by) | The person who asked          | Web: My requests → Edit. Mobile: request → Edit              | Only until someone decides; after that, cancel and ask again         |
| Project (name, description, status, due)             | Owners of the project, admins | Web: Projects → Edit                                         | Samptrek projects change in Samptrek. A new name renames the channel |
| Poll (question, answers, settings)                   | The person who asked          | Web: "Edit poll" on the card. Mobile: long-press → Edit poll | Only while open and nobody has voted; follows the message rules      |
| Status update (words or caption, colour, replies)    | The author                    | Web and mobile: open your status → Edit                      | Audience and expiry stay as posted                                   |

Already editable before this change: scheduled messages, meetings (one or the series), booking
pages, minutes, transcripts, your profile, status and working hours, communities, inbox
conversations and templates, integrations and branding.

API: `PATCH /v1/conversations/:id {name, topic}`, `PATCH /v1/approvals/:id`,
`PATCH /v1/projects/:id`, `PATCH /v1/messages/:id/poll`, `PATCH /v1/network/statuses/:id`.
Each is written to the audit log (`conversation.renamed`, `approval.edited`, `project.edited`,
`poll.edited`).
