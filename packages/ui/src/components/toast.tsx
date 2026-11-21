'use client';
import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { motion as tokens } from '@sampledge/design-tokens';
import { cn } from '../cn.js';

export interface ToastInput {
  title: string;
  description?: string;
  tone?: 'info' | 'success' | 'danger';
  durationMs?: number;
  action?: { label: string; onClick: () => void };
}
interface ToastItem extends ToastInput {
  id: number;
}

const ToastContext = React.createContext<{
  toast: (t: ToastInput) => number;
  dismiss: (id: number) => void;
} | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const ICONS = { info: Info, success: CircleCheck, danger: CircleAlert };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const nextId = React.useRef(1);
  const dismiss = React.useCallback(
    (id: number) => setItems((xs) => xs.filter((x) => x.id !== id)),
    [],
  );
  const toast = React.useCallback(
    (t: ToastInput) => {
      const id = nextId.current++;
      setItems((xs) => [...xs.slice(-3), { ...t, id }]);
      const ms = t.durationMs ?? 4500;
      if (ms > 0) setTimeout(() => dismiss(id), ms);
      return id;
    },
    [dismiss],
  );
  const value = React.useMemo(() => ({ toast, dismiss }), [toast, dismiss]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2"
      >
        <AnimatePresence initial={false}>
          {items.map((t) => {
            const Icon = ICONS[t.tone ?? 'info'];
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 24, transition: { duration: tokens.duration.fast / 1000 } }}
                transition={tokens.spring.gentle}
                role={t.tone === 'danger' ? 'alert' : 'status'}
                className="pointer-events-auto flex items-start gap-3 rounded-lg border border-border bg-surface-glass p-3.5 shadow-lg backdrop-blur-xl"
              >
                <Icon
                  className={cn(
                    'mt-0.5 size-4 shrink-0',
                    t.tone === 'success'
                      ? 'text-success'
                      : t.tone === 'danger'
                        ? 'text-danger'
                        : 'text-accent',
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-label text-text">{t.title}</p>
                  {t.description ? (
                    <p className="mt-0.5 text-meta text-text-muted">{t.description}</p>
                  ) : null}
                  {t.action ? (
                    <button
                      className="mt-2 text-meta font-semibold text-accent hover:underline"
                      onClick={() => {
                        t.action!.onClick();
                        dismiss(t.id);
                      }}
                    >
                      {t.action.label}
                    </button>
                  ) : null}
                </div>
                <button
                  aria-label="Dismiss"
                  onClick={() => dismiss(t.id)}
                  className="text-text-subtle hover:text-text"
                >
                  <X className="size-4" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
