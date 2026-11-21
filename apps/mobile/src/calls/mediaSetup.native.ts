import { AudioSession, registerGlobals } from '@livekit/react-native';

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
