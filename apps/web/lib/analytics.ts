'use client';
import * as React from 'react';
import type { AnalyticsRange, AnalyticsResponse } from '@sampledge/contracts';
import { apiRequest } from './api';
import { useAuth } from './auth';
import { useEngine, useEngineChange } from './engine';

const zone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

/**
 * Analytics for a range and scope. Computed by the server on request, refreshed every minute
 * while open and on reconnect. The last result per range and scope is kept on this device, so
 * the screen still shows (marked with its time) offline.
 */
export function useAnalytics(range: AnalyticsRange, scope: 'org' | 'me') {
  const { db, state } = useEngine();
  const { getAccessToken } = useAuth();
  const online = state.connectivity === 'online';
  const key = `analytics.${scope}.${range}`;
  const [data, setData] = React.useState<AnalyticsResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const seq = React.useRef(0);

  const refresh = React.useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const q = new URLSearchParams({ range, scope, tz: zone() });
      const r = await apiRequest<AnalyticsResponse>('GET', `/v1/analytics?${q}`, {
        token: await getAccessToken(),
      });
      if (my !== seq.current) return;
      setData(r);
      setError(null);
      void db.meta.put({ key, value: r });
    } catch (e) {
      if (my === seq.current) setError(e instanceof Error ? e.message : 'Could not load analytics');
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [db, getAccessToken, key, range, scope]);

  // Cached copy first (instant, and the offline view), then the live one.
  React.useEffect(() => {
    let live = true;
    void db.meta.get(key).then((row) => {
      if (!live) return;
      setData((row?.value as AnalyticsResponse | undefined) ?? null);
      if (!online) setLoading(false);
    });
    if (online) void refresh();
    return () => {
      live = false;
    };
  }, [db, key, online, refresh]);

  React.useEffect(() => {
    if (!online) return;
    const t = setInterval(() => document.visibilityState === 'visible' && void refresh(), 60_000);
    return () => clearInterval(t);
  }, [online, refresh]);

  useEngineChange(['reconnected'], () => void refresh());

  return { data, error, loading, online, refresh };
}
