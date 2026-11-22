import type { CallBackgroundState } from '@sampledge/contracts';
import { useEffect, useState } from 'react';
import { useWorkspace } from './AppProvider';

/** Your call background (kept on the phone, synced), with changes not sent yet shown at once. */
export function useCallBackground(): CallBackgroundState | null {
  const { engine } = useWorkspace();
  const [state, setState] = useState<CallBackgroundState | null>(null);
  useEffect(() => {
    let live = true;
    void engine.getCallBackground().then((s) => live && setState(s));
    const off = engine.events.on('callBackground', setState);
    void engine.reloadCallBackground();
    return () => {
      live = false;
      off();
    };
  }, [engine]);
  return state;
}
