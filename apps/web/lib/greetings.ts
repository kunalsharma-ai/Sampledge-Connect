'use client';
import * as React from 'react';
import {
  DEFAULT_GREETING_POLICY,
  GreetingPolicySchema,
  type GreetingPolicy,
  type GreetingPolicyState,
} from '@sampledge/contracts';
import { apiRequest } from './api';
import { useAuth } from './auth';
import { useEngine, useEngineChange } from './engine';

const KEY = 'greetingPolicy';

/** One copy per page, so the composer button, the picker and Administration agree. */
const listeners = new Set<(p: GreetingPolicy) => void>();
let current: GreetingPolicy = DEFAULT_GREETING_POLICY;
function publish(next: unknown) {
  const r = GreetingPolicySchema.safeParse(next ?? {});
  current = r.success ? r.data : DEFAULT_GREETING_POLICY;
  listeners.forEach((l) => l(current));
}

/**
 * The organization's greeting card rules (on/off and hidden categories). Cached on this device
 * so the picker works offline, refreshed when online and live when an admin changes them
 * (`tenant:updated`, area `greetings`).
 */
export function useGreetingPolicy() {
  const { db, state } = useEngine();
  const { getAccessToken } = useAuth();
  const online = state.connectivity === 'online';
  const [policy, setPolicy] = React.useState<GreetingPolicy>(current);

  React.useEffect(() => {
    listeners.add(setPolicy);
    return () => void listeners.delete(setPolicy);
  }, []);

  const store = React.useCallback(
    (p: GreetingPolicy) => {
      publish(p);
      void db.meta.put({ key: KEY, value: p });
    },
    [db],
  );

  const refresh = React.useCallback(async () => {
    try {
      const r = await apiRequest<GreetingPolicyState>('GET', '/v1/greetings/policy', {
        token: await getAccessToken(),
      });
      store(r.policy);
    } catch {
      /* offline: keep the cached copy */
    }
  }, [getAccessToken, store]);

  React.useEffect(() => {
    void db.meta.get(KEY).then((row) => {
      if (row) publish(row.value);
    });
  }, [db]);
  React.useEffect(() => {
    if (online) void refresh();
  }, [online, refresh]);
  useEngineChange(['tenant'], (e) => {
    if (e.type === 'reconnected' || (e.type === 'tenant' && e.area === 'greetings')) void refresh();
  });

  /** Owners and admins, online only (an organization-wide change). */
  const savePolicy = React.useCallback(
    async (p: GreetingPolicy) => {
      const r = await apiRequest<GreetingPolicyState>('PUT', '/v1/admin/greetings', {
        token: await getAccessToken(),
        body: p,
      });
      store(r.policy);
    },
    [getAccessToken, store],
  );

  return { policy, savePolicy, online };
}
