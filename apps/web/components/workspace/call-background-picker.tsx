'use client';
import * as React from 'react';
import { Ban, Building2, ImagePlus, Lock, Sparkles, Trash2 } from 'lucide-react';
import { cn } from '@sampledge/ui';
import {
  CALL_BACKGROUND_PRESETS,
  callBackgroundThumbPath,
  type CallBackgroundChoice,
} from '@sampledge/contracts';
import { logoBackground, type BackgroundController } from '@/lib/call-backgrounds';

const same = (a: CallBackgroundChoice, b: CallBackgroundChoice) =>
  a.kind === b.kind && (a.kind !== 'preset' || (b.kind === 'preset' && a.presetId === b.presetId));

function Tile({
  label,
  selected,
  disabled,
  onClick,
  children,
  testId,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      title={label}
      disabled={disabled}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'relative aspect-video w-full overflow-hidden rounded-md border bg-white/5 text-white/80 transition',
        'hover:border-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        'disabled:cursor-not-allowed disabled:opacity-40',
        selected ? 'border-accent ring-2 ring-accent' : 'border-white/15',
      )}
    >
      {children}
    </button>
  );
}

/**
 * The background grid in call settings: none, blur, company logo, your own image, and the
 * prebuilt office scenes. Everything runs on this device; members' choice follows them to
 * every device.
 */
export function BackgroundPicker({
  ctl,
  supported,
  camOn,
  onError,
}: {
  ctl: BackgroundController;
  supported: boolean | null;
  camOn: boolean;
  onError: (m: string | null) => void;
}) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [logoPreview, setLogoPreview] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const cur = ctl.effective;
  const off = supported === false;

  React.useEffect(() => {
    if (!ctl.allowLogo || !ctl.brand) return;
    let alive = true;
    void logoBackground(ctl.brand).then((u) => alive && setLogoPreview(u));
    return () => {
      alive = false;
    };
  }, [ctl.allowLogo, ctl.brand]);

  const pick = (c: CallBackgroundChoice) => {
    onError(null);
    void ctl.choose(c);
  };
  const locked = ctl.locked;

  return (
    <section aria-label="Background" className="space-y-2" data-testid="background-picker">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-label text-white">Background</p>
        <p className="text-meta text-white/50">
          {off
            ? 'Not supported in this browser.'
            : !camOn
              ? 'Applies when your camera is on.'
              : 'Runs on this device, not on a server.'}
        </p>
      </div>
      {locked ? (
        <p
          className="flex items-center gap-1.5 rounded-md bg-white/5 px-2 py-1.5 text-meta text-white/70"
          data-testid="background-locked"
        >
          <Lock className="size-3.5" /> Your organization uses the company background in calls.
        </p>
      ) : null}
      <div className="grid grid-cols-3 gap-2">
        <Tile
          label="No background effect"
          selected={cur.kind === 'none'}
          disabled={locked}
          onClick={() => pick({ kind: 'none' })}
        >
          <span className="flex h-full flex-col items-center justify-center gap-1 text-meta">
            <Ban className="size-4" /> None
          </span>
        </Tile>
        <Tile
          label="Blur my background"
          selected={cur.kind === 'blur'}
          disabled={locked || off}
          onClick={() => pick({ kind: 'blur' })}
        >
          <span
            aria-hidden
            className="absolute inset-0 scale-110 bg-cover bg-center blur-[3px]"
            style={{ backgroundImage: `url(${callBackgroundThumbPath('skyline-office')})` }}
          />
          <span className="relative flex h-full flex-col items-center justify-center gap-1 bg-black/30 text-meta text-white">
            <Sparkles className="size-4" /> Blur
          </span>
        </Tile>
        {ctl.allowLogo ? (
          <Tile
            label="Company logo background"
            selected={cur.kind === 'logo'}
            disabled={off}
            onClick={() => pick({ kind: 'logo' })}
            testId="background-logo"
          >
            {logoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoPreview} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full flex-col items-center justify-center gap-1 text-meta">
                <Building2 className="size-4" /> Company
              </span>
            )}
          </Tile>
        ) : null}
        {ctl.allowUpload && ctl.customImageUrl ? (
          <div className="relative">
            <Tile
              label="My own image"
              selected={cur.kind === 'custom'}
              disabled={locked || off}
              onClick={() => pick({ kind: 'custom' })}
              testId="background-custom"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ctl.customImageUrl} alt="" className="h-full w-full object-cover" />
            </Tile>
            <button
              type="button"
              aria-label="Remove my image"
              onClick={() => void ctl.removeImage?.()}
              className="absolute right-1 top-1 rounded bg-black/70 p-1 text-white/80 hover:text-white"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        ) : null}
        {ctl.allowUpload ? (
          <Tile
            label={ctl.customImageUrl ? 'Replace my image' : 'Upload my own image'}
            selected={false}
            disabled={locked || off || uploading}
            onClick={() => fileRef.current?.click()}
          >
            <span className="flex h-full flex-col items-center justify-center gap-1 text-meta">
              <ImagePlus className="size-4" /> {uploading ? 'Uploading…' : 'Your image'}
            </span>
          </Tile>
        ) : null}
        {CALL_BACKGROUND_PRESETS.map((p) => (
          <Tile
            key={p.id}
            label={p.name}
            selected={cur.kind === 'preset' && same(cur, { kind: 'preset', presetId: p.id })}
            disabled={locked || off}
            onClick={() => pick({ kind: 'preset', presetId: p.id })}
            testId={`background-${p.id}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={callBackgroundThumbPath(p.id)}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </Tile>
        ))}
      </div>
      {ctl.allowUpload ? (
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          data-testid="background-file"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f || !ctl.upload) return;
            setUploading(true);
            try {
              await ctl.upload(f);
            } finally {
              setUploading(false);
            }
          }}
        />
      ) : null}
    </section>
  );
}
