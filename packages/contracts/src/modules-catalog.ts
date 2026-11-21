import type { SampledgeModule } from './integrations.js';
import type { ApprovalCategory, TaskKind, TaskPriority } from './work.js';

/**
 * What each Sampledge module sends and what Connect does with it. This catalogue is data, shared
 * by the API (which runs it), the web admin screen (which lists it) and the SDK docs. A module
 * event whose type is not listed here is accepted, logged and ignored (status `ignored`).
 *
 * Conventions for `data` in module events:
 *  - dueAt: ISO date-time.  status: short string.  priority: low|normal|high|urgent.
 *  - amount: { amountMinor: integer, currency: "USD" } (minor units, e.g. cents).
 *  - url: a link to show (test link, file).  fileName: a file's display name.
 *  - Numbers such as completes/target/percent are plain numbers.
 */

export type FactFormat = 'text' | 'date' | 'money' | 'number' | 'percent' | 'url';

export interface FactDef {
  key: string;
  label: string;
  format: FactFormat;
}

/** Where the event's card goes. */
export type ConversationTarget =
  /** The record's own conversation, created on first use. */
  | 'record'
  /** The parent record's conversation (a milestone in its project), created on first use. */
  | 'parent'
  /** A shared module channel, e.g. #hr-announcements, created on first use. */
  | { channel: string; name: string; visibility: 'public' | 'private'; topic: string };

export interface ModuleEventDef {
  type: string;
  label: string;
  description: string;
  tone: 'info' | 'success' | 'warning' | 'danger';
  conversation: ConversationTarget;
  /** Notify `people` from the event (they're added to the conversation first). */
  notify: boolean;
  /** Create a Connect task assigned to `people`. */
  task?: { kind: TaskKind; priority: TaskPriority };
  /** Create an approval; `people` are the approvers. */
  approval?: { category: ApprovalCategory };
  /** Keep the Projects screen current (Samptrek). */
  project?: 'upsert' | 'milestone';
  /** Link `people` (externalUserId + email) to Connect users: directory sync. */
  linkIdentities?: boolean;
  facts: FactDef[];
  /** A realistic example `data`, used by "Send test event" and the SDK docs. */
  example: {
    record: { type: string; id: string; title: string };
    parent?: { type: string; id: string; title: string };
    summary: string;
    data: Record<string, unknown>;
  };
}

export interface ModuleActionDef {
  /** Sent to the module API as POST {baseUrl}/connect/actions with this `type`. */
  type: string;
  label: string;
  description: string;
  /** Offered on records of these types in the conversation context panel. */
  recordTypes: string[];
  /** Run automatically (task created in a linked conversation, approval decided). */
  automatic?: 'task.created' | 'approval.decided';
}

export interface ModuleDef {
  id: SampledgeModule;
  name: string;
  category: string;
  description: string;
  /** Records whose conversations are private and limited to the people involved. */
  restrictedRecordTypes: string[];
  recordTypes: { type: string; label: string }[];
  /** The spec's feature list, each with how Connect delivers it. */
  features: { label: string; how: string }[];
  events: ModuleEventDef[];
  actions: ModuleActionDef[];
}

const due: FactDef = { key: 'dueAt', label: 'Due', format: 'date' };
const status: FactDef = { key: 'status', label: 'Status', format: 'text' };
const amount: FactDef = { key: 'amount', label: 'Amount', format: 'money' };
const link: FactDef = { key: 'url', label: 'Link', format: 'url' };
const file: FactDef = { key: 'fileName', label: 'File', format: 'text' };

const pushTask = (recordTypes: string[]): ModuleActionDef => ({
  type: 'task.created',
  label: 'Send tasks to the module',
  description: 'A task created from chat in a linked conversation is created in the module too.',
  recordTypes,
  automatic: 'task.created',
});
const decided = (recordTypes: string[]): ModuleActionDef => ({
  type: 'approval.decided',
  label: 'Send approval decisions',
  description: 'When an approval from this module is decided, the decision is sent back.',
  recordTypes,
  automatic: 'approval.decided',
});

