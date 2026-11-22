import type { CallMinutesResponse, MeetingMinutes, MinutesConfig } from '@sampledge/contracts';
import { useCallback, useEffect, useState } from 'react';
import { useWorkspace } from './AppProvider';

/**
 * The minutes of a call: the copy on this phone at once (with unsent edits), then the server's.
 * `loaded` turns true once there is something to show or the fetch finished.
 */
export function useCallMinutes(callId: string): {
  data: CallMinutesResponse | null;
  loaded: boolean;
  error: string | null;
  reload: () => void;
} {
  const { engine } = useWorkspace();
  const [data, setData] = useState<CallMinutesResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const read = useCallback(async () => {
    const r = await engine.getCallMinutes(callId);
    if (r) {
      setData(r);
      setLoaded(true);
    }
  }, [engine, callId]);
  const reload = useCallback(() => {
    setError(null);
    void engine
      .reloadCallMinutes(callId)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        void read();
        setLoaded(true);
      });
  }, [engine, callId, read]);
  useEffect(() => {
    void read();
    reload();
    return engine.events.on('minutes', (e) => {
      if (e.callId === callId) void read();
    });
  }, [engine, callId, read, reload]);
  return { data, loaded, error, reload };
}

/** Minutes for calls in a conversation, newest first. */
export function useMinutesList(conversationId: string): MeetingMinutes[] | null {
  const { engine } = useWorkspace();
  const [items, setItems] = useState<MeetingMinutes[] | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void engine.listMinutes(conversationId).then((x) => live && setItems(x));
    load();
    const off = engine.events.on('minutes', (e) => {
      if (!e.conversationId || e.conversationId === conversationId) load();
    });
    return () => {
      live = false;
      off();
    };
  }, [engine, conversationId]);
  return items;
}

export function useMinutesConfig(): MinutesConfig | null {
  const { engine } = useWorkspace();
  const [config, setConfig] = useState<MinutesConfig | null>(null);
  useEffect(() => {
    let live = true;
    void engine.minutesConfig().then((c) => live && setConfig(c));
    const off = engine.events.on('tenant', (e) => {
      if (e.area === 'minutes') void engine.minutesConfig().then((c) => live && setConfig(c));
    });
    return () => {
      live = false;
      off();
    };
  }, [engine]);
  return config;
}
