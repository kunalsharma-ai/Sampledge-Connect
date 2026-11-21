import {
  CONNECTOR_CATALOG,
  DEFAULT_INBOX_SETTINGS,
  type ClientProfile,
  type InboxActivity,
  type InboxConversation,
  type InboxMessage,
  type InboxNote,
  type InboxSettings,
  type LinkedRecord,
  type SlaState,
} from '@sampledge/contracts';
import type {
  ClientProfileDoc,
  ConnectorDoc,
  ExternalAccountDoc,
  ExternalConversationDoc,
  ExternalMessageDoc,
  InboxActivityDoc,
  InboxNoteDoc,
  InboxSettingsDoc,
  LinkedRecordDoc,
} from '../database/documents.js';

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

export const PREVIEW_LENGTH = 140;
export const preview = (text: string, attachments = 0) => {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t) return t.length > PREVIEW_LENGTH ? `${t.slice(0, PREVIEW_LENGTH - 1)}…` : t;
  return attachments ? `${attachments} attachment${attachments > 1 ? 's' : ''}` : '';
};

export const settingsOf = (doc: InboxSettingsDoc | null): InboxSettings =>
  doc
    ? {
        sla: doc.sla,
        dueSoonRatio: doc.dueSoonRatio,
        autoEscalateOnBreach: doc.autoEscalateOnBreach,
        escalationContactIds: doc.escalationContactIds,
        autoAssign: doc.autoAssign,
        teams: doc.teams,
      }
    : DEFAULT_INBOX_SETTINGS;

export function slaState(
  c: ExternalConversationDoc,
  settings: InboxSettings,
  now = new Date(),
): SlaState {
  if (c.slaDueAt) {
    if (c.slaDueAt <= now) return 'breached';
    const start = c.waitingSince ?? c.createdAt;
    const window = c.slaDueAt.getTime() - start.getTime();
    const used = now.getTime() - start.getTime();
    return window > 0 && used / window >= settings.dueSoonRatio ? 'due_soon' : 'on_track';
  }
  if (c.firstResponseAt) return c.firstResponseMet ? 'met' : 'none';
  return 'none';
}

export const toLink = (l: LinkedRecordDoc): LinkedRecord => ({
  ...l,
  linkedAt: l.linkedAt.toISOString(),
});

export function toConversation(
  c: ExternalConversationDoc,
  connector: Pick<ConnectorDoc, 'environment'> | null,
  client: Pick<ClientProfileDoc, '_id' | 'name' | 'company'> | null,
  settings: InboxSettings,
): InboxConversation {
  return {
    conversationId: c._id,
    connectorId: c.connectorId,
    provider: c.provider,
    testMode: connector?.environment === 'test',
    channelMode: CONNECTOR_CATALOG[c.provider].mode,
    client: {
      clientId: c.clientId,
      name: client?.name ?? 'Unknown client',
      company: client?.company ?? null,
    },
    subject: c.subject,
    status: c.status,
    priority: c.priority,
    assigneeId: c.assigneeId,
    teamId: c.teamId,
    tags: c.tags,
    sla: {
      state: slaState(c, settings),
      dueAt: iso(c.slaDueAt),
      firstResponseAt: iso(c.firstResponseAt),
      breachedAt: iso(c.slaBreachedAt),
    },
    escalation: c.escalation ? { ...c.escalation, at: c.escalation.at.toISOString() } : null,
    links: c.links.map(toLink),
    lastMessage: c.lastMessage ? { ...c.lastMessage, at: c.lastMessage.at.toISOString() } : null,
    awaitingReply: c.awaitingReply,
    snoozedUntil: iso(c.snoozedUntil),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export const toMessage = (m: ExternalMessageDoc): InboxMessage => ({
  messageId: m._id,
  conversationId: m.conversationId,
  direction: m.direction,
  text: m.text,
  attachments: m.attachments,
  authorId: m.authorId,
  accountId: m.accountId,
  externalMessageId: m.externalMessageId,
  clientMessageId: m.clientMessageId,
  deliveryState: m.deliveryState,
  error: m.error,
  attempts: m.attempts,
  handoffUrl: m.handoffUrl,
  sandboxRequest: m.sandboxRequest
    ? { ...m.sandboxRequest, at: m.sandboxRequest.at.toISOString() }
    : null,
  createdAt: m.createdAt.toISOString(),
  sentAt: iso(m.sentAt),
});

export const toNote = (n: InboxNoteDoc): InboxNote => ({
  noteId: n._id,
  conversationId: n.conversationId,
  authorId: n.authorId,
  text: n.text,
  mentions: n.mentions,
  clientNoteId: n.clientNoteId,
  createdAt: n.createdAt.toISOString(),
});

export const toActivity = (a: InboxActivityDoc): InboxActivity => ({
  activityId: a._id,
  conversationId: a.conversationId,
  kind: a.kind as InboxActivity['kind'],
  actorId: a.actorId,
  summary: a.summary,
  createdAt: a.createdAt.toISOString(),
});

export function toClient(
  c: ClientProfileDoc,
  accounts: ExternalAccountDoc[],
  conversations: Pick<ExternalConversationDoc, 'links'>[],
): ClientProfile {
  const seen = new Set<string>();
  const links: LinkedRecord[] = [];
  for (const conv of conversations)
    for (const l of conv.links) {
      const key = `${l.module}:${l.recordType}:${l.externalId}`;
      if (!seen.has(key)) {
        seen.add(key);
        links.push(toLink(l));
      }
    }
  return {
    clientId: c._id,
    name: c.name,
    company: c.company,
    email: c.email,
    phone: c.phone,
    title: c.title,
    tags: c.tags,
    ownerId: c.ownerId,
    identities: accounts.map((a) => ({
      accountId: a._id,
      provider: a.provider,
      connectorId: a.connectorId,
      externalUserId: a.externalUserId,
      displayName: a.displayName,
      handle: a.handle,
    })),
    links,
    conversationCount: conversations.length,
    createdAt: c.createdAt.toISOString(),
  };
}
