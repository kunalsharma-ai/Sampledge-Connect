'use client';
import * as React from 'react';
import { ChevronDown, FileText, Loader2, RotateCcw } from 'lucide-react';
import {
  formatClipDuration,
  isAudioAttachment,
  isVideoAttachment,
  type AiTranscript,
  type Attachment,
} from '@sampledge/contracts';
import { cn } from '@sampledge/ui';
import { aiErrorText, languageName, useAiContext } from '@/lib/ai';

const POLL_MS = 4000;
/** Stop polling after this long; the person can open the transcript again later. */
const POLL_FOR_MS = 15 * 60_000;

/**
 * "Transcript" under a call recording, voice message or recorded video. The transcript comes
 * from the organization's own speech-to-text server; without one the button is hidden.
 */
export function TranscriptToggle({ a, compact = false }: { a: Attachment; compact?: boolean }) {
  const ai = useAiContext();
  const [open, setOpen] = React.useState(false);
  const [t, setT] = React.useState<AiTranscript | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const started = React.useRef(0);

  const pending = t?.status === 'queued' || t?.status === 'processing';
  React.useEffect(() => {
    if (!open || !pending || !ai) return;
    const id = setTimeout(async () => {
      if (Date.now() - started.current > POLL_FOR_MS) return;
      try {
        setT(await ai.transcript(a.attachmentId));
      } catch {
        /* keep the last state; the next open retries */
      }
    }, POLL_MS);
    return () => clearTimeout(id);
  }, [open, pending, t, ai, a.attachmentId]);

  if (!ai?.available || !ai.status?.transcription.configured) return null;
  if (a.deletedAt || !(isAudioAttachment(a) || isVideoAttachment(a))) return null;

  const load = async (request: boolean) => {
    setBusy(true);
    setError(null);
    started.current = Date.now();
    try {
      let r = await ai.transcript(a.attachmentId);
      if (request && (r.status === 'none' || r.status === 'failed'))
        r = await ai.requestTranscript(a.attachmentId);
      setT(r);
    } catch (e) {
      setError(aiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn('mt-1.5', compact ? 'px-0' : 'px-1')} data-testid="transcript">
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-meta text-text-muted hover:bg-surface hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
        aria-expanded={open}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && !t) void load(true);
        }}
      >
        {busy || pending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <FileText className="size-3.5" />
        )}
        Transcript
        <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="mt-1 rounded-md border border-border bg-surface px-3 py-2 text-meta">
          {error ? (
            <p className="text-danger">{error}</p>
          ) : !t ? (
            <p className="text-text-subtle">Loading…</p>
          ) : t.status === 'done' ? (
            <TranscriptBody t={t} />
          ) : t.status === 'failed' ? (
            <div className="flex items-center gap-2">
              <p className="flex-1 text-danger">{t.error ?? 'Transcription failed.'}</p>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-accent hover:underline"
                onClick={() => void load(true)}
              >
                <RotateCcw className="size-3" /> Try again
              </button>
            </div>
          ) : pending ? (
            <p className="text-text-subtle">
              Transcribing on your organization’s speech-to-text server. Long recordings can take a
              few minutes.
            </p>
          ) : (
            <p className="text-text-subtle">No transcript yet.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function TranscriptBody({ t }: { t: AiTranscript }) {
  if (!t.text?.trim()) return <p className="text-text-subtle">No speech was heard.</p>;
  return (
    <div className="space-y-1.5">
      {t.segments.length ? (
        <ol className="max-h-64 space-y-1 overflow-y-auto pr-1">
          {t.segments.map((s, i) => (
            <li key={i} className="flex gap-2 text-text">
              <span className="w-10 shrink-0 tabular-nums text-text-subtle">
                {formatClipDuration(s.startMs)}
              </span>
              <span className="min-w-0">{s.text}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-text">{t.text}</p>
      )}
      <p className="text-text-subtle">
        Machine transcript{t.language ? ` · ${languageName(t.language)}` : ''}. It can contain
        mistakes and does not label speakers.
      </p>
    </div>
  );
}
