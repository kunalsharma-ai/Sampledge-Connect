'use client';
import * as React from 'react';
import { PencilLine } from 'lucide-react';
import {
  EDIT_WINDOW_CHOICES,
  editWindowLabel,
  type MessageEditingPolicy,
} from '@sampledge/contracts';
import { Button, StateView, useToast } from '@sampledge/ui';
import { useMessageEditing } from '@/lib/message-editing';
import { FeatureHelp } from '../feature-help';
import { Toggle } from './branding-screen';

/**
 * Administration → Messages: whether people can edit their messages, for how long after
 * sending, and who can open earlier versions (docs/editing.md). Saved in the database and
 * applied live on every device.
 */
export function MessageEditingAdmin() {
  const { policy, canManage, online, savePolicy } = useMessageEditing();
  const { toast } = useToast();
  const [draft, setDraft] = React.useState<MessageEditingPolicy>(policy);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => setDraft(policy), [policy]);
  if (!canManage)
    return (
      <StateView
        state="permission-denied"
        title="Only owners and admins change message rules"
        description="Your role doesn’t include “Set message editing rules”."
      />
    );
  const dirty = JSON.stringify(draft) !== JSON.stringify(policy);
  const save = async () => {
    setSaving(true);
    try {
      await savePolicy(draft);
      toast({
        title: 'Message rules saved',
        description: 'Everyone’s apps update now.',
        tone: 'success',
      });
    } catch (e) {
      toast({
        title: 'Couldn’t save the rules',
        description: (e as Error).message,
        tone: 'danger',
      });
    } finally {
      setSaving(false);
    }
  };
  const choices = EDIT_WINDOW_CHOICES.includes(draft.editWindowMinutes as never)
    ? EDIT_WINDOW_CHOICES
    : [...EDIT_WINDOW_CHOICES, draft.editWindowMinutes];
  return (
    <section
      className="max-w-2xl rounded-xl border border-border bg-surface p-5"
      data-testid="message-editing-admin"
    >
      <div className="mb-4 flex items-center gap-2">
        <PencilLine className="size-4 text-accent" aria-hidden />
        <h2 className="flex-1 text-label text-text">Editing messages</h2>
        <FeatureHelp id="editing" size="sm" />
      </div>
      <div className="flex flex-col gap-5">
        <Toggle
          label="People can edit their own messages"
          help="Off: Edit disappears everywhere. People can still delete their own messages, and moderators can delete anyone’s."
          checked={draft.allowEditing}
          onChange={(allowEditing) => setDraft({ ...draft, allowEditing })}
        />
        <label className="flex flex-col gap-1.5">
          <span className="text-label text-text">Time limit</span>
          <span className="text-meta text-text-subtle">
            How long after sending a message can still be changed.
          </span>
          <select
            aria-label="Time limit for editing"
            disabled={!draft.allowEditing}
            value={draft.editWindowMinutes ?? ''}
            onChange={(e) =>
              setDraft({
                ...draft,
                editWindowMinutes: e.target.value ? Number(e.target.value) : null,
              })
            }
            className="h-9 w-60 rounded-md border border-border bg-surface px-2 text-label text-text disabled:opacity-50"
          >
            {choices.map((m) => (
              <option key={m ?? 'none'} value={m ?? ''}>
                {m == null ? 'No limit' : `Up to ${editWindowLabel(m)}`}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-label text-text">Who can see earlier versions</legend>
          <span className="mb-1 text-meta text-text-subtle">
            Every edit keeps the text it replaced. Click “(edited)” on a message to see them.
          </span>
          {(
            [
              ['everyone', 'Everyone in the conversation'],
              ['moderators', 'Only the sender, moderators and admins'],
            ] as const
          ).map(([v, l]) => (
            <label key={v} className="flex items-center gap-2 text-label font-normal text-text">
              <input
                type="radio"
                name="history"
                checked={draft.historyVisibleTo === v}
                onChange={() => setDraft({ ...draft, historyVisibleTo: v })}
                className="size-4 accent-[var(--sc-color-accent)]"
              />
              {l}
            </label>
          ))}
        </fieldset>
        <p className="text-meta text-text-subtle">
          Every edit is written to the audit log (who, which message and when, never the text).
          SampConnect’s super admins can also turn editing off for a role.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={!dirty || saving} onClick={() => setDraft(policy)}>
            Reset
          </Button>
          <Button disabled={!dirty || saving || !online} onClick={() => void save()}>
            {online ? 'Save rules' : 'Needs a connection'}
          </Button>
        </div>
      </div>
    </section>
  );
}
