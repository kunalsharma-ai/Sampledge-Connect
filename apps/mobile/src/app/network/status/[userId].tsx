import { Ionicons } from '@expo/vector-icons';
import { uuidv7, type NetworkPerson, type NetworkStatus } from '@sampledge/contracts';
import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../../../components/Avatar';
import { Empty, PersonRow, QueuedTag } from '../../../components/NetworkBits';
import { Text } from '../../../components/Text';
import { confirmThen } from '../../../lib/confirm';
import { AUDIENCE_LABEL, LOCAL_STATUS, STATUS_GRADIENT, timeLeft } from '../../../lib/network';
import { useWorkspace } from '../../../state/AppProvider';
import { useNow } from '../../../state/hooks';
import { useNet, useStatusFeed } from '../../../state/useNetwork';
import { fonts, radius, space } from '../../../theme/themes';
import { useTheme } from '../../../theme/ThemeProvider';

/**
 * One person's status updates, full screen. Tap the right side for the next one and the left
 * for the previous. Seeing one is recorded (queued offline). On yours: who viewed it, and delete.
 */
export default function StatusViewer() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const insets = useSafeAreaInsets();
  const { engine } = useWorkspace();
  const { feed, loading } = useStatusFeed();
  const now = useNow(60_000);
  const mine = userId === 'me';
  const group = mine
    ? feed && { person: feed.mine[0]?.author ?? null, statuses: feed.mine }
    : feed?.people.find((g) => g.person.userId === userId);
  const statuses = group?.statuses ?? [];
  // Start at the first one you haven't seen.
  const [index, setIndex] = useState<number | null>(null);
  useEffect(() => {
    if (index === null && statuses.length)
      setIndex(Math.max(0, mine ? 0 : statuses.findIndex((s) => !s.viewedByMe)));
  }, [index, statuses, mine]);
  const i = Math.min(index ?? 0, Math.max(0, statuses.length - 1));
  const s = statuses[i];

  const marked = useRef(new Set<string>());
  useEffect(() => {
    if (!s || mine || s.viewedByMe || marked.current.has(s.statusId)) return;
    marked.current.add(s.statusId);
    void engine.netAct({
      method: 'PUT',
      path: `/v1/network/statuses/${s.statusId}/view`,
      label: `Seeing ${s.author.displayName}’s status`,
      scopes: [],
    });
  }, [s, mine, engine]);

  const [reply, setReply] = useState('');
  const [sent, setSent] = useState(false);
  const [showViewers, setShowViewers] = useState(false);
  const [edit, setEdit] = useState<{ text: string; allowReplies: boolean } | null>(null);

  if (!s)
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        {loading ? (
          <ActivityIndicator color="#fff" style={{ marginTop: 80 }} />
        ) : (
          <Empty
            icon="radio-outline"
            title="No status right now"
            body="Status updates disappear after a while."
          />
        )}
        <Close top={insets.top} />
      </View>
    );

  const next = () => (i < statuses.length - 1 ? setIndex(i + 1) : router.back());
  const prev = () => setIndex(Math.max(0, i - 1));
  const local = s.statusId.startsWith(LOCAL_STATUS);
  const sendReply = () => {
    const text = reply.trim();
    if (!text) return;
    void engine.netAct({
      method: 'POST',
      path: `/v1/network/statuses/${s.statusId}/reply`,
      body: { clientMessageId: uuidv7(), text },
      label: `Reply to ${s.author.displayName}`,
      scopes: [],
    });
    setReply('');
    setSent(true);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.bars}>
        {statuses.map((x, n) => (
          <View
            key={x.statusId}
            style={[styles.bar, { backgroundColor: n <= i ? '#fff' : 'rgba(255,255,255,0.35)' }]}
          />
        ))}
      </View>
      <View style={styles.head}>
        <Avatar name={s.author.displayName} size={36} />
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong" style={styles.white}>
            {mine ? 'My status' : s.author.displayName}
          </Text>
          <Text variant="meta" style={styles.dim}>
            {AUDIENCE_LABEL[s.audience]} · {timeLeft(s.expiresAt, now)}
            {s.editedAt ? ' · edited' : ''}
          </Text>
        </View>
        {local ? <QueuedTag /> : null}
        <Close top={0} inline />
      </View>

      <View style={styles.stage}>
        <StatusBody s={s} />
        <Pressable
          style={[styles.tap, { left: 0 }]}
          onPress={prev}
          accessibilityRole="button"
          accessibilityLabel="Previous status"
        />
        <Pressable
          style={[styles.tap, { right: 0 }]}
          onPress={next}
          accessibilityRole="button"
          accessibilityLabel="Next status"
        />
      </View>

      {mine && edit ? (
        <View style={[styles.reply, { flexDirection: 'column', alignItems: 'stretch' }]}>
          <TextInput
            value={edit.text}
            onChangeText={(text) => setEdit({ ...edit, text })}
            maxLength={700}
            multiline
            autoFocus
            placeholder={s.kind === 'text' ? 'Your status' : 'Caption'}
            placeholderTextColor="rgba(255,255,255,0.6)"
            accessibilityLabel={s.kind === 'text' ? 'Status text' : 'Caption'}
            style={[styles.replyInput, { minHeight: 64 }]}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Text variant="label" style={[styles.white, { flex: 1 }]}>
              Let people reply
            </Text>
            <Switch
              value={edit.allowReplies}
              onValueChange={(allowReplies) => setEdit({ ...edit, allowReplies })}
              accessibilityLabel="Let people reply"
            />
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Pressable
              onPress={() => setEdit(null)}
              accessibilityRole="button"
              style={styles.footBtn}
            >
              <Text variant="label" style={styles.white}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              disabled={s.kind === 'text' && !edit.text.trim()}
              onPress={() => {
                const body: Record<string, unknown> = {};
                if (edit.text.trim() !== s.text) body.text = edit.text.trim();
                if (edit.allowReplies !== s.allowReplies) body.allowReplies = edit.allowReplies;
                if (Object.keys(body).length)
                  void engine.netAct({
                    method: 'PATCH',
                    path: `/v1/network/statuses/${s.statusId}`,
                    body,
                    label: 'Editing your status',
                    scopes: ['statuses'],
                  });
                setEdit(null);
              }}
              accessibilityRole="button"
              style={styles.footBtn}
            >
              <Ionicons name="checkmark" size={18} color="#fff" />
              <Text variant="label" style={styles.white}>
                Save
              </Text>
            </Pressable>
          </View>
        </View>
      ) : mine ? (
        <View style={styles.foot}>
          <Pressable
            onPress={() => setEdit({ text: s.text, allowReplies: s.allowReplies })}
            disabled={local}
            accessibilityRole="button"
            accessibilityLabel="Edit status"
            style={styles.footBtn}
          >
            <Ionicons name="create-outline" size={18} color="#fff" />
            <Text variant="label" style={styles.white}>
              Edit
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setShowViewers((v) => !v)}
            disabled={local}
            accessibilityRole="button"
            style={styles.footBtn}
          >
            <Ionicons name="eye-outline" size={18} color="#fff" />
            <Text variant="label" style={styles.white}>
              {local ? 'Not posted yet' : `Seen by ${s.viewCount ?? 0}`}
            </Text>
          </Pressable>
          <Pressable
            onPress={() =>
              confirmThen(
                'Delete this status?',
                'It disappears for everyone now.',
                'Delete',
                () => {
                  void engine.netAct({
                    method: 'DELETE',
                    path: `/v1/network/statuses/${s.statusId}`,
                    label: 'Deleting your status',
                    scopes: ['statuses'],
                  });
                  if (statuses.length <= 1) router.back();
                },
              )
            }
            disabled={local}
            accessibilityRole="button"
            accessibilityLabel="Delete status"
            style={styles.footBtn}
          >
            <Ionicons name="trash-outline" size={18} color="#fff" />
            <Text variant="label" style={styles.white}>
              Delete
            </Text>
          </Pressable>
        </View>
      ) : s.allowReplies ? (
        <View style={styles.reply}>
          <TextInput
            value={reply}
            onChangeText={(t) => {
              setReply(t);
              setSent(false);
            }}
            placeholder={
              sent ? 'Reply sent to your chat' : `Reply to ${s.author.displayName.split(' ')[0]}`
            }
            placeholderTextColor="rgba(255,255,255,0.6)"
            accessibilityLabel="Reply"
            onSubmitEditing={sendReply}
            style={styles.replyInput}
          />
          <Pressable
            onPress={sendReply}
            disabled={!reply.trim()}
            accessibilityRole="button"
            accessibilityLabel="Send reply"
            style={[styles.send, { opacity: reply.trim() ? 1 : 0.5 }]}
          >
            <Ionicons name="send" size={18} color="#fff" />
          </Pressable>
        </View>
      ) : (
        <Text variant="meta" style={[styles.dim, { textAlign: 'center', padding: space.md }]}>
          Replies are off for this status
        </Text>
      )}

      {mine && showViewers && !local ? (
        <Viewers statusId={s.statusId} onClose={() => setShowViewers(false)} />
      ) : null}
    </View>
  );
}

