'use client';
import * as React from 'react';
import {
  CloudOff,
  Download,
  File as FileIcon,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  FolderOpen,
  LayoutGrid,
  List,
  MessageSquare,
  Search,
  Server,
  X,
} from 'lucide-react';
import type { Conversation, FileItem, FileKind } from '@sampledge/contracts';
import { Avatar, Badge, Button, Skeleton, StateView, cn } from '@sampledge/ui';
import { useAuth } from '@/lib/auth';
import type { DirectoryEntry } from '@/lib/engine';
import { ALL_FILES, useFiles, type FileFilters } from '@/lib/files';
import { attachmentUrl, formatBytes, useAttachmentUrl } from '@/lib/uploads';
import { conversationTitle, formatDay, nameOf } from './helpers';
import { FeatureHelp } from '../feature-help';

const KINDS: { id: FileKind | null; label: string }[] = [
  { id: null, label: 'All files' },
  { id: 'documents', label: 'Documents' },
  { id: 'images', label: 'Images' },
  { id: 'media', label: 'Audio & video' },
  { id: 'other', label: 'Other' },
];
const LS_VIEW = 'sc.files.view';

function iconFor(f: FileItem) {
  const n = f.fileName.toLowerCase();
  if (f.kind === 'images') return FileImage;
  if (f.kind === 'media') return FileVideo;
  if (/\.(xlsx?|csv|ods)$/.test(n)) return FileSpreadsheet;
  if (/\.(zip|rar|7z|tar|gz)$/.test(n)) return FileArchive;
  if (f.kind === 'documents') return FileText;
  return FileIcon;
}
const extOf = (n: string) => (/\.([a-z0-9]{1,5})$/i.exec(n)?.[1] ?? 'file').toUpperCase();

