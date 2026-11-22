'use client';
import { BellRing } from 'lucide-react';
import { Badge, Button } from '@sampledge/ui';
import { useWebPush, type WebPushState } from '@/lib/web-push';
import { FeatureHelp } from '../feature-help';

const COPY: Record<
  WebPushState,
  { badge: string; tone: 'success' | 'neutral' | 'warning' | 'planned'; text: string }
> = {
  on: {
    badge: 'On',
    tone: 'success',
    text: 'You’ll get notifications for direct messages, mentions and replies, and for calls, when Connect isn’t open in a tab on this device.',
  },
  off: {
    badge: 'Off',
    tone: 'neutral',
    text: 'Get notified about direct messages, mentions, replies and calls even when Connect isn’t open.',
  },
  blocked: {
    badge: 'Blocked',
    tone: 'warning',
    text: 'Notifications are blocked for this site. Allow them in your browser’s site settings, then come back here.',
  },
  'org-off': {
    badge: 'Not set up',
    tone: 'neutral',
    text: 'An admin can turn on browser notifications under Integrations.',
  },
  unsupported: {
    badge: 'Unavailable',
    tone: 'planned',
    text: 'This browser doesn’t support web notifications. On iPhone and iPad, add Connect to your Home Screen first.',
  },
};

/** Opt in or out of browser notifications for this device. */
export function BrowserNotificationsCard() {
  const push = useWebPush();
  const s = push.state;
  return (
    <section
      className="mt-6 rounded-xl border border-border p-4"
      data-testid="browser-notifications"
      aria-busy={s === null}
    >
      <div className="flex items-start gap-3">
        <BellRing className="mt-0.5 size-4 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <p className="text-label text-text">Browser notifications on this device</p>
              <FeatureHelp id="quiet-hours" size="sm" inDialog />
            </div>
            {s ? <Badge tone={COPY[s].tone}>{COPY[s].badge}</Badge> : null}
          </div>
          <p className="mt-0.5 text-meta text-text-subtle">{s ? COPY[s].text : 'Checking…'}</p>
          {push.error ? (
            <p role="alert" className="mt-2 text-meta text-danger">
              {push.error}
            </p>
          ) : null}
        </div>
        {s === 'off' ? (
          <Button size="sm" onClick={() => void push.enable()} loading={push.busy}>
            Turn on
          </Button>
        ) : s === 'on' ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void push.disable()}
            loading={push.busy}
          >
            Turn off
          </Button>
        ) : null}
      </div>
    </section>
  );
}
