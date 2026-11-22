import type { Room } from 'livekit-client';
import { useState } from 'react';
import { cameraEffectsAvailable } from '../../modules/camera-effects';
import { useCallBackground } from '../state/useCallBackground';
import { SvgLogoSnapshot } from './SvgLogoSnapshot';
import { useCameraEffects } from './useCameraEffects';

/** Puts my call background and look on this phone's camera for the call in `room`. */
export function CameraEffects({ room }: { room: Room | null }) {
  const state = useCallBackground();
  const [svgLogoPng, setSvgLogoPng] = useState<string | null>(null);
  useCameraEffects(room, state, svgLogoPng);
  if (!state || state.effective.kind !== 'logo' || !cameraEffectsAvailable()) return null;
  return <SvgLogoSnapshot logo={state.brand.logo} onReady={setSvgLogoPng} />;
}
