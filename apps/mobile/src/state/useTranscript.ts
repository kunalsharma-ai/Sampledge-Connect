import type { AiTranscript } from '@sampledge/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { transcriptPending, type TranscriptionSettings } from '../lib/transcript';
import { useApp, useWorkspace } from './AppProvider';

const POLL_MS = 4000;
/** Stop polling after this long; opening the transcript again starts over. */
const POLL_FOR_MS = 15 * 60_000;

/** The organization's speech-to-text setup, cached for offline use (null while unknown). */
export function useTranscription(): TranscriptionSettings | null {
  const { engine } = useWorkspace();
  const { engineState } = useApp();
  const [s, setS] = useState<TranscriptionSettings | null>(null);
  useEffect(() => {
    let live = true;
    void engine.transcriptionSettings().then((x) => live && setS(x));
    return () => {
      live = false;
    };
  }, [engine, engineState?.networkUp]);
  return s;
}

/**
 * A recording's transcript: the copy on this phone at once (with corrections not sent yet),
 * then the server's. Asks for one when there is none. Follows corrections from other devices
 * live, and checks back while it is still being transcribed or translated.
 */
export function useTranscript(attachmentId: string): {
  t: AiTranscript | null;
  loaded: boolean;
  error: string | null;
  reload: (request?: boolean) => void;
} {
  const { engine } = useWorkspace();
  const { engineState } = useApp();
  const [t, setT] = useState<AiTranscript | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(Date.now());

  const read = useCallback(async () => {
    const r = await engine.getTranscript(attachmentId);
    if (r) {
      setT(r);
      setLoaded(true);
    }
  }, [engine, attachmentId]);

  const reload = useCallback(
    (request = false) => {
      setError(null);
      if (request) started.current = Date.now();
      void engine
        .loadTranscript(attachmentId, request)
        .then((r) => r && setT(r))
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setLoaded(true));
    },
    [engine, attachmentId],
  );

  useEffect(() => {
    void read();
    reload(true);
    return engine.events.on('transcript', (e) => {
      if (e.attachmentId === attachmentId) void read();
    });
  }, [engine, attachmentId, read, reload, engineState?.networkUp]);

  const pending = transcriptPending(t);
  useEffect(() => {
    if (!pending || Date.now() - started.current > POLL_FOR_MS) return;
    const id = setTimeout(() => reload(), POLL_MS);
    return () => clearTimeout(id);
  }, [pending, t, reload]);

  return { t, loaded, error, reload };
}
