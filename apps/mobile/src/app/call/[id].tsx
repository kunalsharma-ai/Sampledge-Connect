import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CallVideo } from '../../calls/CallVideo';
import { useCallMedia, type CallTile } from '../../calls/useCallMedia';
import { Avatar } from '../../components/Avatar';
import { Text } from '../../components/Text';
import type { LocalConversation } from '../../db/store';
import { formatDuration } from '../../lib/systemMessages';
import { useWorkspace } from '../../state/AppProvider';
import { conversationTitle, useCalls, usePeople } from '../../state/hooks';
import { alpha, radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

/** The call you are in: people, their video, and the controls. Media goes to the self-hosted SFU. */
export default function CallScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { engine, store, selfId } = useWorkspace();
  const nameOf = usePeople();
  const { current } = useCalls();
  const call = current?.call.callId === id ? current : null;
  const [conv, setConv] = useState<LocalConversation | undefined>();
  const [now, setNow] = useState(Date.now());
  const leaving = useRef(false);

  const media = useCallMedia(call?.join ?? null, call?.media ?? 'audio', {
    onTokenExpired: () => engine.calls.rejoin(),
  });

  useEffect(() => {
    if (call) void store.getConversation(call.call.conversationId).then(setConv);
  }, [store, call?.call.conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The call ended, or you left it from elsewhere: close the screen.
  useEffect(() => {
    if (!call) {
      if (router.canGoBack()) router.back();
      else router.replace('/');
    }
  }, [call]);

  // Leaving the screen any other way (system back) leaves the call.
  useEffect(
    () => () => {
      if (!leaving.current && engine.calls.state.current?.call.callId === id)
        void engine.calls.leave();
    },
    [engine, id],
  );

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // People in the room, then people still being rung.
  const tiles = useMemo(() => {
    const inRoom = media.tiles.map((t) => ({ ...t, ringing: false }));
    const present = new Set(inRoom.map((t) => t.userId));
    if (!present.has(selfId))
      inRoom.unshift({
        userId: selfId,
        isLocal: true,
        speaking: false,
        micOn: media.micOn,
        camOn: false,
        handUp: media.handUp,
        video: null,
        ringing: false,
      });
    const ringing = (call?.call.participants ?? [])
      .filter((p) => p.state === 'ringing' && !present.has(p.userId) && p.userId !== selfId)
      .map((p): CallTile & { ringing: boolean } => ({
        userId: p.userId,
        isLocal: false,
        speaking: false,
        micOn: false,
        camOn: false,
        handUp: false,
        video: null,
        ringing: true,
      }));
    return [...inRoom, ...ringing];
  }, [media.tiles, media.micOn, media.handUp, call, selfId]);

  if (!call) return null;
  const title = conv ? conversationTitle(conv, nameOf, selfId) : 'Call';
  const othersJoined = call.call.participants.some(
    (p) => p.userId !== selfId && p.state === 'joined',
  );
  const status =
    media.status === 'failed'
      ? 'Could not connect audio and video'
      : media.status === 'reconnecting'
        ? 'Reconnecting…'
        : media.status === 'connecting'
          ? 'Connecting…'
          : !othersJoined
            ? 'Ringing…'
            : formatDuration((now - new Date(call.call.startedAt).getTime()) / 1000);
  const cols = tiles.length <= 1 ? 1 : tiles.length <= 4 ? 2 : 3;
  const tileW = (Math.min(width, 900) - space.md * 2 - space.sm * (cols - 1)) / cols;
  const canEnd = call.call.startedBy === selfId;

  const leave = async (forAll = false) => {
    leaving.current = true;
    await (forAll ? engine.calls.endForAll() : engine.calls.leave());
  };

  return (
    <View style={[styles.fill, { backgroundColor: '#05070D', paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text variant="heading" numberOfLines={1} style={{ color: '#FFFFFF' }}>
          {title}
        </Text>
        <Text
          variant="meta"
          style={{ color: media.status === 'failed' ? c.danger : 'rgba(255,255,255,0.7)' }}
          accessibilityLiveRegion="polite"
        >
          {call.media === 'video' ? 'Video call' : 'Voice call'} · {status}
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.grid}>
        {tiles.map((t) => (
          <View
            key={t.userId}
            style={[
              styles.tile,
              {
                width: tileW,
                height: cols === 1 ? Math.max(tileW * 0.75, 320) : tileW * 1.15,
                borderColor: t.speaking ? c.accent : 'transparent',
                backgroundColor: '#111827',
              },
            ]}
            accessibilityLabel={`${t.isLocal ? 'You' : nameOf(t.userId)}${t.ringing ? ', ringing' : ''}${t.micOn ? '' : ', muted'}${t.handUp ? ', hand raised' : ''}`}
          >
            {t.video ? (
              <CallVideo video={t.video} mirror={t.isLocal} />
            ) : (
              <View style={styles.center}>
                <Avatar
                  name={t.isLocal ? nameOf(selfId, { asWritten: true }) : nameOf(t.userId)}
                  size={cols === 1 ? 96 : 64}
                />
              </View>
            )}
            <View style={styles.nameTag}>
              {!t.micOn && !t.ringing ? (
                <Ionicons name="mic-off" size={12} color="#FCA5A5" />
              ) : null}
              <Text variant="meta" numberOfLines={1} style={{ color: '#FFFFFF', flexShrink: 1 }}>
                {t.isLocal ? 'You' : nameOf(t.userId)}
                {t.ringing ? ' · Ringing' : ''}
              </Text>
            </View>
            {t.handUp ? (
              <View style={[styles.hand, { backgroundColor: c.warning }]}>
                <Text style={{ fontSize: 16 }}>✋</Text>
              </View>
            ) : null}
          </View>
        ))}
        {media.error ? (
          <Text variant="meta" style={{ color: '#FCA5A5', textAlign: 'center', width: '100%' }}>
            {media.error}
            {Platform.OS === 'web' ? ' (the web preview needs a camera and microphone)' : ''}
          </Text>
        ) : null}
      </ScrollView>
      <View style={[styles.controls, { paddingBottom: insets.bottom + space.lg }]}>
        <Control
          icon={media.micOn ? 'mic' : 'mic-off'}
          label={media.micOn ? 'Mute' : 'Unmute'}
          active={!media.micOn}
          onPress={() => void media.toggleMic()}
        />
        <Control
          icon={media.camOn ? 'videocam' : 'videocam-off'}
          label={media.camOn ? 'Camera off' : 'Camera on'}
          active={!media.camOn}
          onPress={() => void media.toggleCamera()}
        />
        <Control
          icon="hand-left"
          label={media.handUp ? 'Lower hand' : 'Raise hand'}
          active={media.handUp}
          onPress={() => void media.toggleHand()}
        />
        <Control icon="call" label="Leave" danger onPress={() => void leave()} />
        {canEnd ? (
          <Control icon="stop-circle" label="End for all" danger onPress={() => void leave(true)} />
        ) : null}
      </View>
    </View>
  );

  function Control({
    icon,
    label,
    onPress,
    active,
    danger,
  }: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
    active?: boolean;
    danger?: boolean;
  }) {
    return (
      <View style={{ alignItems: 'center', gap: 6, width: 64 }}>
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ selected: !!active }}
          style={({ pressed }) => [
            styles.ctl,
            {
              backgroundColor: danger
                ? c.danger
                : active
                  ? '#FFFFFF'
                  : alpha('#FFFFFF', pressed ? 0.24 : 0.14),
            },
          ]}
        >
          <Ionicons
            name={icon}
            size={24}
            color={danger ? '#FFFFFF' : active ? '#05070D' : '#FFFFFF'}
            style={icon === 'call' ? { transform: [{ rotate: '135deg' }] } : undefined}
          />
        </Pressable>
        <Text variant="meta" numberOfLines={1} style={{ color: 'rgba(255,255,255,0.75)' }}>
          {label}
        </Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { alignItems: 'center', paddingVertical: space.md, paddingHorizontal: space.lg, gap: 2 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    padding: space.md,
    justifyContent: 'center',
  },
  tile: { borderRadius: radius.lg, overflow: 'hidden', borderWidth: 3 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  nameTag: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
  },
  hand: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.md,
    paddingTop: space.lg,
    paddingHorizontal: space.md,
  },
  ctl: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
});
