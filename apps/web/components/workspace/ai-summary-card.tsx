'use client';
import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CircleHelp, Gavel, MessageSquareReply, Send, Sparkles } from 'lucide-react';
import type {
  AiMeetingSummary,
  AiProposal,
  AiSuggestedReplies,
  AiSummary,
  SummaryRange,
} from '@sampledge/contracts';
import { Button, cn } from '@sampledge/ui';
import type { DirectoryEntry } from '@/lib/engine';
import { aiErrorText, useAi, type AiApi } from '@/lib/ai';
import { ActionItemRow, ConfirmDraftDialog, EngineBadge } from './ai-parts';

const RANGES: { id: SummaryRange; label: string }[] = [
  { id: 'unread', label: 'Unread' },
  { id: 'day', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'recent', label: 'Recent' },
];

export function summaryAsText(s: AiSummary, directory: Map<string, DirectoryEntry>): string {
  const lines = [`AI summary: ${s.summary}`];
  if (s.decisions.length) lines.push('', 'Decisions:', ...s.decisions.map((d) => `• ${d}`));
  if (s.actionItems.length)
    lines.push(
      '',
      'Action items:',
      ...s.actionItems.map(
        (a) =>
          `• ${a.text}${a.assigneeId ? ` (${directory.get(a.assigneeId)?.displayName ?? 'someone'})` : ''}${a.due ? `, ${a.due}` : ''}`,
      ),
    );
  if (s.openQuestions.length)
    lines.push('', 'Open questions:', ...s.openQuestions.map((q) => `• ${q}`));
  return lines.join('\n');
}

