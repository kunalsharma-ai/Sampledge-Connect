'use client';
import * as React from 'react';
import { Captions, CaptionsOff } from 'lucide-react';
import type { useLiveCaptions } from '@/lib/captions';
import { ControlButton } from './calls';

type CaptionsState = ReturnType<typeof useLiveCaptions>;

/** Turns captions on or off for me (others see that captions are being made). */
export function CaptionsButton({ state }: { state: CaptionsState }) {
  return (
    <ControlButton
      on={state.on ? true : undefined}
      label={state.on ? 'Turn captions off' : 'Turn captions on'}
      onClick={() => state.setOn(!state.on)}
    >
      {state.on ? <Captions className="text-accent" /> : <CaptionsOff />}
    </ControlButton>
  );
}

/** Live caption lines over the bottom of the call, plus the "Captions on" notice. */
export function CaptionsOverlay({
  state,
  saved = false,
}: {
  state: CaptionsState;
  saved?: boolean;
}) {
  if (!state.on && !state.active) return null;
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex flex-col items-center gap-1.5 sm:inset-x-8">
      {state.on
        ? state.lines.map((l) => (
            <p
              key={l.id}
              data-testid="caption-line"
              className="max-w-3xl rounded-lg bg-black/75 px-3 py-1.5 text-center text-body text-white shadow-lg"
            >
              <span className="font-semibold text-white/80">{l.name}: </span>
              {l.text}
            </p>
          ))
        : null}
      <span
        className="rounded-full bg-black/60 px-2.5 py-0.5 text-meta text-white/80"
        data-testid="captions-notice"
      >
        {state.error
          ? state.error
          : state.on
            ? state.lines.length
              ? 'Captions on'
              : 'Captions on · waiting for someone to speak'
            : 'Someone turned on captions: speech is transcribed by your organization’s server'}
        {!state.error && saved ? ' · saved with names for the minutes' : ''}
      </span>
    </div>
  );
}
