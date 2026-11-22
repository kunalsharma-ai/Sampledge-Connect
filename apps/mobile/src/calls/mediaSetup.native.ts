import { AudioSession, registerGlobals } from '@livekit/react-native';
import type { Room } from 'livekit-client';
import { Platform } from 'react-native';
import { outputLabel, type AudioOutput } from '../lib/audioRoute';

let registered = false;

/** Installs the WebRTC globals livekit-client needs on iOS and Android (needs a dev build). */
export function setupCallMedia(): void {
  if (registered) return;
  registered = true;
  registerGlobals();
}

export async function startCallAudio(): Promise<void> {
  await AudioSession.startAudioSession();
}

export async function stopCallAudio(): Promise<void> {
  await AudioSession.stopAudioSession();
}

/**
 * Where the call can play. Android lists speaker, earpiece, headset and Bluetooth as they are
 * connected; iOS offers the phone (or a connected headset) and the speaker, plus the system
 * route picker for AirPlay and Bluetooth.
 */
export async function listAudioOutputs(): Promise<AudioOutput[]> {
  const ids = await AudioSession.getAudioOutputs().catch(() => [] as string[]);
  return ids.map((id) => ({ id, label: outputLabel(id) }));
}

export async function selectAudioOutput(_room: Room | null, id: string): Promise<void> {
  await AudioSession.selectAudioOutput(id);
}

export const hasRoutePicker = Platform.OS === 'ios';
export async function showRoutePicker(): Promise<void> {
  await AudioSession.showAudioRoutePicker();
}
