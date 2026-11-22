'use client';
import * as React from 'react';
import {
  uuidv7,
  type AddLinkRequest,
  type ClientProfile,
  type Connector,
  type ConnectorDescriptor,
  type CreateConnectorRequest,
  type CreateInboxConversationRequest,
  type InboxAnalytics,
  type InboxConversation,
  type InboxConversationDetail,
  type InboxList,
  type InboxMessage,
  type InboxNote,
  type InboxSettings,
  type InboxTemplate,
  type ListInboxQuery,
  type RotateCredentialsRequest,
  type SimulateInboundRequest,
  type TestConnectorResult,
  type UpdateConnectorRequest,
  type UpdateInboxConversationRequest,
  type UpsertTemplateRequest,
} from '@sampledge/contracts';
import { ApiFailure, apiRequest } from './api';
import { useAuth } from './auth';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEngine, useEngineChange } from './engine';

export function useInboxApi() {
  const { getAccessToken } = useAuth();
  return React.useMemo(() => {
    const req = async <T>(method: string, path: string, body?: unknown) =>
      apiRequest<T>(method, path, { token: await getAccessToken(), body });
    const qs = (q: Record<string, string | number | undefined>) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v));
      return p.toString();
    };
    return {
      list: (q: ListInboxQuery) =>
        req<InboxList>('GET', `/v1/inbox/conversations?${qs(q as Record<string, string>)}`),
      detail: (id: string) => req<InboxConversationDetail>('GET', `/v1/inbox/conversations/${id}`),
      update: (id: string, body: UpdateInboxConversationRequest) =>
        req<InboxConversationDetail>('PATCH', `/v1/inbox/conversations/${id}`, body),
      reply: (id: string, body: { clientMessageId: string; text: string; templateId?: string }) =>
        req<InboxMessage>('POST', `/v1/inbox/conversations/${id}/replies`, body),
      retry: (id: string, messageId: string) =>
        req<InboxMessage>('POST', `/v1/inbox/conversations/${id}/replies/${messageId}/retry`),
      note: (id: string, body: { clientNoteId: string; text: string; mentions: string[] }) =>
        req<InboxNote>('POST', `/v1/inbox/conversations/${id}/notes`, body),
      escalate: (id: string, body: { reason: string; toUserId?: string }) =>
        req<InboxConversationDetail>('POST', `/v1/inbox/conversations/${id}/escalate`, body),
      link: (id: string, body: AddLinkRequest) =>
        req<InboxConversationDetail>('POST', `/v1/inbox/conversations/${id}/links`, body),
      unlink: (id: string, linkId: string) =>
        req<InboxConversationDetail>('DELETE', `/v1/inbox/conversations/${id}/links/${linkId}`),
      logInbound: (id: string, text: string) =>
        req<InboxConversationDetail>('POST', `/v1/inbox/conversations/${id}/log-inbound`, { text }),
      createHandoff: (body: CreateInboxConversationRequest) =>
        req<InboxConversationDetail>('POST', '/v1/inbox/conversations', body),
      updateClient: (id: string, body: Partial<ClientProfile>) =>
        req<ClientProfile>('PATCH', `/v1/inbox/clients/${id}`, body),
      searchClients: (q: string) => req<ClientProfile[]>('GET', `/v1/inbox/clients?${qs({ q })}`),
      mergeClient: (id: string, fromClientId: string) =>
        req<ClientProfile>('POST', `/v1/inbox/clients/${id}/merge`, { fromClientId }),
      templates: () => req<InboxTemplate[]>('GET', '/v1/inbox/templates'),
      saveTemplate: (id: string | null, body: UpsertTemplateRequest) =>
        id
          ? req<InboxTemplate>('PUT', `/v1/inbox/templates/${id}`, body)
          : req<InboxTemplate>('POST', '/v1/inbox/templates', body),
      deleteTemplate: (id: string) => req<{ deleted: true }>('DELETE', `/v1/inbox/templates/${id}`),
      settings: () => req<InboxSettings>('GET', '/v1/inbox/settings'),
      saveSettings: (s: InboxSettings) => req<InboxSettings>('PUT', '/v1/inbox/settings', s),
      analytics: (days: number) => req<InboxAnalytics>('GET', `/v1/inbox/analytics?days=${days}`),
      catalog: () => req<ConnectorDescriptor[]>('GET', '/v1/connectors/catalog'),
      connectors: () => req<Connector[]>('GET', '/v1/connectors'),
      createConnector: (body: CreateConnectorRequest) =>
        req<Connector>('POST', '/v1/connectors', body),
      updateConnector: (id: string, body: UpdateConnectorRequest) =>
        req<Connector>('PATCH', `/v1/connectors/${id}`, body),
      rotateCredentials: (id: string, body: RotateCredentialsRequest) =>
        req<Connector>('PUT', `/v1/connectors/${id}/credentials`, body),
      rotateWebhookUrl: (id: string) => req<Connector>('POST', `/v1/connectors/${id}/webhook-url`),
      testConnector: (id: string) => req<TestConnectorResult>('POST', `/v1/connectors/${id}/test`),
      simulate: (id: string, body: SimulateInboundRequest) =>
        req<{ accepted: boolean; conversationIds: string[] }>(
          'POST',
          `/v1/connectors/${id}/simulate-inbound`,
          body,
        ),
      removeConnector: (id: string) => req<{ deleted: true }>('DELETE', `/v1/connectors/${id}`),
    };
  }, [getAccessToken]);
}
export type InboxApi = ReturnType<typeof useInboxApi>;

