import { VideoTrack } from '@livekit/react-native';
import type { Participant, TrackPublication } from 'livekit-client';
import { StyleSheet } from 'react-native';

type TrackRef = Parameters<typeof VideoTrack>[0]['trackRef'];

/** iOS and Android: renders the camera track with the native WebRTC view. */
export function CallVideo({
  video,
  mirror,
}: {
  video: { participant: Participant; publication: TrackPublication };
  mirror?: boolean;
}) {
  const trackRef = {
    participant: video.participant,
    publication: video.publication,
    source: video.publication.source,
  } as unknown as TrackRef;
  return (
    <VideoTrack
      trackRef={trackRef}
      style={StyleSheet.absoluteFill}
      objectFit="cover"
      mirror={mirror}
    />
  );
}
