'use client';
import * as React from 'react';
import { Camera, Trash2, ZoomIn } from 'lucide-react';
import {
  MAX_AVATAR_BYTES,
  type UpdateProfileRequest,
  type UserSummary,
} from '@sampledge/contracts';
import {
  Avatar,
  Button,
  Dialog,
  DialogContent,
  Field,
  Input,
  Textarea,
  useToast,
} from '@sampledge/ui';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useEngine } from '@/lib/engine';
import { avatarUrl } from './helpers';

const OUT = 512; // px, square
const VIEW = 288; // crop window, px

type Draft = Required<{
  [K in 'displayName' | 'title' | 'department' | 'phone' | 'bio' | 'timeZone']: string;
}>;

const toDraft = (u: Partial<UserSummary>): Draft => ({
  displayName: u.displayName ?? '',
  title: u.title ?? '',
  department: u.department ?? '',
  phone: u.phone ?? '',
  bio: u.bio ?? '',
  timeZone: u.timeZone ?? '',
});

function timeZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf(
      'timeZone',
    );
  } catch {
    return [];
  }
}

/**
 * Your profile: photo (upload, crop, change, remove) and name, title, department, phone,
 * bio and time zone. Changes show for everyone at once (`directory:updated`).
 */
export function ProfileCard() {
  const { session, getAccessToken } = useAuth();
  const { directory, state } = useEngine();
  const { toast } = useToast();
  const me = session!.user.userId;
  const current = directory.get(me) ?? session!.user;
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(current));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [cropSrc, setCropSrc] = React.useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const online = state.connectivity === 'online';
  const zones = React.useMemo(timeZones, []);
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Follow edits made on another device, unless this form has unsaved changes.
  const saved = toDraft(current);
  const savedKey = JSON.stringify(saved);
  const dirty = JSON.stringify(draft) !== savedKey;
  const lastSaved = React.useRef(savedKey);
  React.useEffect(() => {
    if (lastSaved.current === savedKey) return;
    setDraft((d) => (JSON.stringify(d) === lastSaved.current ? JSON.parse(savedKey) : d));
    lastSaved.current = savedKey;
  }, [savedKey]);

  const set =
    (k: keyof Draft) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setDraft((d) => ({ ...d, [k]: e.target.value }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body: UpdateProfileRequest = {};
      for (const k of Object.keys(draft) as (keyof Draft)[])
        if (draft[k] !== saved[k]) (body as Record<string, string>)[k] = draft[k];
      await apiRequest<UserSummary>('PATCH', '/v1/me/profile', {
        token: await getAccessToken(),
        body,
      });
      toast({ title: 'Profile saved', tone: 'success' });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/^image\/(png|jpeg|webp|gif|avif|heic|heif)$/.test(f.type)) {
      toast({ title: 'Choose a photo (PNG, JPEG or WebP)', tone: 'danger' });
      return;
    }
    setCropSrc(URL.createObjectURL(f));
  };

  const upload = async (dataUrl: string) => {
    setPhotoBusy(true);
    try {
      await apiRequest<UserSummary>('PUT', '/v1/me/avatar', {
        token: await getAccessToken(),
        body: { image: dataUrl },
      });
      toast({ title: 'Profile photo updated', tone: 'success' });
    } catch (err) {
      toast({ title: 'Photo not saved', description: (err as Error).message, tone: 'danger' });
    } finally {
      setPhotoBusy(false);
    }
  };

  const remove = async () => {
    setPhotoBusy(true);
    try {
      await apiRequest<UserSummary>('DELETE', '/v1/me/avatar', { token: await getAccessToken() });
      toast({ title: 'Profile photo removed', tone: 'success' });
    } catch (err) {
      toast({ title: 'Photo not removed', description: (err as Error).message, tone: 'danger' });
    } finally {
      setPhotoBusy(false);
    }
  };

  const photo = avatarUrl(current.avatarUrl);
  return (
    <section
      className="mb-6 rounded-xl border border-border bg-surface-raised p-4 sm:p-5"
      aria-labelledby="profile-heading"
    >
      <h3 id="profile-heading" className="text-h3 text-text">
        Profile
      </h3>
      <p className="mt-0.5 text-meta text-text-muted">
        Everyone in {session!.tenant.name} sees this next to your name.
        {online ? '' : ' Changes need a connection.'}
      </p>
      <div className="mt-4 flex flex-col gap-5 sm:flex-row">
        <div className="flex shrink-0 flex-row items-center gap-3 sm:flex-col sm:items-center">
          <Avatar
            name={draft.displayName || current.displayName}
            src={photo}
            size="lg"
            className="[&>span:first-child]:size-24 [&>span:first-child]:text-h2"
          />
          <div className="flex flex-wrap gap-1.5 sm:justify-center">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/heic"
              className="sr-only"
              aria-label="Choose a profile photo"
              onChange={pick}
              tabIndex={-1}
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={!online}
              loading={photoBusy}
              onClick={() => fileRef.current?.click()}
            >
              <Camera /> {photo ? 'Change photo' : 'Add photo'}
            </Button>
            {photo ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={!online || photoBusy}
                aria-label="Remove profile photo"
                onClick={() => void remove()}
              >
                <Trash2 />
              </Button>
            ) : null}
          </div>
        </div>
        <form
          onSubmit={save}
          className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2"
          data-testid="profile-form"
        >
          <Field label="Name" htmlFor="pf-name">
            <Input
              id="pf-name"
              value={draft.displayName}
              maxLength={80}
              required
              onChange={set('displayName')}
            />
          </Field>
          <Field label="Job title" htmlFor="pf-title">
            <Input
              id="pf-title"
              value={draft.title}
              maxLength={80}
              placeholder="Research Director"
              onChange={set('title')}
            />
          </Field>
          <Field label="Department" htmlFor="pf-dept">
            <Input
              id="pf-dept"
              value={draft.department}
              maxLength={80}
              placeholder="Fieldwork"
              onChange={set('department')}
            />
          </Field>
          <Field label="Phone" htmlFor="pf-phone">
            <Input
              id="pf-phone"
              type="tel"
              value={draft.phone}
              maxLength={32}
              placeholder="+91 98765 43210"
              onChange={set('phone')}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Time zone" htmlFor="pf-tz">
              <div className="flex gap-2">
                <select
                  id="pf-tz"
                  value={draft.timeZone}
                  onChange={set('timeZone')}
                  className="h-10 min-w-0 flex-1 rounded-md border border-border bg-surface px-3 text-label text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <option value="">Not set</option>
                  {(zones.includes(draft.timeZone) || !draft.timeZone
                    ? zones
                    : [draft.timeZone, ...zones]
                  ).map((z) => (
                    <option key={z} value={z}>
                      {z.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
                {deviceZone && draft.timeZone !== deviceZone ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-10"
                    onClick={() => setDraft((d) => ({ ...d, timeZone: deviceZone }))}
                  >
                    Use this device’s
                  </Button>
                ) : null}
              </div>
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="About you" htmlFor="pf-bio" hint={`${draft.bio.length}/500`}>
              <Textarea
                id="pf-bio"
                rows={3}
                value={draft.bio}
                maxLength={500}
                placeholder="What you work on, languages, markets you cover…"
                onChange={set('bio')}
              />
            </Field>
          </div>
          {error ? (
            <p role="alert" className="text-label text-danger sm:col-span-2">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 sm:col-span-2">
            {dirty ? (
              <Button type="button" variant="ghost" onClick={() => setDraft(saved)}>
                Discard
              </Button>
            ) : null}
            <Button
              type="submit"
              loading={saving}
              disabled={!dirty || !online || !draft.displayName.trim()}
            >
              Save profile
            </Button>
          </div>
        </form>
      </div>
      <CropDialog
        src={cropSrc}
        onClose={() => {
          if (cropSrc) URL.revokeObjectURL(cropSrc);
          setCropSrc(null);
        }}
        onDone={(d) => void upload(d)}
      />
    </section>
  );
}

/** Square crop with drag to move and a zoom slider (arrow keys move too). */
function CropDialog({
  src,
  onClose,
  onDone,
}: {
  src: string | null;
  onClose: () => void;
  onDone: (dataUrl: string) => void;
}) {
  const [img, setImg] = React.useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = React.useState(1);
  const [pos, setPos] = React.useState({ x: 0, y: 0 });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const drag = React.useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  React.useEffect(() => {
    setImg(null);
    setZoom(1);
    setPos({ x: 0, y: 0 });
    setError(null);
    if (!src) return;
    const i = new Image();
    i.onload = () => setImg(i);
    i.onerror = () => setError('This photo can’t be opened. Try a PNG or JPEG.');
    i.src = src;
  }, [src]);

  // The image covers the crop window at zoom 1; offsets are clamped so no gap shows.
  const base = img ? VIEW / Math.min(img.naturalWidth, img.naturalHeight) : 1;
  const w = img ? img.naturalWidth * base * zoom : VIEW;
  const h = img ? img.naturalHeight * base * zoom : VIEW;
  const clamp = React.useCallback(
    (p: { x: number; y: number }) => ({
      x: Math.min(0, Math.max(VIEW - w, p.x)),
      y: Math.min(0, Math.max(VIEW - h, p.y)),
    }),
    [w, h],
  );
  // Centre on open and keep the centre when zooming.
  const prev = React.useRef({ w: 0, h: 0 });
  React.useEffect(() => {
    if (!img) return;
    setPos((p) => {
      // Where the crop centre sits in the image, as a fraction (0.5 = middle on first open).
      const cx = prev.current.w ? (VIEW / 2 - p.x) / prev.current.w : 0.5;
      const cy = prev.current.h ? (VIEW / 2 - p.y) / prev.current.h : 0.5;
      prev.current = { w, h };
      return clamp({ x: VIEW / 2 - cx * w, y: VIEW / 2 - cy * h });
    });
  }, [img, w, h, clamp]);
  React.useEffect(() => {
    if (!src) prev.current = { w: 0, h: 0 };
  }, [src]);

  const done = async () => {
    if (!img) return;
    setBusy(true);
    const c = document.createElement('canvas');
    c.width = OUT;
    c.height = OUT;
    const ctx = c.getContext('2d')!;
    const s = OUT / VIEW;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, pos.x * s, pos.y * s, w * s, h * s);
    let out = '';
    for (const [type, q] of [
      ['image/webp', 0.86],
      ['image/jpeg', 0.84],
      ['image/jpeg', 0.7],
      ['image/jpeg', 0.55],
    ] as const) {
      out = c.toDataURL(type, q);
      if (!out.startsWith(`data:${type}`)) continue; // browser can't encode this type
      if ((out.length - out.indexOf(',') - 1) * 0.75 <= MAX_AVATAR_BYTES) break;
    }
    setBusy(false);
    onDone(out);
    onClose();
  };

  const move = (dx: number, dy: number) => setPos((p) => clamp({ x: p.x + dx, y: p.y + dy }));

  return (
    <Dialog open={!!src} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Crop your photo"
        description="Drag to position it. Use the slider to zoom."
      >
        <div className="flex flex-col items-center gap-4">
          <div
            role="img"
            aria-label="Photo crop area. Use arrow keys to move the photo."
            tabIndex={0}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 24 : 8;
              const d: Record<string, [number, number]> = {
                ArrowLeft: [step, 0],
                ArrowRight: [-step, 0],
                ArrowUp: [0, step],
                ArrowDown: [0, -step],
              };
              if (d[e.key]) {
                e.preventDefault();
                move(...d[e.key]!);
              }
            }}
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (d) setPos(clamp({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }));
            }}
            onPointerUp={() => (drag.current = null)}
            onWheel={(e) => setZoom((z) => Math.min(4, Math.max(1, z - e.deltaY / 500)))}
            className="relative cursor-grab touch-none select-none overflow-hidden rounded-xl bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
            style={{ width: VIEW, height: VIEW }}
          >
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={img.src}
                alt=""
                draggable={false}
                className="absolute max-w-none"
                style={{ left: pos.x, top: pos.y, width: w, height: h }}
              />
            ) : null}
            {/* Round preview mask: what others see. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white/70"
              style={{ boxShadow: `0 0 0 ${VIEW}px rgb(0 0 0 / 0.5)` }}
            />
          </div>
          <label className="flex w-full max-w-[288px] items-center gap-3 text-meta text-text-muted">
            <ZoomIn className="size-4 shrink-0" aria-hidden />
            <span className="sr-only">Zoom</span>
            <input
              type="range"
              min={1}
              max={4}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full accent-[var(--sc-accent)]"
              aria-label="Zoom"
            />
          </label>
          {error ? (
            <p role="alert" className="text-label text-danger">
              {error}
            </p>
          ) : null}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void done()} disabled={!img} loading={busy}>
            Use photo
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
