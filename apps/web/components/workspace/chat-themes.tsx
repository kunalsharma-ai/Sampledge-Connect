'use client';
import * as React from 'react';
import { Check, MessageSquareText } from 'lucide-react';
import {
  CHAT_THEMES,
  CHAT_THEME_CATEGORIES,
  type ChatThemeCategory,
  type ChatThemeId,
  type ChatThemePolicy,
} from '@sampledge/contracts';
import { Badge, Button, Card, cn, useTheme, useToast } from '@sampledge/ui';
import { useAuth } from '@/lib/auth';
import { chatThemeCss, useChatTheme } from '@/lib/chat-theme';

const CATEGORY_LABEL: Record<ChatThemeCategory, string> = {
  classic: 'Classic',
  office: 'Office',
  pattern: 'Patterns',
  color: 'Colors',
};

/**
 * Settings card: pick how conversations look. Twenty professional chat themes on top of your app
 * theme; the choice follows you to every device. Owners and admins also set the organization
 * default and can limit which themes people may pick.
 */
export function ChatThemesCard() {
  const { themeId, policy, effective, choose, savePolicy, online } = useChatTheme();
  const { session } = useAuth();
  const { toast } = useToast();
  const isAdmin = session?.user.role === 'owner' || session?.user.role === 'admin';
  const [tab, setTab] = React.useState<ChatThemeCategory | 'all'>('all');
  const [managing, setManaging] = React.useState(false);
  const [draft, setDraft] = React.useState<ChatThemePolicy>(policy);
  React.useEffect(() => setDraft(policy), [policy]);

  const offered = CHAT_THEMES.filter((t) => !policy.allowed || policy.allowed.includes(t.id));
  const shown = (managing ? CHAT_THEMES : offered).filter(
    (t) => tab === 'all' || t.category === tab,
  );
  const pick = (id: ChatThemeId) => {
    if (managing) {
      const all = draft.allowed ?? CHAT_THEMES.map((t) => t.id);
      const next = all.includes(id) ? all.filter((x) => x !== id) : [...all, id];
      setDraft({ ...draft, allowed: next.length ? next : [draft.defaultThemeId] });
      return;
    }
    choose(id === policy.defaultThemeId && themeId === null ? null : id);
  };

  return (
    <Card className="mt-6 p-5" data-testid="chat-themes">
      <div className="flex flex-wrap items-start gap-3">
        <MessageSquareText className="mt-0.5 size-5 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="text-label text-text">Chat theme</h3>
          <p className="mt-0.5 text-meta text-text-subtle">
            How your conversations look: background and your message bubbles. Works with your app
            theme above and follows you to every device.
          </p>
        </div>
        {isAdmin ? (
          <Button
            size="sm"
            variant={managing ? 'secondary' : 'ghost'}
            onClick={() => setManaging((m) => !m)}
            aria-pressed={managing}
          >
            {managing ? 'Back to my theme' : 'Organization rules'}
          </Button>
        ) : null}
      </div>

      {managing ? (
        <div className="mt-4 grid gap-3 rounded-lg border border-border bg-surface-sunken p-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-meta text-text-muted">
              Default for everyone
              <select
                value={draft.defaultThemeId}
                onChange={(e) =>
                  setDraft({ ...draft, defaultThemeId: e.target.value as ChatThemeId })
                }
                className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-body text-text"
              >
                {CHAT_THEMES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-meta text-text-muted">
              People can choose
              <select
                value={draft.allowed ? 'some' : 'all'}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    allowed:
                      e.target.value === 'all' ? null : (policy.allowed ?? [draft.defaultThemeId]),
                  })
                }
                className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-body text-text"
              >
                <option value="all">Any theme</option>
                <option value="some">Only the themes ticked below</option>
              </select>
            </label>
          </div>
          <Button
            size="sm"
            disabled={!online || JSON.stringify(draft) === JSON.stringify(policy)}
            onClick={() =>
              void savePolicy(draft).then(
                () => toast({ title: 'Chat theme rules saved', tone: 'success' }),
                (e: Error) =>
                  toast({
                    title: 'Couldn’t save the rules',
                    description: e.message,
                    tone: 'danger',
                  }),
              )
            }
          >
            {online ? 'Save rules' : 'Needs a connection'}
          </Button>
        </div>
      ) : policy.allowed ? (
        <p className="mt-3 text-meta text-text-muted">
          Your organization offers {policy.allowed.length} of {CHAT_THEMES.length} themes.
        </p>
      ) : null}

      <div role="tablist" aria-label="Theme categories" className="mt-4 flex flex-wrap gap-1.5">
        {(['all', ...CHAT_THEME_CATEGORIES] as const).map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={tab === c}
            onClick={() => setTab(c)}
            className={cn(
              'rounded-full border px-3 py-1 text-meta font-medium',
              tab === c
                ? 'border-accent bg-accent-soft text-text'
                : 'border-border text-text-muted hover:bg-surface-raised hover:text-text',
            )}
          >
            {c === 'all' ? 'All' : CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>

      <div
        role={managing ? 'group' : 'radiogroup'}
        aria-label={managing ? 'Themes people can choose' : 'Chat themes'}
        className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
      >
        {shown.map((t) => {
          const on = managing ? !draft.allowed || draft.allowed.includes(t.id) : effective === t.id;
          return (
            <ThemeTile
              key={t.id}
              id={t.id}
              name={t.name}
              description={t.description}
              selected={on}
              checkbox={managing}
              isDefault={t.id === (managing ? draft.defaultThemeId : policy.defaultThemeId)}
              onPick={() => pick(t.id)}
            />
          );
        })}
      </div>
    </Card>
  );
}

function ThemeTile({
  id,
  name,
  description,
  selected,
  checkbox,
  isDefault,
  onPick,
}: {
  id: ChatThemeId;
  name: string;
  description: string;
  selected: boolean;
  checkbox: boolean;
  isDefault: boolean;
  onPick: () => void;
}) {
  const { theme } = useTheme();
  const style = React.useMemo(() => chatThemeCss(id, theme), [id, theme]);
  return (
    <button
      type="button"
      role={checkbox ? 'checkbox' : 'radio'}
      aria-checked={selected}
      onClick={onPick}
      data-chat-theme-option={id}
      className={cn(
        'group overflow-hidden rounded-xl border text-left transition-shadow',
        selected
          ? 'border-accent ring-2 ring-accent'
          : 'border-border hover:border-border-strong hover:shadow-md',
      )}
    >
      <div
        className="relative flex h-28 flex-col justify-end gap-1.5 p-2.5"
        style={style}
        aria-hidden
      >
        <span className="w-[70%] rounded-lg rounded-tl-sm border border-border bg-bubble-other px-2 py-1 text-[11px] leading-tight text-text">
          Draft is ready
        </span>
        <span className="ml-auto w-[62%] rounded-lg rounded-tr-sm bg-bubble-own px-2 py-1 text-[11px] leading-tight text-bubble-own-fg">
          Looks great, thanks
        </span>
        {selected ? (
          <span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-accent text-accent-fg">
            <Check className="size-3.5" />
          </span>
        ) : null}
      </div>
      <div className="border-t border-border bg-surface px-3 py-2">
        <span className="flex items-center gap-1.5 text-label text-text">
          <span className="truncate">{name}</span>
          {isDefault ? (
            <Badge tone="neutral" className="shrink-0">
              Default
            </Badge>
          ) : null}
        </span>
        <span className="block truncate text-meta text-text-subtle">{description}</span>
      </div>
    </button>
  );
}
