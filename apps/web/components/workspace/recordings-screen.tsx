'use client';
import * as React from 'react';
import { Clapperboard, Download, FileArchive, Play, ShieldCheck, Trash2, X } from 'lucide-react';
import {
  formatClipDuration,
  type ExportRecordingsResponse,
  type Recording,
  type RecordingKind,
  type RecordingList,
  type RecordingSettings,
} from '@sampledge/contracts';
import { Badge, Button, Field, Input, StateView, cn, useToast } from '@sampledge/ui';
import { apiRequest } from '@/lib/api';
import { toApiUrl } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import { useEngineChange, useTenantChange, type DirectoryEntry } from '@/lib/engine';
import { attachmentUrl, formatBytes } from '@/lib/uploads';
import { KIND_ICON, KIND_LABEL, RecordingAttachment } from './recordings';
import { nameOf } from './helpers';
import { MinutesSettingsPanel } from './minutes-settings';
import { FeatureHelp } from '../feature-help';

const FILTERS: { id: RecordingKind | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'call', label: 'Calls & meetings' },
  { id: 'voice', label: 'Voice' },
  { id: 'video', label: 'Video' },
  { id: 'screen', label: 'Screen' },
];

const RETENTION_PRESETS = [null, 30, 90, 180, 365] as const;

const dateTime = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function useRecordingsApi() {
  const { getAccessToken } = useAuth();
  return React.useMemo(() => {
    const req = async <T,>(method: string, path: string, body?: unknown) =>
      apiRequest<T>(method, path, { token: await getAccessToken(), body });
    return {
      getAccessToken,
      list: (kind: RecordingKind | 'all', before?: string) => {
        const q = new URLSearchParams();
        if (kind !== 'all') q.set('kind', kind);
        if (before) q.set('before', before);
        return req<RecordingList>('GET', `/v1/recordings?${q}`);
      },
      remove: (id: string) => req<{ deleted: true }>('DELETE', `/v1/recordings/${id}`),
      settings: () => req<RecordingSettings>('GET', '/v1/admin/recording-settings'),
      saveSettings: (s: RecordingSettings) =>
        req<RecordingSettings>('PUT', '/v1/admin/recording-settings', s),
      exportZip: (from: string, to: string) =>
        req<ExportRecordingsResponse>('POST', '/v1/admin/recordings/export', { from, to }),
    };
  }, [getAccessToken]);
}

/**
 * Every recording in the conversations I'm in: play, download (backup) and delete.
 * Admins also set automatic deletion and download everything in a date range as a ZIP.
 */
