'use client';
import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Eye, Flag, ImagePlus, Plus, Send, Trash2, Type, Video, X } from 'lucide-react';
import {
  STATUS_BACKGROUNDS,
  uuidv7,
  type NetworkPerson,
  type NetworkStatus,
  type StatusFeed,
  type UploadTicket,
} from '@sampledge/contracts';
import {
  Avatar,
  Button,
  Dialog,
  DialogContent,
  Field,
  Input,
  Textarea,
  cn,
  useToast,
} from '@sampledge/ui';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { API_URL } from '@/lib/config';
import { useNet, useNetwork } from '@/lib/network';
import { relativeShort } from '../workspace/helpers';
import { Switch } from './profile';
import { errorText } from './ui';
import { ReportDialog } from './people';

export const BACKGROUNDS: Record<(typeof STATUS_BACKGROUNDS)[number], string> = {
  ocean: 'linear-gradient(135deg,#1e3a8a,#5B8CFF)',
  violet: 'linear-gradient(135deg,#4c1d95,#8B5CF6)',
  sunset: 'linear-gradient(135deg,#9a3412,#f59e0b)',
  emerald: 'linear-gradient(135deg,#064e3b,#34D399)',
  graphite: 'linear-gradient(135deg,#111827,#4b5563)',
};

const AUDIENCE_LABEL = {
  connections: 'My connections',
  followers: 'Connections and followers',
  public: 'Public (anyone, incl. my public page)',
  selected: 'Only people I choose',
} as const;