/** A reply or note waiting in this device's action queue (offline, or refused by the server). */
export interface PendingInboxItem {
  kind: 'reply' | 'note';
  id: string;
  conversationId: string;
  text: string;
  mentions?: string[];
  templateId?: string;
  createdAt: string;
  error?: string;
}

/** Conversation fields an agent can change offline; queued per field so the last choice wins. */
type QueuedUpdate = UpdateInboxConversationRequest;

const LEGACY_OUTBOX_KEY = 'inbox.outbox';
const LIST_KEY = 'inbox.list';
const detailKey = (id: string) => `inbox.detail.${id}`;
const isInboxKey = (key: string) => key.startsWith('inbox-');
const replyKey = (kind: 'reply' | 'note', id: string) => `inbox-${kind}|${id}`;
const updateKey = (id: string, fields: string[]) => `inbox-update|${id}|${fields.sort().join(',')}`;
const readKey = (id: string) => `inbox-read|${id}`;

/**
 * Inbox data for the signed-in agent: REST, kept fresh by `inbox:changed` socket events and
 * refetched on reconnect, and cached in this identity's IndexedDB so the inbox opens offline.
 * Replies, notes, ownership changes and read marks go through the shared durable action queue
 * (`engine.queueAction`): saved first, sent in order when connected, retried with backoff,
 * coalesced by key, and listed in the Sync Center if the server refuses them.
 */
