'use client';
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  CornerDownLeft,
  Hash,
  MessageSquarePlus,
  Palette,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react';
import type { Conversation } from '@sampledge/contracts';
import { Kbd, cn } from '@sampledge/ui';
import type { DirectoryEntry } from '@/lib/engine';
import { conversationTitle } from './helpers';

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  icon: typeof Hash;
  run: () => void;
}

/** Cmd/Ctrl+K palette: jump to any conversation or run a workspace action. Works offline. */
export function CommandPalette({
  open,
  onOpenChange,
  conversations,
  me,
  directory,
  onSelect,
  actions,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  conversations: Conversation[];
  me: string;
  directory: Map<string, DirectoryEntry>;
  onSelect: (id: string) => void;
  actions: PaletteAction[];
}) {
  const [q, setQ] = React.useState('');
  const [index, setIndex] = React.useState(0);
  React.useEffect(() => {
    if (open) {
      setQ('');
      setIndex(0);
    }
  }, [open]);

  const needle = q.trim().toLowerCase();
  const items: PaletteAction[] = [
    ...conversations
      .map((c) => ({ c, title: conversationTitle(c, me, directory) }))
      .filter(({ title }) => !needle || title.toLowerCase().includes(needle))
      .slice(0, 8)
      .map(({ c, title }) => ({
        id: c.conversationId,
        label: title,
        hint: c.kind === 'dm' ? 'Direct message' : c.kind === 'group' ? 'Group' : 'Channel',
        icon: c.kind === 'dm' || c.kind === 'group' ? Users : Hash,
        run: () => onSelect(c.conversationId),
      })),
    ...actions.filter((a) => !needle || a.label.toLowerCase().includes(needle)),
  ];
  const safeIndex = Math.min(index, Math.max(items.length - 1, 0));

  const choose = (a: PaletteAction | undefined) => {
    if (!a) return;
    onOpenChange(false);
    a.run();
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[50] bg-black/40 backdrop-blur-sm" />
        <DialogPrimitive.Content
          aria-label="Command palette"
          className="fixed left-1/2 top-[14vh] z-[60] w-[min(600px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface shadow-lg data-[state=open]:animate-[sc-dialog-in_var(--sc-duration-slow)_var(--sc-ease-emphasized)]"
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search conversations and actions
          </DialogPrimitive.Description>
          <div className="flex items-center gap-3 border-b border-border px-4">
            <Search className="size-4 text-text-subtle" />
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setIndex((i) => Math.min(i + 1, items.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setIndex((i) => Math.max(i - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  choose(items[safeIndex]);
                }
              }}
              placeholder="Jump to a conversation or run a command"
              aria-label="Search"
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-list"
              className="h-14 flex-1 bg-transparent text-body text-text outline-none placeholder:text-text-subtle"
            />
            <Kbd>Esc</Kbd>
          </div>
          <ul id="palette-list" role="listbox" className="max-h-[360px] overflow-y-auto p-2">
            {items.length === 0 ? (
              <li className="px-3 py-8 text-center text-label font-normal text-text-subtle">
                No matches. Universal search across messages is planned.
              </li>
            ) : null}
            {items.map((a, i) => (
              <li key={a.id} role="option" aria-selected={i === safeIndex}>
                <button
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => choose(a)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left',
                    i === safeIndex ? 'bg-accent-soft text-text' : 'text-text-muted',
                  )}
                >
                  <a.icon className={cn('size-4', i === safeIndex && 'text-accent')} />
                  <span className="flex-1 truncate text-label">{a.label}</span>
                  {a.hint ? <span className="text-meta text-text-subtle">{a.hint}</span> : null}
                  {i === safeIndex ? (
                    <CornerDownLeft className="size-3.5 text-text-subtle" />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const PALETTE_ICONS = { MessageSquarePlus, Palette, RefreshCw };
