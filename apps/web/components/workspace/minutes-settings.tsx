'use client';
import * as React from 'react';
import {
  CHAT_EXPORT_POLICIES,
  CHAT_EXPORT_POLICY_LABEL,
  MINUTES_TEMPLATES,
  MINUTES_TEMPLATE_INFO,
  TRANSCRIPT_LANGUAGES,
  type MinutesSettings,
} from '@sampledge/contracts';
import { Button, Field, Input, StateView, cn, useToast } from '@sampledge/ui';
import { useTenantChange } from '@/lib/engine';
import { minutesErrorText, useMinutesApi } from '@/lib/minutes';

const select =
  'h-9 w-full rounded-md border border-border bg-surface px-2 text-body text-text focus-visible:outline-2 focus-visible:outline-accent';

/**
 * Admin settings for minutes of meeting and chat export: who may export chats, the default
 * template and language, and whether live captions are kept so minutes can name speakers.
 * Saved in the organization's database; every device refreshes when it changes.
 */
export function MinutesSettingsPanel() {
  const api = useMinutesApi();
  const { toast } = useToast();
  const [s, setS] = React.useState<MinutesSettings | null>(null);
  const [days, setDays] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!api.online) return;
    void api.settings().then(
      (v) => {
        setS(v);
        setDays(String(v.captionRetentionDays));
        setError(null);
      },
      (e) => setError(minutesErrorText(e)),
    );
  }, [api]);
  React.useEffect(load, [load]);
  useTenantChange('minutes', load);

  if (error) return <p className="text-meta text-danger">{error}</p>;
  if (!s) return <StateView state="loading" title="Loading settings" className="py-6" />;

  const save = async (next: MinutesSettings) => {
    const prev = s;
    setS(next);
    setSaving(true);
    try {
      setS(await api.saveSettings(next));
      toast({ title: 'Minutes settings saved', tone: 'success' });
    } catch (e) {
      setS(prev);
      toast({ title: 'Could not save', description: minutesErrorText(e), tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="min-h" className="flex flex-col gap-4" data-testid="minutes-settings">
      <div>
        <h3 id="min-h" className="text-h3 text-text">
          Minutes and chat export
        </h3>
        <p className="mt-1 text-meta text-text-subtle">
          Minutes are drafted after each call from transcripts, captions and chat, then reviewed by
          the people who were there before anyone else sees them.
        </p>
      </div>

      <Field
        label="Who can export chats"
        htmlFor="min-export"
        hint="Every export is recorded in the audit log."
      >
        <select
          id="min-export"
          className={select}
          value={s.chatExport}
          disabled={saving || !api.online}
          onChange={(e) =>
            void save({ ...s, chatExport: e.target.value as MinutesSettings['chatExport'] })
          }
        >
          {CHAT_EXPORT_POLICIES.map((p) => (
            <option key={p} value={p}>
              {CHAT_EXPORT_POLICY_LABEL[p]}
            </option>
          ))}
        </select>
      </Field>

      <div>
        <p className="mb-1.5 text-label text-text">Default template</p>
        <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Default template">
          {MINUTES_TEMPLATES.map((t) => (
            <button
              key={t}
              role="radio"
              aria-checked={s.defaultTemplate === t}
              disabled={saving || !api.online}
              onClick={() => void save({ ...s, defaultTemplate: t })}
              className={cn(
                'rounded-lg border px-3 py-2 text-left',
                s.defaultTemplate === t
                  ? 'border-accent bg-accent-soft'
                  : 'border-border hover:border-border-strong',
              )}
            >
              <span className="block text-label text-text">{MINUTES_TEMPLATE_INFO[t].label}</span>
              <span className="block text-[11px] leading-snug text-text-subtle">
                {MINUTES_TEMPLATE_INFO[t].description}
              </span>
            </button>
          ))}
        </div>
      </div>

      <Field
        label="Write minutes in"
        htmlFor="min-lang"
        hint="People can pick another language for each meeting. Languages other than English need your AI model server."
      >
        <select
          id="min-lang"
          className={select}
          value={s.defaultLanguage}
          disabled={saving || !api.online}
          onChange={(e) => void save({ ...s, defaultLanguage: e.target.value })}
        >
          {TRANSCRIPT_LANGUAGES.map(([c, n]) => (
            <option key={c} value={c}>
              {n}
            </option>
          ))}
        </select>
      </Field>

      <label className="flex items-start gap-3 rounded-lg border border-border p-3">
        <input
          type="checkbox"
          checked={s.keepCaptions}
          disabled={saving || !api.online}
          onChange={(e) => void save({ ...s, keepCaptions: e.target.checked })}
          className="mt-0.5 size-4 accent-[var(--sc-accent)]"
        />
        <span>
          <span className="block text-label text-text">Keep live captions for minutes</span>
          <span className="block text-meta text-text-subtle">
            Saves who said what during calls that aren’t recorded, so minutes can name speakers.
            Everyone in the call sees a notice. Off by default.
          </span>
        </span>
      </label>
      {s.keepCaptions ? (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(days);
            if (Number.isInteger(n) && n >= 1 && n <= 365)
              void save({ ...s, captionRetentionDays: n });
          }}
        >
          <div className="flex-1">
            <Field
              label="Delete saved captions after (days)"
              htmlFor="min-days"
              hint="1 to 365 days"
            >
              <Input
                id="min-days"
                inputMode="numeric"
                value={days}
                onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))}
              />
            </Field>
          </div>
          <Button
            type="submit"
            variant="secondary"
            className="mb-6"
            disabled={saving || !days || Number(days) === s.captionRetentionDays}
          >
            Apply
          </Button>
        </form>
      ) : null}
    </section>
  );
}