export function useInboxData(query: ListInboxQuery) {
  const api = useInboxApi();
  const { db, engine, state } = useEngine();
  const online = state.connectivity === 'online';
  const [list, setList] = React.useState<InboxList | null>(null);
  const [error, setError] = React.useState<{ code: string; message: string } | null>(null);
  const [tick, setTick] = React.useState(0);
  const key = JSON.stringify(query);
  const bump = React.useCallback(() => setTick((t) => t + 1), []);

  const actions = useLiveQuery(
    () => db.actions.filter((a) => isInboxKey(a.key)).sortBy('createdAt'),
    [db],
  );

  React.useEffect(() => {
    void db.meta.get(LIST_KEY).then((row) => {
      if (row) setList((l) => l ?? (row.value as InboxList));
    });
  }, [db]);

  const refresh = React.useCallback(async () => {
    try {
      const l = await api.list(JSON.parse(key) as ListInboxQuery);
      setList(l);
      setError(null);
      if (key === JSON.stringify({ status: 'active' }))
        void db.meta.put({ key: LIST_KEY, value: l });
    } catch (e) {
      const err =
        e instanceof ApiFailure ? e.error : { code: 'INTERNAL', message: (e as Error).message };
      setError(err);
    }
  }, [api, key, db]);

  React.useEffect(() => {
    if (online) void refresh();
  }, [online, refresh, tick]);

  // Live: any inbox change this agent can see, from any device or agent.
  React.useEffect(() => engine.onInbox(bump), [engine, bump]);
  // A queued inbox change was confirmed or refused, or the device reconnected: refetch.
  useEngineChange(['action'], (e) => {
    if (e.type === 'reconnected' || (e.type === 'action' && isInboxKey(e.key))) bump();
  });

  const enqueue = React.useCallback(
    async (item: Omit<PendingInboxItem, 'id' | 'createdAt'>) => {
      const id = uuidv7();
      await engine.queueAction(
        item.kind === 'reply'
          ? {
              key: replyKey('reply', id),
              method: 'POST',
              path: `/v1/inbox/conversations/${item.conversationId}/replies`,
              body: { clientMessageId: id, text: item.text, templateId: item.templateId },
              label: 'Reply to client',
              conversationId: item.conversationId,
            }
          : {
              key: replyKey('note', id),
              method: 'POST',
              path: `/v1/inbox/conversations/${item.conversationId}/notes`,
              body: { clientNoteId: id, text: item.text, mentions: item.mentions ?? [] },
              label: 'Internal note',
              conversationId: item.conversationId,
            },
      );
      return { ...item, id, createdAt: new Date().toISOString() };
    },
    [engine],
  );

  // One-time move of replies saved by the previous inbox-only outbox onto the shared queue.
  React.useEffect(() => {
    void db.meta.get(LEGACY_OUTBOX_KEY).then(async (row) => {
      const old = (row?.value as PendingInboxItem[] | undefined) ?? [];
      if (!old.length) return;
      for (const item of old) await enqueue(item);
      await db.meta.delete(LEGACY_OUTBOX_KEY);
    });
  }, [db, enqueue]);

  const queueUpdate = React.useCallback(
    (conversationId: string, body: QueuedUpdate, label = 'Update conversation') =>
      engine.queueAction({
        key: updateKey(conversationId, Object.keys(body)),
        method: 'PATCH',
        path: `/v1/inbox/conversations/${conversationId}`,
        body,
        label,
        conversationId,
      }),
    [engine],
  );

  const markRead = React.useCallback(
    (conversationId: string) =>
      engine.queueAction({
        key: readKey(conversationId),
        method: 'PUT',
        path: `/v1/inbox/conversations/${conversationId}/read`,
        label: 'Mark conversation read',
        conversationId,
      }),
    [engine],
  );

  const all = actions ?? [];
  const outbox: PendingInboxItem[] = all
    .filter((a) => a.key.startsWith('inbox-reply|') || a.key.startsWith('inbox-note|'))
    .map((a) => {
      const b = a.body as { clientMessageId?: string; clientNoteId?: string; text: string };
      return {
        kind: a.key.startsWith('inbox-reply|') ? 'reply' : 'note',
        id: b.clientMessageId ?? b.clientNoteId ?? a.key,
        conversationId: a.conversationId!,
        text: b.text,
        createdAt: new Date(a.createdAt).toISOString(),
        error: a.state === 'failed' ? (a.lastError?.message ?? 'Not sent') : undefined,
      };
    });

  /** Shows queued changes right away, before the server confirms them. */
  const overlay = React.useCallback(
    <T extends InboxConversation>(c: T): T => {
      let out = c;
      for (const a of all) {
        if (a.conversationId !== c.conversationId || a.state !== 'queued') continue;
        if (a.key.startsWith('inbox-update|')) out = { ...out, ...(a.body as QueuedUpdate) };
        else if (a.key.startsWith('inbox-read|')) out = { ...out, unread: false };
      }
      return out;
    },
    [all],
  );

  const discard = (id: string) => {
    const a = all.find((x) => x.key === replyKey('reply', id) || x.key === replyKey('note', id));
    if (a) void engine.discardAction(a.key);
  };
  const retry = (id: string) => {
    const a = all.find((x) => x.key === replyKey('reply', id) || x.key === replyKey('note', id));
    if (a) void engine.retryAction(a.key);
  };

  return {
    api,
    list,
    error,
    refresh,
    online,
    outbox,
    enqueue,
    discard,
    retry,
    queueUpdate,
    markRead,
    overlay,
    tick,
  };
}

export function useInboxDetail(api: InboxApi, id: string | null, online: boolean, tick: number) {
  const { db } = useEngine();
  const [detail, setDetail] = React.useState<InboxConversationDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const load = React.useCallback(async () => {
    if (!id) return;
    try {
      const d = await api.detail(id);
      setDetail(d);
      setError(null);
      void db.meta.put({ key: detailKey(id), value: d });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, id, db]);
  React.useEffect(() => {
    setDetail(null);
    setError(null);
    if (!id) return;
    void db.meta.get(detailKey(id)).then((row) => {
      if (row) setDetail((d) => d ?? (row.value as InboxConversationDetail));
    });
  }, [id, db]);
  React.useEffect(() => {
    if (online) void load();
  }, [online, load, tick]);
  return { detail, setDetail, error, reload: load };
}
