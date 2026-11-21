'use client';
import { motion } from 'motion/react';
import { Bot, Briefcase, CheckSquare, FileText, Hash, Lock, Users, X } from 'lucide-react';
import type { Conversation } from '@sampledge/contracts';
import { Avatar, Badge, cn } from '@sampledge/ui';
import type { DirectoryEntry } from '@/lib/engine';
import { conversationTitle, nameOf } from './helpers';

const KIND_LABEL: Record<Conversation['kind'], string> = {
  dm: 'Direct message',
  group: 'Group',
  channel_public: 'Public channel',
  channel_private: 'Private channel',
};

/** Planned context cards: shown honestly as not yet connected. */
const PLANNED = [
  {
    icon: Briefcase,
    title: 'Project & client',
    body: 'Linked Samptrek project, client and bid status.',
    phase: 'Phase 2',
  },
  {
    icon: CheckSquare,
    title: 'Tasks & approvals',
    body: 'Open tasks and approvals raised in this conversation.',
    phase: 'Phase 2',
  },
  {
    icon: FileText,
    title: 'Shared files',
    body: 'Files shared here, stored in Nextcloud.',
    phase: 'Phase 1b',
  },
  { icon: Bot, title: 'AI summary', body: 'Catch-up summary and action items.', phase: 'Phase 4' },
];

export function ContextPanel({
  conversation,
  me,
  directory,
  presence,
  onClose,
  className,
}: {
  conversation: Conversation;
  me: string;
  directory: Map<string, DirectoryEntry>;
  presence: Map<string, string>;
  onClose: () => void;
  className?: string;
}) {
  const title = conversationTitle(conversation, me, directory);
  const members = [...conversation.memberIds].sort((a, b) => {
    const pa = presence.get(a) === 'online' || a === me ? 0 : 1;
    const pb = presence.get(b) === 'online' || b === me ? 0 : 1;
    return pa - pb || nameOf(a, directory).localeCompare(nameOf(b, directory));
  });
  const Icon =
    conversation.kind === 'channel_private' ? Lock : conversation.kind === 'group' ? Users : Hash;

  return (
    <motion.aside
      aria-label="Conversation details"
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16 }}
      transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
      className={cn(
        'flex h-full w-full flex-col border-l border-border bg-surface/60 backdrop-blur-xl min-[1400px]:w-[320px] min-[1400px]:shrink-0',
        className,
      )}
    >
      <div className="flex h-[60px] items-center justify-between px-5">
        <h2 className="text-label text-text">Details</h2>
        <button
          onClick={onClose}
          aria-label="Close details"
          className="rounded-sm p-1.5 text-text-subtle hover:bg-surface-raised hover:text-text"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex-1 space-y-6 overflow-y-auto px-5 pb-6">
        <div className="rounded-xl border border-border bg-surface-raised p-4 shadow-sm">
          <div className="flex items-center gap-3">
            {conversation.kind === 'dm' ? (
              <Avatar name={title} size="lg" />
            ) : (
              <span className="flex size-12 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <Icon className="size-5" />
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate font-display text-h3 text-text">{title}</p>
              <p className="text-meta text-text-subtle">{KIND_LABEL[conversation.kind]}</p>
            </div>
          </div>
          {conversation.topic ? (
            <p className="mt-3 text-label font-normal text-text-muted">{conversation.topic}</p>
          ) : null}
          <dl className="mt-4 grid grid-cols-2 gap-3 text-meta">
            <div>
              <dt className="text-text-subtle">Members</dt>
              <dd className="text-label text-text">{conversation.memberIds.length}</dd>
            </div>
            <div>
              <dt className="text-text-subtle">Created</dt>
              <dd className="text-label text-text">
                {new Date(conversation.createdAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </dd>
            </div>
          </dl>
        </div>

        <section>
          <p className="mb-2 text-overline uppercase text-text-subtle">Members</p>
          <ul className="space-y-1">
            {members.slice(0, 24).map((id) => {
              const u = directory.get(id);
              const online = id === me || presence.get(id) === 'online';
              return (
                <li key={id} className="flex items-center gap-3 rounded-md px-2 py-1.5">
                  <Avatar
                    name={nameOf(id, directory)}
                    size="sm"
                    presence={online ? 'online' : 'offline'}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-label text-text">
                      {nameOf(id, directory)}
                      {id === me ? <span className="text-text-subtle"> (you)</span> : null}
                    </span>
                    <span className="block truncate text-meta text-text-subtle">
                      {u?.title ?? u?.role ?? ''}
                    </span>
                  </span>
                </li>
              );
            })}
            {members.length > 24 ? (
              <li className="px-2 text-meta text-text-subtle">+{members.length - 24} more</li>
            ) : null}
          </ul>
        </section>

        <section className="space-y-2">
          <p className="mb-2 text-overline uppercase text-text-subtle">Work context</p>
          {PLANNED.map((p) => (
            <div key={p.title} className="rounded-lg border border-dashed border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-label text-text-muted">
                  <p.icon className="size-4" /> {p.title}
                </span>
                <Badge tone="planned" className="px-1.5 text-[10px]">
                  Planned · {p.phase}
                </Badge>
              </div>
              <p className="mt-1 text-meta text-text-subtle">{p.body}</p>
            </div>
          ))}
        </section>
      </div>
    </motion.aside>
  );
}