export const MODULE_CATALOG: Record<SampledgeModule, ModuleDef> = {
  samptrek: {
    id: 'samptrek',
    name: 'Samptrek',
    category: 'Project management',
    description: 'Project channels, milestone and deadline alerts, task assignments, escalations.',
    restrictedRecordTypes: [],
    recordTypes: [
      { type: 'project', label: 'Project' },
      { type: 'milestone', label: 'Milestone' },
      { type: 'task', label: 'Task' },
    ],
    features: [
      { label: 'Automatic project channels', how: 'project.created opens a project channel' },
      { label: 'Project milestone alerts', how: 'milestone.due / milestone.reached cards' },
      { label: 'Project discussions', how: 'The project channel, linked to the project record' },
      { label: 'Task assignments', how: 'task.assigned creates a Connect task for the assignee' },
      { label: 'Escalation workflows', how: 'project.escalated: urgent escalation task + alert' },
      { label: 'Deadline notifications', how: 'deadline.approaching notifies the people named' },
      { label: 'Project-linked attachments', how: 'file.linked posts the file link in the channel' },
      { label: 'Chat-to-task conversion', how: 'Create task from a message; sent to Samptrek' },
    ],
    events: [
      {
        type: 'project.created',
        label: 'Project created',
        description: 'Creates the project channel and adds the project team.',
        tone: 'info',
        conversation: 'record',
        notify: true,
        project: 'upsert',
        facts: [status, due, { key: 'client', label: 'Client', format: 'text' }],
        example: {
          record: { type: 'project', id: 'PRJ-1042', title: 'Northwind brand tracker Q1' },
          summary: 'New project: Northwind brand tracker Q1',
          data: { status: 'active', dueAt: '2026-12-19T17:00:00.000Z', client: 'Northwind' },
        },
      },
      {
        type: 'project.updated',
        label: 'Project updated',
        description: 'Updates the project status and due date.',
        tone: 'info',
        conversation: 'record',
        notify: false,
        project: 'upsert',
        facts: [status, due],
        example: {
          record: { type: 'project', id: 'PRJ-1042', title: 'Northwind brand tracker Q1' },
          summary: 'Project moved to at risk',
          data: { status: 'at_risk', dueAt: '2026-12-19T17:00:00.000Z' },
        },
      },
      {
        type: 'milestone.due',
        label: 'Milestone due',
        description: 'Alerts the project channel that a milestone is due.',
        tone: 'warning',
        conversation: 'parent',
        notify: true,
        project: 'milestone',
        facts: [due],
        example: {
          record: { type: 'milestone', id: 'MS-7', title: 'Questionnaire sign-off' },
          parent: { type: 'project', id: 'PRJ-1042', title: 'Northwind brand tracker Q1' },
          summary: 'Questionnaire sign-off is due tomorrow',
          data: { dueAt: '2026-11-24T17:00:00.000Z', status: 'due' },
        },
      },
      {
        type: 'milestone.reached',
        label: 'Milestone reached',
        description: 'Celebrates a reached milestone in the project channel.',
        tone: 'success',
        conversation: 'parent',
        notify: false,
        project: 'milestone',
        facts: [],
        example: {
          record: { type: 'milestone', id: 'MS-6', title: 'Kick-off complete' },
          parent: { type: 'project', id: 'PRJ-1042', title: 'Northwind brand tracker Q1' },
          summary: 'Kick-off complete',
          data: { status: 'reached' },
        },
      },
      {
        type: 'task.assigned',
        label: 'Task assigned',
        description: 'Creates a Connect task for the assignee, linked to the Samptrek task.',
        tone: 'info',
        conversation: 'parent',
        notify: true,
        task: { kind: 'task', priority: 'normal' },
        facts: [due, { key: 'priority', label: 'Priority', format: 'text' }],
        example: {
          record: { type: 'task', id: 'TSK-311', title: 'Translate screener into German' },
          parent: { type: 'project', id: 'PRJ-1042', title: 'Northwind brand tracker Q1' },
          summary: 'Translate screener into German',
          data: { dueAt: '2026-11-26T12:00:00.000Z', priority: 'high' },
        },
      },
      {
        type: 'deadline.approaching',
        label: 'Deadline approaching',
        description: 'Notifies the people named that a deadline is close.',
        tone: 'warning',
        conversation: 'parent',
        notify: true,
        facts: [due],
        example: {
          record: { type: 'task', id: 'TSK-311', title: 'Translate screener into German' },
          parent: { type: 'project', id: 'PRJ-1042', title: 'Northwind brand tracker Q1' },
          summary: 'Due in 24 hours',
          data: { dueAt: '2026-11-26T12:00:00.000Z' },
        },
      },
      {
        type: 'project.escalated',
        label: 'Project escalated',
        description: 'Posts an escalation and creates an urgent escalation task.',
        tone: 'danger',
        conversation: 'record',
        notify: true,
        task: { kind: 'escalation', priority: 'urgent' },
        facts: [{ key: 'reason', label: 'Reason', format: 'text' }],
        example: {
          record: { type: 'project', id: 'PRJ-1042', title: 'Northwind brand tracker Q1' },
          summary: 'Fieldwork is 3 days behind plan',
          data: { reason: 'Low incidence in DE sample' },
        },
      },
      {
        type: 'file.linked',
        label: 'File linked',
        description: 'Shares a project file link in the project channel.',
        tone: 'info',
        conversation: 'parent',
        notify: false,
        facts: [file, link],
        example: {
          record: { type: 'file', id: 'FILE-88', title: 'Questionnaire v3.docx' },
          parent: { type: 'project', id: 'PRJ-1042', title: 'Northwind brand tracker Q1' },
          summary: 'Questionnaire v3 uploaded',
          data: { fileName: 'Questionnaire v3.docx', url: 'https://samptrek.example/files/88' },
        },
      },
    ],
    actions: [pushTask(['project', 'milestone', 'task'])],
  },
  sampleaudience: {
    id: 'sampleaudience',
    name: 'SampleAudience',
    category: 'Sample marketplace',
    description: 'Supplier channels, feasibility, delivery and quota alerts, supplier escalations.',
    restrictedRecordTypes: [],
    recordTypes: [
      { type: 'supplier', label: 'Supplier' },
      { type: 'job', label: 'Sample job' },
    ],
    features: [
      { label: 'Supplier communication', how: 'Each supplier gets a vendor channel' },
      { label: 'Feasibility discussions', how: 'feasibility.requested opens a job conversation' },
      { label: 'Sample delivery updates', how: 'delivery.updated cards with completes vs target' },
      { label: 'Quota alerts', how: 'quota.alert notifies the people named' },
      { label: 'Supplier issue escalation', how: 'supplier.issue: alert + escalation task' },
      { label: 'Vendor-specific channels', how: 'supplier.onboarded creates the vendor channel' },
      { label: 'Sampling performance notifications', how: 'performance.report cards' },
    ],
    events: [
      {
        type: 'supplier.onboarded',
        label: 'Supplier onboarded',
        description: 'Creates the vendor channel for a supplier.',
        tone: 'info',
        conversation: 'record',
        notify: true,
        facts: [{ key: 'country', label: 'Country', format: 'text' }],
        example: {
          record: { type: 'supplier', id: 'SUP-19', title: 'PanelPoint GmbH' },
          summary: 'PanelPoint GmbH joined the marketplace',
          data: { country: 'Germany' },
        },
      },
      {
        type: 'feasibility.requested',
        label: 'Feasibility requested',
        description: 'Opens a discussion for a feasibility check.',
        tone: 'info',
        conversation: 'record',
        notify: true,
        facts: [
          { key: 'target', label: 'Target completes', format: 'number' },
          { key: 'incidence', label: 'Incidence', format: 'percent' },
          due,
        ],
        example: {
          record: { type: 'job', id: 'JOB-5521', title: 'DE gen pop n=1,000' },
          summary: 'Can we deliver 1,000 completes at 18% incidence?',
          data: { target: 1000, incidence: 18, dueAt: '2026-11-25T10:00:00.000Z' },
        },
      },
      {
        type: 'delivery.updated',
        label: 'Delivery update',
        description: 'Posts sample delivery progress.',
        tone: 'info',
        conversation: 'record',
        notify: false,
        facts: [
          { key: 'completes', label: 'Completes', format: 'number' },
          { key: 'target', label: 'Target', format: 'number' },
        ],
        example: {
          record: { type: 'job', id: 'JOB-5521', title: 'DE gen pop n=1,000' },
          summary: '640 of 1,000 completes delivered',
          data: { completes: 640, target: 1000 },
        },
      },
      {
        type: 'quota.alert',
        label: 'Quota alert',
        description: 'Warns that a quota cell is behind or full.',
        tone: 'warning',
        conversation: 'record',
        notify: true,
        facts: [
          { key: 'quota', label: 'Quota', format: 'text' },
          { key: 'percent', label: 'Filled', format: 'percent' },
        ],
        example: {
          record: { type: 'job', id: 'JOB-5521', title: 'DE gen pop n=1,000' },
          summary: 'Women 18-24 is only 22% filled',
          data: { quota: 'Women 18-24', percent: 22 },
        },
      },
      {
        type: 'supplier.issue',
        label: 'Supplier issue',
        description: 'Escalates a supplier problem and creates an escalation task.',
        tone: 'danger',
        conversation: 'record',
        notify: true,
        task: { kind: 'escalation', priority: 'high' },
        facts: [{ key: 'issue', label: 'Issue', format: 'text' }],
        example: {
          record: { type: 'supplier', id: 'SUP-19', title: 'PanelPoint GmbH' },
          summary: 'Duplicate respondents detected in JOB-5521',
          data: { issue: 'Duplicate respondents' },
        },
      },
      {
        type: 'performance.report',
        label: 'Sampling performance',
        description: 'Posts a supplier performance summary.',
        tone: 'info',
        conversation: 'record',
        notify: false,
        facts: [
          { key: 'conversion', label: 'Conversion', format: 'percent' },
          { key: 'dropout', label: 'Drop-out', format: 'percent' },
        ],
        example: {
          record: { type: 'supplier', id: 'SUP-19', title: 'PanelPoint GmbH' },
          summary: 'Weekly performance for PanelPoint GmbH',
          data: { conversion: 31, dropout: 12 },
        },
      },
    ],
    actions: [
      {
        type: 'supplier.message',
        label: 'Send to supplier',
        description: 'Forward a message from the vendor channel to the supplier in SampleAudience.',
        recordTypes: ['supplier', 'job'],
      },
    ],
  },
  sampcode: {
    id: 'sampcode',
    name: 'Sampcode',
    category: 'Survey programming',
    description: 'Survey discussions, QA issues, test links, survey approvals, launch readiness.',
    restrictedRecordTypes: [],
    recordTypes: [{ type: 'survey', label: 'Survey' }],
    features: [
      { label: 'Survey programming discussions', how: 'survey.created opens a survey channel' },
      { label: 'QA issue reporting', how: 'qa.issue.reported posts the issue' },
      { label: 'Test-link sharing', how: 'testlink.shared posts the link' },
      { label: 'Bug-to-task conversion', how: 'QA issues become bug tasks; sent back to Sampcode' },
      { label: 'Survey approval workflows', how: 'survey.approval.requested creates an approval' },
      { label: 'Launch readiness notifications', how: 'launch.ready notifies the team' },
      { label: 'Technical incident discussions', how: 'incident.opened: alert + urgent task' },
    ],
    events: [
      {
        type: 'survey.created',
        label: 'Survey created',
        description: 'Opens the survey programming conversation.',
        tone: 'info',
        conversation: 'record',
        notify: true,
        facts: [{ key: 'platform', label: 'Platform', format: 'text' }, due],
        example: {
          record: { type: 'survey', id: 'SV-2207', title: 'Northwind tracker wave 5' },
          summary: 'Programming started',
          data: { platform: 'Sampcode', dueAt: '2026-11-28T09:00:00.000Z' },
        },
      },
      {
        type: 'qa.issue.reported',
        label: 'QA issue',
        description: 'Posts a QA issue and creates a bug task for the programmer.',
        tone: 'warning',
        conversation: 'record',
        notify: true,
        task: { kind: 'bug', priority: 'high' },
        facts: [
          { key: 'question', label: 'Question', format: 'text' },
          { key: 'severity', label: 'Severity', format: 'text' },
        ],
        example: {
          record: { type: 'survey', id: 'SV-2207', title: 'Northwind tracker wave 5' },
          summary: 'Q12 skips to Q15 when "Other" is selected',
          data: { question: 'Q12', severity: 'major' },
        },
      },
      {
        type: 'testlink.shared',
        label: 'Test link',
        description: 'Shares a survey test link.',
        tone: 'info',
        conversation: 'record',
        notify: true,
        facts: [link],
        example: {
          record: { type: 'survey', id: 'SV-2207', title: 'Northwind tracker wave 5' },
          summary: 'Test link ready for QA',
          data: { url: 'https://sampcode.example/t/SV-2207?test=1' },
        },
      },
      {
        type: 'survey.approval.requested',
        label: 'Survey approval',
        description: 'Asks the people named to approve the survey for launch.',
        tone: 'info',
        conversation: 'record',
        notify: true,
        approval: { category: 'survey' },
        facts: [link],
        example: {
          record: { type: 'survey', id: 'SV-2207', title: 'Northwind tracker wave 5' },
          summary: 'Approve wave 5 for soft launch',
          data: { url: 'https://sampcode.example/t/SV-2207?test=1' },
        },
      },
      {
        type: 'launch.ready',
        label: 'Ready to launch',
        description: 'Tells the team the survey passed QA and is ready to launch.',
        tone: 'success',
        conversation: 'record',
        notify: true,
        facts: [],
        example: {
          record: { type: 'survey', id: 'SV-2207', title: 'Northwind tracker wave 5' },
          summary: 'All QA checks passed',
          data: {},
        },
      },
      {
        type: 'incident.opened',
        label: 'Technical incident',
        description: 'Opens an incident discussion and an urgent escalation task.',
        tone: 'danger',
        conversation: 'record',
        notify: true,
        task: { kind: 'escalation', priority: 'urgent' },
        facts: [{ key: 'impact', label: 'Impact', format: 'text' }],
        example: {
          record: { type: 'survey', id: 'SV-2207', title: 'Northwind tracker wave 5' },
          summary: 'Survey returns 500 errors on mobile',
          data: { impact: 'Fieldwork paused' },
        },
      },
    ],
    actions: [pushTask(['survey']), decided(['survey'])],
  },
  sampbidx: {
    id: 'sampbidx',
    name: 'SampBidX',
    category: 'Bidding CRM',
    description: 'Bid collaboration, pricing approvals, quotations, proposals and deadlines.',
    restrictedRecordTypes: [],
    recordTypes: [{ type: 'bid', label: 'Bid' }],
    features: [
      { label: 'Bid collaboration', how: 'bid.created opens a bid conversation' },
      { label: 'Pricing approvals', how: 'pricing.approval.requested creates an approval' },
      { label: 'Quotation discussions', how: 'quotation.updated posts the new figure' },
      { label: 'Proposal notifications', how: 'proposal.sent notifies the bid team' },
      { label: 'Deadline reminders', how: 'bid.deadline.approaching notifies the people named' },
      { label: 'Internal bid escalation', how: 'bid.escalated: alert + escalation task' },
      { label: 'Bid-linked conversation history', how: 'Every bid card lives in its bid chat' },
    ],
    events: [
      {
        type: 'bid.created',
        label: 'Bid created',
        description: 'Opens the bid conversation.',
        tone: 'info',
        conversation: 'record',
        notify: true,
        facts: [{ key: 'client', label: 'Client', format: 'text' }, due],
        example: {
          record: { type: 'bid', id: 'BID-903', title: 'Contoso usage & attitude study' },
          summary: 'New RFP from Contoso',
          data: { client: 'Contoso', dueAt: '2026-11-27T15:00:00.000Z' },
        },
      },
      {
        type: 'pricing.approval.requested',
        label: 'Pricing approval',
        description: 'Asks the people named to approve the bid price.',
        tone: 'info',
        conversation: 'record',
        notify: true,
        approval: { category: 'pricing' },
        facts: [amount, { key: 'margin', label: 'Margin', format: 'percent' }],
        example: {
          record: { type: 'bid', id: 'BID-903', title: 'Contoso usage & attitude study' },
          summary: 'Approve price for Contoso U&A',
          data: { amount: { amountMinor: 4850000, currency: 'USD' }, margin: 34 },
        },
      },
      {
        type: 'quotation.updated',
        label: 'Quotation updated',
        description: 'Posts the updated quotation.',
        tone: 'info',
        conversation: 'record',
        notify: false,
        facts: [amount],
        example: {
          record: { type: 'bid', id: 'BID-903', title: 'Contoso usage & attitude study' },
          summary: 'Quotation revised after scope change',
          data: { amount: { amountMinor: 5120000, currency: 'USD' } },
        },
      },
      {
        type: 'proposal.sent',
        label: 'Proposal sent',
        description: 'Tells the bid team the proposal went to the client.',
        tone: 'success',
        conversation: 'record',
        notify: true,
        facts: [],
        example: {
          record: { type: 'bid', id: 'BID-903', title: 'Contoso usage & attitude study' },
          summary: 'Proposal sent to Contoso',
          data: {},
        },
      },
      {
        type: 'bid.deadline.approaching',
        label: 'Bid deadline',
        description: 'Reminds the people named of the submission deadline.',
        tone: 'warning',
        conversation: 'record',
        notify: true,
        facts: [due],
        example: {
          record: { type: 'bid', id: 'BID-903', title: 'Contoso usage & attitude study' },
          summary: 'Submission due in 6 hours',
          data: { dueAt: '2026-11-27T15:00:00.000Z' },
        },
      },
      {
        type: 'bid.escalated',
        label: 'Bid escalated',
        description: 'Escalates a bid internally with an escalation task.',
        tone: 'danger',
        conversation: 'record',
        notify: true,
        task: { kind: 'escalation', priority: 'high' },
        facts: [{ key: 'reason', label: 'Reason', format: 'text' }],
        example: {
          record: { type: 'bid', id: 'BID-903', title: 'Contoso usage & attitude study' },
          summary: 'Client asks for 20% discount',
          data: { reason: 'Discount above approval limit' },
        },
      },
    ],
    actions: [decided(['bid'])],
  },
  sampforce: {
    id: 'sampforce',
    name: 'SampForce',
    category: 'Sales CRM',
    description: 'Lead and deal conversations, client history, follow-ups, CRM actions from chat.',
    restrictedRecordTypes: [],
    recordTypes: [
      { type: 'lead', label: 'Lead' },
      { type: 'opportunity', label: 'Opportunity' },
    ],
    features: [
      { label: 'Lead-linked conversations', how: 'lead.created opens a lead conversation' },
      { label: 'Client communication history', how: 'client.message.logged cards' },
      { label: 'Sales follow-ups', how: 'followup.due creates a follow-up task' },
      { label: 'Deal notifications', how: 'deal.stage.changed / deal.won cards' },
      { label: 'Client assignment', how: 'client.assigned adds and notifies the owner' },
      { label: 'Opportunity-linked files', how: 'file.linked posts the file link' },
      { label: 'Conversation-to-CRM actions', how: 'Log a message or create a follow-up in CRM' },
    ],
    events: [
      {
        type: 'lead.created',
        label: 'Lead created',
        description: 'Opens a conversation for a new lead.',
        tone: 'info',
        conversation: 'record',
        notify: true,
        facts: [
          { key: 'company', label: 'Company', format: 'text' },
          { key: 'source', label: 'Source', format: 'text' },
        ],
        example: {
          record: { type: 'lead', id: 'LD-4410', title: 'Fabrikam: brand health' },
          summary: 'Inbound lead from Fabrikam',
          data: { company: 'Fabrikam', source: 'Website' },
        },
      },
      {
        type: 'opportunity.created',
        label: 'Opportunity created',
        description: 'Opens a conversation for a new opportunity.',
        tone: 'info',
        conversation: 'record',
        notify: true,
        facts: [amount, { key: 'stage', label: 'Stage', format: 'text' }],
        example: {
          record: { type: 'opportunity', id: 'OP-218', title: 'Fabrikam brand health 2027' },
          summary: 'Opportunity opened',
          data: { amount: { amountMinor: 12000000, currency: 'USD' }, stage: 'Qualification' },
        },
      },
      {
        type: 'client.message.logged',
        label: 'Client communication',
        description: 'Adds a client email or call to the conversation history.',
        tone: 'info',
        conversation: 'record',
        notify: false,
        facts: [{ key: 'channel', label: 'Channel', format: 'text' }],
        example: {
          record: { type: 'opportunity', id: 'OP-218', title: 'Fabrikam brand health 2027' },
          summary: 'Client asked for a revised timeline',
          data: { channel: 'Email' },
        },
      },
      {
        type: 'followup.due',
        label: 'Follow-up due',
        description: 'Creates a follow-up task for the account owner.',
        tone: 'warning',
        conversation: 'record',
        notify: true,
        task: { kind: 'follow_up', priority: 'normal' },
        facts: [due],
        example: {
          record: { type: 'opportunity', id: 'OP-218', title: 'Fabrikam brand health 2027' },
          summary: 'Send the revised timeline to Fabrikam',
          data: { dueAt: '2026-11-24T16:00:00.000Z' },
        },
      },
      {
        type: 'deal.stage.changed',
        label: 'Deal stage changed',
        description: 'Posts the new deal stage.',
        tone: 'info',
        conversation: 'record',
        notify: false,
        facts: [{ key: 'stage', label: 'Stage', format: 'text' }, amount],
        example: {
          record: { type: 'opportunity', id: 'OP-218', title: 'Fabrikam brand health 2027' },
          summary: 'Moved to Negotiation',
          data: { stage: 'Negotiation', amount: { amountMinor: 11500000, currency: 'USD' } },
        },
      },
      {
        type: 'deal.won',
        label: 'Deal won',
        description: 'Celebrates a won deal.',
        tone: 'success',
        conversation: 'record',
        notify: true,
        facts: [amount],
        example: {
          record: { type: 'opportunity', id: 'OP-218', title: 'Fabrikam brand health 2027' },
          summary: 'Fabrikam signed',
          data: { amount: { amountMinor: 11500000, currency: 'USD' } },
        },
      },
      {
        type: 'client.assigned',
        label: 'Client assigned',
        description: 'Adds the new account owner to the conversation and notifies them.',
        tone: 'info',
        conversation: 'record',
        notify: true,
        facts: [],
        example: {
          record: { type: 'lead', id: 'LD-4410', title: 'Fabrikam: brand health' },
          summary: 'You now own Fabrikam',
          data: {},
        },
      },
      {
        type: 'file.linked',
        label: 'File linked',
        description: 'Shares an opportunity file link.',
        tone: 'info',
        conversation: 'record',
        notify: false,
        facts: [file, link],
        example: {
          record: { type: 'opportunity', id: 'OP-218', title: 'Fabrikam brand health 2027' },
          summary: 'Signed SOW uploaded',
          data: { fileName: 'Fabrikam SOW.pdf', url: 'https://sampforce.example/files/9' },
        },
      },
    ],
    actions: [
      {
        type: 'crm.activity.log',
        label: 'Log to SampForce',
        description: 'Log a message from this conversation as an activity on the CRM record.',
        recordTypes: ['lead', 'opportunity'],
      },
      {
        type: 'crm.followup.create',
        label: 'Create CRM follow-up',
        description: 'Create a follow-up on the CRM record from this conversation.',
        recordTypes: ['lead', 'opportunity'],
      },
    ],
  },
  sampcrew: {
    id: 'sampcrew',
    name: 'SampCrew',
    category: 'HR CRM',
    description: 'Announcements, onboarding, leave, HR support and policy discussions, directory.',
    restrictedRecordTypes: ['employee', 'leave_request', 'hr_case'],
    recordTypes: [
      { type: 'employee', label: 'Employee' },
      { type: 'leave_request', label: 'Leave request' },
      { type: 'hr_case', label: 'HR case' },
      { type: 'announcement', label: 'Announcement' },
      { type: 'policy', label: 'Policy' },
    ],
    features: [
      { label: 'Employee announcements', how: 'announcement.published posts in #announcements' },
      { label: 'Onboarding communication', how: 'onboarding.started opens a private onboarding chat' },
      { label: 'Leave notifications', how: 'leave.requested approval, leave.decided card' },
      { label: 'HR support channels', how: 'hr.case.opened opens a private case chat with HR' },
      { label: 'Internal policy discussions', how: 'policy.published posts in #policies' },
      { label: 'Employee directory', how: 'employee.synced links SampCrew people to Connect users' },
      {
        label: 'Permission-sensitive HR conversations',
        how: 'Employee, leave and case chats are private to the people named',
      },
    ],
    events: [
      {
        type: 'announcement.published',
        label: 'Announcement',
        description: 'Posts an HR announcement in #announcements.',
        tone: 'info',
        conversation: {
          channel: 'announcements',
          name: 'announcements',
          visibility: 'public',
          topic: 'Company announcements from SampCrew',
        },
        notify: false,
        facts: [],
        example: {
          record: { type: 'announcement', id: 'AN-55', title: 'Office closed 24 December' },
          summary: 'Our offices are closed on 24 December. Enjoy the break!',
          data: {},
        },
      },
      {
        type: 'policy.published',
        label: 'Policy published',
        description: 'Posts a new or changed policy in #policies for discussion.',
        tone: 'info',
        conversation: {
          channel: 'policies',
          name: 'policies',
          visibility: 'public',
          topic: 'Internal policies from SampCrew',
        },
        notify: false,
        facts: [link],
        example: {
          record: { type: 'policy', id: 'POL-12', title: 'Remote work policy 2027' },
          summary: 'Updated remote work policy, effective 1 January',
          data: { url: 'https://sampcrew.example/policies/12' },
        },
      },
      {
        type: 'onboarding.started',
        label: 'Onboarding started',
        description: 'Opens a private onboarding conversation for a new hire.',
        tone: 'info',
        conversation: 'record',
        notify: true,
        facts: [{ key: 'startDate', label: 'Start date', format: 'date' }],
        example: {
          record: { type: 'employee', id: 'EMP-301', title: 'Onboarding: Lena Fischer' },
          summary: 'Welcome Lena! Your onboarding plan is ready.',
          data: { startDate: '2026-12-01T09:00:00.000Z' },
        },
      },
      {
        type: 'leave.requested',
        label: 'Leave request',
        description: 'Asks the manager named to approve leave (private to them and HR).',
        tone: 'info',
        conversation: 'record',
        notify: true,
        approval: { category: 'leave' },
        facts: [
          { key: 'from', label: 'From', format: 'date' },
          { key: 'to', label: 'To', format: 'date' },
        ],
        example: {
          record: { type: 'leave_request', id: 'LV-77', title: 'Leave: 22–26 Dec' },
          summary: 'Annual leave request',
          data: { from: '2026-12-22T00:00:00.000Z', to: '2026-12-26T00:00:00.000Z' },
        },
      },
      {
        type: 'leave.decided',
        label: 'Leave decided',
        description: 'Tells the employee their leave was approved or declined.',
        tone: 'success',
        conversation: 'record',
        notify: true,
        facts: [status],
        example: {
          record: { type: 'leave_request', id: 'LV-77', title: 'Leave: 22–26 Dec' },
          summary: 'Leave approved',
          data: { status: 'approved' },
        },
      },
      {
        type: 'hr.case.opened',
        label: 'HR case',
        description: 'Opens a private HR support conversation.',
        tone: 'warning',
        conversation: 'record',
        notify: true,
        facts: [{ key: 'topic', label: 'Topic', format: 'text' }],
        example: {
          record: { type: 'hr_case', id: 'HR-204', title: 'HR case HR-204' },
          summary: 'Question about parental leave',
          data: { topic: 'Benefits' },
        },
      },
      {
        type: 'employee.synced',
        label: 'Directory sync',
        description: 'Links SampCrew employees to Connect users by email (no message is posted).',
        tone: 'info',
        conversation: 'record',
        notify: false,
        linkIdentities: true,
        facts: [],
        example: {
          record: { type: 'employee', id: 'EMP-301', title: 'Lena Fischer' },
          summary: 'Employee synced',
          data: {},
        },
      },
    ],
    actions: [decided(['leave_request'])],
  },
  talk2tax: {
    id: 'talk2tax',
    name: 'Talk2Tax',
    category: 'Finance',
    description: 'Invoices, payment reminders and escalations, expense and budget approvals.',
    restrictedRecordTypes: ['invoice', 'expense', 'budget', 'payment'],
    recordTypes: [
      { type: 'invoice', label: 'Invoice' },
      { type: 'expense', label: 'Expense' },
      { type: 'budget', label: 'Budget' },
    ],
    features: [
      { label: 'Invoice discussions', how: 'invoice.created opens a private invoice chat' },
      { label: 'Payment reminders', how: 'payment.reminder notifies the people named' },
      { label: 'Expense approvals', how: 'expense.submitted creates an approval' },
      { label: 'Finance team channels', how: 'finance.notice posts in the private #finance-team' },
      { label: 'Payment escalation', how: 'payment.overdue: alert + escalation task' },
      { label: 'Budget approval discussions', how: 'budget.approval.requested approval + chat' },
      {
        label: 'Permission-controlled financial attachments',
        how: 'Finance records and their files live in private chats limited to the people named',
      },
    ],
    events: [
      {
        type: 'invoice.created',
        label: 'Invoice created',
        description: 'Opens a private conversation about an invoice.',
        tone: 'info',
        conversation: 'record',
        notify: true,
        facts: [amount, due, { key: 'client', label: 'Client', format: 'text' }],
        example: {
          record: { type: 'invoice', id: 'INV-2026-118', title: 'Invoice INV-2026-118' },
          summary: 'Invoice issued to Northwind',
          data: {
            amount: { amountMinor: 1875000, currency: 'EUR' },
            dueAt: '2026-12-15T00:00:00.000Z',
            client: 'Northwind',
          },
        },
      },
      {
        type: 'payment.reminder',
        label: 'Payment reminder',
        description: 'Reminds the people named that a payment is due.',
        tone: 'warning',
        conversation: 'record',
        notify: true,
        facts: [amount, due],
        example: {
          record: { type: 'invoice', id: 'INV-2026-118', title: 'Invoice INV-2026-118' },
          summary: 'Payment due in 3 days',
          data: { amount: { amountMinor: 1875000, currency: 'EUR' }, dueAt: '2026-12-15T00:00:00.000Z' },
        },
      },
      {
        type: 'payment.overdue',
        label: 'Payment overdue',
        description: 'Escalates an overdue payment with an escalation task.',
        tone: 'danger',
        conversation: 'record',
        notify: true,
        task: { kind: 'escalation', priority: 'high' },
        facts: [amount, { key: 'daysOverdue', label: 'Days overdue', format: 'number' }],
        example: {
          record: { type: 'invoice', id: 'INV-2026-118', title: 'Invoice INV-2026-118' },
          summary: 'Payment is 10 days overdue',
          data: { amount: { amountMinor: 1875000, currency: 'EUR' }, daysOverdue: 10 },
        },
      },
      {
        type: 'expense.submitted',
        label: 'Expense approval',
        description: 'Asks the people named to approve an expense.',
        tone: 'info',
        conversation: 'record',
        notify: true,
        approval: { category: 'expense' },
        facts: [amount, { key: 'category', label: 'Category', format: 'text' }],
        example: {
          record: { type: 'expense', id: 'EXP-930', title: 'Expense EXP-930: client workshop' },
          summary: 'Travel and venue for the Northwind workshop',
          data: { amount: { amountMinor: 128900, currency: 'EUR' }, category: 'Travel' },
        },
      },
      {
        type: 'budget.approval.requested',
        label: 'Budget approval',
        description: 'Opens a budget discussion and asks the people named to approve it.',
        tone: 'info',
        conversation: 'record',
        notify: true,
        approval: { category: 'budget' },
        facts: [amount, { key: 'period', label: 'Period', format: 'text' }],
        example: {
          record: { type: 'budget', id: 'BUD-2027-RES', title: 'Research ops budget 2027' },
          summary: 'Approve the 2027 research ops budget',
          data: { amount: { amountMinor: 32000000, currency: 'EUR' }, period: 'FY2027' },
        },
      },
      {
        type: 'finance.notice',
        label: 'Finance team notice',
        description: 'Posts a notice in the private #finance-team channel.',
        tone: 'info',
        conversation: {
          channel: 'finance-team',
          name: 'finance-team',
          visibility: 'private',
          topic: 'Finance team (Talk2Tax)',
        },
        notify: true,
        facts: [],
        example: {
          record: { type: 'notice', id: 'FN-12', title: 'Month-end close' },
          summary: 'Month-end close starts Friday. Submit expenses by Thursday.',
          data: {},
        },
      },
      {
        type: 'attachment.linked',
        label: 'Financial document',
        description: 'Shares a link to a financial document in the record’s private chat.',
        tone: 'info',
        conversation: 'record',
        notify: false,
        facts: [file, link],
        example: {
          record: { type: 'invoice', id: 'INV-2026-118', title: 'Invoice INV-2026-118' },
          summary: 'Invoice PDF attached',
          data: { fileName: 'INV-2026-118.pdf', url: 'https://talk2tax.example/docs/118' },
        },
      },
    ],
    actions: [decided(['expense', 'budget'])],
  },
};

