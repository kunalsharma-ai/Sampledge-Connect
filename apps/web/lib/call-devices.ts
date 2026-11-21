'use client';
import {
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type LocalVideoTrack,
  type Room,
  type RoomOptions,
} from 'livekit-client';

/**
 * Which microphone, camera and speaker to use in calls, and whether to blur the background.
 * Remembered on this device (each device has its own hardware), used for every call and meeting.
 */
export interface DevicePrefs {
  audioinput?: string;
  videoinput?: string;
  audiooutput?: string;
  blur?: boolean;
}

const KEY = 'sampledge.callDevices';

export function loadDevicePrefs(): DevicePrefs {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as DevicePrefs;
  } catch {
    return {};
  }
}

export function saveDevicePrefs(next: DevicePrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode: the choice lasts for this call only.
  }
}

/** Room options that start the call on the saved devices. */
export function deviceOptions(): Pick<RoomOptions, 'audioOutput'> & {
  audio: { deviceId?: string };
  video: { deviceId?: string };
} {
  const p = typeof window === 'undefined' ? {} : loadDevicePrefs();
  return {
    audio: p.audioinput ? { deviceId: p.audioinput } : {},
    video: p.videoinput ? { deviceId: p.videoinput } : {},
    ...(p.audiooutput ? { audioOutput: { deviceId: p.audiooutput } } : {}),
  };
}

/**
 * Background blur runs in the browser (MediaPipe selfie segmentation, WebGL). Its runtime and
 * model are served from this app (/vision), never a CDN.
 */
export async function blurSupported(): Promise<boolean> {
  try {
    const m = await import('@livekit/track-processors');
    return m.supportsBackgroundProcessors();
  } catch {
    return false;
  }
}

function cameraTrack(room: Room): LocalVideoTrack | null {
  const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
  return (pub?.track as LocalVideoTrack | undefined) ?? null;
}

export async function setBlur(room: Room, on: boolean): Promise<void> {
  const track = cameraTrack(room);
  if (!track) return;
  const current = track.getProcessor();
  if (!on) {
    if (current) await track.stopProcessor();
    return;
  }
  if (current) return;
  const { BackgroundProcessor } = await import('@livekit/track-processors');
  await track.setProcessor(
    BackgroundProcessor({
      mode: 'background-blur',
      blurRadius: 14,
      assetPaths: {
        tasksVisionFileSet: `${window.location.origin}/vision`,
        modelAssetPath: `${window.location.origin}/vision/selfie_segmenter.tflite`,
      },
    }),
  );
}

/**
 * Keeps the saved blur on the camera whenever it is turned on (the camera track is recreated
 * each time). Returns a cleanup function.
 */
export function followBlurPref(room: Room, onError?: (e: unknown) => void): () => void {
  const apply = (pub: LocalTrackPublication) => {
    if (pub.source !== Track.Source.Camera || !loadDevicePrefs().blur) return;
    setBlur(room, true).catch((e) => onError?.(e));
  };
  room.on(RoomEvent.LocalTrackPublished, apply);
  const existing = room.localParticipant.getTrackPublication(Track.Source.Camera);
  if (existing?.track) apply(existing);
  return () => {
    room.off(RoomEvent.LocalTrackPublished, apply);
  };
}
