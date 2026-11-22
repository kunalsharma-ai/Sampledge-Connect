'use client';
import type { RoomOptions } from 'livekit-client';

/**
 * Which microphone, camera and speaker to use in calls. Remembered on this device (each device
 * has its own hardware). The background is saved to the account (see call-backgrounds.ts).
 */
export interface DevicePrefs {
  audioinput?: string;
  videoinput?: string;
  audiooutput?: string;
  /** Old versions saved blur here; it is moved to the account once. */
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
 * Background effects run in the browser (MediaPipe selfie segmentation, WebGL). Its runtime and
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
