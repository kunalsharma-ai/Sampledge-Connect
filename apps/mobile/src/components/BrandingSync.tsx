import { useEffect } from 'react';
import { orgBrandingFrom } from '../lib/branding';
import { useApp } from '../state/AppProvider';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Keeps the organization's branding (theme, logo, app name) current: loaded after sign-in and
 * whenever the connection comes back, and right away when an owner saves it. The last copy is
 * kept on the device so the branded theme shows offline. Renders nothing.
 */
export function BrandingSync() {
  const { sessionState, workspace, engineState } = useApp();
  const { setOrg } = useTheme();
  const engine = workspace?.engine;
  const online = engineState?.socket === 'connected' || engineState?.networkUp === true;

  useEffect(() => {
    if (sessionState === 'signedOut') setOrg(null);
  }, [sessionState, setOrg]);

  useEffect(() => {
    if (!engine || sessionState !== 'active' || !online) return;
    let alive = true;
    engine
      .getBranding()
      .then((v) => alive && setOrg(orgBrandingFrom(v)))
      .catch(() => undefined); // keep the last copy; branding never blocks the app
    const off = engine.events.on('branding', (v) => setOrg(orgBrandingFrom(v)));
    return () => {
      alive = false;
      off();
    };
  }, [engine, sessionState, online, setOrg]);

  return null;
}
