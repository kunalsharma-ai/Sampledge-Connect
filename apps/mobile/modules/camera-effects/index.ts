import { requireOptionalNativeModule } from 'expo';

/**
 * The phone's own camera effects (call background and look), applied natively to every outgoing
 * camera frame: a GPU shader plus on-device person and face finding (MediaPipe on Android, Apple
 * Vision on iOS). Missing in the web preview and in app builds made before this module existed.
 */
interface CameraEffectsNative {
  processorName(): string;
  setOptions(json: string): boolean;
}

const native = requireOptionalNativeModule<CameraEffectsNative>('SampCameraEffects');

/** The name the camera track's frame processor is registered under. */
export const CAMERA_EFFECTS_PROCESSOR = 'sampconnect-camera-effects';

export const cameraEffectsAvailable = (): boolean => native != null;

/** Hands the options to the camera. False when this build has no native camera effects. */
export function setNativeCameraEffects(options: unknown): boolean {
  if (!native) return false;
  try {
    return native.setOptions(JSON.stringify(options));
  } catch {
    return false;
  }
}
