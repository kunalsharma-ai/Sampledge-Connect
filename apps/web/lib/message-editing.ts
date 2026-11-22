'use client';
import * as React from 'react';
import {
  DEFAULT_MESSAGE_EDITING_STATE,
  MessageEditingPolicySchema,
  type MessageEditHistory,
  type MessageEditingPolicy,
  type MessageEditingState,
} from '@sampledge/contracts';
import { apiRequest } from './api';
import { useAuth } from './auth';
import { useEngine, useEngineChange } from './engine';

const KEY = 'messageEditing';

/** One copy per page, so every timeline and the admin card agree. */
const listeners = new Set<(s: MessageEditingState) => void>();
let current: MessageEditingState = DEFAULT_MESSAGE_EDITING_STATE;
function publish(next: MessageEditingState) {
  const p = MessageEditingPolicySchema.safeParse(next.policy ?? {});
  current = { ...next, policy: p.success ? p.data : DEFAULT_MESSAGE_EDITING_STATE.policy };
  listeners.forEach((l) => l(current));
}

/**
 * The organization's message editing rules (docs/editing.md), cached on this device so Edit
 * shows or hides correctly offline too. Changes arrive live through `tenant:updated` (area
 * `messages`); the server checks the same rules again when a queued edit is sent.
 */
export function useMessageEditing() {
  const { db, state } = useEngine();
  const { getAccessToken } = useAuth();
  const online = state.connectivity === 'online';
  const [s, setS] = React.useState<MessageEditingState>(current);

  React.useEffect(() => {
    listeners.add(setS);
    return () => void listeners.delete(setS);
  }, []);

  const store = React.useCallback(
    (next: MessageEditingState) => {
      publish(next);
      void db.meta.put({ key: KEY, value: next });
    },
    [db],
  );

  const refresh = React.useCallback(async () => {
    try {
      store(
        await apiRequest<MessageEditingState>('GET', '/v1/message-editing', {
          token: await getAccessToken(),
        }),
      );
    } catch {
      /* offline: keep the cached copy */
    }
  }, [getAccessToken, store]);

  React.useEffect(() => {
    void db.meta.get(KEY).then((row) => {
      if (row) publish(row.value as MessageEditingState);
    });
  }, [db]);
  React.useEffect(() => {
    if (online) void refresh();
  }, [online, refresh]);
  useEngineChange(['tenant', 'reconnected'], (e) => {
    if (e.type === 'tenant' && e.area !== 'messages') return;
    void refresh();
  });

  /** Owners and admins, online only (an organization-wide change). */
  const savePolicy = React.useCallback(
    async (policy: MessageEditingPolicy) => {
      store(
        await apiRequest<MessageEditingState>('PUT', '/v1/admin/message-editing', {
          token: await getAccessToken(),
          body: policy,
        }),
      );
    },
    [getAccessToken, store],
  );

  const history = React.useCallback(
    async (messageId: string) =>
      apiRequest<MessageEditHistory>('GET', `/v1/messages/${messageId}/edits`, {
        token: await getAccessToken(),
      }),
    [getAccessToken],
  );

  return { ...s, online, savePolicy, history, refresh };
}
