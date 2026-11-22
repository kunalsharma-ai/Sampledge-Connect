'use client';
import * as React from 'react';
import { RotateCcw, Wand2 } from 'lucide-react';
import { cn } from '@sampledge/ui';
import {
  CALL_APPEARANCE_ENHANCE,
  CALL_LOOK_FILTERS,
  DEFAULT_CALL_APPEARANCE,
  isNeutralAppearance,
  usesFaceShaping,
  type CallAppearance,
} from '@sampledge/contracts';
import type { Room } from 'livekit-client';
import { useFaceStatus } from '@/lib/call-backgrounds';
import { lookParams } from '@/lib/camera-look';

type Key = Exclude<keyof CallAppearance, 'filter'>;
const GROUPS: {
  title: string;
  note?: string;
  sliders: { key: Key; label: string; min: number }[];
}[] = [
  {
    title: 'Light and colour',
    sliders: [
      { key: 'brightness', label: 'Brightness', min: -100 },
      { key: 'contrast', label: 'Contrast', min: -100 },
      { key: 'saturation', label: 'Colour', min: -100 },
      { key: 'warmth', label: 'Warmth', min: -100 },
      { key: 'lowLight', label: 'Low light', min: 0 },
    ],
  },
  {
    title: 'Touch-up',
    sliders: [
      { key: 'smoothing', label: 'Smooth skin', min: 0 },
      { key: 'sharpness', label: 'Sharpness', min: 0 },
    ],
  },
  {
    title: 'Face shaping',
    note: 'Finds your face on this device; nothing is sent anywhere.',
    sliders: [
      { key: 'faceSlim', label: 'Slim face', min: 0 },
      { key: 'eyes', label: 'Bigger eyes', min: 0 },
      { key: 'nose', label: 'Slimmer nose', min: 0 },
    ],
  },
];

/** A CSS approximation of a look, for the little swatches. */
function swatchFilter(id: CallAppearance['filter']) {
  const p = lookParams({ ...DEFAULT_CALL_APPEARANCE, filter: id });
  return [
    `brightness(${1 + p.brightness * 0.6})`,
    `contrast(${1 + p.contrast * 0.6})`,
    `saturate(${1 + p.saturation})`,
    `grayscale(${p.grayscale})`,
    `sepia(${Math.max(p.sepia, Math.max(0, p.warmth) * 0.5)})`,
    p.warmth < 0 ? `hue-rotate(${p.warmth * 30}deg)` : '',
  ].join(' ');
}

/**
 * How I look on camera: a one-tap look, then sliders for light, colour, touch-up and face
 * shaping. Changes show on my video straight away and follow me to my other devices.
 */
const FACE_TEXT = {
  off: '',
  loading: 'Getting face shaping ready…',
  unavailable: 'Face shaping isn’t available on this device.',
  searching: 'Looking for your face…',
  found: 'Face found.',
} as const;

export function AppearancePicker({
  room,
  appearance,
  onChange,
  supported,
  camOn,
}: {
  room: Room | null;
  appearance: CallAppearance;
  onChange: (patch: Partial<CallAppearance>) => void;
  supported: boolean | null;
  camOn: boolean;
}) {
  const off = supported === false;
  const face = useFaceStatus(room, camOn && usesFaceShaping(appearance));
  return (
    <section aria-label="Appearance" className="space-y-3" data-testid="appearance-picker">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-label text-white">Appearance</p>
        <p className="text-meta text-white/50">
          {off
            ? 'Not supported in this browser.'
            : !camOn
              ? 'Applies when your camera is on.'
              : 'Runs on this device, not on a server.'}
        </p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={off}
          data-testid="appearance-enhance"
          onClick={() => onChange(CALL_APPEARANCE_ENHANCE)}
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-meta font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          <Wand2 className="size-3.5" /> Enhance
        </button>
        <button
          type="button"
          disabled={off || isNeutralAppearance(appearance)}
          data-testid="appearance-reset"
          onClick={() => onChange(DEFAULT_CALL_APPEARANCE)}
          className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-white/15 px-3 text-meta text-white/80 hover:bg-white/10 disabled:opacity-40"
        >
          <RotateCcw className="size-3.5" /> Reset
        </button>
      </div>

      <div>
        <p className="pb-1.5 text-meta font-medium uppercase tracking-wide text-white/50">Looks</p>
        <div className="grid grid-cols-5 gap-1.5">
          {CALL_LOOK_FILTERS.map((f) => {
            const on = appearance.filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={on}
                aria-label={f.name}
                title={f.name}
                disabled={off}
                data-testid={`look-${f.id}`}
                onClick={() => onChange({ filter: f.id })}
                className={cn(
                  'group flex flex-col items-center gap-1 rounded-md p-1 text-[11px] leading-tight text-white/75 disabled:opacity-40',
                  on ? 'bg-white/10 text-white' : 'hover:bg-white/5',
                )}
              >
                <span
                  className={cn(
                    'block size-10 rounded-full border-2 bg-[radial-gradient(circle_at_50%_38%,#f1c7a6_0,#d99a74_28%,#6b4a3a_29%,#2f4f6f_60%,#9fb7c9_100%)]',
                    on ? 'border-accent' : 'border-white/15',
                  )}
                  style={{ filter: swatchFilter(f.id) }}
                />
                <span className="w-full truncate text-center">{f.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {GROUPS.map((g) => (
        <div key={g.title} className="space-y-1.5">
          <p className="text-meta font-medium uppercase tracking-wide text-white/50">{g.title}</p>
          {g.note ? <p className="text-meta text-white/45">{g.note}</p> : null}
          {g.title === 'Face shaping' && face !== 'off' ? (
            <p
              className={cn('text-meta', face === 'found' ? 'text-emerald-300' : 'text-white/60')}
              data-testid="face-status"
              data-status={face}
            >
              {FACE_TEXT[face]}
            </p>
          ) : null}
          {g.sliders.map((s) => {
            const v = appearance[s.key];
            const id = `look-${s.key}`;
            return (
              <div key={s.key} className="grid grid-cols-[6.5rem_1fr_2.25rem] items-center gap-2">
                <label htmlFor={id} className="text-meta text-white/75">
                  {s.label}
                </label>
                <input
                  id={id}
                  type="range"
                  min={s.min}
                  max={100}
                  step={1}
                  value={v}
                  disabled={off}
                  data-testid={id}
                  onChange={(e) => onChange({ [s.key]: Number(e.target.value) })}
                  onDoubleClick={() => onChange({ [s.key]: 0 })}
                  className="h-1.5 w-full cursor-pointer accent-accent disabled:cursor-not-allowed"
                />
                <span className="text-right text-meta tabular-nums text-white/60">
                  {v > 0 && s.min < 0 ? `+${v}` : v}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}
