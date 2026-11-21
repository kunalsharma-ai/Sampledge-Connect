'use client';
import * as React from 'react';
import type { PushStatus, WebPushConfig } from '@sampledge/contracts';
import { apiRequest } from './api';
import { useAuth } from './auth';

export type WebPushState =
  | 'unsupported' // no service worker / Push API (or not a production build)
  | 'org-off' // the organization hasn't turned browser notifications on
  | 'blocked' // the person denied permission in the browser
  | 'off'
  | 'on';

const KEY_LS = 'sampledge.webpush.key';

function supported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function keyBytes(b64url: string) {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/**
 * Browser notifications for this device session. The subscription is stored on the
 * session, so signing out or revoking the device stops them.
 */
export function useWebPush() {
  const { getAccessToken } = useAuth();
  const [state, setState] = React.useState<WebPushState | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const register = React.useCallback(
    async (cfg: WebPushConfig, ask: boolean) => {
      const reg = await navigator.serviceWorker.ready;
      if (ask && Notification.permission === 'default') {
        const p = await Notification.requestPermission();
        if (p !== 'granted') return setState(p === 'denied' ? 'blocked' : 'off');
      }
      if (Notification.permission !== 'granted') return setState('off');
      let sub = await reg.pushManager.getSubscription();
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(KEY_LS);
      } catch {
        /* storage unavailable */
      }
      // The organization rotated its key: the old subscription can no longer be used.
      if (sub && stored && stored !== cfg.publicKey) {
        await sub.unsubscribe().catch(() => undefined);
        sub = null;
      }
      sub ??= await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(cfg.publicKey!),
      });
      await apiRequest<PushStatus>('POST', '/v1/push/token', {
        token: await getAccessToken(),
        body: { provider: 'webpush', token: JSON.stringify(sub.toJSON()), platform: 'web' },
      });
      try {
        localStorage.setItem(KEY_LS, cfg.publicKey!);
      } catch {
        /* ignore */
      }
      setState('on');
    },
    [getAccessToken],
  );

  const refresh = React.useCallback(async () => {
    // The service worker is only registered in production builds.
    if (!supported() || process.env.NODE_ENV !== 'production') return setState('unsupported');
    try {
      const cfg = await apiRequest<WebPushConfig>('GET', '/v1/push/web', {
        token: await getAccessToken(),
      });
      if (!cfg.enabled || !cfg.publicKey) return setState('org-off');
      if (Notification.permission === 'denied') return setState('blocked');
      if (Notification.permission === 'granted') {
        // Keep the server's copy current (subscriptions rotate; sessions change).
        await register(cfg, false);
        return;
      }
      setState(cfg.subscribed ? 'on' : 'off');
    } catch {
      /* offline: leave as is */
    }
  }, [getAccessToken, register]);

  React.useEffect(() => {
    void refresh();
    if (!supported()) return;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'resubscribe') void refresh();
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    return () => navigator.serviceWorker.removeEventListener('message', onMsg);
  }, [refresh]);

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      const cfg = await apiRequest<WebPushConfig>('GET', '/v1/push/web', {
        token: await getAccessToken(),
      });
      if (!cfg.enabled || !cfg.publicKey) return setState('org-off');
      await register(cfg, true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      await (await reg.pushManager.getSubscription())?.unsubscribe();
      await apiRequest('DELETE', '/v1/push/token', { token: await getAccessToken() });
      setState('off');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return { state, busy, error, enable, disable };
}