/** The row of status rings: yours first, then unseen, then seen. */
export function StatusRail({
  onOpen,
  onCompose,
}: {
  onOpen: (author: string) => void;
  onCompose: () => void;
}) {
  const { data } = useNet<StatusFeed>('/v1/network/statuses', [
    'statuses',
    'connections',
    'follows',
  ]);
  const { session } = useAuth();
  const mine = data?.mine ?? [];
  return (
    <div className="flex gap-4 overflow-x-auto pb-1">
      <button
        onClick={mine.length ? () => onOpen(session!.user.userId) : onCompose}
        className="flex w-[72px] shrink-0 flex-col items-center gap-1.5"
      >
        <span
          className={cn(
            'relative rounded-full p-[3px]',
            mine.length
              ? 'bg-[conic-gradient(var(--sc-color-accent),var(--sc-color-accent2),var(--sc-color-accent))]'
              : 'bg-border',
          )}
        >
          <span className="block rounded-full bg-bg p-[2px]">
            <Avatar name={session!.user.displayName} size="lg" />
          </span>
          <span
            onClick={(e) => {
              e.stopPropagation();
              onCompose();
            }}
            className="absolute -bottom-0.5 -right-0.5 grid size-6 place-items-center rounded-full border-2 border-bg bg-accent text-accent-fg"
          >
            <Plus className="size-3.5" />
          </span>
        </span>
        <span className="w-full truncate text-center text-meta text-text">My status</span>
      </button>
      {(data?.people ?? []).map((p) => (
        <button
          key={p.person.userId}
          onClick={() => onOpen(p.person.userId)}
          className="flex w-[72px] shrink-0 flex-col items-center gap-1.5"
        >
          <span
            className={cn(
              'rounded-full p-[3px]',
              p.unseen
                ? 'bg-[conic-gradient(var(--sc-color-accent),var(--sc-color-accent2),var(--sc-color-accent))]'
                : 'bg-border',
            )}
          >
            <span className="block rounded-full bg-bg p-[2px]">
              <Avatar name={p.person.displayName} size="lg" />
            </span>
          </span>
          <span
            className={cn(
              'w-full truncate text-center text-meta',
              p.unseen ? 'text-text' : 'text-text-subtle',
            )}
          >
            {p.person.displayName.split(' ')[0]}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Full-screen viewer: tap through, reply privately, see who viewed yours. */
export function StatusViewer({
  authorId,
  onClose,
  onReplied,
}: {
  authorId: string | null;
  onClose: () => void;
  onReplied?: (userId: string) => void;
}) {
  const { data } = useNet<StatusFeed>('/v1/network/statuses', ['statuses']);
  const { session, getAccessToken } = useAuth();
  const net = useNetwork();
  const { toast } = useToast();
  const me = session!.user.userId;
  const list: NetworkStatus[] = !authorId
    ? []
    : authorId === me
      ? (data?.mine ?? [])
      : (data?.people.find((p) => p.person.userId === authorId)?.statuses ?? []);
  const author: NetworkPerson | undefined = list[0]?.author;
  const [i, setI] = React.useState(0);
  const [reply, setReply] = React.useState('');
  const [paused, setPaused] = React.useState(false);
  const [reporting, setReporting] = React.useState(false);
  const [viewers, setViewers] = React.useState<
    { person: NetworkPerson; viewedAt: string }[] | null
  >(null);
  React.useEffect(() => {
    // Start at the first unseen one.
    const firstUnseen = list.findIndex((s) => !s.viewedByMe);
    setI(firstUnseen > 0 ? firstUnseen : 0);
    setViewers(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorId]);
  const s = list[i];
  React.useEffect(() => {
    if (!s || s.author.userId === me || s.viewedByMe) return;
    void net
      .act({
        id: `view-${s.statusId}`,
        method: 'PUT',
        path: `/v1/network/statuses/${s.statusId}/view`,
        label: 'Status seen',
        scopes: ['statuses'],
      })
      .catch(() => undefined);
  }, [s, me, net]);
  React.useEffect(() => {
    if (!s || paused || s.kind === 'video') return;
    const t = setTimeout(() => (i < list.length - 1 ? setI(i + 1) : onClose()), 6000);
    return () => clearTimeout(t);
  }, [s, i, list.length, paused, onClose]);
  React.useEffect(() => {
    if (!authorId) return;
    const onKey = (e: KeyboardEvent) => {
      // Arrow keys move between statuses unless you are typing a reply.
      const typing = (e.target as HTMLElement | null)?.tagName === 'INPUT';
      if (e.key === 'Escape') onClose();
      else if (!typing && e.key === 'ArrowRight') setI((n) => (n < list.length - 1 ? n + 1 : n));
      else if (!typing && e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [authorId, list.length, onClose]);
  if (!authorId || !s || !author) return null;

  const sendReply = async () => {
    const text = reply.trim();
    if (!text) return;
    setReply('');
    try {
      const r = await net.act({
        method: 'POST',
        path: `/v1/network/statuses/${s.statusId}/reply`,
        body: { clientMessageId: uuidv7(), text },
        label: `Reply to ${author.displayName}`,
        scopes: [],
      });
      toast({
        title: r === null ? 'Reply queued' : 'Reply sent privately',
        description:
          r === null
            ? 'It will be sent when you’re back online.'
            : `It’s in your messages with ${author.displayName}.`,
        tone: 'success',
      });
      if (r && onReplied) onReplied(author.userId);
    } catch (e) {
      toast({ title: 'Couldn’t reply', description: errorText(e), tone: 'danger' });
    }
  };
  const loadViewers = async () => {
    const token = await getAccessToken();
    setViewers(
      await apiRequest<{ person: NetworkPerson; viewedAt: string }[]>(
        'GET',
        `/v1/network/statuses/${s.statusId}/viewers`,
        { token },
      ).catch(() => []),
    );
    setPaused(true);
  };

  return (
    <AnimatePresence>
      <motion.div
        key="viewer"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 backdrop-blur-md"
        role="dialog"
        aria-label={`${author.displayName}'s status`}
      >
        <div className="relative flex h-[min(780px,100dvh)] w-[min(440px,100vw)] flex-col overflow-hidden rounded-none bg-black shadow-2xl sm:rounded-2xl">
          <div className="absolute inset-x-3 top-3 z-10 flex gap-1">
            {list.map((x, n) => (
              <div
                key={x.statusId}
                className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30"
              >
                <div
                  className={cn('h-full bg-white', n < i && 'w-full', n > i && 'w-0')}
                  style={
                    n === i
                      ? {
                          width: paused ? '50%' : '100%',
                          transition: paused || s.kind === 'video' ? 'none' : 'width 6s linear',
                        }
                      : undefined
                  }
                />
              </div>
            ))}
          </div>
          <div className="absolute inset-x-3 top-6 z-10 flex items-center gap-2 text-white">
            <Avatar name={author.displayName} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-label">
                {author.userId === me ? 'My status' : author.displayName}
              </p>
              <p className="text-meta text-white/70">
                {relativeShort(s.createdAt)} ago · {AUDIENCE_LABEL[s.audience]}
              </p>
            </div>
            {author.userId !== me ? (
              <button
                aria-label="Report status"
                onClick={() => {
                  setPaused(true);
                  setReporting(true);
                }}
                className="rounded-full p-1.5 hover:bg-white/10"
              >
                <Flag className="size-4" />
              </button>
            ) : null}
            <button
              aria-label="Close"
              onClick={onClose}
              className="rounded-full p-1.5 hover:bg-white/10"
            >
              <X className="size-5" />
            </button>
          </div>
          {reporting ? (
            <ReportDialog
              targetType="status"
              targetId={s.statusId}
              name={`${author.displayName.split(' ')[0]}’s status`}
              open
              onOpenChange={(o) => {
                if (!o) {
                  setReporting(false);
                  setPaused(false);
                }
              }}
            />
          ) : null}
          <div
            className="relative flex flex-1 items-center justify-center"
            style={s.kind === 'text' ? { background: BACKGROUNDS[s.background] } : undefined}
            onPointerDown={() => setPaused(true)}
            onPointerUp={() => setPaused(false)}
          >
            {s.kind === 'text' ? (
              <p className="px-8 text-center font-display text-[28px] leading-tight text-white">
                {s.text}
              </p>
            ) : s.media ? (
              s.kind === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={new URL(s.media.url, API_URL).toString()}
                  alt={s.text || 'Status photo'}
                  className="max-h-full w-full object-contain"
                />
              ) : (
                <video
                  src={new URL(s.media.url, API_URL).toString()}
                  autoPlay
                  playsInline
                  className="max-h-full w-full"
                  onEnded={() => (i < list.length - 1 ? setI(i + 1) : onClose())}
                />
              )
            ) : null}
            {s.kind !== 'text' && s.text ? (
              <p className="absolute inset-x-0 bottom-4 bg-black/40 px-5 py-3 text-center text-body text-white">
                {s.text}
              </p>
            ) : null}
            <button
              aria-label="Previous"
              className="absolute inset-y-0 left-0 w-1/3"
              onClick={() => setI(Math.max(0, i - 1))}
            />
            <button
              aria-label="Next"
              className="absolute inset-y-0 right-0 w-1/3"
              onClick={() => (i < list.length - 1 ? setI(i + 1) : onClose())}
            />
          </div>
          {author.userId === me ? (
            <div className="border-t border-white/10 bg-black/60 p-3 text-white">
              {viewers ? (
                <div className="max-h-48 overflow-y-auto">
                  <p className="mb-2 text-meta text-white/70">Viewed by {viewers.length}</p>
                  {viewers.map((v) => (
                    <div key={v.person.userId} className="flex items-center gap-2 py-1">
                      <Avatar name={v.person.displayName} size="sm" />
                      <span className="flex-1 text-label">{v.person.displayName}</span>
                      <span className="text-meta text-white/60">{relativeShort(v.viewedAt)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void loadViewers()}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-label hover:bg-white/10"
                >
                  <Eye className="size-4" /> {s.viewCount ?? 0}{' '}
                  {s.viewCount === 1 ? 'view' : 'views'}
                </button>
                <button
                  onClick={() => {
                    void net.act({
                      method: 'DELETE',
                      path: `/v1/network/statuses/${s.statusId}`,
                      label: 'Delete status',
                      scopes: ['statuses'],
                    });
                    onClose();
                  }}
                  className="ml-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-label text-red-300 hover:bg-white/10"
                >
                  <Trash2 className="size-4" /> Delete
                </button>
              </div>
            </div>
          ) : s.allowReplies ? (
            <form
              className="flex items-center gap-2 border-t border-white/10 bg-black/60 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void sendReply();
              }}
            >
              <Input
                value={reply}
                onFocus={() => setPaused(true)}
                onBlur={() => setPaused(false)}
                onChange={(e) => setReply(e.target.value)}
                placeholder={`Reply privately to ${author.displayName.split(' ')[0]}…`}
                className="border-white/20 bg-white/10 text-white placeholder:text-white/50"
              />
              <Button type="submit" size="icon" aria-label="Send reply">
                <Send />
              </Button>
            </form>
          ) : (
            <p className="border-t border-white/10 bg-black/60 p-3 text-center text-meta text-white/60">
              Replies are off for this status
            </p>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

/** New status: text on a colour, a photo or a video; audience and how long it stays up. */
export function StatusComposer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const net = useNetwork();
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const [kind, setKind] = React.useState<'text' | 'image' | 'video'>('text');
  const [text, setText] = React.useState('');
  const [bg, setBg] = React.useState<(typeof STATUS_BACKGROUNDS)[number]>('ocean');
  const [file, setFile] = React.useState<File | null>(null);
  const [audience, setAudience] = React.useState<keyof typeof AUDIENCE_LABEL>('connections');
  const [hours, setHours] = React.useState(24);
  const [allowReplies, setAllowReplies] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const preview = React.useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  React.useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const upload = async (f: File): Promise<string> => {
    const token = await getAccessToken();
    const ticket = await apiRequest<UploadTicket>('POST', '/v1/network/status-media', {
      token,
      body: { fileName: f.name, mimeType: f.type, sizeBytes: f.size },
    });
    const res = await fetch(API_URL + ticket.uploadUrl, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
      body: f,
    });
    if (!res.ok) throw new Error('Upload failed');
    await apiRequest('POST', `/v1/uploads/${ticket.uploadId}/complete`, { token });
    return ticket.uploadId;
  };

  const post = async () => {
    setBusy(true);
    try {
      let attachmentId: string | null = null;
      if (kind !== 'text') {
        if (!file) throw new Error('Choose a file');
        if (!net.online)
          throw new Error(
            'Photo and video statuses need a connection. Text statuses work offline.',
          );
        attachmentId = await upload(file);
      }
      const r = await net.act({
        method: 'POST',
        path: '/v1/network/statuses',
        body: {
          clientStatusId: uuidv7(),
          kind,
          text,
          background: bg,
          attachmentId,
          audience,
          expiresInHours: hours,
          allowReplies,
        },
        label: 'New status',
        scopes: ['statuses'],
      });
      toast({
        title: r === null ? 'Status queued' : 'Status posted',
        description:
          r === null
            ? 'It goes up when you’re back online.'
            : `Visible for ${hours === 24 ? '24 hours' : hours < 24 ? `${hours} hours` : `${hours / 24} days`}.`,
        tone: 'success',
      });
      setText('');
      setFile(null);
      onOpenChange(false);
    } catch (e) {
      toast({ title: 'Couldn’t post', description: errorText(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New status"
        description="Share an update with your connections. It disappears on its own."
      >
        <div className="flex flex-col gap-4">
          <div className="flex gap-1 rounded-md border border-border p-0.5">
            {(
              [
                ['text', 'Text', Type],
                ['image', 'Photo', ImagePlus],
                ['video', 'Video', Video],
              ] as const
            ).map(([k, label, Icon]) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-sm py-1.5 text-meta',
                  kind === k ? 'bg-accent-soft text-text' : 'text-text-muted',
                )}
              >
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>
          {kind === 'text' ? (
            <>
              <div
                className="flex h-40 items-center justify-center rounded-lg p-4"
                style={{ background: BACKGROUNDS[bg] }}
              >
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={700}
                  rows={3}
                  placeholder="What’s new?"
                  className="border-none bg-transparent text-center font-display text-[22px] text-white shadow-none placeholder:text-white/60 focus-visible:ring-0"
                />
              </div>
              <div className="flex gap-2">
                {STATUS_BACKGROUNDS.map((b) => (
                  <button
                    key={b}
                    aria-label={b}
                    onClick={() => setBg(b)}
                    className={cn(
                      'size-7 rounded-full ring-offset-2 ring-offset-surface',
                      bg === b && 'ring-2 ring-accent',
                    )}
                    style={{ background: BACKGROUNDS[b] }}
                  />
                ))}
              </div>
            </>
          ) : (
            <>
              <label className="flex h-40 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-border-strong bg-surface-raised text-label text-text-muted">
                {preview ? (
                  kind === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <video src={preview} className="h-full w-full object-cover" muted />
                  )
                ) : (
                  <span className="flex items-center gap-2">
                    {kind === 'image' ? (
                      <ImagePlus className="size-5" />
                    ) : (
                      <Video className="size-5" />
                    )}{' '}
                    Choose a {kind === 'image' ? 'photo' : 'video'}
                  </span>
                )}
                <input
                  type="file"
                  className="sr-only"
                  accept={
                    kind === 'image'
                      ? 'image/png,image/jpeg,image/gif,image/webp'
                      : 'video/mp4,video/webm,video/quicktime'
                  }
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Add a caption (optional)"
              />
            </>
          )}
          <Field label="Who can see it" htmlFor="st-audience">
            <select
              id="st-audience"
              value={audience}
              onChange={(e) => setAudience(e.target.value as keyof typeof AUDIENCE_LABEL)}
              className="h-10 w-full rounded-md border border-border bg-surface px-3 text-label text-text"
            >
              {(['connections', 'followers', 'public'] as const).map((a) => (
                <option key={a} value={a}>
                  {AUDIENCE_LABEL[a]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Visible for" htmlFor="st-hours">
            <div className="flex flex-wrap gap-1.5">
              {[6, 24, 72, 168].map((h) => (
                <button
                  key={h}
                  onClick={() => setHours(h)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-meta',
                    hours === h
                      ? 'border-accent bg-accent-soft text-text'
                      : 'border-border text-text-muted',
                  )}
                >
                  {h < 24 ? `${h} hours` : h === 24 ? '24 hours' : `${h / 24} days`}
                </button>
              ))}
              <Input
                type="number"
                min={1}
                max={168}
                value={hours}
                onChange={(e) => setHours(Math.max(1, Math.min(168, Number(e.target.value) || 24)))}
                className="h-8 w-24"
                id="st-hours"
                aria-label="Custom hours"
              />
            </div>
          </Field>
          <div className="flex items-center justify-between">
            <span className="text-label text-text">Allow private replies</span>
            <Switch
              checked={allowReplies}
              onChange={setAllowReplies}
              label="Allow private replies"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              loading={busy}
              onClick={() => void post()}
              disabled={kind === 'text' ? !text.trim() : !file}
            >
              Post status
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
