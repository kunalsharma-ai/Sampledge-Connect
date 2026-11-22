'use client';
import * as React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  FileText,
  Languages,
  Loader2,
  Pencil,
  RotateCcw,
} from 'lucide-react';
import {
  TRANSCRIPT_LANGUAGES,
  formatClipDuration,
  isAudioAttachment,
  isVideoAttachment,
  type AiTranscript,
  type Attachment,
  type TranscriptSegment,
} from '@sampledge/contracts';
import { cn } from '@sampledge/ui';
import { aiErrorText, languageName, useAiContext } from '@/lib/ai';
import { ApiFailure } from '@/lib/api';
import { useEngineChange } from '@/lib/engine';
import { useMinutesApi } from '@/lib/minutes';

const POLL_MS = 4000;
/** Stop polling after this long; the person can open the transcript again later. */
const POLL_FOR_MS = 15 * 60_000;

const busyStatus = (s: string | undefined) => s === 'queued' || s === 'processing';

/**
 * "Transcript" under a call recording, voice message or recorded video. The transcript comes
 * from the organization's own speech-to-text server; without one the button is hidden.
 * People who were there can switch languages, correct lines and mark it checked; corrections
 * sync live and wait in the offline queue when there is no connection.
 */
export function TranscriptToggle({ a, compact = false }: { a: Attachment; compact?: boolean }) {
  const ai = useAiContext();
  const [open, setOpen] = React.useState(false);
  const [t, setT] = React.useState<AiTranscript | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const started = React.useRef(0);

  const pending = busyStatus(t?.status) || !!t?.translations.some((x) => busyStatus(x.status));
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

  const refresh = React.useCallback(async () => {
    if (!ai) return;
    try {
      setT(await ai.transcript(a.attachmentId));
    } catch {
      /* offline: keep what is shown */
    }
  }, [ai, a.attachmentId]);

  // Someone corrected or translated it on another device, or a queued correction landed.
  useEngineChange(['transcript', 'action'], (e) => {
    if (!open || !t) return;
    if (e.type === 'reconnected') void refresh();
    else if (e.type === 'transcript' && e.attachmentId === a.attachmentId) void refresh();
    else if (e.type === 'action' && e.key.startsWith(`transcript|${a.attachmentId}|`))
      void refresh();
  });

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
        {busy || busyStatus(t?.status) ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <FileText className="size-3.5" />
        )}
        Transcript
        {t?.reviewedAt ? (
          <CheckCircle2 className="size-3 text-success" aria-label="Checked" />
        ) : null}
        <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="mt-1 rounded-md border border-border bg-surface px-3 py-2 text-meta">
          {error ? (
            <p className="text-danger">{error}</p>
          ) : !t ? (
            <p className="text-text-subtle">Loading…</p>
          ) : t.status === 'done' ? (
            <TranscriptBody
              t={t}
              translation={ai.status.transcription.translation ?? 'none'}
              onChange={(next) => {
                started.current = Date.now();
                setT(next);
              }}
            />
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
          ) : busyStatus(t.status) ? (
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

const linkBtn =
  'inline-flex items-center gap-1 rounded px-1 text-accent hover:underline disabled:pointer-events-none disabled:opacity-50';

function TranscriptBody({
  t,
  translation,
  onChange,
}: {
  t: AiTranscript;
  translation: 'model' | 'english' | 'none';
  onChange: (t: AiTranscript) => void;
}) {
  const api = useMinutesApi();
  /** null: the original. */
  const [lang, setLang] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<string[]>([]);
  const [draftText, setDraftText] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [note, setNote] = React.useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(
    null,
  );

  const tr = lang ? (t.translations.find((x) => x.language === lang) ?? null) : null;
  const segments: TranscriptSegment[] = tr ? tr.segments : t.segments;
  const text = tr ? tr.text : t.text;
  const reviewedAt = tr ? tr.reviewedAt : t.reviewedAt;
  const edited = tr ? tr.edited : t.edited;
  const viewDone = !tr || tr.status === 'done';

  const offered = React.useMemo(() => {
    const have = new Set([t.language ?? '', ...t.translations.map((x) => x.language)]);
    if (translation === 'none') return [];
    const all =
      translation === 'model'
        ? TRANSCRIPT_LANGUAGES
        : TRANSCRIPT_LANGUAGES.filter(([c]) => c === 'en');
    return all.filter(([c]) => !have.has(c));
  }, [t, translation]);

  const startEdit = () => {
    setDraft(segments.map((s) => s.text));
    setDraftText(text ?? '');
    setEditing(true);
    setNote(null);
  };

  const save = async (body: {
    segments?: { index: number; text: string }[];
    text?: string;
    reviewed?: boolean;
  }) => {
    setSaving(true);
    setNote(null);
    try {
      const r = await api.correctTranscript(t, {
        baseRevision: t.revision,
        ...(lang ? { language: lang } : {}),
        ...body,
      });
      if (r === 'queued') {
        setNote({
          tone: 'ok',
          text: 'Saved on this device. It will sync when you’re back online.',
        });
      } else {
        onChange(r);
        setEditing(false);
      }
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 409) {
        const d = e.error.details as { current?: AiTranscript; lines?: number[] } | undefined;
        if (d?.current) onChange(d.current);
        setNote({
          tone: 'warn',
          text: d?.lines?.length
            ? `Someone else corrected line${d.lines.length === 1 ? '' : 's'} ${d.lines.map((i) => i + 1).join(', ')} first. Their version is shown; your other lines are still in the editor.`
            : e.error.message,
        });
      } else setNote({ tone: 'error', text: aiErrorText(e) });
    } finally {
      setSaving(false);
    }
  };

  const translate = async (language: string) => {
    setNote(null);
    try {
      onChange(await api.translateTranscript(t.attachmentId, language));
      setLang(language);
    } catch (e) {
      setNote({ tone: 'error', text: aiErrorText(e) });
    }
  };

  if (!t.text?.trim()) return <p className="text-text-subtle">No speech was heard.</p>;
  return (
    <div className="space-y-2">
      <div
        className="flex flex-wrap items-center gap-1.5"
        role="tablist"
        aria-label="Transcript language"
      >
        <LangChip active={!lang} onClick={() => !editing && setLang(null)}>
          {t.language ? languageName(t.language) : 'Original'}
          <span className="text-text-subtle"> · original</span>
        </LangChip>
        {t.translations.map((x) => (
          <LangChip
            key={x.language}
            active={lang === x.language}
            onClick={() => !editing && setLang(x.language)}
          >
            {busyStatus(x.status) ? <Loader2 className="size-3 animate-spin" /> : null}
            {languageName(x.language)}
            {x.outdated ? (
              <AlertTriangle className="size-3 text-warning" aria-label="Out of date" />
            ) : null}
          </LangChip>
        ))}
        {offered.length && api.online && !editing ? (
          <label className="inline-flex items-center gap-1 text-text-muted">
            <Languages className="size-3.5" />
            <span className="sr-only">Translate to</span>
            <select
              className="rounded border border-border bg-surface px-1 py-0.5 text-meta text-text"
              value=""
              onChange={(e) => e.target.value && void translate(e.target.value)}
            >
              <option value="">Translate to…</option>
              {offered.map(([c, n]) => (
                <option key={c} value={c}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {tr && tr.status === 'failed' ? (
        <div className="flex items-center gap-2">
          <p className="flex-1 text-danger">{tr.error ?? 'Translation failed.'}</p>
          <button type="button" className={linkBtn} onClick={() => void translate(tr.language)}>
            <RotateCcw className="size-3" /> Try again
          </button>
        </div>
      ) : tr && !viewDone ? (
        <p className="text-text-subtle">
          Translating to {languageName(tr.language)}
          {tr.engine === 'stt' ? ' on your speech-to-text server' : ' on your AI model server'}…
        </p>
      ) : editing ? (
        segments.length ? (
          <ol className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {segments.map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="w-10 shrink-0 pt-1 tabular-nums text-text-subtle">
                  {formatClipDuration(s.startMs)}
                </span>
                <textarea
                  aria-label={`Line ${i + 1}`}
                  rows={1}
                  value={draft[i] ?? ''}
                  onChange={(e) => setDraft((d) => d.map((v, j) => (j === i ? e.target.value : v)))}
                  className={cn(
                    'min-h-7 flex-1 resize-y rounded border bg-bg px-2 py-1 text-meta text-text focus-visible:outline-2 focus-visible:outline-accent',
                    draft[i] !== s.text ? 'border-accent' : 'border-border',
                  )}
                />
              </li>
            ))}
          </ol>
        ) : (
          <textarea
            aria-label="Transcript text"
            rows={6}
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            className="w-full rounded border border-border bg-bg px-2 py-1 text-meta text-text"
          />
        )
      ) : segments.length ? (
        <ol className="max-h-64 space-y-1 overflow-y-auto pr-1" dir="auto">
          {segments.map((s, i) => (
            <li key={i} className="flex gap-2 text-text">
              <span className="w-10 shrink-0 tabular-nums text-text-subtle">
                {formatClipDuration(s.startMs)}
              </span>
              <span className="min-w-0" dir="auto">
                {s.text}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-text" dir="auto">
          {text}
        </p>
      )}

      {tr?.outdated && viewDone && !editing ? (
        <p className="flex items-center gap-1.5 text-warning">
          <AlertTriangle className="size-3.5" />
          The original was corrected after this was translated.
          <button
            type="button"
            className={linkBtn}
            disabled={!api.online}
            onClick={() => void translate(tr.language)}
          >
            Translate again
          </button>
        </p>
      ) : null}

      {note ? (
        <p
          role="status"
          className={cn(
            note.tone === 'ok'
              ? 'text-success'
              : note.tone === 'warn'
                ? 'text-warning'
                : 'text-danger',
          )}
        >
          {note.text}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="flex-1 text-text-subtle">
          {reviewedAt ? (
            <span className="inline-flex items-center gap-1 text-success">
              <CheckCircle2 className="size-3.5" /> Checked against the recording
            </span>
          ) : tr ? (
            `Machine translation from ${t.language ? languageName(t.language) : 'the original'}`
          ) : (
            `Machine transcript${t.language ? ` · ${languageName(t.language)}` : ''}`
          )}
          {edited ? ' · corrected by people' : ''}
          {!reviewedAt ? '. It can contain mistakes and does not label speakers.' : ''}
        </p>
        {t.canEdit && viewDone ? (
          editing ? (
            <>
              <button
                type="button"
                className={linkBtn}
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className={cn(linkBtn, 'font-semibold')}
                disabled={saving}
                onClick={() =>
                  void save(
                    segments.length
                      ? {
                          segments: draft
                            .map((v, index) => ({ index, text: v }))
                            .filter((x) => x.text !== segments[x.index]?.text),
                        }
                      : { text: draftText },
                  )
                }
              >
                {saving ? <Loader2 className="size-3 animate-spin" /> : null} Save corrections
              </button>
            </>
          ) : (
            <>
              <button type="button" className={linkBtn} onClick={startEdit}>
                <Pencil className="size-3" /> Correct
              </button>
              <button
                type="button"
                className={linkBtn}
                disabled={saving}
                onClick={() => void save({ reviewed: !reviewedAt })}
              >
                <CheckCircle2 className="size-3" /> {reviewedAt ? 'Unmark checked' : 'Mark checked'}
              </button>
            </>
          )
        ) : null}
      </div>
    </div>
  );
}

function LangChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-meta',
        active
          ? 'border-accent bg-accent-soft text-text'
          : 'border-border text-text-muted hover:text-text',
      )}
    >
      {children}
    </button>
  );
}
