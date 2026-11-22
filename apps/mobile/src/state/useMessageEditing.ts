import { DEFAULT_MESSAGE_EDITING_STATE, type MessageEditingState } from '@sampledge/contracts';
import { useEffect, useState } from 'react';
import { useWorkspace } from './AppProvider';

/** The organization's message editing rules, kept on the phone and updated live. */
export function useMessageEditing(): MessageEditingState {
  const { engine } = useWorkspace();
  const [state, setState] = useState<MessageEditingState>(DEFAULT_MESSAGE_EDITING_STATE);
  useEffect(() => {
    let live = true;
    void engine.getMessageEditing().then((s) => live && setState(s));
    const off = engine.events.on('messageEditing', setState);
    return () => {
      live = false;
      off();
    };
  }, [engine]);
  return state;
}