export function moduleEventDef(module: SampledgeModule, type: string): ModuleEventDef | null {
  return MODULE_CATALOG[module].events.find((e) => e.type === type) ?? null;
}

/** HR and finance records get private conversations limited to the people involved. */
export function isRestrictedRecord(module: SampledgeModule, recordType: string): boolean {
  return MODULE_CATALOG[module].restrictedRecordTypes.includes(recordType);
}

/** Formats a fact value for a card ("€18,750.00", "24 Nov 2026"). */
export function formatFact(format: FactFormat, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  switch (format) {
    case 'money': {
      const v = value as { amountMinor?: unknown; currency?: unknown };
      if (typeof v?.amountMinor !== 'number' || typeof v.currency !== 'string') return null;
      try {
        return new Intl.NumberFormat('en', { style: 'currency', currency: v.currency }).format(
          v.amountMinor / 100,
        );
      } catch {
        return `${(v.amountMinor / 100).toFixed(2)} ${v.currency}`;
      }
    }
    case 'date': {
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) return null;
      return d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      });
    }
    case 'number':
      return typeof value === 'number' ? value.toLocaleString('en') : null;
    case 'percent':
      return typeof value === 'number' ? `${value}%` : null;
    case 'url':
      return typeof value === 'string' && /^https?:\/\//.test(value) ? value : null;
    default:
      return typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, 200) : null;
  }
}
