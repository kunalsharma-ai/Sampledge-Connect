'use client';
import * as React from 'react';
import type {
  AiAskResponse,
  AiDigest,
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
import { useEngine, useTenantChange } from './engine';

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
