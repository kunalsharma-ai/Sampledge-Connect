'use client';
import * as React from 'react';
import { FlipHorizontal2, ImagePlus, RotateCw, Undo2 } from 'lucide-react';
import {
  CHAT_BACKGROUND_FILTERS,
  DEFAULT_CHAT_BACKGROUND_ADJUST,
  chatBackgroundColorMatrix,
  customImagesAllowed,
  isNeutralChatBackground,
  type ChatBackgroundAdjust,
  type ChatBackgroundFilter,
} from '@sampledge/contracts';
import { Button, Dialog, DialogContent, cn, useToast } from '@sampledge/ui';
import { useChatTheme, useChatThemeStyle } from '@/lib/chat-theme';
import {
  prepareChatBackground,
  useChatBackgroundSlot,
  type ChatBackgroundSlot,
} from '@/lib/chat-background';

/**
 * Draws a personal background picture with its edits: crop (focus and zoom), colour (one
 * shared feColorMatrix, the same maths the phone app uses), blur, opacity over the theme's
 * colour, and a dim wash in that colour so messages stay readable. Fills its positioned parent.
 */
export function ChatBackdrop({
  url,
  adjust,
  scale = 1,
  className,
}: {
  url: string;
  adjust: ChatBackgroundAdjust;
  /** Shrinks the blur for small previews (1 = a full-size conversation). */
  scale?: number;
  className?: string;
}) {
  const id = `chat-bg-${React.useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const colour = !isNeutralChatBackground(adjust);
  const blur = adjust.blur * scale;
  const origin = `${adjust.focusX * 100}% ${adjust.focusY * 100}%`;
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
      style={{ background: 'var(--sc-chat-base)' }}
    >
      {colour ? (
        <svg width="0" height="0" className="absolute">
          <filter id={id} colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={chatBackgroundColorMatrix(adjust).join(' ')} />
          </filter>
        </svg>
      ) : null}
      <img
        src={url}
        alt=""
        draggable={false}
        className="absolute inset-0 size-full max-w-none select-none object-cover"
        style={{
          objectPosition: origin,
          transformOrigin: origin,
          // A little extra zoom hides the soft edge a blur leaves.
          transform: `scale(${adjust.zoom * (blur ? 1 + Math.min(0.12, blur / 150) : 1)})`,
          filter: [colour ? `url(#${id})` : '', blur ? `blur(${blur}px)` : '']
            .filter(Boolean)
            .join(' '),
          opacity: adjust.opacity,
        }}
      />
      <div
        className="absolute inset-0"
        style={{ background: 'var(--sc-chat-base)', opacity: adjust.dim }}
      />
    </div>
  );
}

const FILTER_LABEL: Record<ChatBackgroundFilter, string> = {
  none: 'Original',
  mono: 'Mono',
  sepia: 'Sepia',
  vivid: 'Vivid',
  fade: 'Fade',
  noir: 'Noir',
  cool: 'Cool',
};

