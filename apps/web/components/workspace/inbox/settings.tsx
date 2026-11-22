'use client';
import * as React from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { INBOX_PRIORITIES, type InboxSettings, type InboxTemplate } from '@sampledge/contracts';
import { Button, Field, Input, StateView, cn, useToast } from '@sampledge/ui';
import { useTenantChange, type DirectoryEntry } from '@/lib/engine';
import type { InboxApi } from '@/lib/inbox';
import { PRIORITY_STYLE } from './shared';

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        className={cn(
          'mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring',
          checked ? 'bg-accent' : 'bg-surface-raised border border-border',
        )}
      >
        <span
          className={cn(
            'size-4 rounded-full bg-white shadow transition-transform',
            checked && 'translate-x-4',
          )}
        />
      </span>
      <span>
        <span className="block text-label text-text">{label}</span>
        <span className="block text-meta text-text-muted">{hint}</span>
      </span>
    </label>
  );
}

/** SLA targets, routing, escalation contacts, inbox teams and response templates. */
export function InboxSettingsPanel({
  api,
  directory,
  settings,
  onSaved,
  online,
}: {
  api: InboxApi;
  directory: Map<string, DirectoryEntry>;
  settings: InboxSettings | null;
  onSaved: (s: InboxSettings) => void;
  online: boolean;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = React.useState<InboxSettings | null>(settings);
  const [templates, setTemplates] = React.useState<InboxTemplate[] | null>(null);
  const [tpl, setTpl] = React.useState({ name: '', shortcut: '', body: '' });
  React.useEffect(() => setDraft(settings), [settings]);
  const [tick, setTick] = React.useState(0);
  useTenantChange('inbox', () => setTick((t) => t + 1));
  React.useEffect(() => {
    if (online) void api.templates().then(setTemplates, () => setTemplates([]));
  }, [api, online, tick]);
  const agents = [...directory.values()].filter((u) => u.role !== 'guest' && u.status === 'active');

  if (!draft) return <StateView state={online ? 'loading' : 'offline'} />;
  const save = async () => {
    try {
      const s = await api.saveSettings(draft);
      onSaved(s);
      toast({ title: 'Inbox settings saved', tone: 'success' });
    } catch (e) {
      toast({ title: 'Could not save', description: (e as Error).message, tone: 'danger' });
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-[1100px] gap-5 p-5 sm:p-6 lg:grid-cols-2">
      <section className="space-y-5 rounded-xl border border-border bg-surface/70 p-5">
        <div>
          <h2 className="text-h3 text-text">Service levels</h2>
          <p className="text-label font-normal text-text-muted">
            How long a client may wait for a reply, by priority.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {INBOX_PRIORITIES.map((p) => (
            <Field key={p} label={`${PRIORITY_STYLE[p].label} (minutes)`} htmlFor={`sla-${p}`}>
              <Input
                id={`sla-${p}`}
                type="number"
                min={5}
                value={draft.sla[p]}
                onChange={(e) =>
                  setDraft({ ...draft, sla: { ...draft.sla, [p]: Number(e.target.value) } })
                }
              />
            </Field>
          ))}
        </div>
        <Field label="Warn when this much of the window is used" htmlFor="due-soon">
          <select
            id="due-soon"
            className="h-10 w-full rounded-md border border-border bg-surface-sunken px-3 text-body text-text"
            value={draft.dueSoonRatio}
            onChange={(e) => setDraft({ ...draft, dueSoonRatio: Number(e.target.value) })}
          >
            {[0.5, 0.75, 0.9].map((r) => (
              <option key={r} value={r}>
                {r * 100}%
              </option>
            ))}
          </select>
        </Field>
        <Toggle
          checked={draft.autoAssign}
          onChange={(v) => setDraft({ ...draft, autoAssign: v })}
          label="Auto-assign new conversations"
          hint="Within the owning team, to the agent with the fewest open conversations."
        />
        <Toggle
          checked={draft.autoEscalateOnBreach}
          onChange={(v) => setDraft({ ...draft, autoEscalateOnBreach: v })}
          label="Escalate automatically on SLA breach"
          hint="Raises priority and hands the conversation to the first escalation contact."
        />
        <Field label="Escalation contacts" htmlFor="esc">
          <div id="esc" className="flex flex-wrap gap-1.5">
            {agents.map((u) => {
              const on = draft.escalationContactIds.includes(u.userId);
              return (
                <button
                  key={u.userId}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      escalationContactIds: on
                        ? draft.escalationContactIds.filter((x) => x !== u.userId)
                        : [...draft.escalationContactIds, u.userId],
                    })
                  }
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-meta',
                    on
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-border text-text-muted hover:border-border-strong',
                  )}
                >
                  {u.displayName}
                </button>
              );
            })}
          </div>
        </Field>
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-surface/70 p-5">
        <div className="flex items-center">
          <div className="flex-1">
            <h2 className="text-h3 text-text">Inbox teams</h2>
            <p className="text-label font-normal text-text-muted">
              A team-owned conversation is visible to its team and supervisors only.
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setDraft({
                ...draft,
                teams: [...draft.teams, { teamId: '', name: 'New team', memberIds: [] }],
              })
            }
          >
            <Plus /> Team
          </Button>
        </div>
        {draft.teams.length === 0 ? (
          <p className="text-label font-normal text-text-subtle">
            No teams: every agent sees every conversation.
          </p>
        ) : null}
        {draft.teams.map((t, i) => (
          <div key={t.teamId || i} className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2">
              <Input
                aria-label="Team name"
                value={t.name}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    teams: draft.teams.map((x, j) =>
                      j === i ? { ...x, name: e.target.value } : x,
                    ),
                  })
                }
              />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Remove team"
                onClick={() => setDraft({ ...draft, teams: draft.teams.filter((_, j) => j !== i) })}
              >
                <Trash2 />
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {agents.map((u) => {
                const on = t.memberIds.includes(u.userId);
                return (
                  <button
                    key={u.userId}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        teams: draft.teams.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                memberIds: on
                                  ? x.memberIds.filter((m) => m !== u.userId)
                                  : [...x.memberIds, u.userId],
                              }
                            : x,
                        ),
                      })
                    }
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-meta',
                      on
                        ? 'border-accent-2 bg-accent-2-soft text-accent-2'
                        : 'border-border text-text-muted hover:border-border-strong',
                    )}
                  >
                    {u.displayName}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <div className="flex justify-end">
          <Button onClick={() => void save()} disabled={!online}>
            <Save /> Save settings
          </Button>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-surface/70 p-5 lg:col-span-2">
        <div>
          <h2 className="text-h3 text-text">Response templates</h2>
          <p className="text-label font-normal text-text-muted">
            Type / and the shortcut in the composer. Variables: {'{{client.firstName}}'},{' '}
            {'{{client.name}}'}, {'{{client.company}}'}, {'{{agent.name}}'}.
          </p>
        </div>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {(templates ?? []).map((t) => (
            <li key={t.templateId} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-label text-text">
                  {t.name}{' '}
                  {t.shortcut ? (
                    <span className="font-mono text-meta text-text-subtle">/{t.shortcut}</span>
                  ) : null}
                </p>
                <p className="line-clamp-2 text-label font-normal text-text-muted">{t.body}</p>
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Delete ${t.name}`}
                onClick={() =>
                  void api
                    .deleteTemplate(t.templateId)
                    .then(() =>
                      setTemplates((x) => x?.filter((y) => y.templateId !== t.templateId) ?? null),
                    )
                }
              >
                <Trash2 />
              </Button>
            </li>
          ))}
          {templates && !templates.length ? (
            <li className="px-4 py-3 text-label font-normal text-text-subtle">No templates yet.</li>
          ) : null}
        </ul>
        <form
          className="grid gap-3 sm:grid-cols-[1fr_160px]"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const t = await api.saveTemplate(null, {
                name: tpl.name,
                shortcut: tpl.shortcut || null,
                body: tpl.body,
              });
              setTemplates((x) => [...(x ?? []), t]);
              setTpl({ name: '', shortcut: '', body: '' });
            } catch (err) {
              toast({
                title: 'Could not save template',
                description: (err as Error).message,
                tone: 'danger',
              });
            }
          }}
        >
          <Input
            aria-label="Template name"
            placeholder="Name, e.g. Fieldwork update"
            value={tpl.name}
            onChange={(e) => setTpl({ ...tpl, name: e.target.value })}
          />
          <Input
            aria-label="Shortcut"
            placeholder="shortcut"
            value={tpl.shortcut}
            onChange={(e) => setTpl({ ...tpl, shortcut: e.target.value.toLowerCase() })}
          />
          <textarea
            aria-label="Template text"
            rows={2}
            className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-body text-text sm:col-span-2"
            placeholder="Hi {{client.firstName}}, …"
            value={tpl.body}
            onChange={(e) => setTpl({ ...tpl, body: e.target.value })}
          />
          <div className="sm:col-span-2">
            <Button
              type="submit"
              variant="secondary"
              disabled={!tpl.name.trim() || !tpl.body.trim() || !online}
            >
              <Plus /> Add template
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
