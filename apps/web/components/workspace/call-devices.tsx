'use client';
import * as React from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { Settings2, X } from 'lucide-react';
import { cn } from '@sampledge/ui';
import {
  blurSupported,
  loadDevicePrefs,
  saveDevicePrefs,
  type DevicePrefs,
} from '@/lib/call-devices';
import { useApplyBackground, type BackgroundController } from '@/lib/call-backgrounds';
import { BackgroundPicker } from './call-background-picker';
import { ControlButton } from './calls';

type Kind = 'audioinput' | 'videoinput' | 'audiooutput';
const KINDS: { kind: Kind; label: string; id: string }[] = [
  { kind: 'audioinput', label: 'Microphone', id: 'dev-mic' },
  { kind: 'videoinput', label: 'Camera', id: 'dev-cam' },
  { kind: 'audiooutput', label: 'Speaker', id: 'dev-out' },
];
const select =
  'h-10 w-full rounded-md border border-white/15 bg-black/40 px-2 text-body text-white disabled:opacity-50';

/**
 * In-call settings: pick the microphone, camera and speaker (saved on this device), and the
 * background (blur, a prebuilt image, your own image or the company logo). Members and guests.
 */
export function CallDeviceSettings({
  room,
  backgrounds,
}: {
  room: Room;
  backgrounds: BackgroundController;
}) {
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [devices, setDevices] = React.useState<Record<Kind, MediaDeviceInfo[]>>({
    audioinput: [],
    videoinput: [],
    audiooutput: [],
  });
  const [active, setActive] = React.useState<Partial<Record<Kind, string>>>({});
  const [prefs, setPrefs] = React.useState<DevicePrefs>({});
  const [canBlur, setCanBlur] = React.useState<boolean | null>(null);
  const [camOn, setCamOn] = React.useState(room.localParticipant.isCameraEnabled);
  const report = (e: unknown) =>
    setError(e instanceof Error ? e.message : 'That device could not be switched.');

  React.useEffect(() => {
    setPrefs(loadDevicePrefs());
    void blurSupported().then(setCanBlur);
  }, [room]);
  useApplyBackground(room, backgrounds, setError);

  React.useEffect(() => {
    const sync = () => setCamOn(room.localParticipant.isCameraEnabled);
    room.on(RoomEvent.LocalTrackPublished, sync);
    room.on(RoomEvent.LocalTrackUnpublished, sync);
    room.on(RoomEvent.TrackMuted, sync);
    room.on(RoomEvent.TrackUnmuted, sync);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, sync);
      room.off(RoomEvent.LocalTrackUnpublished, sync);
      room.off(RoomEvent.TrackMuted, sync);
      room.off(RoomEvent.TrackUnmuted, sync);
    };
  }, [room]);

  const refresh = React.useCallback(async () => {
    const [a, v, o] = await Promise.all(
      KINDS.map((k) => Room.getLocalDevices(k.kind, false).catch(() => [] as MediaDeviceInfo[])),
    );
    setDevices({ audioinput: a!, videoinput: v!, audiooutput: o! });
    setActive({
      audioinput: room.getActiveDevice('audioinput'),
      videoinput: room.getActiveDevice('videoinput'),
      audiooutput: room.getActiveDevice('audiooutput'),
    });
  }, [room]);

  React.useEffect(() => {
    if (!open) return;
    void refresh();
    const md = navigator.mediaDevices;
    md?.addEventListener?.('devicechange', refresh);
    return () => md?.removeEventListener?.('devicechange', refresh);
  }, [open, refresh]);

  const update = (next: DevicePrefs) => {
    setPrefs(next);
    saveDevicePrefs(next);
  };

  const pick = async (kind: Kind, deviceId: string) => {
    setError(null);
    update({ ...prefs, [kind]: deviceId });
    setActive((a) => ({ ...a, [kind]: deviceId }));
    try {
      await room.switchActiveDevice(kind, deviceId);
    } catch (e) {
      report(e);
    }
  };

  const outputs = devices.audiooutput.length > 0;
  const camera = room.localParticipant.getTrackPublication(Track.Source.Camera);

  return (
    <span className="relative">
      <ControlButton
        on={open ? true : undefined}
        label={open ? 'Close settings' : 'Devices and background'}
        onClick={() => setOpen((o) => !o)}
      >
        <Settings2 className={cn(open && 'text-accent')} />
      </ControlButton>
      {open ? (
        <div
          role="dialog"
          aria-label="Call settings"
          data-testid="call-devices"
          className="absolute bottom-14 left-1/2 z-20 max-h-[min(640px,calc(100vh-8rem))] w-[min(400px,calc(100vw-2rem))] -translate-x-1/2 space-y-3 overflow-y-auto rounded-xl border border-white/15 bg-[#0d1424]/95 p-4 text-left shadow-2xl backdrop-blur"
        >
          <div className="flex items-center justify-between">
            <p className="text-label text-white">Devices and background</p>
            <button
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="rounded-sm p-1 text-white/60 hover:bg-white/10 hover:text-white"
            >
              <X className="size-4" />
            </button>
          </div>
          {KINDS.filter((k) => k.kind !== 'audiooutput' || outputs).map((k) => {
            const list = devices[k.kind];
            const value = active[k.kind] ?? prefs[k.kind] ?? list[0]?.deviceId ?? '';
            return (
              <label key={k.kind} htmlFor={k.id} className="block space-y-1">
                <span className="text-meta text-white/70">{k.label}</span>
                <select
                  id={k.id}
                  className={select}
                  value={list.some((d) => d.deviceId === value) ? value : ''}
                  disabled={list.length === 0}
                  onChange={(e) => void pick(k.kind, e.target.value)}
                >
                  {list.length === 0 ? <option value="">None found</option> : null}
                  {list.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `${k.label} ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
          {!outputs ? (
            <p className="text-meta text-white/50">
              This browser plays sound on the system’s speaker.
            </p>
          ) : null}
          <BackgroundPicker
            ctl={backgrounds}
            supported={canBlur}
            camOn={camOn}
            onError={setError}
          />
          {error || backgrounds.error ? (
            <p className="text-meta text-[#ff8a8a]">{error ?? backgrounds.error}</p>
          ) : null}
          {camera?.track?.getProcessor() ? (
            <p className="text-meta text-white/50" data-testid="background-active">
              {backgrounds.effective.kind === 'blur'
                ? 'Background blur is on.'
                : 'Your background is on.'}
            </p>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
