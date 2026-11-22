'use client';
import * as React from 'react';
import {
  ChatThemePolicySchema,
  DEFAULT_CHAT_THEME_POLICY,
  effectiveChatTheme,
  type ChatThemeId,
  type ChatThemePolicy,
  type ChatThemeState,
} from '@sampledge/contracts';
import { chatThemeStyle } from '@sampledge/design-tokens';
import { useTheme } from '@sampledge/ui';
import { apiRequest } from './api';
import { useAuth } from './auth';
import { useEngine, useEngineChange } from './engine';

const KEY = 'chatTheme';
interface Stored {
  themeId: ChatThemeId | null;
  policy: ChatThemePolicy;
}

/** One store per page, so every timeline and the Settings card agree. */
const listeners = new Set<(s: Stored) => void>();
let current: Stored = { themeId: null, policy: DEFAULT_CHAT_THEME_POLICY };
function publish(next: Stored) {
  // Copies cached before a rule existed get its default.
  const policy = ChatThemePolicySchema.safeParse(next.policy ?? {});
  current = { ...next, policy: policy.success ? policy.data : DEFAULT_CHAT_THEME_POLICY };
  listeners.forEach((l) => l(current));
}

/**
 * Your chat theme and the organization's rules. Saved on this device first and queued, so a
 * change shows at once, works offline and reaches your other devices (`chat-theme:changed`).
 * Organization rules come live through `tenant:updated` (area `chat_themes`).
 */
export function useChatTheme() {
  const { db, engine, state } = useEngine();
  const { getAccessToken } = useAuth();
  const online = state.connectivity === 'online';
  const [s, setS] = React.useState<Stored>(current);

  React.useEffect(() => {
    listeners.add(setS);
    return () => void listeners.delete(setS);
  }, []);

  const store = React.useCallback(
    (next: Stored) => {
      publish(next);
      void db.meta.put({ key: KEY, value: next });
    },
    [db],
  );

  const refresh = React.useCallback(async () => {
    try {
      const r = await apiRequest<ChatThemeState>('GET', '/v1/me/chat-theme', {
        token: await getAccessToken(),
      });
      // A change still waiting in the queue wins over the server's older copy.
      const pending = await db.actions.get('my-chat-theme');
      store({
        themeId: pending
          ? ((pending.body as { themeId: ChatThemeId | null }).themeId ?? null)
          : r.themeId,
        policy: r.policy,
      });
    } catch {
      /* offline: keep the cached copy */
    }
  }, [db, getAccessToken, store]);

  React.useEffect(() => {
    void db.meta.get(KEY).then((row) => {
      if (row) publish(row.value as Stored);
    });
  }, [db]);
  React.useEffect(() => {
    if (online) void refresh();
  }, [online, refresh]);
  useEngineChange(['chatTheme', 'tenant', 'reconnected'], (e) => {
    if (e.type === 'chatTheme') store({ ...current, themeId: e.themeId as ChatThemeId | null });
    else if (e.type === 'tenant' && e.area !== 'chat_themes') return;
    else void refresh();
  });

  const choose = React.useCallback(
    (themeId: ChatThemeId | null) => {
      store({ ...current, themeId });
      void engine.queueAction({
        key: 'my-chat-theme',
        method: 'PUT',
        path: '/v1/me/chat-theme',
        body: { themeId },
        label: 'Change chat theme',
      });
    },
    [engine, store],
  );

  /** Owners and admins, online only (an organization-wide change). */
  const savePolicy = React.useCallback(
    async (policy: ChatThemePolicy) => {
      const r = await apiRequest<ChatThemeState>('PUT', '/v1/admin/chat-themes', {
        token: await getAccessToken(),
        body: policy,
      });
      store({ ...current, policy: r.policy });
    },
    [getAccessToken, store],
  );

  return {
    themeId: s.themeId,
    policy: s.policy,
    effective: effectiveChatTheme(s.themeId, s.policy),
    choose,
    savePolicy,
    online,
  };
}

/** CSS for a conversation area in chat theme `id`, resolved against the app theme in use. */
export function useChatThemeStyle(id: ChatThemeId): React.CSSProperties {
  const { theme } = useTheme();
  return React.useMemo(() => chatThemeCss(id, theme), [id, theme]);
}

export function chatThemeCss(
  id: ChatThemeId,
  theme: ReturnType<typeof useTheme>['theme'],
): React.CSSProperties {
  const s = chatThemeStyle(id, theme.colors, theme.mode);
  return {
    background: s.background,
    // The theme's plain colour, under and over a personal picture.
    ['--sc-chat-base' as string]: s.base,
    // Tailwind's bubble utilities read these.
    ['--sc-color-bubble-own' as string]: s.bubbleOwn,
    ['--sc-color-bubble-own-fg' as string]: s.bubbleOwnFg,
    ['--sc-color-bubble-other' as string]: s.bubbleOther,
    ['--color-bubble-own' as string]: s.bubbleOwn,
    ['--color-bubble-own-fg' as string]: s.bubbleOwnFg,
    ['--color-bubble-other' as string]: s.bubbleOther,
  };
}
