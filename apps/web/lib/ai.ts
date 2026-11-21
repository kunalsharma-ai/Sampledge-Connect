'use client';
import * as React from 'react';
import type {
  ActionItem,
  AiAskResponse,
  AiDigest,
  AiDismissedSuggestions,
  AiDuplicates,
  AiMeetingSummary,
  AiPrioritizedNotifications,
  AiProposal,
  AiSearchResponse,
  AiStatus,
  AiSuggestedReplies,
  AiSummary,
  AiTranscript,
  AiTranslation,
  ConfirmAiProposalRequest,
  Message,
  SummaryRange,
} from '@sampledge/contracts';
import { ApiFailure, apiRequest } from './api';
import { useAuth } from './auth';
import { useEngine, useEngineChange, useTenantChange } from './engine';
import { useLiveQuery } from 'dexie-react-hooks';

/**
 * The private AI assistant client. Every call is an explicit user action over REST; nothing
 * here runs on the chat path, and failures never affect sending or reading messages.
 */
export function useAi() {
  const { getAccessToken } = useAuth();
  const { state } = useEngine();
  const online = state.connectivity === 'online';
  const [status, setStatus] = React.useState<AiStatus | null>(null);

  const call = React.useCallback(
    async <T>(method: string, path: string, body?: unknown): Promise<T> =>
      apiRequest<T>(method, `/v1/ai${path}`, { token: await getAccessToken(), body }),
    [getAccessToken],
  );

  const refreshStatus = React.useCallback(async () => {
    try {
      setStatus(await call<AiStatus>('GET', '/status'));
    } catch {
      /* offline or AI unavailable: keep the last known status */
    }
  }, [call]);

  React.useEffect(() => {
    if (online) void refreshStatus();
  }, [online, refreshStatus]);
  useTenantChange('ai', () => void refreshStatus());

  return React.useMemo(
    () => ({
      online,
      status,
      available: online && !!status?.enabled,
      refreshStatus,
      setEnabled: async (enabled: boolean) => {
        const s = await call<AiStatus>('PUT', '/settings', { enabled });
        setStatus(s);
        return s;
      },
      summarize: (conversationId: string, range: SummaryRange) =>
        call<AiSummary>('POST', `/conversations/${conversationId}/summary`, { range }),
      summarizeMeeting: (meetingId: string) =>
        call<AiMeetingSummary>('POST', `/meetings/${meetingId}/summary`),
      replies: (conversationId: string) =>
        call<AiSuggestedReplies>('POST', `/conversations/${conversationId}/replies`),
      search: (query: string, conversationId?: string) =>
        call<AiSearchResponse>('POST', '/search', { query, conversationId, limit: 12 }),
      ask: (
        question: string,
        history: { role: 'user' | 'assistant'; text: string }[],
        conversationId?: string,
      ) => call<AiAskResponse>('POST', '/ask', { question, history, conversationId }),
      translate: (messageId: string, targetLanguage: string) =>
        call<AiTranslation>('POST', '/translate', { messageId, targetLanguage }),
      digest: (sinceHours: number) => call<AiDigest>('POST', '/digest', { sinceHours }),
      duplicates: (text: string) => call<AiDuplicates>('POST', '/duplicates', { text }),
      priority: () => call<AiPrioritizedNotifications>('GET', '/notifications/priority'),
      propose: (conversationId: string, text: string) =>
        call<AiProposal>('POST', '/proposals', { kind: 'send_message', conversationId, text }),
      confirm: (proposalId: string, body: ConfirmAiProposalRequest) =>
        call<{ proposal: AiProposal; message: Message }>(
          'POST',
          `/proposals/${proposalId}/confirm`,
          body,
        ),
      dismiss: (proposalId: string) => call<AiProposal>('POST', `/proposals/${proposalId}/dismiss`),
      transcript: (attachmentId: string) =>
        call<AiTranscript>('GET', `/transcripts/${attachmentId}`),
      requestTranscript: (attachmentId: string) =>
        call<AiTranscript>('POST', `/transcripts/${attachmentId}`),
    }),
    [online, status, refreshStatus, call],
  );
}
export type AiApi = ReturnType<typeof useAi>;

/** The workspace's AI client, shared so recordings and cards don't each fetch the status. */
export const AiContext = React.createContext<AiApi | null>(null);
export const useAiContext = () => React.useContext(AiContext);

