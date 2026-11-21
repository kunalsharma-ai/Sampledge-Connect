'use client';
import * as React from 'react';
import {
  uuidv7,
  type Conversation,
  type CreatePollRequest,
  type Message,
  type MyPollVote,
  type PostingPolicy,
  type ScheduledMessage,
} from '@sampledge/contracts';
import { apiRequest } from './api';
import { useAuth } from './auth';
import { useEngine } from './engine';

type Token = () => Promise<string | null>;

export const pollsApi = {
  create: async (
    t: Token,
    conversationId: string,
    body: Omit<CreatePollRequest, 'clientMessageId'>,
  ) =>
    apiRequest<Message>('POST', `/v1/conversations/${conversationId}/polls`, {
      token: await t(),
      body: { clientMessageId: uuidv7(), ...body },
    }),
  vote: async (t: Token, messageId: string, optionIds: string[]) =>
    apiRequest<Message>('PUT', `/v1/messages/${messageId}/poll/vote`, {
      token: await t(),
      body: { optionIds },
    }),
  mine: async (t: Token, messageId: string) =>
    apiRequest<MyPollVote>('GET', `/v1/messages/${messageId}/poll/vote`, { token: await t() }),
  close: async (t: Token, messageId: string) =>
    apiRequest<Message>('POST', `/v1/messages/${messageId}/poll/close`, { token: await t() }),
  setPostingPolicy: async (t: Token, conversationId: string, policy: PostingPolicy) =>
    apiRequest<Conversation>('PUT', `/v1/conversations/${conversationId}/posting-policy`, {
      token: await t(),
      body: { policy },
    }),
};

export const scheduledApi = {
  create: async (
    t: Token,
    conversationId: string,
    text: string,
    mentions: string[],
    sendAt: Date,
    replyToMessageId: string | null,
  ) =>
    apiRequest<ScheduledMessage>('POST', `/v1/conversations/${conversationId}/scheduled-messages`, {
      token: await t(),
      body: {
        clientMessageId: uuidv7(),
        content: { text, mentions },
        sendAt: sendAt.toISOString(),
        replyToMessageId,
      },
    }),
  reschedule: async (t: Token, id: string, sendAt: Date) =>
    apiRequest<ScheduledMessage>('PATCH', `/v1/scheduled-messages/${id}`, {
      token: await t(),
      body: { sendAt: sendAt.toISOString() },
    }),
  cancel: async (t: Token, id: string) =>
    apiRequest<ScheduledMessage>('DELETE', `/v1/scheduled-messages/${id}`, { token: await t() }),
  sendNow: async (t: Token, id: string) =>
    apiRequest<ScheduledMessage>('POST', `/v1/scheduled-messages/${id}/send-now`, {
      token: await t(),
    }),
};

/** The caller's pending and failed scheduled messages, kept live over the socket. */
export function useScheduled(conversationId: string | null) {
  const { engine, state } = useEngine();
  const { getAccessToken } = useAuth();
  const [items, setItems] = React.useState<ScheduledMessage[]>([]);
  const online = state.connectivity === 'online';

  const refresh = React.useCallback(async () => {
    if (!conversationId) return setItems([]);
    try {
      setItems(
        await apiRequest<ScheduledMessage[]>(
          'GET',
          `/v1/scheduled-messages?conversationId=${conversationId}`,
          { token: await getAccessToken() },
        ),
      );
    } catch {
      /* offline: keep what we have */
    }
  }, [conversationId, getAccessToken]);

  React.useEffect(() => {
    setItems([]);
    if (online) void refresh();
  }, [online, refresh]);

  React.useEffect(
    () =>
      engine.onScheduled((s) => {
        if (s.conversationId !== conversationId) return;
        setItems((cur) => {
          const rest = cur.filter((x) => x.scheduledId !== s.scheduledId);
          const keep = s.status === 'scheduled' || s.status === 'failed';
          return (keep ? [...rest, s] : rest).sort((a, b) => a.sendAt.localeCompare(b.sendAt));
        });
      }),
    [engine, conversationId],
  );

  return { items, refresh, online };
}

export { schedulePresets } from './schedule-presets';
