import type { Participant, TrackPublication } from 'livekit-client';
import { useEffect, useRef, type ComponentRef } from 'react';
import { StyleSheet, View } from 'react-native';

/** Web preview: attaches the camera track to a <video> element inside the tile. */
export function CallVideo({
  video,
  mirror,
}: {
  video: { participant: Participant; publication: TrackPublication };
  mirror?: boolean;
}) {
  const host = useRef<ComponentRef<typeof View>>(null);
  const track = video.publication.track;
  useEffect(() => {
    const node = host.current as unknown as HTMLElement | null;
    if (!track || !node) return;
    const el = track.attach() as HTMLVideoElement;
    el.muted = true;
    el.playsInline = true;
    Object.assign(el.style, {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      transform: mirror ? 'scaleX(-1)' : '',
    });
    node.appendChild(el);
    return () => {
      track.detach(el);
      el.remove();
    };
  }, [track, mirror]);
  return <View ref={host} style={StyleSheet.absoluteFill} />;
}
