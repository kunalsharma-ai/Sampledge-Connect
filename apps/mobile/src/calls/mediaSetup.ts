import type { Room } from 'livekit-client';
import type { AudioOutput } from '../lib/audioRoute';

/** Web preview: browsers have WebRTC built in, so there is nothing to set up. */
export function setupCallMedia(): void {}
export async function startCallAudio(): Promise<void> {}
export async function stopCallAudio(): Promise<void> {}

/** Speakers and headsets the browser can play the call through. */
export async function listAudioOutputs(): Promise<AudioOutput[]> {
  const devices = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []);
  return (devices ?? [])
    .filter((d) => d.kind === 'audiooutput')
    .map((d, i) => ({
      id: d.deviceId,
      label: d.label || (i === 0 ? 'Default' : `Speaker ${i + 1}`),
    }));
}

export async function selectAudioOutput(room: Room | null, id: string): Promise<void> {
  await room?.switchActiveDevice('audiooutput', id);
}

/** The system route picker (AirPlay, Bluetooth...) exists on iPhone only. */
export const hasRoutePicker = false;
export async function showRoutePicker(): Promise<void> {}
