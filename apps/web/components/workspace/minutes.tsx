'use client';
import * as React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Languages,
  NotebookPen,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  MINUTES_TEMPLATES,
  MINUTES_TEMPLATE_INFO,
  TRANSCRIPT_LANGUAGES,
  formatCallDuration,
  languageLabel,
  uuidv7,
  type CallMinutesResponse,
  type DocumentFormat,
  type MeetingMinutes,
  type MinutesActionItem,
  type MinutesConfig,
  type MinutesSystemMetadata,
  type MinutesTemplate,
  type UpdateMinutesRequest,
} from '@sampledge/contracts';
import type { LocalMessage } from '@sampledge/offline';
import { Badge, Button, Dialog, DialogContent, Input, Textarea, cn, useToast } from '@sampledge/ui';
import { ApiFailure } from '@/lib/api';
import { useEngineChange, type DirectoryEntry } from '@/lib/engine';
import { minutesErrorText, useMinutesApi, useMinutesConfig, type MinutesApi } from '@/lib/minutes';
import { nameOf } from './helpers';

type Editable = Pick<
  MeetingMinutes,
  'title' | 'agenda' | 'summary' | 'decisions' | 'actionItems' | 'openQuestions' | 'notes'
>;
const FIELDS = [
  'title',
  'agenda',
  'summary',
  'decisions',
  'actionItems',
  'openQuestions',
  'notes',
] as const;
const FIELD_LABEL: Record<(typeof FIELDS)[number], string> = {
  title: 'title',
  agenda: 'agenda',
  summary: 'summary',
  decisions: 'decisions',
  actionItems: 'action items',
  openQuestions: 'open questions',
  notes: 'notes',
};
const pick = (m: MeetingMinutes): Editable => ({
  title: m.title,
  agenda: m.agenda,
  summary: m.summary,
  decisions: m.decisions,
  actionItems: m.actionItems,
  openQuestions: m.openQuestions,
  notes: m.notes,
});
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const when = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

/**
 * Minutes of meeting for one call: make the draft, review and edit it with the others who
 * were there (edits merge per field and work offline), share it with the conversation, and
 * download it as PDF or Word in a template.
 */