type NumKey = Exclude<keyof ChatBackgroundAdjust, 'filter'>;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const signed = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`;
const SECTIONS: {
  title: string;
  rows: {
    k: NumKey;
    label: string;
    min: number;
    max: number;
    step: number;
    fmt: (v: number) => string;
  }[];
}[] = [
  {
    title: 'Crop',
    rows: [
      { k: 'zoom', label: 'Zoom', min: 1, max: 3, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
      { k: 'focusX', label: 'Left to right', min: 0, max: 1, step: 0.01, fmt: pct },
      { k: 'focusY', label: 'Top to bottom', min: 0, max: 1, step: 0.01, fmt: pct },
    ],
  },
  {
    title: 'Light and colour',
    rows: [
      { k: 'brightness', label: 'Brightness', min: -1, max: 1, step: 0.05, fmt: signed },
      { k: 'contrast', label: 'Contrast', min: -1, max: 1, step: 0.05, fmt: signed },
      { k: 'saturation', label: 'Saturation', min: -1, max: 1, step: 0.05, fmt: signed },
      { k: 'warmth', label: 'Warmth', min: -1, max: 1, step: 0.05, fmt: signed },
    ],
  },
  {
    title: 'Readability',
    rows: [
      { k: 'opacity', label: 'Opacity', min: 0.2, max: 1, step: 0.05, fmt: pct },
      { k: 'blur', label: 'Blur', min: 0, max: 24, step: 1, fmt: (v) => `${v}px` },
      { k: 'dim', label: 'Dim', min: 0, max: 0.8, step: 0.05, fmt: pct },
    ],
  },
];

/** Sample messages over the picture, so people see how readable it will be. */
function SampleMessages() {
  return (
    <div className="relative flex h-full flex-col justify-end gap-2 p-4">
      <span className="text-meta text-text-subtle">
        <span className="font-medium text-text">Sara Lindqvist</span> 9:41 AM
      </span>
      <span className="w-fit max-w-[75%] rounded-lg rounded-tl-sm border border-border bg-bubble-other px-3 py-1.5 text-body text-text">
        Draft is ready
      </span>
      <span className="ml-auto w-fit max-w-[75%] rounded-lg rounded-tr-sm bg-bubble-own px-3 py-1.5 text-body text-bubble-own-fg">
        Looks great, thanks
      </span>
    </div>
  );
}

/** The photo editor: crop, rotate, flip, filters, light and colour, opacity, blur and dim. */
export function ChatBackgroundEditor({
  open,
  onOpenChange,
  title,
  image: initialImage,
  adjust: initialAdjust,
  onSave,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  image: Blob;
  adjust: ChatBackgroundAdjust;
  onSave: (image: Blob, adjust: ChatBackgroundAdjust) => Promise<void>;
  onRemove?: () => Promise<void>;
}) {
  const { effective } = useChatTheme();
  const themeStyle = useChatThemeStyle(effective);
  const { toast } = useToast();
  const [image, setImage] = React.useState(initialImage);
  const [adjust, setAdjust] = React.useState(initialAdjust);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    setImage(initialImage);
    setAdjust(initialAdjust);
  }, [initialImage, initialAdjust]);
  const url = React.useMemo(() => URL.createObjectURL(image), [image]);
  React.useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const set = (k: NumKey, v: number) => setAdjust((a) => ({ ...a, [k]: v }));
  const bake = async (opts: { rotate?: 90; flipX?: boolean }) => {
    setBusy(true);
    try {
      setImage(await prepareChatBackground(image, opts));
      if (opts.flipX) setAdjust((a) => ({ ...a, focusX: 1 - a.focusX }));
    } finally {
      setBusy(false);
    }
  };

  // Drag the picture to place it (sliders do the same for keyboards).
  const drag = React.useRef<{
    x: number;
    y: number;
    fx: number;
    fy: number;
    w: number;
    h: number;
  } | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        description="Kept on this device only. Your chat theme still sets the bubble colours."
        className="w-[min(920px,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <div className="grid gap-5 md:grid-cols-[1.25fr_1fr]">
          <div className="min-w-0">
            <div
              className="relative aspect-[16/11] cursor-grab touch-none overflow-hidden rounded-lg border border-border active:cursor-grabbing"
              style={themeStyle}
              data-testid="chat-bg-preview"
              onPointerDown={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = {
                  x: e.clientX,
                  y: e.clientY,
                  fx: adjust.focusX,
                  fy: adjust.focusY,
                  w: r.width,
                  h: r.height,
                };
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d) return;
                const clamp = (v: number) => Math.min(1, Math.max(0, v));
                setAdjust((a) => ({
                  ...a,
                  focusX: clamp(d.fx - (e.clientX - d.x) / d.w / a.zoom),
                  focusY: clamp(d.fy - (e.clientY - d.y) / d.h / a.zoom),
                }));
              }}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
            >
              <ChatBackdrop url={url} adjust={adjust} scale={0.6} />
              <SampleMessages />
            </div>
            <p className="mt-2 text-meta text-text-subtle">Drag the picture to place it.</p>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void bake({ rotate: 90 })}
              >
                <RotateCw className="size-4" aria-hidden /> Rotate
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void bake({ flipX: true })}
              >
                <FlipHorizontal2 className="size-4" aria-hidden /> Flip
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAdjust(DEFAULT_CHAT_BACKGROUND_ADJUST)}
                disabled={JSON.stringify(adjust) === JSON.stringify(DEFAULT_CHAT_BACKGROUND_ADJUST)}
              >
                <Undo2 className="size-4" aria-hidden /> Reset edits
              </Button>
            </div>

            <fieldset className="mt-4">
              <legend className="text-label text-text">Filter</legend>
              <div
                className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7"
                role="radiogroup"
                aria-label="Filter"
              >
                {CHAT_BACKGROUND_FILTERS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="radio"
                    aria-checked={adjust.filter === f}
                    onClick={() => setAdjust((a) => ({ ...a, filter: f }))}
                    className="group text-center"
                  >
                    <span
                      className={cn(
                        'relative block aspect-square overflow-hidden rounded-md border',
                        adjust.filter === f
                          ? 'border-accent ring-2 ring-accent'
                          : 'border-border group-hover:border-border-strong',
                      )}
                      style={themeStyle}
                    >
                      <ChatBackdrop url={url} adjust={{ ...adjust, filter: f, dim: 0, blur: 0 }} />
                    </span>
                    <span className="mt-1 block truncate text-meta text-text-muted">
                      {FILTER_LABEL[f]}
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="space-y-4">
            {SECTIONS.map((s) => (
              <fieldset key={s.title}>
                <legend className="text-label text-text">{s.title}</legend>
                <div className="mt-2 space-y-2.5">
                  {s.rows.map((r) => (
                    <label key={r.k} className="block">
                      <span className="flex items-center justify-between text-meta text-text-muted">
                        {r.label}
                        <span className="tabular-nums text-text-subtle">{r.fmt(adjust[r.k])}</span>
                      </span>
                      <input
                        type="range"
                        min={r.min}
                        max={r.max}
                        step={r.step}
                        value={adjust[r.k]}
                        onChange={(e) => set(r.k, Number(e.target.value))}
                        onDoubleClick={() => set(r.k, DEFAULT_CHAT_BACKGROUND_ADJUST[r.k])}
                        className="mt-1 w-full accent-[var(--sc-color-accent)]"
                        data-adjust={r.k}
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {onRemove ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void onRemove().then(() => onOpenChange(false))}
            >
              Remove picture
            </Button>
          ) : null}
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void onSave(image, adjust)
                  .then(() => onOpenChange(false))
                  .catch((e: Error) =>
                    toast({
                      title: 'Couldn’t save the picture',
                      description: e.message,
                      tone: 'danger',
                    }),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Use this picture
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One click to pick a picture from this device (files, photo library or camera), then the
 * editor. Used in Settings (all chats) and in a conversation's details (this chat only).
 */
export function ChatBackgroundControl({
  slot,
  heading,
  hint,
}: {
  slot: ChatBackgroundSlot;
  heading: string;
  hint: string;
}) {
  const { policy, effective } = useChatTheme();
  const themeStyle = useChatThemeStyle(effective);
  const { background, save, remove } = useChatBackgroundSlot(slot);
  const { toast } = useToast();
  const input = React.useRef<HTMLInputElement>(null);
  const [editing, setEditing] = React.useState<{
    image: Blob;
    adjust: ChatBackgroundAdjust;
  } | null>(null);
  const [over, setOver] = React.useState(false);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/') && file.type !== '') {
      toast({
        title: 'That isn’t a picture',
        description: 'Choose a JPEG, PNG or WebP picture.',
        tone: 'danger',
      });
      return;
    }
    try {
      const image = await prepareChatBackground(file);
      setEditing({ image, adjust: DEFAULT_CHAT_BACKGROUND_ADJUST });
    } catch (e) {
      toast({
        title: 'Couldn’t open the picture',
        description: (e as Error).message,
        tone: 'danger',
      });
    }
  };

  if (!customImagesAllowed(policy)) {
    return (
      <p className="text-meta text-text-subtle" data-testid="chat-bg-off">
        Your organization has turned off personal background pictures.
      </p>
    );
  }

  const inScope = slot === 'all' ? 'all' : 'conversation';
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-lg border p-3 transition-colors',
        over ? 'border-accent bg-accent-soft' : 'border-border',
      )}
      data-chat-bg-control={inScope}
      onDragOver={(e) => {
        if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void pickFile(e.dataTransfer.files[0]);
      }}
    >
      <span
        className="relative h-12 w-[72px] shrink-0 overflow-hidden rounded-md border border-border"
        style={themeStyle}
      >
        {background ? (
          <>
            <ChatBackdrop url={background.url} adjust={background.adjust} scale={0.08} />
          </>
        ) : (
          <span className="flex size-full items-center justify-center text-text-subtle">
            <ImagePlus className="size-5" aria-hidden />
          </span>
        )}
      </span>
      <span className="min-w-[9rem] flex-1">
        <span className="block text-label text-text">{heading}</span>
        <span className="block text-meta text-text-subtle">
          {background ? 'Your picture, kept on this device.' : hint}
        </span>
      </span>
      <span className="flex flex-wrap gap-2">
        {background ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setEditing({ image: background.image, adjust: background.adjust })}
            >
              Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => input.current?.click()}>
              Change
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void remove()}>
              Remove
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={() => input.current?.click()}>
            <ImagePlus className="size-4" aria-hidden /> Choose a picture
          </Button>
        )}
      </span>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void pickFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {editing ? (
        <ChatBackgroundEditor
          open
          onOpenChange={(o) => !o && setEditing(null)}
          title={slot === 'all' ? 'Background for all chats' : 'Background for this chat'}
          image={editing.image}
          adjust={editing.adjust}
          onSave={save}
          onRemove={background ? remove : undefined}
        />
      ) : null}
    </div>
  );
}
