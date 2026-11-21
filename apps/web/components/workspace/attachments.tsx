'use client';
import * as React from 'react';
import { AlertCircle, Download, FileText, ImageIcon, Loader2, RotateCw, X } from 'lucide-react';
import {
  formatClipDuration,
  isAudioAttachment,
  isImageAttachment,
  isVideoAttachment,
  type Attachment,
} from '@sampledge/contracts';
import { cn } from '@sampledge/ui';
import { useAuth } from '@/lib/auth';
import { formatBytes, useAttachmentUrl } from '@/lib/uploads';
import type { ClipKind } from '@/lib/recorder';
import { KIND_ICON, KIND_LABEL, RecordingAttachment } from './recordings';

export interface DraftAttachment {
  key: string;
  file: File;
  progress: number;
  state: 'uploading' | 'ready' | 'failed';
  error?: string;
  attachment?: Attachment;
  previewUrl?: string;
  /** Set for a clip recorded in the composer. */
  recording?: { kind: ClipKind; durationMs: number };
}

/** Files waiting in the composer, with upload progress. */
export function DraftAttachments({
  drafts,
  onRemove,
  onRetry,
}: {
  drafts: DraftAttachment[];
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
}) {
  if (drafts.length === 0) return null;
  return (
    <ul aria-label="Attachments" className="flex flex-wrap gap-2 px-3 pt-3">
      {drafts.map((d) => (
        <li
          key={d.key}
          className={cn(
            'group relative flex w-56 items-center gap-2.5 overflow-hidden rounded-lg border bg-surface p-2',
            d.state === 'failed' ? 'border-danger' : 'border-border',
          )}
        >
          {d.recording ? (
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-danger/15 text-danger">
              {React.createElement(KIND_ICON[d.recording.kind], { className: 'size-5' })}
            </span>
          ) : d.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={d.previewUrl} alt="" className="size-10 shrink-0 rounded-md object-cover" />
          ) : (
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
              <FileText className="size-5" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-label text-text">
              {d.recording
                ? `${KIND_LABEL[d.recording.kind]} · ${formatClipDuration(d.recording.durationMs)}`
                : d.file.name}
            </span>
            <span
              className={cn(
                'block truncate text-meta',
                d.state === 'failed' ? 'text-danger' : 'text-text-subtle',
              )}
            >
              {d.state === 'failed'
                ? (d.error ?? 'Upload failed')
                : d.state === 'uploading'
                  ? `Uploading ${Math.round(d.progress * 100)}%`
                  : formatBytes(d.file.size)}
            </span>
          </span>
          {d.state === 'uploading' ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-text-subtle" aria-hidden />
          ) : d.state === 'failed' && !d.error?.includes('not allowed') ? (
            <button
              type="button"
              onClick={() => onRetry(d.key)}
              aria-label={`Retry ${d.file.name}`}
              className="rounded-sm p-1 text-text-subtle hover:bg-surface-raised hover:text-text"
            >
              <RotateCw className="size-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onRemove(d.key)}
            aria-label={`Remove ${d.file.name}`}
            className="rounded-sm p-1 text-text-subtle hover:bg-surface-raised hover:text-text"
          >
            <X className="size-3.5" />
          </button>
          {d.state === 'uploading' ? (
            <span
              className="absolute inset-x-0 bottom-0 h-0.5 bg-accent transition-[width] duration-150"
              style={{ width: `${Math.max(4, d.progress * 100)}%` }}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ImageTile({ a, single }: { a: Attachment; single: boolean }) {
  const { getAccessToken } = useAuth();
  const { url, error } = useAttachmentUrl(a.attachmentId, getAccessToken);
  const ratio = a.width && a.height ? a.width / a.height : 4 / 3;
  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${a.fileName}`}
      className={cn(
        'relative block overflow-hidden rounded-lg border border-border bg-surface-raised',
        single ? 'w-72 max-w-full' : 'size-36',
      )}
      style={single ? { aspectRatio: String(Math.min(Math.max(ratio, 0.6), 2)) } : undefined}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={a.fileName}
          loading="lazy"
          className="size-full object-cover transition-transform duration-[var(--sc-duration-base)] hover:scale-[1.02]"
        />
      ) : (
        <span className="flex size-full items-center justify-center text-text-subtle">
          {error ? <AlertCircle className="size-5" /> : <ImageIcon className="size-5" />}
        </span>
      )}
    </a>
  );
}

function FileCard({ a, own }: { a: Attachment; own: boolean }) {
  const { getAccessToken } = useAuth();
  const { url } = useAttachmentUrl(a.attachmentId, getAccessToken);
  const ext = a.fileName.includes('.') ? a.fileName.split('.').pop()!.toUpperCase() : 'FILE';
  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      download={a.fileName}
      className={cn(
        'flex w-72 max-w-full items-center gap-3 rounded-lg border p-2.5 transition-colors',
        own
          ? 'border-border bg-accent-soft hover:border-accent'
          : 'border-border bg-surface-raised hover:border-border-strong',
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent text-[10px] font-bold tracking-wide text-accent-fg">
        {ext.slice(0, 4)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-label text-text">{a.fileName}</span>
        <span className="block text-meta text-text-subtle">{formatBytes(a.sizeBytes)}</span>
      </span>
      <Download className="size-4 shrink-0 text-text-muted" aria-hidden />
    </a>
  );
}

/** Attachments on a sent message: image thumbnails first, then file cards. */
export function MessageAttachments({
  attachments,
  own,
}: {
  attachments: Attachment[];
  own: boolean;
}) {
  if (attachments.length === 0) return null;
  const isMedia = (a: Attachment) => !!a.recording || isAudioAttachment(a) || isVideoAttachment(a);
  const images = attachments.filter((a) => isImageAttachment(a) && !a.deletedAt);
  const media = attachments.filter(isMedia);
  const files = attachments.filter((a) => !isImageAttachment(a) && !isMedia(a));
  return (
    <div className={cn('mt-1 flex flex-col gap-1.5', own ? 'items-end' : 'items-start')}>
      {images.length > 0 ? (
        <div className={cn('flex flex-wrap gap-1.5', own && 'justify-end')}>
          {images.map((a) => (
            <ImageTile key={a.attachmentId} a={a} single={images.length === 1} />
          ))}
        </div>
      ) : null}
      {media.map((a) => (
        <RecordingAttachment key={a.attachmentId} a={a} own={own} />
      ))}
      {files.map((a) =>
        a.deletedAt ? (
          <span key={a.attachmentId} className="text-meta text-text-subtle">
            {a.fileName} was deleted
          </span>
        ) : (
          <FileCard key={a.attachmentId} a={a} own={own} />
        ),
      )}
    </div>
  );
}