export function MinutesDialog({
  open,
  onOpenChange,
  callId,
  me,
  directory,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  callId: string;
  me: string;
  directory: Map<string, DirectoryEntry>;
}) {
  const api = useMinutesApi();
  const config = useMinutesConfig();
  const { toast } = useToast();
  const [data, setData] = React.useState<CallMinutesResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [edit, setEdit] = React.useState<Editable | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [remote, setRemote] = React.useState(false);
  const [conflict, setConflict] = React.useState<string[] | null>(null);
  const [language, setLanguage] = React.useState<string>('');
  const m = data?.minutes ?? null;
  const dirty = !!(m && edit && FIELDS.some((f) => !same(edit[f], m[f])));

  const load = React.useCallback(async () => {
    try {
      const r = await api.forCall(callId);
      setData(r);
      setError(null);
      setRemote(false);
      setConflict(null);
      setEdit(r.minutes ? pick(r.minutes) : null);
    } catch (e) {
      setError(minutesErrorText(e));
    }
  }, [api, callId]);

  React.useEffect(() => {
    if (!open) return;
    setData(null);
    void load();
  }, [open, load]);
  React.useEffect(() => {
    if (config && !language) setLanguage(config.defaultLanguage);
  }, [config, language]);

  // Another person (or my other device) changed these minutes: reload unless I'm editing.
  useEngineChange(['minutes', 'action'], (e) => {
    if (!open) return;
    if (e.type === 'minutes' && e.callId === callId) {
      if (e.deleted) {
        toast({ title: 'These minutes were deleted' });
        void load();
      } else if (!m || e.revision > m.revision) {
        if (dirty) setRemote(true);
        else void load();
      }
    }
    if (e.type === 'action' && m && e.key === `minutes|${m.minutesId}`) {
      if (!e.ok)
        toast({
          title: 'Your offline edit was not saved',
          description: e.error?.message ?? 'Open the minutes again to see the current version.',
          tone: 'danger',
        });
      void load();
    }
    if (e.type === 'reconnected') void load();
  });

  const generate = async (regenerate: boolean) => {
    setBusy(regenerate ? 'regenerate' : 'generate');
    try {
      await api.generate(callId, { language, regenerate });
      await load();
      toast({
        title: regenerate ? 'Minutes written again' : 'Draft minutes ready',
        description: 'Check them with the others who were in the call before you share them.',
        tone: 'success',
      });
    } catch (e) {
      toast({
        title: 'Could not make the minutes',
        description: minutesErrorText(e),
        tone: 'danger',
      });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!m || !edit) return;
    const body: UpdateMinutesRequest = { baseRevision: m.revision };
    for (const f of FIELDS)
      if (!same(edit[f], m[f])) (body as Record<string, unknown>)[f] = edit[f];
    setBusy('save');
    try {
      const r = await api.update(m, body);
      if (r === 'queued') {
        toast({
          title: 'Saved on this device',
          description: 'Your changes reach the others when you’re back online.',
        });
      } else {
        setData((d) => (d ? { ...d, minutes: r } : d));
        setEdit(pick(r));
        setConflict(null);
        toast({ title: 'Minutes saved', tone: 'success' });
      }
    } catch (e) {
      if (e instanceof ApiFailure && e.error.code === 'CONFLICT') {
        const fields = (e.error.details as { fields?: string[] } | undefined)?.fields ?? [];
        setConflict(fields);
      } else toast({ title: 'Could not save', description: minutesErrorText(e), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    if (!m) return;
    if (dirty) await save();
    setBusy('share');
    try {
      const r = await api.share(m.minutesId);
      setData((d) => (d ? { ...d, minutes: r } : d));
      toast({
        title: 'Minutes shared',
        description: 'Everyone in the conversation can open them now.',
        tone: 'success',
      });
    } catch (e) {
      toast({ title: 'Could not share', description: minutesErrorText(e), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!m) return;
    setBusy('delete');
    try {
      await api.remove(m.minutesId);
      toast({ title: 'Minutes deleted' });
      await load();
    } catch (e) {
      toast({ title: 'Could not delete', description: minutesErrorText(e), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  const canEdit = !!m?.canEdit;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={m ? m.title : 'Minutes of meeting'}
        description={
          m
            ? `${m.media === 'video' ? 'Video' : 'Voice'} call · ${when.format(new Date(m.startedAt))}${
                m.durationSec != null ? ` · ${formatCallDuration(m.durationSec)}` : ''
              }`
            : 'Attendees, summary, decisions and action items from this call.'
        }
        className="flex max-h-[min(860px,calc(100vh-2rem))] w-[min(880px,calc(100vw-2rem))] flex-col"
        bodyClassName="flex min-h-0 flex-1 flex-col"
      >
        <div className="-mx-6 -mb-6 flex min-h-0 flex-1 flex-col" data-testid="minutes-dialog">
          {error ? (
            <p className="px-6 pb-6 text-label text-danger">{error}</p>
          ) : !data ? (
            <p className="px-6 pb-6 text-label text-text-subtle">Loading…</p>
          ) : !m ? (
            <Empty
              data={data}
              config={config}
              language={language}
              setLanguage={setLanguage}
              busy={busy === 'generate'}
              online={api.online}
              onGenerate={() => void generate(false)}
            />
          ) : (
            <>
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-4">
                <div className="flex flex-wrap items-center gap-2">
                  {m.status === 'draft' ? (
                    <Badge tone="warning">Draft · only people in the call can see it</Badge>
                  ) : (
                    <Badge tone="success">
                      <CheckCircle2 className="size-3" /> Shared
                      {m.sharedBy
                        ? ` by ${m.sharedBy === me ? 'you' : nameOf(m.sharedBy, directory)}`
                        : ''}
                    </Badge>
                  )}
                  <Badge tone="neutral">
                    <Languages className="size-3" /> {languageLabel(m.language)}
                  </Badge>
                  <Badge tone="neutral">
                    {m.engine === 'model'
                      ? 'Written by your AI model server'
                      : m.engine === 'basic'
                        ? 'Drafted by the built-in assistant'
                        : 'Written by people'}
                  </Badge>
                  {!api.online ? (
                    <Badge tone="neutral">Offline · edits save on this device</Badge>
                  ) : null}
                </div>
                {remote ? (
                  <Notice
                    tone="warning"
                    text="Someone else just changed these minutes."
                    action="Load their version"
                    onAction={() => void load()}
                  />
                ) : null}
                {conflict ? (
                  <Notice
                    tone="danger"
                    text={`Someone else changed the ${conflict.map((f) => FIELD_LABEL[f as keyof typeof FIELD_LABEL] ?? f).join(', ')} while you were editing. Your other changes are still here.`}
                    action="Load their version"
                    onAction={() => void load()}
                  />
                ) : null}

                <Section title="Attendees" icon={<Users className="size-4" />}>
                  <ul className="flex flex-wrap gap-1.5">
                    {m.attendees.map((a, i) => (
                      <li
                        key={`${a.userId ?? a.name}-${i}`}
                        className="rounded-full border border-border bg-surface-raised px-2.5 py-1 text-meta text-text"
                      >
                        {a.name}
                        {a.guest ? <span className="text-text-subtle"> · guest</span> : null}
                        {a.minutes != null ? (
                          <span className="text-text-subtle"> · {a.minutes} min</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </Section>

                {edit ? (
                  <>
                    {canEdit ? (
                      <label className="block">
                        <span className="mb-1 block text-meta font-medium text-text-muted">
                          Title
                        </span>
                        <Input
                          value={edit.title}
                          onChange={(e) => setEdit({ ...edit, title: e.target.value })}
                          aria-label="Minutes title"
                        />
                      </label>
                    ) : null}
                    {canEdit || m.agenda ? (
                      <Section title="Agenda">
                        <TextBlock
                          value={edit.agenda}
                          onChange={canEdit ? (v) => setEdit({ ...edit, agenda: v }) : undefined}
                          rows={2}
                          placeholder="What the meeting was for"
                          label="Agenda"
                        />
                      </Section>
                    ) : null}
                    <Section title="Summary">
                      <TextBlock
                        value={edit.summary}
                        onChange={canEdit ? (v) => setEdit({ ...edit, summary: v }) : undefined}
                        rows={5}
                        placeholder="What was discussed"
                        label="Summary"
                      />
                    </Section>
                    <Section title="Decisions">
                      <ListEditor
                        items={edit.decisions}
                        onChange={canEdit ? (v) => setEdit({ ...edit, decisions: v }) : undefined}
                        numbered
                        addLabel="Add a decision"
                        empty="No decisions recorded."
                      />
                    </Section>
                    <Section title="Action items">
                      <ActionItems
                        items={edit.actionItems}
                        attendees={m.attendees}
                        onChange={canEdit ? (v) => setEdit({ ...edit, actionItems: v }) : undefined}
                        directory={directory}
                      />
                    </Section>
                    <Section title="Open questions">
                      <ListEditor
                        items={edit.openQuestions}
                        onChange={
                          canEdit ? (v) => setEdit({ ...edit, openQuestions: v }) : undefined
                        }
                        addLabel="Add a question"
                        empty="No open questions."
                      />
                    </Section>
                    {canEdit || m.notes ? (
                      <Section title="Notes">
                        <TextBlock
                          value={edit.notes}
                          onChange={canEdit ? (v) => setEdit({ ...edit, notes: v }) : undefined}
                          rows={3}
                          placeholder="Anything else to keep with the minutes"
                          label="Notes"
                        />
                      </Section>
                    ) : null}
                  </>
                ) : null}
                <p className="text-meta text-text-subtle">
                  {sourcesLine(m)} Speech recognition and translation run on your organization’s own
                  servers and can contain mistakes, so check names, numbers and decisions before
                  sharing.
                </p>
                <DownloadPanel api={api} minutes={m} config={config} />
              </div>
              {canEdit ? (
                <footer className="flex flex-wrap items-center gap-2 border-t border-border px-6 py-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void remove()}
                    loading={busy === 'delete'}
                    disabled={!api.online || !!busy}
                    aria-label="Delete minutes"
                  >
                    <Trash2 /> <span className="hidden sm:inline">Delete</span>
                  </Button>
                  <div className="flex items-center gap-1">
                    <LanguageSelect
                      value={language || m.language}
                      onChange={setLanguage}
                      label="Write in"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void generate(true)}
                      loading={busy === 'regenerate'}
                      disabled={!api.online || !!busy}
                    >
                      <RefreshCw /> <span className="hidden sm:inline">Write again</span>
                    </Button>
                  </div>
                  <div className="flex-1" />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void save()}
                    loading={busy === 'save'}
                    disabled={!dirty || !!busy}
                  >
                    Save changes
                  </Button>
                  {m.status === 'draft' ? (
                    <Button
                      size="sm"
                      onClick={() => void share()}
                      loading={busy === 'share'}
                      disabled={!api.online || !!busy}
                    >
                      <Send /> Share with conversation
                    </Button>
                  ) : null}
                </footer>
              ) : null}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function sourcesLine(m: MeetingMinutes) {
  const s = m.sources;
  const parts: string[] = [];
  if (s.transcripts)
    parts.push(
      `${s.transcripts} recording transcript${s.transcripts === 1 ? '' : 's'}${
        s.reviewedTranscripts ? ` (${s.reviewedTranscripts} checked)` : ''
      }`,
    );
  if (s.captionLines) parts.push(`${s.captionLines} caption lines`);
  if (s.chatMessages)
    parts.push(`${s.chatMessages} chat message${s.chatMessages === 1 ? '' : 's'}`);
  const langs = s.spokenLanguages.length
    ? ` Spoken: ${s.spokenLanguages.map(languageLabel).join(', ')}.`
    : '';
  return parts.length
    ? `Made from ${parts.join(', ')}.${langs}`
    : `Written by the people in the call.${langs}`;
}

function Empty({
  data,
  config,
  language,
  setLanguage,
  busy,
  online,
  onGenerate,
}: {
  data: CallMinutesResponse;
  config: MinutesConfig | null;
  language: string;
  setLanguage: (l: string) => void;
  busy: boolean;
  online: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 pb-8 pt-2 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <NotebookPen className="size-6" />
      </span>
      {data.canCreate ? (
        <>
          <p className="max-w-md text-label font-normal text-text-muted">
            {config && !config.aiEnabled
              ? 'The AI assistant is off, so the minutes start with the attendees filled in and you write the rest.'
              : 'The assistant drafts the minutes from the call’s transcripts, captions and chat. Only people who were in the call see the draft until one of you shares it.'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <LanguageSelect value={language} onChange={setLanguage} label="Write in" />
            <Button onClick={onGenerate} loading={busy} disabled={!online}>
              <NotebookPen /> Make minutes
            </Button>
          </div>
          {config && !config.model && language !== 'en' ? (
            <p className="max-w-md text-meta text-text-subtle">
              Without an AI model server, minutes in other languages use translated transcripts when
              there are any. An admin can add one in Integrations.
            </p>
          ) : null}
          {!online ? (
            <p className="text-meta text-text-subtle">Making minutes needs a connection.</p>
          ) : null}
        </>
      ) : (
        <p className="max-w-md text-label font-normal text-text-muted">
          {data.blockedReason ??
            'No minutes have been shared for this call yet. People who were in the call can make them.'}
        </p>
      )}
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-label text-text">
        <span className="h-3.5 w-1 rounded-full bg-accent" />
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function Notice({
  tone,
  text,
  action,
  onAction,
}: {
  tone: 'warning' | 'danger';
  text: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-meta',
        tone === 'danger'
          ? 'border-danger/40 bg-danger/10 text-danger'
          : 'border-warning/40 bg-warning/10 text-warning',
      )}
    >
      <AlertTriangle className="size-4 shrink-0" />
      <span className="flex-1 text-text">{text}</span>
      <Button size="sm" variant="secondary" onClick={onAction}>
        {action}
      </Button>
    </div>
  );
}

function TextBlock({
  value,
  onChange,
  rows,
  placeholder,
  label,
}: {
  value: string;
  onChange?: (v: string) => void;
  rows: number;
  placeholder: string;
  label: string;
}) {
  if (!onChange)
    return value.trim() ? (
      <p className="whitespace-pre-wrap text-label font-normal text-text">{value}</p>
    ) : (
      <p className="text-label font-normal text-text-subtle">Nothing written.</p>
    );
  return (
    <Textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      aria-label={label}
      className="w-full"
    />
  );
}

function ListEditor({
  items,
  onChange,
  numbered,
  addLabel,
  empty,
}: {
  items: string[];
  onChange?: (v: string[]) => void;
  numbered?: boolean;
  addLabel: string;
  empty: string;
}) {
  if (!onChange)
    return items.length ? (
      <ol
        className={cn(
          'space-y-1 pl-5 text-label font-normal text-text',
          numbered ? 'list-decimal' : 'list-disc',
        )}
      >
        {items.map((d, i) => (
          <li key={i}>{d}</li>
        ))}
      </ol>
    ) : (
      <p className="text-label font-normal text-text-subtle">{empty}</p>
    );
  return (
    <div className="space-y-1.5">
      {items.map((d, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-5 shrink-0 text-right text-meta text-text-subtle">
            {numbered ? `${i + 1}.` : '•'}
          </span>
          <Input
            value={d}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
            aria-label={`${addLabel.replace('Add a ', '')} ${i + 1}`}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Remove"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            <X />
          </Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={() => onChange([...items, ''])}>
        <Plus /> {addLabel}
      </Button>
    </div>
  );
}

function ActionItems({
  items,
  attendees,
  onChange,
  directory,
}: {
  items: MinutesActionItem[];
  attendees: MeetingMinutes['attendees'];
  onChange?: (v: MinutesActionItem[]) => void;
  directory: Map<string, DirectoryEntry>;
}) {
  const owner = (a: MinutesActionItem) =>
    a.ownerId ? nameOf(a.ownerId, directory) : (a.ownerName ?? 'Unassigned');
  if (!onChange)
    return items.length ? (
      <ul className="divide-y divide-border rounded-lg border border-border">
        {items.map((a) => (
          <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-label font-normal">
            <CheckCircle2
              className={cn('size-4 shrink-0', a.done ? 'text-success' : 'text-text-subtle')}
            />
            <span className={cn('flex-1 text-text', a.done && 'line-through opacity-70')}>
              {a.text}
            </span>
            <span className="text-meta text-text-muted">{owner(a)}</span>
            {a.due ? <Badge tone="neutral">{a.due}</Badge> : null}
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-label font-normal text-text-subtle">No action items recorded.</p>
    );
  const set = (i: number, patch: Partial<MinutesActionItem>) =>
    onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const people = attendees.filter((a) => a.userId);
  return (
    <div className="space-y-2">
      {items.map((a, i) => (
        <div
          key={a.id}
          className="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-lg border border-border p-2 sm:grid-cols-[auto_1fr_160px_110px_auto]"
        >
          <input
            type="checkbox"
            checked={a.done}
            onChange={(e) => set(i, { done: e.target.checked })}
            aria-label={`Done: ${a.text || 'action item'}`}
            className="size-4 accent-[var(--sc-accent)]"
          />
          <Input
            value={a.text}
            onChange={(e) => set(i, { text: e.target.value })}
            aria-label={`Action ${i + 1}`}
          />
          <select
            value={a.ownerId ?? (a.ownerName ? `name:${a.ownerName}` : '')}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) set(i, { ownerId: null, ownerName: null });
              else if (v.startsWith('name:')) set(i, { ownerId: null, ownerName: v.slice(5) });
              else set(i, { ownerId: v, ownerName: null });
            }}
            aria-label={`Owner of action ${i + 1}`}
            className="col-span-2 h-10 rounded-md border border-border bg-surface-raised px-2 text-label font-normal text-text sm:col-span-1"
          >
            <option value="">Unassigned</option>
            {people.map((p) => (
              <option key={p.userId} value={p.userId!}>
                {p.name}
              </option>
            ))}
            {attendees
              .filter((g) => g.guest)
              .map((g) => (
                <option key={`g-${g.name}`} value={`name:${g.name}`}>
                  {g.name} (guest)
                </option>
              ))}
            {a.ownerName && !attendees.some((x) => x.name === a.ownerName) ? (
              <option value={`name:${a.ownerName}`}>{a.ownerName}</option>
            ) : null}
          </select>
          <Input
            value={a.due ?? ''}
            placeholder="Due"
            onChange={(e) => set(i, { due: e.target.value || null })}
            aria-label={`Due date of action ${i + 1}`}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Remove action"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            <X />
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          onChange([
            ...items,
            { id: uuidv7(), text: '', ownerId: null, ownerName: null, due: null, done: false },
          ])
        }
      >
        <Plus /> Add an action item
      </Button>
    </div>
  );
}

export function LanguageSelect({
  value,
  onChange,
  label,
  only,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  /** Limit the choices (for example English only without a model server). */
  only?: string[];
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-meta text-text-muted">
      <Languages className="size-3.5" />
      <span className="sr-only sm:not-sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="h-8 rounded-sm border border-border bg-surface-raised px-2 text-label font-normal text-text"
      >
        {TRANSCRIPT_LANGUAGES.filter(([c]) => !only || only.includes(c)).map(([c, n]) => (
          <option key={c} value={c}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Format, template and transcript appendix, then download. Works for every reader. */
function DownloadPanel({
  api,
  minutes,
  config,
}: {
  api: MinutesApi;
  minutes: MeetingMinutes;
  config: MinutesConfig | null;
}) {
  const { toast } = useToast();
  const [format, setFormat] = React.useState<DocumentFormat>('pdf');
  const [template, setTemplate] = React.useState<MinutesTemplate | null>(null);
  const [transcript, setTranscript] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const chosen = template ?? config?.defaultTemplate ?? 'modern';
  return (
    <section
      className="rounded-xl border border-border bg-surface-raised/50 p-4"
      aria-label="Download minutes"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="flex flex-1 items-center gap-2 text-label text-text">
          <Download className="size-4 text-accent" /> Download
        </h3>
        <div
          role="radiogroup"
          aria-label="File type"
          className="flex rounded-md border border-border p-0.5"
        >
          {(['pdf', 'docx'] as const).map((f) => (
            <button
              key={f}
              role="radio"
              aria-checked={format === f}
              onClick={() => setFormat(f)}
              className={cn(
                'rounded-sm px-3 py-1 text-meta font-medium',
                format === f ? 'bg-accent text-accent-fg' : 'text-text-muted hover:text-text',
              )}
            >
              {f === 'pdf' ? 'PDF' : 'Word'}
            </button>
          ))}
        </div>
      </div>
      <div
        role="radiogroup"
        aria-label="Template"
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {MINUTES_TEMPLATES.map((t) => (
          <button
            key={t}
            role="radio"
            aria-checked={chosen === t}
            onClick={() => setTemplate(t)}
            className={cn(
              'flex flex-col items-start gap-2 rounded-lg border p-2 text-left transition-colors',
              chosen === t
                ? 'border-accent bg-accent-soft'
                : 'border-border hover:border-border-strong',
            )}
          >
            <TemplateThumb template={t} />
            <span className="text-meta font-semibold text-text">
              {MINUTES_TEMPLATE_INFO[t].label}
              {config?.defaultTemplate === t ? (
                <span className="font-normal text-text-subtle"> · default</span>
              ) : null}
            </span>
            <span className="text-[11px] leading-snug text-text-subtle">
              {MINUTES_TEMPLATE_INFO[t].description}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex flex-1 items-center gap-2 text-meta text-text-muted">
          <input
            type="checkbox"
            checked={transcript}
            onChange={(e) => setTranscript(e.target.checked)}
            className="size-4 accent-[var(--sc-accent)]"
          />
          Add the full transcript at the end
        </label>
        <Button
          size="sm"
          loading={busy}
          disabled={!api.online}
          onClick={async () => {
            setBusy(true);
            try {
              const name = await api.download(minutes, format, chosen, transcript);
              toast({ title: 'Downloaded', description: name, tone: 'success' });
            } catch (e) {
              toast({ title: 'Download failed', description: minutesErrorText(e), tone: 'danger' });
            } finally {
              setBusy(false);
            }
          }}
        >
          <FileText /> Download {format === 'pdf' ? 'PDF' : 'Word'}
        </Button>
      </div>
      {!api.online ? (
        <p className="mt-2 text-meta text-text-subtle">Downloads need a connection.</p>
      ) : null}
    </section>
  );
}

/** A tiny picture of each template's first page. */
function TemplateThumb({ template }: { template: MinutesTemplate }) {
  const line = (w: string, c = 'bg-[#CBD5E1]') => (
    <span className={cn('block h-[3px] rounded-full', c)} style={{ width: w }} />
  );
  return (
    <span
      aria-hidden
      className="relative flex h-[84px] w-full flex-col gap-1 overflow-hidden rounded-md border border-black/10 bg-white p-2 shadow-sm"
    >
      {template === 'executive' ? (
        <span className="-mx-2 -mt-2 mb-1 flex h-6 flex-col justify-center gap-0.5 border-b-2 border-[var(--sc-accent)] bg-[#0F172A] px-2">
          {line('60%', 'bg-white')}
          {line('35%', 'bg-[#94A3B8]')}
        </span>
      ) : template === 'modern' ? (
        <>
          <span className="-mx-2 -mt-2 mb-1 h-1.5 bg-[var(--sc-accent)]" />
          {line('25%', 'bg-[var(--sc-accent)]')}
          {line('65%', 'bg-[#111827]')}
        </>
      ) : template === 'classic' ? (
        <span className="mb-1 flex flex-col items-center gap-0.5">
          {line('30%')}
          {line('60%', 'bg-[#1F2328]')}
          <span className="mt-0.5 block h-[3px] w-full border-y border-[#1F2328]" />
        </span>
      ) : (
        <span className="mb-0.5 flex items-center justify-between border-b border-[var(--sc-accent)] pb-0.5">
          {line('45%', 'bg-[#111827]')}
          {line('25%')}
        </span>
      )}
      {template === 'compact' ? (
        <>
          {line('90%')}
          {line('85%')}
          {line('92%')}
          {line('70%')}
          {line('88%')}
          {line('60%')}
        </>
      ) : (
        <>
          <span
            className={cn(
              'block h-3 rounded-sm',
              template === 'classic' ? 'bg-[#F4F1EA]' : 'bg-[#EEF2FF]',
            )}
          />
          {line('80%')}
          {line('70%')}
          {line('50%')}
        </>
      )}
    </span>
  );
}

/** The card posted in the conversation when minutes are shared. */
export function MinutesCard({
  message,
  me,
  directory,
}: {
  message: LocalMessage;
  me: string;
  directory: Map<string, DirectoryEntry>;
}) {
  const meta = message.metadata?.minutes as
    (MinutesSystemMetadata & { deleted?: boolean }) | undefined;
  const [open, setOpen] = React.useState(false);
  if (!meta) return null;
  const who = meta.sharedBy === me ? 'You' : nameOf(meta.sharedBy, directory).split(' ')[0];
  return (
    <div className="my-3 flex justify-center" data-testid="minutes-card">
      <div className="flex w-full max-w-md items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-sm">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <NotebookPen className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-label text-text">
            {meta.deleted ? 'Minutes of meeting deleted' : meta.title}
          </p>
          <p className="truncate text-meta text-text-subtle">
            {meta.deleted
              ? 'Someone who was in the call deleted them.'
              : `Minutes shared by ${who} · ${meta.decisions} decision${meta.decisions === 1 ? '' : 's'} · ${meta.actionItems} action item${meta.actionItems === 1 ? '' : 's'}`}
          </p>
        </div>
        {meta.deleted ? null : (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Open
          </Button>
        )}
      </div>
      {open ? (
        <MinutesDialog
          open={open}
          onOpenChange={setOpen}
          callId={meta.callId}
          me={me}
          directory={directory}
        />
      ) : null}
    </div>
  );
}

/** "Minutes" on an ended call card. */
export function MinutesButton({
  callId,
  me,
  directory,
}: {
  callId: string;
  me: string;
  directory: Map<string, DirectoryEntry>;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
        aria-label="Minutes of meeting"
      >
        <NotebookPen /> Minutes
      </Button>
      {open ? (
        <MinutesDialog
          open={open}
          onOpenChange={setOpen}
          callId={callId}
          me={me}
          directory={directory}
        />
      ) : null}
    </>
  );
}