function StatusBody({ s }: { s: NetworkStatus }) {
  if (s.kind === 'text')
    return (
      <LinearGradient
        colors={STATUS_GRADIENT[s.background]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.textCard}
      >
        <Text style={styles.bigText}>{s.text}</Text>
      </LinearGradient>
    );
  return (
    <View style={StyleSheet.absoluteFill}>
      {s.media ? (
        s.kind === 'image' ? (
          <Image
            source={{ uri: s.media.url }}
            style={StyleSheet.absoluteFill}
            resizeMode="contain"
          />
        ) : (
          <StatusVideo key={s.statusId} uri={s.media.url} />
        )
      ) : null}
      {s.text ? (
        <View style={styles.caption}>
          <Text style={styles.white}>{s.text}</Text>
        </View>
      ) : null}
    </View>
  );
}

function StatusVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer({ uri }, (p) => {
    p.loop = true;
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      nativeControls={false}
    />
  );
}

function Viewers({ statusId, onClose }: { statusId: string; onClose: () => void }) {
  const { theme } = useTheme();
  const { data, loading } = useNet<{ person: NetworkPerson; viewedAt: string }[]>(
    `/v1/network/statuses/${statusId}/viewers`,
  );
  return (
    <View style={[styles.sheet, { backgroundColor: theme.colors.surface }]}>
      <View style={styles.sheetHead}>
        <Text variant="heading" style={{ flex: 1 }}>
          Viewed by {data?.length ?? 0}
        </Text>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close viewers"
          hitSlop={8}
        >
          <Ionicons name="close" size={22} color={theme.colors.textMuted} />
        </Pressable>
      </View>
      <ScrollView>
        {loading && !data ? <ActivityIndicator /> : null}
        {data?.map((v, n) => (
          <PersonRow
            key={v.person.userId}
            person={v.person}
            divider={n > 0}
            actions={
              <Text variant="meta" tone="muted">
                {new Date(v.viewedAt).toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </Text>
            }
          />
        ))}
        {data && !data.length ? <Empty icon="eye-off-outline" title="No one yet" /> : null}
      </ScrollView>
    </View>
  );
}

function Close({ top, inline }: { top: number; inline?: boolean }) {
  return (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      accessibilityRole="button"
      accessibilityLabel="Close"
      hitSlop={10}
      style={inline ? undefined : [styles.close, { top: top + space.md }]}
    >
      <Ionicons name="close" size={26} color="#fff" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#05070d' },
  bars: { flexDirection: 'row', gap: 4, paddingHorizontal: space.md, paddingTop: space.sm },
  bar: { flex: 1, height: 3, borderRadius: 2 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  white: { color: '#fff' },
  dim: { color: 'rgba(255,255,255,0.7)' },
  stage: { flex: 1, marginHorizontal: space.sm, borderRadius: radius.lg, overflow: 'hidden' },
  textCard: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  bigText: {
    color: '#fff',
    fontFamily: fonts.semibold,
    fontSize: 28,
    lineHeight: 38,
    textAlign: 'center',
  },
  caption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: space.lg,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  tap: { position: 'absolute', top: 0, bottom: 0, width: '35%' },
  foot: { flexDirection: 'row', justifyContent: 'space-around', padding: space.md },
  footBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: space.sm },
  reply: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md },
  replyInput: {
    flex: 1,
    color: '#fff',
    fontFamily: fonts.regular,
    fontSize: 16,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  send: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  close: { position: 'absolute', right: space.md },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '55%',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingBottom: space.xl,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', padding: space.lg },
});
