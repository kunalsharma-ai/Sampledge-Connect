import type { CallBackgroundState } from '@sampledge/contracts';
import {
  LocalVideoTrack,
  RoomEvent,
  Track,
  TrackEvent,
  type LocalTrackPublication,
  type Room,
} from 'livekit-client';
import { useEffect, useState } from 'react';
import {
  CAMERA_EFFECTS_PROCESSOR,
  cameraEffectsAvailable,
  setNativeCameraEffects,
} from '../../modules/camera-effects';
import { effectPictures } from './cameraEffectPictures';
import { nativeEffectsOff, nativeEffectsOptions, type NativeEffectsOptions } from './cameraEffects';

/** The native camera track (@livekit/react-native-webrtc) has a frame-processor hook. */
type EffectTrack = { _setVideoEffects?: (names: string[]) => void };

/**
 * Applies my call background and look to this phone's camera while I'm in a call. The settings
 * come from my synced call background (offline copy first, changes from my other devices arrive
 * live), so changing them anywhere updates the picture I'm sending within a moment.
 *
 * `svgLogoPng` is the organization's vector logo drawn to a PNG (see SvgLogoSnapshot).
 */
export function useCameraEffects(
  room: Room | null,
  state: CallBackgroundState | null,
  svgLogoPng: string | null,
) {
  const [options, setOptions] = useState<NativeEffectsOptions | null>(null);

  // Turn the settings into camera options (fetching pictures as needed).
  useEffect(() => {
    if (!state || !cameraEffectsAvailable()) return;
    let live = true;
    void effectPictures(state, svgLogoPng).then((pictures) => {
      if (live) setOptions(nativeEffectsOptions(state, pictures));
    });
    return () => {
      live = false;
    };
  }, [state, svgLogoPng]);

  // Hand them to the camera, and switch the processor on or off for the camera track. The track
  // is replaced when the camera is turned back on or flipped, so it is attached again then.
  useEffect(() => {
    if (!room || !options) return;
    setNativeCameraEffects(options);
    const wanted = !nativeEffectsOff(options);
    const attach = () => {
      const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      const track = pub?.track;
      if (!(track instanceof LocalVideoTrack)) return;
      const mst = track.mediaStreamTrack as unknown as EffectTrack | undefined;
      if (!mst?._setVideoEffects) return;
      try {
        mst._setVideoEffects(wanted ? [CAMERA_EFFECTS_PROCESSOR] : []);
      } catch {
        // The camera is between tracks; the next event attaches again.
      }
    };
    let watched: LocalVideoTrack | null = null;
    const watch = () => {
      const t = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
      if (t instanceof LocalVideoTrack && t !== watched) {
        watched?.off(TrackEvent.Restarted, attach);
        watched = t;
        t.on(TrackEvent.Restarted, attach);
      }
      attach();
    };
    const onPublished = (pub: LocalTrackPublication) => {
      if (pub.source === Track.Source.Camera) watch();
    };
    watch();
    room.on(RoomEvent.LocalTrackPublished, onPublished);
    room.on(RoomEvent.TrackUnmuted, watch);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, onPublished);
      room.off(RoomEvent.TrackUnmuted, watch);
      watched?.off(TrackEvent.Restarted, attach);
    };
  }, [room, options]);

  return { available: cameraEffectsAvailable(), options };
}
