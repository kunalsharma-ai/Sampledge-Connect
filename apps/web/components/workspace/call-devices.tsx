'use client';
import * as React from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { Settings2, X } from 'lucide-react';
import { cn } from '@sampledge/ui';
import {
  blurSupported,
  followBlurPref,
  loadDevicePrefs,
  saveDevicePrefs,
  setBlur,
  type DevicePrefs,
} from '@/lib/call-devices';
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
 * In-call settings: pick the microphone, camera and speaker, and blur the background. The
 * choice is saved on this device for later calls. Used by members and guests.
 */
export function CallDeviceSettings({ room }: { room: Room }) {
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const onError = setError;
  const [devices, setDevices] = React.useState<Record<Kind, MediaDeviceInfo[]>>({
    audioinput: [],
    videoinput: [],
    audiooutput: [],
  });
  const [active, setActive] = React.useState<Partial<Record<Kind, string>>>({});
  const [prefs, setPrefs] = React.useState<DevicePrefs>({});
  const [canBlur, setCanBlur] = React.useState<boolean | null>(null);
  const [blurBusy, setBlurBusy] = React.useState(false);
  const [camOn, setCamOn] = React.useState(room.localParticipant.isCameraEnabled);
  const report = (e: unknown) =>
    setError(e instanceof Error ? e.message : 'That device could not be switched.');

  React.useEffect(() => {
    setPrefs(loadDevicePrefs());
    void blurSupported().then(setCanBlur);
    return followBlurPref(room, () => setError('Background blur could not start on this device.'));
  }, [room]);

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
      // A new camera device gets a fresh track; keep the blur on it.
      if (kind === 'videoinput' && prefs.blur) await setBlur(room, true);
    } catch (e) {
      report(e);
    }
  };

  const toggleBlur = async () => {
    const on = !prefs.blur;
    setError(null);
    update({ ...prefs, blur: on });
    setBlurBusy(true);
    try {
      await setBlur(room, on);
    } catch {
      update({ ...prefs, blur: false });
      onError('Background blur could not start on this device.');
    } finally {
      setBlurBusy(false);
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
          className="absolute bottom-14 left-1/2 z-20 w-[min(340px,calc(100vw-2rem))] -translate-x-1/2 space-y-3 rounded-xl border border-white/15 bg-[#0d1424]/95 p-4 text-left shadow-2xl backdrop-blur"
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
          <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <div>
              <p className="text-label text-white">Blur my background</p>
              <p className="text-meta text-white/60">
                {canBlur === false
                  ? 'Not supported in this browser.'
                  : !camOn
                    ? 'Applies when your camera is on.'
                    : 'Runs on this device, not on a server.'}
              </p>
            </div>
            <button
              role="switch"
              aria-checked={!!prefs.blur}
              aria-label="Blur my background"
              disabled={canBlur === false || blurBusy}
              onClick={() => void toggleBlur()}
              className={cn(
                'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40',
                prefs.blur ? 'bg-accent' : 'bg-white/20',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 size-5 rounded-full bg-white transition-transform',
                  prefs.blur ? 'translate-x-5' : 'translate-x-0.5',
                )}
              />
            </button>
          </div>
          {error ? <p className="text-meta text-[#ff8a8a]">{error}</p> : null}
          {camera?.track?.getProcessor() ? (
            <p className="text-meta text-white/50" data-testid="blur-active">
              Background blur is on.
            </p>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