export function FilesScreen({
  conversations,
  me,
  directory,
  onOpenMessage,
}: {
  conversations: Conversation[];
  me: string;
  directory: Map<string, DirectoryEntry>;
  onOpenMessage: (conversationId: string, messageId: string | null) => void;
}) {
  const [filters, setFilters] = React.useState<FileFilters>(ALL_FILES);
  const [view, setViewState] = React.useState<'grid' | 'list'>('grid');
  React.useEffect(() => {
    try {
      const v = localStorage.getItem(LS_VIEW);
      if (v === 'list' || v === 'grid') setViewState(v);
    } catch {
      /* private mode */
    }
  }, []);
  const setView = (v: 'grid' | 'list') => {
    setViewState(v);
    try {
      localStorage.setItem(LS_VIEW, v);
    } catch {
      /* private mode */
    }
  };
  const files = useFiles(filters);
  const { getAccessToken } = useAuth();
  const byId = new Map(conversations.map((c) => [c.conversationId, c]));
  const where = (id: string) => {
    const c = byId.get(id);
    return !c
      ? 'Conversation'
      : c.kind.startsWith('channel')
        ? `#${conversationTitle(c, me, directory)}`
        : conversationTitle(c, me, directory);
  };
  const download = async (f: FileItem) => {
    try {
      const url = await attachmentUrl(f.attachmentId, getAccessToken);
      const u = new URL(url);
      u.searchParams.set('download', '1');
      window.open(u.toString(), '_blank', 'noopener');
    } catch {
      /* offline: button is disabled */
    }
  };
  const people = [...directory.values()]
    .filter((p) => p.status === 'active')
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const total = files.items?.reduce((n, f) => n + f.sizeBytes, 0) ?? 0;
  const filtered = !!(filters.q || filters.kind || filters.in || filters.from);

  return (
    <main className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0" data-testid="files-screen">
      <header className="shrink-0 border-b border-border bg-surface/40 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-6xl px-4 pt-5 sm:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <FolderOpen className="size-[18px]" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="font-display text-h3 text-text">Files</h1>
                <FeatureHelp id="files" />
              </div>
              <p className="text-meta text-text-subtle">
                Everything shared in your conversations and channels
                {files.items
                  ? ` · ${files.items.length}${files.hasMore ? '+' : ''} files, ${formatBytes(total)}`
                  : ''}
              </p>
            </div>
            {!files.online ? (
              <Badge tone="warning" className="gap-1">
                <CloudOff className="size-3.5" aria-hidden /> Offline: last synced list
              </Badge>
            ) : null}
            <div
              className="flex rounded-lg border border-border p-0.5"
              role="group"
              aria-label="View"
            >
              {(['grid', 'list'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  aria-label={v === 'grid' ? 'Grid view' : 'List view'}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-md',
                    view === v ? 'bg-surface-raised text-text' : 'text-text-subtle hover:text-text',
                  )}
                >
                  {v === 'grid' ? <LayoutGrid className="size-4" /> : <List className="size-4" />}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <label className="group relative min-w-[220px] flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle group-focus-within:text-accent"
                aria-hidden
              />
              <input
                value={filters.q}
                onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                placeholder="Find a file by name"
                aria-label="Find a file by name"
                className="h-10 w-full rounded-lg border border-border bg-surface-sunken pl-9 pr-8 text-label font-normal text-text outline-none placeholder:text-text-subtle focus:border-accent"
              />
              {filters.q ? (
                <button
                  onClick={() => setFilters((f) => ({ ...f, q: '' }))}
                  aria-label="Clear"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-subtle hover:text-text"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </label>
            <Select
              label="Shared by"
              value={filters.from ?? ''}
              onChange={(v) => setFilters((f) => ({ ...f, from: v || null }))}
              options={[
                { value: '', label: 'Anyone' },
                ...people.map((p) => ({
                  value: p.userId,
                  label: p.userId === me ? `${p.displayName} (you)` : p.displayName,
                })),
              ]}
            />
            <Select
              label="In"
              value={filters.in ?? ''}
              onChange={(v) => setFilters((f) => ({ ...f, in: v || null }))}
              options={[
                { value: '', label: 'Anywhere' },
                ...conversations.map((c) => ({
                  value: c.conversationId,
                  label: where(c.conversationId),
                })),
              ]}
            />
          </div>

          <nav aria-label="File types" className="-mb-px mt-3 flex gap-1 overflow-x-auto">
            {KINDS.map((k) => {
              const active = filters.kind === k.id;
              return (
                <button
                  key={k.label}
                  onClick={() => setFilters((f) => ({ ...f, kind: k.id }))}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative h-10 shrink-0 px-3 text-label transition-colors',
                    active ? 'text-text' : 'text-text-muted hover:text-text',
                  )}
                >
                  {k.label}
                  {active ? (
                    <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-accent" />
                  ) : null}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6">
          {files.error && files.items === null ? (
            <StateView state="error" title="Couldn’t load files" description={files.error} />
          ) : files.items === null ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-44 rounded-xl" />
              ))}
            </div>
          ) : files.items.length === 0 ? (
            <StateView
              state="empty"
              title={filtered ? 'No files match' : 'No files yet'}
              description={
                filtered
                  ? 'Try another name, type or person.'
                  : 'Files you and your team share in conversations appear here.'
              }
            />
          ) : view === 'grid' ? (
            <ul
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
              data-testid="files-grid"
            >
              {files.items.map((f) => (
                <li
                  key={f.attachmentId}
                  className="group overflow-hidden rounded-xl border border-border bg-surface transition-[border-color,transform,box-shadow] duration-[var(--sc-duration-fast)] hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md"
                >
                  <button
                    className="block w-full text-left"
                    onClick={() => onOpenMessage(f.conversationId, f.messageId)}
                    aria-label={`Open ${f.fileName} in its conversation`}
                  >
                    <Preview f={f} online={files.online} />
                    <span className="block px-3 pb-1 pt-2.5">
                      <span className="block truncate text-label text-text" title={f.fileName}>
                        {f.fileName}
                      </span>
                      <span className="block truncate text-meta text-text-subtle">
                        {formatBytes(f.sizeBytes)} · {formatDay(f.createdAt)}
                      </span>
                    </span>
                  </button>
                  <div className="flex items-center gap-2 px-3 pb-3 pt-1">
                    <Avatar
                      name={nameOf(f.uploaderId, directory)}
                      src={avatarOf(f.uploaderId, directory)}
                      size="xs"
                    />
                    <span className="min-w-0 flex-1 truncate text-meta text-text-subtle">
                      {where(f.conversationId)}
                    </span>
                    {f.storage === 'nextcloud' ? <NextcloudMark /> : null}
                    <button
                      onClick={() => void download(f)}
                      disabled={!files.online}
                      aria-label={`Download ${f.fileName}`}
                      className="flex size-7 items-center justify-center rounded-md text-text-subtle hover:bg-surface-raised hover:text-text disabled:opacity-40"
                    >
                      <Download className="size-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div
              className="overflow-hidden rounded-xl border border-border bg-surface"
              data-testid="files-list"
            >
              <table className="w-full table-fixed text-left">
                <thead className="border-b border-border text-meta text-text-subtle">
                  <tr>
                    <th className="w-[55%] px-4 py-2.5 font-medium md:w-[40%]">Name</th>
                    <th className="hidden px-4 py-2.5 font-medium md:table-cell">Shared by</th>
                    <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Where</th>
                    <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Size</th>
                    <th className="w-24 px-4 py-2.5 font-medium">Date</th>
                    <th className="w-20 px-2 py-2.5">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {files.items.map((f) => {
                    const Icon = iconFor(f);
                    return (
                      <tr
                        key={f.attachmentId}
                        className="border-b border-border last:border-0 hover:bg-surface-raised/60"
                      >
                        <td className="max-w-0 px-4 py-2.5">
                          <span className="flex items-center gap-2.5">
                            <Icon className="size-4 shrink-0 text-accent" aria-hidden />
                            <span className="truncate text-label text-text">{f.fileName}</span>
                            {f.storage === 'nextcloud' ? <NextcloudMark /> : null}
                          </span>
                        </td>
                        <td className="hidden px-4 py-2.5 text-meta text-text-muted md:table-cell">
                          {f.uploaderId === me ? 'You' : nameOf(f.uploaderId, directory)}
                        </td>
                        <td className="hidden px-4 py-2.5 text-meta text-text-muted lg:table-cell">
                          {where(f.conversationId)}
                        </td>
                        <td className="hidden px-4 py-2.5 text-meta tabular-nums text-text-muted sm:table-cell">
                          {formatBytes(f.sizeBytes)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-meta text-text-muted">
                          {formatDay(f.createdAt)}
                        </td>
                        <td className="px-2 py-2.5">
                          <span className="flex justify-end gap-1">
                            <button
                              onClick={() => onOpenMessage(f.conversationId, f.messageId)}
                              aria-label={`Show ${f.fileName} in its conversation`}
                              className="flex size-7 items-center justify-center rounded-md text-text-subtle hover:bg-surface-raised hover:text-text"
                            >
                              <MessageSquare className="size-4" />
                            </button>
                            <button
                              onClick={() => void download(f)}
                              disabled={!files.online}
                              aria-label={`Download ${f.fileName}`}
                              className="flex size-7 items-center justify-center rounded-md text-text-subtle hover:bg-surface-raised hover:text-text disabled:opacity-40"
                            >
                              <Download className="size-4" />
                            </button>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {files.hasMore ? (
            <div className="mt-5 flex justify-center">
              <Button
                variant="secondary"
                size="sm"
                loading={files.loadingMore}
                onClick={() => void files.loadMore()}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function avatarOf(id: string, dir: Map<string, DirectoryEntry>) {
  return (dir.get(id) as { avatarUrl?: string | null } | undefined)?.avatarUrl ?? undefined;
}

function NextcloudMark() {
  return (
    <span
      title="Stored in your Nextcloud"
      className="flex items-center gap-1 rounded bg-surface-raised px-1.5 py-0.5 text-[10px] font-medium text-text-subtle"
    >
      <Server className="size-3" aria-hidden /> Nextcloud
    </span>
  );
}

function Preview({ f, online }: { f: FileItem; online: boolean }) {
  const { getAccessToken } = useAuth();
  const img = f.kind === 'images' && online;
  const { url } = useAttachmentUrl(img ? f.attachmentId : null, getAccessToken);
  const Icon = iconFor(f);
  return (
    <span className="relative flex h-28 items-center justify-center overflow-hidden bg-surface-sunken">
      {img && url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <span className="flex flex-col items-center gap-1.5">
          <Icon className="size-8 text-accent" aria-hidden />
          <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-text-muted">
            {extOf(f.fileName)}
          </span>
        </span>
      )}
    </span>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label
      className={cn(
        'flex h-10 items-center gap-1 rounded-lg border px-3 text-meta',
        value ? 'border-accent bg-accent-soft text-text' : 'border-border text-text-muted',
      )}
    >
      <span className="text-text-subtle">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="max-w-[170px] cursor-pointer truncate bg-transparent text-meta text-text outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
