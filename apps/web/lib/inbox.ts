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
import { useEngine } from './engine';

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

/** A reply or note written while offline (or while the API was unreachable). Sent in order on reconnect. */
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

const OUTBOX_KEY = 'inbox.outbox';
const LIST_KEY = 'inbox.list';
const detailKey = (id: string) => `inbox.detail.${id}`;

/**
 * Inbox data for the signed-in agent: REST, kept fresh by `inbox:changed` socket events, and
 * cached in this identity's IndexedDB so the inbox still opens offline. Replies and notes
 * written offline go to a durable local queue (idempotent ids) and are sent on reconnect.
 */
export function useInboxData(query: ListInboxQuery) {
  const api = useInboxApi();
  const { db, engine, state } = useEngine();
  const online = state.connectivity === 'online';
  const [list, setList] = React.useState<InboxList | null>(null);
  const [error, setError] = React.useState<{ code: string; message: string } | null>(null);
  const [outbox, setOutbox] = React.useState<PendingInboxItem[]>([]);
  const [tick, setTick] = React.useState(0);
  const key = JSON.stringify(query);

  React.useEffect(() => {
    void db.meta.get(LIST_KEY).then((row) => {
      if (row) setList((l) => l ?? (row.value as InboxList));
    });
    void db.meta.get(OUTBOX_KEY).then((row) => setOutbox((row?.value as PendingInboxItem[]) ?? []));
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

  React.useEffect(() => engine.onInbox(() => setTick((t) => t + 1)), [engine]);

  const saveOutbox = React.useCallback(
    async (next: PendingInboxItem[]) => {
      setOutbox(next);
      await db.meta.put({ key: OUTBOX_KEY, value: next });
    },
    [db],
  );

  const enqueue = React.useCallback(
    async (item: Omit<PendingInboxItem, 'id' | 'createdAt'>) => {
      const row = await db.meta.get(OUTBOX_KEY);
      const cur = (row?.value as PendingInboxItem[]) ?? [];
      const full = { ...item, id: uuidv7(), createdAt: new Date().toISOString() };
      await saveOutbox([...cur, full]);
      return full;
    },
    [db, saveOutbox],
  );

  const flushing = React.useRef(false);
  const flush = React.useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      let cur = ((await db.meta.get(OUTBOX_KEY))?.value as PendingInboxItem[]) ?? [];
      for (const item of [...cur]) {
        try {
          if (item.kind === 'reply')
            await api.reply(item.conversationId, {
              clientMessageId: item.id,
              text: item.text,
              templateId: item.templateId,
            });
          else
            await api.note(item.conversationId, {
              clientNoteId: item.id,
              text: item.text,
              mentions: item.mentions ?? [],
            });
          cur = cur.filter((x) => x.id !== item.id);
        } catch (e) {
          if (e instanceof ApiFailure && e.status > 0 && e.status < 500 && e.status !== 429) {
            cur = cur.map((x) => (x.id === item.id ? { ...x, error: e.message } : x));
          } else break; // still offline or server trouble: keep order, try again later
        }
      }
      await saveOutbox(cur);
    } finally {
      flushing.current = false;
    }
  }, [api, db, saveOutbox]);

  React.useEffect(() => {
    if (online && outbox.some((x) => !x.error)) void flush();
  }, [online, outbox, flush]);

  const discard = (id: string) => saveOutbox(outbox.filter((x) => x.id !== id));

  return { api, list, error, refresh, online, outbox, enqueue, flush, discard, tick };
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
