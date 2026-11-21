'use client';
import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AtSign, Bell, BellOff, Check } from 'lucide-react';
import type { Conversation, NotifyLevel } from '@sampledge/contracts';
import { Tooltip, cn, useToast } from '@sampledge/ui';
import { useEngine } from '@/lib/engine';

const OPTIONS: { level: NotifyLevel; label: string; hint: string; icon: typeof Bell }[] = [
  {
    level: 'all',
    label: 'All activity',
    hint: 'Mentions, replies and direct messages',
    icon: Bell,
  },
  {
    level: 'mentions',
    label: 'Mentions only',
    hint: 'Only when someone @mentions you',
    icon: AtSign,
  },
  { level: 'none', label: 'Nothing', hint: 'Muted. Unread counts still update', icon: BellOff },
];

export const notifyIcon = (l: NotifyLevel) => OPTIONS.find((o) => o.level === l)!.icon;

/** The caller's notification level for one conversation. Works offline (queued). */
export function NotifyLevelMenu({
  conversation,
}: {
  conversation: Conversation;
  /** Kept for callers; changing works offline now. */
  offline?: boolean;
}) {
  const { db, engine } = useEngine();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const level = conversation.myNotifyLevel ?? 'all';
  const Icon = notifyIcon(level);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Saved on this device first and queued, so it works offline and reaches every device.
  const choose = async (next: NotifyLevel) => {
    setOpen(false);
    if (next === level) return;
    setSaving(true);
    try {
      await db.conversations.update(conversation.conversationId, { myNotifyLevel: next });
      await engine.queueAction({
        key: `notify|${conversation.conversationId}`,
        method: 'PUT',
        path: `/v1/conversations/${conversation.conversationId}/notify-level`,
        body: { level: next },
        label: 'Change notifications',
        conversationId: conversation.conversationId,
      });
    } catch {
      toast({ title: 'Couldn’t change notifications', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  if (conversation.myRole === null) return null;
  return (
    <div ref={ref} className="relative">
      <Tooltip content="Notifications" side="bottom">
        <span>
          <button
            onClick={() => setOpen((o) => !o)}
            disabled={saving}
            aria-label={`Notifications: ${OPTIONS.find((o) => o.level === level)!.label}`}
            aria-expanded={open}
            className={cn(
              'rounded-sm p-1.5 hover:bg-surface-raised hover:text-text disabled:opacity-50',
              level === 'all' ? 'text-text-muted' : 'text-warning',
            )}
          >
            <Icon className="size-4" />
          </button>
        </span>
      </Tooltip>
      <AnimatePresence>
        {open ? (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-full z-40 mt-2 w-64 rounded-lg border border-border bg-surface p-1 shadow-lg"
          >
            <p className="px-2.5 pb-1 pt-1.5 text-overline uppercase text-text-subtle">
              Notify me about
            </p>
            {OPTIONS.map((o) => (
              <button
                key={o.level}
                role="menuitemradio"
                aria-checked={o.level === level}
                onClick={() => void choose(o.level)}
                className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-surface-raised"
              >
                <o.icon className="mt-0.5 size-4 shrink-0 text-text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block text-label text-text">{o.label}</span>
                  <span className="block text-meta text-text-subtle">{o.hint}</span>
                </span>
                {o.level === level ? <Check className="mt-0.5 size-4 text-accent" /> : null}
              </button>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