/** Right-panel "Catch me up": summary, decisions, action items, open questions, suggested replies. */
export function AiSummaryCard({
  ai,
  conversationId,
  where,
  me,
  directory,
  canPost,
  onUseReply,
}: {
  ai: AiApi;
  conversationId: string;
  where: string;
  me: string;
  directory: Map<string, DirectoryEntry>;
  canPost: boolean;
  onUseReply: (text: string) => void;
}) {
  const [range, setRange] = React.useState<SummaryRange>('unread');
  const [summary, setSummary] = React.useState<AiSummary | null>(null);
  const [replies, setReplies] = React.useState<AiSuggestedReplies | null>(null);
  const [busy, setBusy] = React.useState<null | 'summary' | 'replies' | 'share'>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<AiProposal | null>(null);
  React.useEffect(() => {
    setSummary(null);
    setReplies(null);
    setError(null);
  }, [conversationId]);

  const disabled = !ai.available;
  const run = async (r: SummaryRange) => {
    setRange(r);
    setBusy('summary');
    setError(null);
    try {
      setSummary(await ai.summarize(conversationId, r));
    } catch (e) {
      setError(aiErrorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      aria-label="AI summary"
      className="rounded-xl border border-border bg-gradient-to-b from-accent-soft/60 to-surface-raised p-4 shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-label text-text">
          <Sparkles className="size-4 text-accent" /> AI assistant
        </p>
        {ai.status ? <EngineBadge engine={summary?.engine ?? ai.status.engine} /> : null}
      </div>
      {!ai.online ? (
        <p className="mt-2 text-meta text-text-subtle">
          Available when you’re back online. Chat keeps working offline.
        </p>
      ) : ai.status && !ai.status.enabled ? (
        <p className="mt-2 text-meta text-text-subtle">Your admin turned the assistant off.</p>
      ) : null}

      <div
        role="tablist"
        aria-label="Summary range"
        className="mt-3 flex rounded-md border border-border bg-surface p-0.5"
      >
        {RANGES.map((r) => (
          <button
            key={r.id}
            role="tab"
            aria-selected={summary?.range === r.id || (!summary && range === r.id)}
            disabled={disabled || busy !== null}
            onClick={() => void run(r.id)}
            className={cn(
              'flex-1 rounded-sm px-2 py-1 text-meta transition-colors disabled:opacity-50',
              (summary ? summary.range : range) === r.id
                ? 'bg-accent-soft text-text'
                : 'text-text-muted hover:text-text',
            )}
          >
            {r.label}
          </button>
        ))}
      </div>
      {!summary ? (
        <Button
          size="sm"
          className="mt-3 w-full"
          loading={busy === 'summary'}
          disabled={disabled}
          onClick={() => void run(range)}
        >
          <Sparkles /> Catch me up
        </Button>
      ) : null}
      {error ? <p className="mt-2 text-meta text-danger">{error}</p> : null}

      <AnimatePresence initial={false}>
        {summary ? (
          <motion.div
            key={`${summary.range}-${summary.generatedAt}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className={cn('mt-3 space-y-3', busy === 'summary' && 'opacity-50')}
          >
            <p className="text-label font-normal leading-relaxed text-text">{summary.summary}</p>
            {summary.highlights.length ? (
              <ul className="space-y-1.5">
                {summary.highlights.map((h) => (
                  <li key={h} className="flex gap-2 text-meta text-text-muted">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-accent" />
                    {h}
                  </li>
                ))}
              </ul>
            ) : null}
            {summary.decisions.length ? (
              <div>
                <p className="mb-1 flex items-center gap-1.5 text-overline uppercase text-text-subtle">
                  <Gavel className="size-3" /> Decisions
                </p>
                <ul className="space-y-1">
                  {summary.decisions.map((d) => (
                    <li key={d} className="text-meta text-text">
                      {d}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {summary.actionItems.length ? (
              <div>
                <p className="mb-1.5 text-overline uppercase text-text-subtle">Action items</p>
                <ul className="space-y-1.5">
                  {summary.actionItems.map((a) => (
                    <ActionItemRow key={a.text} item={a} directory={directory} me={me} />
                  ))}
                </ul>
              </div>
            ) : null}
            {summary.openQuestions.length ? (
              <div>
                <p className="mb-1 flex items-center gap-1.5 text-overline uppercase text-text-subtle">
                  <CircleHelp className="size-3" /> Still open
                </p>
                <ul className="space-y-1">
                  {summary.openQuestions.map((q) => (
                    <li key={q} className="text-meta text-text">
                      {q}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {canPost && summary.messageCount > 0 ? (
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                loading={busy === 'share'}
                disabled={disabled}
                onClick={async () => {
                  setBusy('share');
                  try {
                    setDraft(await ai.propose(conversationId, summaryAsText(summary, directory)));
                  } catch (e) {
                    setError(aiErrorText(e));
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                <Send /> Share summary to chat…
              </Button>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {canPost ? (
        <div className="mt-4 border-t border-border pt-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-overline uppercase text-text-subtle">
              <MessageSquareReply className="size-3" /> Suggested replies
            </p>
            <Button
              variant="link"
              size="sm"
              className="h-auto text-meta"
              disabled={disabled || busy !== null}
              onClick={async () => {
                setBusy('replies');
                try {
                  setReplies(await ai.replies(conversationId));
                } catch (e) {
                  setError(aiErrorText(e));
                } finally {
                  setBusy(null);
                }
              }}
            >
              {replies ? 'Refresh' : 'Suggest'}
            </Button>
          </div>
          {replies?.suggestions.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {replies.suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => onUseReply(s)}
                  className="rounded-full border border-border bg-surface px-2.5 py-1 text-left text-meta text-text transition-colors hover:border-accent hover:bg-accent-soft"
                >
                  {s}
                </button>
              ))}
            </div>
          ) : replies ? (
            <p className="mt-1 text-meta text-text-subtle">Nothing to reply to yet.</p>
          ) : (
            <p className="mt-1 text-meta text-text-subtle">
              Tap a suggestion to put it in your message box. You still press send.
            </p>
          )}
        </div>
      ) : null}

      <ConfirmDraftDialog
        ai={ai}
        proposal={draft}
        onOpenChange={(o) => !o && setDraft(null)}
        where={where}
      />
    </section>
  );
}

/** Meeting details: summary of the agenda and the meeting chat (recordings are not transcribed yet). */
export function MeetingAiSummary({
  meetingId,
  me,
  directory,
}: {
  meetingId: string;
  me: string;
  directory: Map<string, DirectoryEntry>;
}) {
  const ai = useAi();
  const [s, setS] = React.useState<AiMeetingSummary | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  if (ai.status && !ai.status.enabled) return null;
  return (
    <div className="rounded-lg border border-border bg-surface-raised p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-label text-text">
          <Sparkles className="size-4 text-accent" /> Meeting summary
        </p>
        {s ? (
          <EngineBadge engine={s.engine} />
        ) : (
          <Button
            size="sm"
            variant="secondary"
            loading={busy}
            disabled={!ai.available}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                setS(await ai.summarizeMeeting(meetingId));
              } catch (e) {
                setError(aiErrorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Summarize
          </Button>
        )}
      </div>
      {error ? <p className="mt-2 text-meta text-danger">{error}</p> : null}
      {s ? (
        <div className="mt-2 space-y-2">
          <p className="text-label font-normal text-text">{s.summary}</p>
          {s.decisions.length ? (
            <ul className="space-y-1">
              {s.decisions.map((d) => (
                <li key={d} className="flex gap-1.5 text-meta text-text">
                  <Gavel className="mt-0.5 size-3 shrink-0 text-text-subtle" /> {d}
                </li>
              ))}
            </ul>
          ) : null}
          {s.actionItems.length ? (
            <ul className="space-y-1.5">
              {s.actionItems.map((a) => (
                <ActionItemRow key={a.text} item={a} directory={directory} me={me} />
              ))}
            </ul>
          ) : null}
          <p className="text-meta text-text-subtle">
            From the agenda and meeting chat. Call recordings are not transcribed yet (planned:
            self-hosted speech-to-text).
          </p>
        </div>
      ) : (
        <p className="mt-1 text-meta text-text-subtle">
          Decisions and action items from the agenda and meeting chat.
        </p>
      )}
    </div>
  );
}
