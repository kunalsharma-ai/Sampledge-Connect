import { Ionicons } from '@expo/vector-icons';
import { formatClipDuration, type RecordingKind } from '@sampledge/contracts';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWorkspace } from '../state/AppProvider';
import { alpha, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

/** Where a clip's bytes are: the local copy while it waits to upload, else a signed link. */
export interface ClipSource {
  attachmentId: string | null;
  localUri: string | null;
}

// Signed links are valid for ten minutes; reuse them for a little less.
const urlCache = new Map<string, { url: string; until: number }>();

export function useClipUrl() {
  const { engine } = useWorkspace();
  return async (src: ClipSource): Promise<string | null> => {
    if (src.localUri) return src.localUri;
    if (!src.attachmentId) return null;
    const hit = urlCache.get(src.attachmentId);
    if (hit && hit.until > Date.now()) return hit.url;
    const url = await engine.attachmentUrl(src.attachmentId);
    urlCache.set(src.attachmentId, { url, until: Date.now() + 8 * 60_000 });
    return url;
  };
}

export const RECORDING_LABEL: Record<RecordingKind, string> = {
  voice: 'Voice message',
  video: 'Video message',
  screen: 'Screen recording',
  call: 'Call recording',
};

/** Only one clip plays at a time: starting one pauses the last. */
let pauseCurrent: (() => void) | null = null;

/**
 * Inline audio player (voice messages, audio-only call recordings). The link is fetched on
 * first play, so a list of voice messages costs nothing until one is played.
 */
export function AudioClip({
  source,
  durationMs,
  own,
  label,
}: {
  source: ClipSource;
  durationMs: number | null;
  own: boolean;
  label: string;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const getUrl = useClipUrl();
  const [uri, setUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wantPlay = useRef(false);
  const player = useAudioPlayer(uri ? { uri } : null, { updateInterval: 200 });
  const status = useAudioPlayerStatus(player);
  const fg = own ? c.bubbleOwnText : c.text;
  const total = status.duration > 0 ? status.duration * 1000 : (durationMs ?? 0);
  const at = status.currentTime * 1000;
  const progress = total > 0 ? Math.min(1, at / total) : 0;

  const playerRef = useRef(player);
  playerRef.current = player;
  const pause = useRef(() => playerRef.current.pause()).current;
  useEffect(() => {
    if (uri && status.isLoaded && wantPlay.current) {
      wantPlay.current = false;
      setLoading(false);
      void setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
      pauseCurrent?.();
      pauseCurrent = pause;
      player.play();
    }
  }, [uri, status.isLoaded]);
  useEffect(() => {
    if (status.didJustFinish) {
      player.pause();
      void player.seekTo(0);
    }
  }, [status.didJustFinish]);
  useEffect(
    () => () => {
      if (pauseCurrent === pause) pauseCurrent = null;
    },
    [],
  );

  const toggle = async () => {
    setError(null);
    if (status.playing) return player.pause();
    if (uri) {
      pauseCurrent?.();
      pauseCurrent = pause;
      return player.play();
    }
    setLoading(true);
    try {
      const u = await getUrl(source);
      if (!u) throw new Error('missing');
      wantPlay.current = true;
      setUri(u);
    } catch {
      setLoading(false);
      setError('Plays when online');
    }
  };

  return (
    <View
      style={[
        styles.audio,
        { backgroundColor: alpha(own ? '#000000' : c.accent, own ? 0.14 : 0.08) },
      ]}
    >
      <Pressable
        onPress={() => void toggle()}
        accessibilityRole="button"
        accessibilityLabel={`${status.playing ? 'Pause' : 'Play'} ${label}, ${formatClipDuration(total)}`}
        style={[styles.play, { backgroundColor: own ? alpha('#ffffff', 0.22) : c.accent }]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={own ? fg : c.onAccent} />
        ) : (
          <Ionicons
            name={status.playing ? 'pause' : 'play'}
            size={18}
            color={own ? fg : c.onAccent}
            style={status.playing ? undefined : { marginLeft: 2 }}
          />
        )}
      </Pressable>
      <View style={{ flex: 1, gap: 6 }}>
        <View style={[styles.track, { backgroundColor: alpha(fg, 0.18) }]}>
          <View
            style={[
              styles.fill,
              { width: `${progress * 100}%`, backgroundColor: own ? fg : c.accent },
            ]}
          />
        </View>
        <Text variant="meta" style={{ color: fg, opacity: 0.8 }}>
          {error ??
            (status.playing || at > 0
              ? `${formatClipDuration(at)} / ${formatClipDuration(total)}`
              : `${label} · ${formatClipDuration(total)}`)}
        </Text>
      </View>
      <Ionicons
        name={label === RECORDING_LABEL.voice ? 'mic' : 'recording-outline'}
        size={16}
        color={alpha(fg, 0.6)}
      />
    </View>
  );
}

/** A video clip in the timeline: a tile that opens the player. */
export function VideoClip({
  source,
  durationMs,
  label,
}: {
  source: ClipSource;
  durationMs: number | null;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Play ${label}${durationMs ? `, ${formatClipDuration(durationMs)}` : ''}`}
        style={({ pressed }) => [styles.tile, { opacity: pressed ? 0.85 : 1 }]}
      >
        <View style={styles.tileIcon}>
          <Ionicons name="play" size={26} color="#ffffff" style={{ marginLeft: 3 }} />
        </View>
        <View style={styles.tileFoot}>
          <Ionicons
            name={label === RECORDING_LABEL.screen ? 'desktop-outline' : 'videocam'}
            size={13}
            color="#ffffff"
          />
          <Text variant="meta" style={{ color: '#ffffff', flex: 1 }} numberOfLines={1}>
            {label}
          </Text>
          {durationMs ? (
            <Text variant="meta" style={{ color: '#ffffff' }}>
              {formatClipDuration(durationMs)}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {open ? (
        <ClipPlayerModal source={source} title={label} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

/** Full-screen player for video clips and call recordings. */
export function ClipPlayerModal({
  source,
  title,
  onClose,
}: {
  source: ClipSource;
  title: string;
  onClose: () => void;
}) {
  const getUrl = useClipUrl();
  const insets = useSafeAreaInsets();
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getUrl(source)
      .then((u) => alive && (u ? setUri(u) : setError('This clip is not available.')))
      .catch(() => alive && setError('Connect to play this recording.'));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <Modal
      visible
      animationType="fade"
      onRequestClose={onClose}
      supportedOrientations={['portrait', 'landscape']}
    >
      <View style={[styles.modal, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.modalHead}>
          <Text variant="bodyStrong" style={{ color: '#ffffff', flex: 1 }} numberOfLines={1}>
            {title}
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close player"
            hitSlop={10}
          >
            <Ionicons name="close" size={26} color="#ffffff" />
          </Pressable>
        </View>
        <View style={styles.modalBody}>
          {uri ? (
            <VideoSurface uri={uri} />
          ) : error ? (
            <Text variant="body" style={{ color: '#ffffff' }}>
              {error}
            </Text>
          ) : (
            <ActivityIndicator color="#ffffff" />
          )}
        </View>
      </View>
    </Modal>
  );
}

function VideoSurface({ uri }: { uri: string }) {
  const player = useVideoPlayer({ uri });
  // Start once the source is ready (calling play() earlier is ignored on the web).
  useEffect(() => {
    let started = false;
    const go = () => {
      if (started) return;
      started = true;
      pauseCurrent?.();
      pauseCurrent = null;
      player.play();
    };
    if (player.status === 'readyToPlay') go();
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') go();
    });
    return () => sub.remove();
  }, [player]);
  return (
    <View style={styles.surface}>
      <VideoView
        player={player}
        style={styles.video}
        contentFit="contain"
        nativeControls
        allowsPictureInPicture
        accessibilityLabel="Video player"
      />
    </View>
  );
}

/** Shown in place of a recording someone deleted (or the retention policy removed). */
export function DeletedClip({ own, kind }: { own: boolean; kind: RecordingKind | null }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const fg = own ? c.bubbleOwnText : c.textMuted;
  return (
    <View
      style={[styles.deleted, { borderColor: alpha(fg, 0.35) }]}
      accessibilityLabel={`${kind ? RECORDING_LABEL[kind] : 'Recording'} deleted`}
    >
      <Ionicons name="trash-outline" size={14} color={fg} />
      <Text variant="meta" style={{ color: fg }}>
        {kind === 'voice' ? 'Voice message deleted' : 'Recording deleted'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  audio: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.sm,
    borderRadius: radius.md,
    minWidth: 230,
  },
  play: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
  tile: {
    width: 220,
    height: 140,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: '#0b1220',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: alpha('#ffffff', 0.2),
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileFoot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: alpha('#000000', 0.45),
  },
  modal: { flex: 1, backgroundColor: '#000000' },
  modalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  modalBody: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  surface: { flex: 1, alignSelf: 'stretch', overflow: 'hidden' },
  video: { flex: 1, width: '100%', height: '100%' },
  deleted: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
});
