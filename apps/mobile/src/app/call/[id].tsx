import { Ionicons } from '@expo/vector-icons';
import { guestIdentity, isGuestIdentity } from '@sampledge/contracts';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { CameraEffects } from '../../calls/CameraEffects';
import { useCallMedia, type CallTile } from '../../calls/useCallMedia';
import { useLiveCaptions } from '../../calls/useLiveCaptions';
import { Avatar, PersonAvatar } from '../../components/Avatar';
import { Text } from '../../components/Text';
import type { LocalConversation } from '../../db/store';
import { outputIcon, outputLabel } from '../../lib/audioRoute';
import { captionsNotice } from '../../lib/captions';
import { guestLabel } from '../../lib/guests';
import { formatDuration } from '../../lib/systemMessages';
import { useWorkspace } from '../../state/AppProvider';
import { conversationTitle, useCalls, useConversations, usePeople } from '../../state/hooks';
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
  const { current, config, error: callError } = useCalls();
  const [recBusy, setRecBusy] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [audioOpen, setAudioOpen] = useState(false);
  const { conversations } = useConversations();
  const lobbySeen = useRef(new Set<string>());
  const call = current?.call.callId === id ? current : null;
  const [conv, setConv] = useState<LocalConversation | undefined>();
  const [now, setNow] = useState(Date.now());
  const leaving = useRef(false);

  const media = useCallMedia(call?.join ?? null, call?.media ?? 'audio', {
    onTokenExpired: () => engine.calls.rejoin(),
  });
  const captions = useLiveCaptions(media.room, {
    enabled: !!config?.captionsEnabled,
    myName: nameOf(selfId, { asWritten: true }),
    transcribe: (clip) => engine.calls.transcribeCaption(clip),
  });

  useEffect(() => {
    if (call) void store.getConversation(call.call.conversationId).then(setConv);
  }, [store, call?.call.conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The call ended, or you left it from elsewhere: close the screen. If the chat is open on
  // top, wait until this screen is showing again, so the chat isn't the one that closes.
  const navigation = useNavigation();
  const close = useCallback(() => {
    if (engine.calls.state.current?.call.callId === id) return;
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [engine, id]);
  useEffect(() => {
    if (!call && navigation.isFocused()) close();
  }, [call, navigation, close]);
  useFocusEffect(close);

  // Leaving the screen any other way (system back) leaves the call.
  useEffect(
    () => () => {
      if (!leaving.current && engine.calls.state.current?.call.callId === id)
        void engine.calls.leave();
    },
    [engine, id],
  );

  // Someone new is waiting in the lobby: a nudge, since they can't get in until someone answers.
  const lobby = call?.call.lobby ?? [];
  useEffect(() => {
    const fresh = lobby.filter((g) => !lobbySeen.current.has(g.guestId));
    fresh.forEach((g) => lobbySeen.current.add(g.guestId));
    if (fresh.length) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, [lobby.map((g) => g.guestId).join()]); // eslint-disable-line react-hooks/exhaustive-deps

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
  /** Members by name; guests as "Name (guest)" so nobody mistakes them for colleagues. */
  const who = (id: string) => {
    if (!isGuestIdentity(id)) return nameOf(id);
    const g = call.call.guests?.find((x) => guestIdentity(x.guestId) === id);
    return guestLabel(g?.name ?? 'Guest');
  };
  const chatUnread =
    conversations.find((x) => x.conversationId === call.call.conversationId)?.unread ?? 0;
  // The chat opens on top; the call keeps running underneath and "Back to call" returns here.
  const openChat = () =>
    router.push({ pathname: '/conversation/[id]', params: { id: call.call.conversationId } });
  const decide = async (guestId: string, decision: 'admit' | 'deny') => {
    setDeciding(`${decision}:${guestId}`);
    await engine.calls.decideGuest(guestId, decision);
    setDeciding(null);
  };
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
  const rec = call.call.recording ?? null;
  const recLabel = !rec
    ? null
    : rec.status === 'starting'
      ? 'Starting recording…'
      : rec.status === 'stopping'
        ? 'Saving recording…'
        : `Recording · ${formatDuration((now - new Date(rec.startedAt).getTime()) / 1000)}`;
  const toggleRecording = async () => {
    if (recBusy) return;
    setRecBusy(true);
    await engine.calls.setRecording(!rec);
    setRecBusy(false);
  };

  const leave = async (forAll = false) => {
    leaving.current = true;
    await (forAll ? engine.calls.endForAll() : engine.calls.leave());
  };

  return (
    <View style={[styles.fill, { backgroundColor: '#05070D', paddingTop: insets.top }]}>
      <CameraEffects room={media.room} />
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
        {rec ? (
          <View
            style={[styles.recPill, { backgroundColor: alpha('#EF4444', 0.18) }]}
            accessibilityRole="text"
            accessibilityLabel={`${recLabel}. Started by ${rec.startedBy === selfId ? 'you' : nameOf(rec.startedBy)}. Everyone in the call can see this.`}
            accessibilityLiveRegion="polite"
          >
            <View style={styles.recDot} />
            <Text variant="meta" style={{ color: '#FECACA' }}>
              {recLabel}
              {rec.startedBy === selfId ? '' : ` · started by ${nameOf(rec.startedBy)}`}
            </Text>
          </View>
        ) : null}
        {callError ? (
          <Pressable onPress={() => engine.calls.dismissError()} accessibilityRole="button">
            <Text variant="meta" style={{ color: '#FCA5A5', textAlign: 'center' }}>
              {callError} (tap to dismiss)
            </Text>
          </Pressable>
        ) : null}
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
            accessibilityLabel={`${t.isLocal ? 'You' : who(t.userId)}${t.ringing ? ', ringing' : ''}${t.micOn ? '' : ', muted'}${t.handUp ? ', hand raised' : ''}`}
          >
            {t.video ? (
              <CallVideo video={t.video} mirror={t.isLocal && media.facing === 'user'} />
            ) : (
              <View style={styles.center}>
                <PersonAvatar
                  userId={t.isLocal ? selfId : t.userId}
                  name={t.isLocal ? nameOf(selfId, { asWritten: true }) : who(t.userId)}
                  size={cols === 1 ? 96 : 64}
                />
              </View>
            )}
            <View style={styles.nameTag}>
              {!t.micOn && !t.ringing ? (
                <Ionicons name="mic-off" size={12} color="#FCA5A5" />
              ) : null}
              <Text variant="meta" numberOfLines={1} style={{ color: '#FFFFFF', flexShrink: 1 }}>
                {t.isLocal ? 'You' : who(t.userId)}
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
      {lobby.length ? (
        <View
          style={[styles.lobby, { borderColor: alpha(c.warning, 0.5) }]}
          accessibilityLabel={`${lobby.length} waiting in the lobby`}
          accessibilityLiveRegion="polite"
        >
          <Text variant="label" style={{ color: '#FDE68A' }}>
            Waiting in the lobby · {lobby.length}
          </Text>
          {lobby.map((g) => (
            <View key={g.guestId} style={styles.lobbyRow}>
              <Avatar name={g.name} size={34} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="bodyStrong" numberOfLines={1} style={{ color: '#FFFFFF' }}>
                  {g.name}
                </Text>
                <Text variant="meta" numberOfLines={1} style={{ color: 'rgba(255,255,255,0.65)' }}>
                  Guest from outside · {g.email}
                </Text>
              </View>
              <Pressable
                onPress={() => void decide(g.guestId, 'deny')}
                disabled={!!deciding}
                accessibilityRole="button"
                accessibilityLabel={`Deny ${g.name}`}
                style={[styles.lobbyBtn, { backgroundColor: alpha('#FFFFFF', 0.14) }]}
              >
                <Text variant="label" style={{ color: '#FFFFFF' }}>
                  {deciding === `deny:${g.guestId}` ? '…' : 'Deny'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void decide(g.guestId, 'admit')}
                disabled={!!deciding}
                accessibilityRole="button"
                accessibilityLabel={`Admit ${g.name}`}
                style={[styles.lobbyBtn, { backgroundColor: c.accent }]}
              >
                <Text variant="label" style={{ color: c.onAccent }}>
                  {deciding === `admit:${g.guestId}` ? '…' : 'Admit'}
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {audioOpen ? (
        <View
          style={[styles.lobby, { borderColor: alpha('#FFFFFF', 0.18) }]}
          accessibilityLabel="Audio output"
        >
          <Text variant="label" style={{ color: '#FFFFFF' }}>
            Play the call through
          </Text>
          {media.outputs.map((o) => {
            const on = media.output === o.id;
            return (
              <Pressable
                key={o.id}
                onPress={() => {
                  void media.chooseOutput(o.id);
                  setAudioOpen(false);
                }}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={o.label}
                style={styles.lobbyRow}
              >
                <Ionicons name={outputIcon(o.id)} size={20} color="#FFFFFF" />
                <Text variant="bodyStrong" style={{ flex: 1, color: '#FFFFFF' }}>
                  {o.label}
                </Text>
                {on ? <Ionicons name="checkmark" size={20} color="#86EFAC" /> : null}
              </Pressable>
            );
          })}
          {!media.outputs.length ? (
            <Text variant="meta" style={{ color: 'rgba(255,255,255,0.7)' }}>
              Only this device's own speaker is available.
            </Text>
          ) : null}
          {media.hasRoutePicker ? (
            <Pressable
              onPress={() => {
                void media.showRoutePicker();
                setAudioOpen(false);
              }}
              accessibilityRole="button"
              style={styles.lobbyRow}
            >
              <Ionicons name="bluetooth" size={20} color="#FFFFFF" />
              <Text variant="bodyStrong" style={{ flex: 1, color: '#FFFFFF' }}>
                Bluetooth, AirPlay and more…
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {captions.on || captions.active ? (
        <View style={styles.captions} pointerEvents="none">
          {captions.on
            ? captions.lines.map((l) => (
                <Text
                  key={l.id}
                  testID="caption-line"
                  style={[styles.captionLine, { color: '#FFFFFF' }]}
                  accessibilityLiveRegion="polite"
                >
                  <Text variant="bodyStrong" style={{ color: 'rgba(255,255,255,0.8)' }}>
                    {l.name}:{' '}
                  </Text>
                  {l.text}
                </Text>
              ))
            : null}
          <Text variant="meta" style={styles.captionNotice} testID="captions-notice">
            {captionsNotice({
              on: captions.on,
              lines: captions.lines.length,
              error: captions.error,
              canSend: captions.canSend,
            })}
          </Text>
        </View>
      ) : null}
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
        {media.camOn ? (
          <Control icon="camera-reverse" label="Flip" onPress={() => void media.flipCamera()} />
        ) : null}
        <Control
          icon={media.output ? outputIcon(media.output) : 'volume-high'}
          label={media.output ? outputLabel(media.output) : 'Audio'}
          active={audioOpen}
          onPress={() => {
            void media.refreshOutputs();
            setAudioOpen((o) => !o);
          }}
        />
        <Control
          icon="hand-left"
          label={media.handUp ? 'Lower hand' : 'Raise hand'}
          active={media.handUp}
          onPress={() => void media.toggleHand()}
        />
        {config?.captionsEnabled ? (
          <Control
            icon={captions.on ? 'text' : 'text-outline'}
            label={captions.on ? 'Captions off' : 'Captions'}
            active={captions.on}
            onPress={() => captions.setOn(!captions.on)}
          />
        ) : null}
        {config?.recordingEnabled ? (
          <Control
            icon={rec ? 'stop' : 'radio-button-on'}
            label={rec ? 'Stop rec' : 'Record'}
            active={!!rec}
            disabled={recBusy || rec?.status === 'stopping'}
            onPress={() => void toggleRecording()}
          />
        ) : null}
        <Control
          icon="chatbubble-ellipses"
          label={chatUnread ? `Chat · ${chatUnread}` : 'Chat'}
          active={chatUnread > 0}
          onPress={openChat}
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
    disabled,
  }: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
    active?: boolean;
    danger?: boolean;
    disabled?: boolean;
  }) {
    return (
      <View style={{ alignItems: 'center', gap: 6, width: 64 }}>
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ selected: !!active, disabled: !!disabled }}
          disabled={disabled}
          style={({ pressed }) => [
            styles.ctl,
            {
              opacity: disabled ? 0.5 : 1,
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
            color={
              danger
                ? '#FFFFFF'
                : icon === 'radio-button-on'
                  ? '#F87171'
                  : active
                    ? icon === 'stop'
                      ? '#DC2626'
                      : '#05070D'
                    : '#FFFFFF'
            }
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
  captions: { alignItems: 'center', gap: 6, paddingHorizontal: space.md, paddingBottom: space.sm },
  captionLine: {
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    textAlign: 'center',
    overflow: 'hidden',
  },
  captionNotice: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    color: 'rgba(255,255,255,0.8)',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 2,
    overflow: 'hidden',
    textAlign: 'center',
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
  lobby: {
    marginHorizontal: space.md,
    padding: space.md,
    gap: space.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    backgroundColor: 'rgba(17,24,39,0.96)',
  },
  lobbyRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  lobbyBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill },
  recPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444' },
  controls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: space.md,
    paddingTop: space.lg,
    paddingHorizontal: space.md,
  },
  ctl: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
});
