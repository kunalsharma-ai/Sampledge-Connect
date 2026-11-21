import type { ChatThemeState } from '@sampledge/contracts';
import { useEffect, useMemo, useState } from 'react';
import { chatLook, type ChatLook } from '../lib/chatTheme';
import { useTheme } from '../theme/ThemeProvider';
import { useWorkspace } from './AppProvider';

/** Your chat theme (kept on the phone, synced) and how it looks over the current app theme. */
export function useChatTheme(): { state: ChatThemeState | null; look: ChatLook | null } {
  const { engine } = useWorkspace();
  const { theme } = useTheme();
  const [state, setState] = useState<ChatThemeState | null>(null);
  useEffect(() => {
    let live = true;
    void engine.getChatTheme().then((s) => live && s && setState(s));
    const off = engine.events.on('chatTheme', setState);
    return () => {
      live = false;
      off();
    };
  }, [engine]);
  const effective = state?.effective ?? 'default';
  const look = useMemo(
    () => (effective === 'default' ? null : chatLook(effective, theme.colors, theme.dark)),
    [effective, theme],
  );
  return { state, look };
}
