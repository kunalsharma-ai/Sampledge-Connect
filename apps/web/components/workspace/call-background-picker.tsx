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

const Img = ({ src }: { src: string }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
);

const Heading = ({ children }: { children: React.ReactNode }) => (
  <p className="col-span-3 pt-1 text-meta font-medium uppercase tracking-wide text-white/50">
    {children}
  </p>
);

/**
 * The background grid in call settings: none, blur, the company background, uploads (mine and
 * the organization's) and the prebuilt photos. Everything runs on this device; members' choice
 * follows them to every device.
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
  const locked = ctl.locked;

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
  const isUpload = (id: string) => cur.kind === 'upload' && cur.imageId === id;
  const isPreset = (id: string) => cur.kind === 'preset' && cur.presetId === id;
  const mine = ctl.uploads.filter((u) => u.owner === 'mine');
  const company = ctl.uploads.filter((u) => u.owner === 'organization');
  const groups = [...new Set(CALL_BACKGROUND_PRESETS.map((p) => p.group))];

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
          <span className="flex h-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-white/15 to-white/5 text-meta text-white backdrop-blur">
            <Sparkles className="size-4" /> Blur
          </span>
        </Tile>
        {ctl.allowUpload ? (
          <Tile
            label="Upload your own background"
            selected={false}
            disabled={locked || off || uploading}
            onClick={() => fileRef.current?.click()}
            testId="background-upload"
          >
            <span className="flex h-full flex-col items-center justify-center gap-1 border border-dashed border-white/30 text-meta">
              <ImagePlus className="size-4" /> {uploading ? 'Uploading…' : 'Upload'}
            </span>
          </Tile>
        ) : null}

        {ctl.allowLogo || company.length ? <Heading>Company</Heading> : null}
        {ctl.allowLogo ? (
          <Tile
            label="Company logo background"
            selected={cur.kind === 'logo'}
            disabled={off}
            onClick={() => pick({ kind: 'logo' })}
            testId="background-logo"
          >
            {logoPreview ? (
              <Img src={logoPreview} />
            ) : (
              <span className="flex h-full flex-col items-center justify-center gap-1 text-meta">
                <Building2 className="size-4" /> Company
              </span>
            )}
          </Tile>
        ) : null}
        {company.map((u) => (
          <Tile
            key={u.imageId}
            label={u.name}
            selected={isUpload(u.imageId)}
            disabled={locked || off}
            onClick={() => pick({ kind: 'upload', imageId: u.imageId })}
            testId="background-company-upload"
          >
            <Img src={u.url} />
          </Tile>
        ))}

        {mine.length ? <Heading>Yours</Heading> : null}
        {mine.map((u) => (
          <div key={u.imageId} className="relative">
            <Tile
              label={u.name}
              selected={isUpload(u.imageId)}
              disabled={locked || off}
              onClick={() => pick({ kind: 'upload', imageId: u.imageId })}
              testId="background-mine"
            >
              <Img src={u.url} />
            </Tile>
            <button
              type="button"
              aria-label={`Remove ${u.name}`}
              onClick={() => void ctl.removeImage?.(u.imageId)}
              className="absolute right-1 top-1 rounded bg-black/70 p-1 text-white/80 hover:text-white"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        ))}

        {groups.map((g) => (
          <React.Fragment key={g}>
            <Heading>{g === 'Home' ? 'Luxury homes' : 'Offices'}</Heading>
            {CALL_BACKGROUND_PRESETS.filter((p) => p.group === g).map((p) => (
              <Tile
                key={p.id}
                label={p.name}
                selected={isPreset(p.id)}
                disabled={locked || off}
                onClick={() => pick({ kind: 'preset', presetId: p.id })}
                testId={`background-${p.id}`}
              >
                <Img src={callBackgroundThumbPath(p.id)} />
              </Tile>
            ))}
          </React.Fragment>
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