export function RecordingsScreen({
  me,
  directory,
  isAdmin,
  online,
  onOpenConversation,
}: {
  me: string;
  directory: Map<string, DirectoryEntry>;
  isAdmin: boolean;
  online: boolean;
  onOpenConversation: (conversationId: string) => void;
}) {
  const api = useRecordingsApi();
  const { toast } = useToast();
  const [kind, setKind] = React.useState<RecordingKind | 'all'>('all');
  const [items, setItems] = React.useState<Recording[] | null>(null);
  const [next, setNext] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [playing, setPlaying] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<string | null>(null);
  const [adminOpen, setAdminOpen] = React.useState(false);

  const load = React.useCallback(
    async (more?: string) => {
      try {
        const r = await api.list(kind, more);
        setItems((cur) => (more ? [...(cur ?? []), ...r.items] : r.items));
        setNext(r.nextBefore);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
        setItems((cur) => cur ?? []);
      }
    },
    [api, kind],
  );
  React.useEffect(() => {
    setItems(null);
    if (online) void load();
  }, [load, online]);
  useTenantChange('recordings', () => void load());
  // Call recordings added and any recording deleted (on any device) arrive live.
  useEngineChange(['recording'], () => void load());
  // Voice and video clips sent in chat show within 20 seconds, and at once when this window
  // comes back to the front.
  React.useEffect(() => {
    if (!online) return;
    const tick = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const t = setInterval(tick, 20_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load, online]);

  const download = async (r: Recording) => {
    try {
      const url = await attachmentUrl(r.recordingId, api.getAccessToken);
      const a = document.createElement('a');
      a.href = url + '&download=1';
      a.download = r.fileName;
      a.click();
    } catch (e) {
      toast({ title: 'Download failed', description: (e as Error).message, tone: 'danger' });
    }
  };
  const remove = async (r: Recording) => {
    try {
      await api.remove(r.recordingId);
      setItems((cur) => cur?.filter((x) => x.recordingId !== r.recordingId) ?? null);
      toast({ title: `${KIND_LABEL[r.kind]} deleted`, tone: 'success' });
    } catch (e) {
      toast({ title: 'Could not delete', description: (e as Error).message, tone: 'danger' });
    }
    setConfirm(null);
  };

  const total = (items ?? []).reduce((n, r) => n + r.sizeBytes, 0);

  return (
    <main className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0" aria-label="Recordings">
      <header className="flex h-[60px] shrink-0 items-center gap-2 border-b border-border bg-surface/40 px-4 backdrop-blur-xl sm:px-6">
        <Clapperboard className="size-5 text-accent" />
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="mr-2 font-display text-h3 text-text">Recordings</h1>
          <FeatureHelp id="recordings" />
        </div>
        <span className="hidden text-label font-normal text-text-muted sm:inline">
          {items ? `${items.length}${next ? '+' : ''} · ${formatBytes(total)}` : ''}
        </span>
        <div className="flex-1" />
        {isAdmin ? (
          <Button
            variant={adminOpen ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setAdminOpen((o) => !o)}
            aria-expanded={adminOpen}
            aria-label="Settings & backup"
          >
            <ShieldCheck /> <span className="hidden sm:inline">Settings & backup</span>
          </Button>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <div
            className="flex gap-1.5 overflow-x-auto border-b border-border px-4 py-3 sm:px-6"
            role="tablist"
            aria-label="Filter recordings"
          >
            {FILTERS.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={kind === f.id}
                onClick={() => setKind(f.id)}
                className={cn(
                  'shrink-0 rounded-full border px-3 py-1 text-label transition-colors',
                  kind === f.id
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-border text-text-muted hover:border-border-strong hover:text-text',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {!online && items === null ? (
            <StateView state="offline" description="Recordings load when you're back online." />
          ) : items === null ? (
            <StateView state="loading" title="Loading recordings" />
          ) : error && items.length === 0 ? (
            <StateView state="error" description={error} />
          ) : items.length === 0 ? (
            <StateView
              state="empty"
              title="No recordings yet"
              description="Record a voice message, video message or your screen from any chat, or record a call or meeting. They appear here."
            />
          ) : (
            <ul className="divide-y divide-border" data-testid="recordings-list">
              {items.map((r) => {
                const Icon = KIND_ICON[r.kind];
                const who = r.createdBy === me ? 'You' : nameOf(r.createdBy, directory);
                return (
                  <li key={r.recordingId} className="px-4 py-3 sm:px-6">
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          'flex size-10 shrink-0 items-center justify-center rounded-lg',
                          r.kind === 'call'
                            ? 'bg-danger/15 text-danger'
                            : 'bg-accent-soft text-accent',
                        )}
                      >
                        <Icon className="size-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 truncate text-label text-text">
                          {KIND_LABEL[r.kind]}
                          <span className="text-text-subtle">in</span>
                          <button
                            onClick={() => onOpenConversation(r.conversationId)}
                            className="truncate text-accent hover:underline"
                          >
                            {r.conversationName}
                          </button>
                        </p>
                        <p className="truncate text-meta text-text-subtle">
                          {who} · {dateTime.format(new Date(r.createdAt))}
                          {r.durationMs ? ` · ${formatClipDuration(r.durationMs)}` : ''} ·{' '}
                          {formatBytes(r.sizeBytes)}
                        </p>
                      </div>
                      {r.expiresAt ? (
                        <Badge tone="warning" className="hidden md:inline-flex">
                          Deletes {day.format(new Date(r.expiresAt))}
                        </Badge>
                      ) : null}
                      <div className="flex shrink-0 items-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={playing === r.recordingId ? 'Close player' : 'Play'}
                          onClick={() =>
                            setPlaying((p) => (p === r.recordingId ? null : r.recordingId))
                          }
                        >
                          {playing === r.recordingId ? <X /> : <Play />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Download ${r.fileName}`}
                          onClick={() => void download(r)}
                        >
                          <Download />
                        </Button>
                        {r.canDelete ? (
                          confirm === r.recordingId ? (
                            <Button size="sm" variant="danger" onClick={() => void remove(r)}>
                              Delete?
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Delete recording"
                              onClick={() => setConfirm(r.recordingId)}
                            >
                              <Trash2 />
                            </Button>
                          )
                        ) : null}
                      </div>
                    </div>
                    {playing === r.recordingId ? (
                      <div className="mt-3 pl-[52px]">
                        <RecordingAttachment
                          own={false}
                          a={{
                            attachmentId: r.recordingId,
                            conversationId: r.conversationId,
                            uploaderId: r.createdBy,
                            fileName: r.fileName,
                            mimeType: r.mimeType,
                            sizeBytes: r.sizeBytes,
                            width: null,
                            height: null,
                            status: 'ready',
                            createdAt: r.createdAt,
                            recording: r.kind,
                            durationMs: r.durationMs,
                            deletedAt: null,
                          }}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
              {next ? (
                <li className="flex justify-center p-4">
                  <Button variant="secondary" size="sm" onClick={() => void load(next)}>
                    Load more
                  </Button>
                </li>
              ) : null}
            </ul>
          )}
        </section>

        {isAdmin && adminOpen ? (
          <aside className="fixed inset-0 z-40 overflow-y-auto border-l border-border bg-surface p-5 md:static md:z-auto md:w-[360px] md:shrink-0">
            <div className="mb-4 flex items-center justify-between md:hidden">
              <h2 className="text-h3 text-text">Settings & backup</h2>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close"
                onClick={() => setAdminOpen(false)}
              >
                <X />
              </Button>
            </div>
            <RetentionSettings api={api} onSaved={() => void load()} />
            <div className="my-6 h-px bg-border" />
            <ExportPanel api={api} />
            <div className="my-6 h-px bg-border" />
            <MinutesSettingsPanel />
          </aside>
        ) : null}
      </div>
    </main>
  );
}

function RetentionSettings({
  api,
  onSaved,
}: {
  api: ReturnType<typeof useRecordingsApi>;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [s, setS] = React.useState<RecordingSettings | null>(null);
  const [custom, setCustom] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    void api.settings().then((v) => {
      setS(v);
      if (v.retentionDays && !RETENTION_PRESETS.includes(v.retentionDays as 30))
        setCustom(String(v.retentionDays));
    });
  }, [api]);
  if (!s) return <StateView state="loading" title="Loading settings" className="py-6" />;

  const save = async (next: RecordingSettings) => {
    setSaving(true);
    try {
      setS(await api.saveSettings(next));
      toast({
        title: 'Recording settings saved',
        description: next.retentionDays
          ? `Recordings are deleted ${next.retentionDays} days after they are made.`
          : 'Recordings are kept until someone deletes them.',
        tone: 'success',
      });
      onSaved();
    } catch (e) {
      toast({ title: 'Could not save', description: (e as Error).message, tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-labelledby="ret-h"
      className="flex flex-col gap-4"
      data-testid="retention-settings"
    >
      <div>
        <h3 id="ret-h" className="text-h3 text-text">
          Automatic deletion
        </h3>
        <p className="mt-1 text-meta text-text-subtle">
          Applies to every recording in your organization: chat clips and call recordings. Download
          a backup first if you need to keep them.
        </p>
      </div>
      <div
        className="flex flex-wrap gap-1.5"
        role="radiogroup"
        aria-label="Delete recordings after"
      >
        {RETENTION_PRESETS.map((d) => (
          <button
            key={String(d)}
            role="radio"
            aria-checked={s.retentionDays === d}
            disabled={saving}
            onClick={() => {
              setCustom('');
              void save({ ...s, retentionDays: d });
            }}
            className={cn(
              'rounded-full border px-3 py-1 text-label',
              s.retentionDays === d
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-border text-text-muted hover:border-border-strong',
            )}
          >
            {d === null ? 'Off' : d === 365 ? '1 year' : `${d} days`}
          </button>
        ))}
      </div>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(custom);
          if (Number.isInteger(n) && n >= 1 && n <= 3650) void save({ ...s, retentionDays: n });
        }}
      >
        <div className="flex-1">
          <Field label="Custom (days)" htmlFor="ret-custom" hint="1 to 3650 days">
            <Input
              id="ret-custom"
              inputMode="numeric"
              value={custom}
              onChange={(e) => setCustom(e.target.value.replace(/\D/g, ''))}
              placeholder="e.g. 45"
            />
          </Field>
        </div>
        <Button type="submit" variant="secondary" disabled={!custom || saving} className="mb-6">
          Apply
        </Button>
      </form>
      <label className="flex items-start gap-3 rounded-lg border border-border p-3">
        <input
          type="checkbox"
          checked={s.callRecordingEnabled}
          disabled={saving}
          onChange={(e) => void save({ ...s, callRecordingEnabled: e.target.checked })}
          className="mt-0.5 size-4 accent-[var(--sc-accent)]"
        />
        <span>
          <span className="block text-label text-text">Allow call and meeting recording</span>
          <span className="block text-meta text-text-subtle">
            Anyone in a call can start a recording. Everyone in the call sees that it is being
            recorded.
          </span>
        </span>
      </label>
    </section>
  );
}

function ExportPanel({ api }: { api: ReturnType<typeof useRecordingsApi> }) {
  const { toast } = useToast();
  const today = new Date();
  const [from, setFrom] = React.useState(isoDay(new Date(today.getTime() - 30 * 86_400_000)));
  const [to, setTo] = React.useState(isoDay(today));
  const [busy, setBusy] = React.useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const start = new Date(`${from}T00:00:00`);
      const end = new Date(`${to}T00:00:00`);
      end.setDate(end.getDate() + 1);
      const r = await api.exportZip(start.toISOString(), end.toISOString());
      if (r.count === 0) {
        toast({ title: 'No recordings in that range', tone: 'info' });
        return;
      }
      const a = document.createElement('a');
      a.href = toApiUrl(r.url);
      a.click();
      toast({
        title: 'Backup download started',
        description: `${r.count} recordings · ${formatBytes(r.totalBytes)} · ZIP with a manifest.csv`,
        tone: 'success',
      });
    } catch (e) {
      toast({ title: 'Export failed', description: (e as Error).message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="exp-h" className="flex flex-col gap-4">
      <div>
        <h3 id="exp-h" className="text-h3 text-text">
          Back up recordings
        </h3>
        <p className="mt-1 text-meta text-text-subtle">
          Downloads every recording made in the range as one ZIP, in folders per conversation, with
          a manifest of who recorded what and when (up to 4 GB per download).
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From" htmlFor="exp-from">
          <Input
            id="exp-from"
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="To" htmlFor="exp-to">
          <Input
            id="exp-to"
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
      </div>
      <Button onClick={() => void run()} loading={busy} disabled={!from || !to || from > to}>
        <FileArchive /> Download ZIP
      </Button>
    </section>
  );
}