/**
 * Turning a suggested task into a real one. It only opens the task form, prefilled; the person
 * reviews it and presses Create. The assistant never creates tasks by itself.
 */
export interface AiTaskActions {
  createTask: (item: ActionItem, conversationId: string) => void;
  isCreated: (item: ActionItem, conversationId: string) => boolean;
  /** "Not needed": hidden on all of the person's devices until they undo it. */
  isDismissed: (item: ActionItem, conversationId: string) => boolean;
  setDismissed: (item: ActionItem, conversationId: string, dismissed: boolean) => void;
}
export const AiTaskContext = React.createContext<AiTaskActions | null>(null);
export const suggestionKey = (item: ActionItem, conversationId: string) =>
  `${conversationId}|${item.messageId ?? ''}|${item.text}`;

export function aiErrorText(e: unknown): string {
  if (e instanceof ApiFailure) {
    if (e.error.code === 'RATE_LIMITED') return 'Too many AI requests. Try again in a minute.';
    return e.error.message;
  }
  return 'The assistant could not finish that. Try again.';
}

/** The person's preferred language for translations (browser language, e.g. "en"). */
export function preferredLanguage(): string {
  if (typeof navigator === 'undefined') return 'en';
  return (navigator.language || 'en').split('-')[0]!.toLowerCase();
}

export function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(undefined, { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

export const ENGINE_LABEL: Record<AiStatus['engine'], string> = {
  off: 'Off',
  basic: 'Built-in (no model)',
  model: 'Your model server',
};

const DISMISSED_CACHE_KEY = 'ai-dismissed-suggestions';

/**
 * Suggested tasks the person dismissed. Cached in this identity's IndexedDB, changed through
 * the engine's action queue (so it works offline), and kept in step with their other devices
 * by `ai:suggestion`. Queued changes count at once, so a row never flicks back.
 */
export function useAiDismissals() {
  const { db, engine, state } = useEngine();
  const { getAccessToken } = useAuth();
  const [ids, setIds] = React.useState<Set<string>>(() => new Set());
  const online = state.connectivity === 'online';
  const store = React.useCallback(
    (next: Set<string>) => {
      setIds(next);
      void db.meta.put({ key: DISMISSED_CACHE_KEY, value: [...next] });
    },
    [db],
  );
  const refresh = React.useCallback(async () => {
    try {
      const r = await apiRequest<AiDismissedSuggestions>('GET', '/v1/ai/suggestions/dismissed', {
        token: await getAccessToken(),
      });
      store(new Set(r.suggestionIds));
    } catch {
      /* offline or AI unavailable: keep the cached set */
    }
  }, [getAccessToken, store]);
  React.useEffect(() => {
    void db.meta.get(DISMISSED_CACHE_KEY).then((row) => {
      if (row) setIds((s) => (s.size ? s : new Set(row.value as string[])));
    });
  }, [db]);
  React.useEffect(() => {
    if (online) void refresh();
  }, [online, refresh]);
  useEngineChange(['aiSuggestion', 'action'], (e) => {
    if (e.type === 'aiSuggestion')
      setIds((prev) => {
        const next = new Set(prev);
        if (e.dismissed) next.add(e.suggestionId);
        else next.delete(e.suggestionId);
        void db.meta.put({ key: DISMISSED_CACHE_KEY, value: [...next] });
        return next;
      });
    else if (e.type === 'reconnected' || (e.type === 'action' && e.key.startsWith('aisuggestion|')))
      void refresh();
  });
  const pending = useLiveQuery(
    () =>
      db.actions
        .where('key')
        .startsWith('aisuggestion|')
        .filter((a) => a.state === 'queued')
        .toArray(),
    [db],
  );
  const isDismissed = React.useCallback(
    (id: string) => {
      const queued = pending?.find((a) => a.key === `aisuggestion|${id}`);
      return queued ? queued.method === 'PUT' : ids.has(id);
    },
    [ids, pending],
  );
  const setDismissed = React.useCallback(
    (id: string, dismissed: boolean) => {
      const next = new Set(ids);
      if (dismissed) next.add(id);
      else next.delete(id);
      store(next);
      void engine.queueAction({
        key: `aisuggestion|${id}`,
        method: dismissed ? 'PUT' : 'DELETE',
        path: `/v1/ai/suggestions/${id}/dismissed`,
        label: dismissed ? 'Dismiss suggested task' : 'Restore suggested task',
      });
    },
    [ids, store, engine],
  );
  return { isDismissed, setDismissed };
}
