import { Ionicons } from '@expo/vector-icons';
import { formatClipDuration, RECORDING_KINDS, type RecordingKind } from '@sampledge/contracts';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { formatBytes } from '../components/Attachments';
import { Glass } from '../components/Glass';
import { AudioClip, ClipPlayerModal, RECORDING_LABEL } from '../components/MediaClips';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { confirmThen } from '../lib/confirm';
import { useApp, useWorkspace } from '../state/AppProvider';
import { usePeople } from '../state/hooks';
import type { Recording } from '../sync/transport';
import { alpha, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';

const KIND_ICON: Record<RecordingKind, keyof typeof Ionicons.glyphMap> = {
  voice: 'mic-outline',
  video: 'videocam-outline',
  screen: 'desktop-outline',
  call: 'recording-outline',
};
const FILTERS: { key: RecordingKind | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  ...RECORDING_KINDS.map((k) => ({
    key: k,
    label: k === 'call' ? 'Calls' : k === 'voice' ? 'Voice' : k === 'video' ? 'Video' : 'Screen',
  })),
];

function day(iso: string): string {
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Every recording in conversations you can read: voice and video messages, screen
 * recordings and call recordings. Recordings stream from the server, so this needs a
 * connection; the clips inside conversations still show their cards offline.
 */
export default function Recordings() {
  const { conversationId, title } = useLocalSearchParams<{
    conversationId?: string;
    title?: string;
  }>();
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine, selfId } = useWorkspace();
  const { engineState } = useApp();
  const nameOf = usePeople();
  const [kind, setKind] = useState<RecordingKind | 'all'>('all');
  const [items, setItems] = useState<Recording[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Recording | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const gen = useRef(0);
  const blocked = engine.serverActionBlocker();

  const load = useCallback(
    async (before?: string) => {
      if (engine.serverActionBlocker()) return;
      const g = before ? gen.current : ++gen.current;
      setLoading(true);
      try {
        const page = await engine.listRecordings({
          conversationId: conversationId || undefined,
          kind: kind === 'all' ? undefined : kind,
          before,
          limit: 30,
        });
        if (g !== gen.current) return;
        setItems((prev) => (before ? [...(prev ?? []), ...page.items] : page.items));
        setNext(page.nextBefore);
        setError(null);
      } catch (e) {
        if (g === gen.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (g === gen.current) setLoading(false);
      }
    },
    [engine, conversationId, kind],
  );

  useEffect(() => {
    void load();
  }, [load, engineState?.networkUp]);

  const remove = (r: Recording) =>
    confirmThen(
      `Delete this ${RECORDING_LABEL[r.kind].toLowerCase()}?`,
      'It is deleted for everyone in the conversation and cannot be recovered. The message stays and says the recording was deleted.',
      'Delete',
      () =>
        void (async () => {
          setBusy(r.recordingId);
          try {
            await engine.deleteRecording(r.recordingId);
            setItems((all) => (all ?? []).filter((x) => x.recordingId !== r.recordingId));
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(null);
          }
        })(),
    );

  const renderItem = ({ item: r }: { item: Recording }) => {
    const audio = r.mimeType.startsWith('audio/');
    const by = r.createdBy === selfId ? 'You' : nameOf(r.createdBy);
    return (
      <Glass style={styles.card}>
        <View style={styles.cardHead}>
          <View style={[styles.icon, { backgroundColor: alpha(c.accent, 0.12) }]}>
            <Ionicons name={KIND_ICON[r.kind]} size={19} color={c.accent} />
          </View>
          <View style={{ flex: 1, gap: 1 }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {RECORDING_LABEL[r.kind]}
              {conversationId ? '' : ` · ${r.conversationName}`}
            </Text>
            <Text variant="meta" tone="muted" numberOfLines={1}>
              {by} · {day(r.createdAt)}
              {r.durationMs ? ` · ${formatClipDuration(r.durationMs)}` : ''} ·{' '}
              {formatBytes(r.sizeBytes)}
            </Text>
            {r.expiresAt ? (
              <Text variant="meta" tone="subtle">
                Deleted automatically on {day(r.expiresAt)}
              </Text>
            ) : null}
          </View>
          {r.canDelete ? (
            <Pressable
              onPress={() => remove(r)}
              disabled={!!blocked || busy === r.recordingId}
              accessibilityRole="button"
              accessibilityLabel={`Delete ${RECORDING_LABEL[r.kind]} from ${day(r.createdAt)}`}
              hitSlop={8}
              style={{ opacity: blocked ? 0.4 : 1 }}
            >
              {busy === r.recordingId ? (
                <ActivityIndicator size="small" color={c.danger} />
              ) : (
                <Ionicons name="trash-outline" size={20} color={c.danger} />
              )}
            </Pressable>
          ) : null}
        </View>
        {audio ? (
          <AudioClip
            source={{ attachmentId: r.recordingId, localUri: null }}
            durationMs={r.durationMs}
            own={false}
            label={RECORDING_LABEL[r.kind]}
          />
        ) : (
          <Pressable
            onPress={() => setOpen(r)}
            accessibilityRole="button"
            accessibilityLabel={`Play ${RECORDING_LABEL[r.kind]}`}
            style={({ pressed }) => [
              styles.playRow,
              { backgroundColor: alpha(c.accent, pressed ? 0.16 : 0.08) },
            ]}
          >
            <Ionicons name="play-circle" size={22} color={c.accent} />
            <Text variant="bodyStrong" tone="accent">
              Play video
            </Text>
          </Pressable>
        )}
      </Glass>
    );
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: title ? `Recordings · ${title}` : 'Recordings' }} />
      {open ? (
        <ClipPlayerModal
          source={{ attachmentId: open.recordingId, localUri: null }}
          title={`${RECORDING_LABEL[open.kind]} · ${open.conversationName}`}
          onClose={() => setOpen(null)}
        />
      ) : null}
      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
          accessibilityRole="tablist"
        >
          {FILTERS.map((f) => {
            const on = f.key === kind;
            return (
              <Pressable
                key={f.key}
                onPress={() => setKind(f.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                style={[
                  styles.chip,
                  {
                    backgroundColor: on ? c.accent : alpha(c.text, 0.06),
                    borderColor: on ? c.accent : c.border,
                  },
                ]}
              >
                <Text variant="label" style={{ color: on ? c.onAccent : c.text }}>
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <FlatList
        data={items ?? []}
        keyExtractor={(r) => r.recordingId}
        renderItem={renderItem}
        contentContainerStyle={{
          padding: space.lg,
          paddingTop: space.sm,
          gap: space.md,
          paddingBottom: 80,
        }}
        refreshControl={
          <RefreshControl
            refreshing={loading && !!items}
            onRefresh={() => void load()}
            tintColor={c.accent}
          />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (next && !loading) void load(next);
        }}
        ListHeaderComponent={
          blocked || error ? (
            <View
              style={[styles.note, { backgroundColor: alpha(error ? c.danger : c.warning, 0.12) }]}
            >
              <Text variant="meta" style={{ color: error ? c.danger : c.warning }}>
                {error ?? `${blocked} Recordings play from the server.`}
              </Text>
            </View>
          ) : undefined
        }
        ListEmptyComponent={
          items && !loading ? (
            <View style={styles.empty}>
              <Ionicons name="recording-outline" size={36} color={c.textSubtle} />
              <Text tone="muted" style={{ textAlign: 'center' }}>
                {kind === 'all'
                  ? 'No recordings yet. Tap the mic in a conversation to send a voice message, or record a call from the call screen.'
                  : `No ${FILTERS.find((f) => f.key === kind)!.label.toLowerCase()} recordings.`}
              </Text>
            </View>
          ) : !blocked ? (
            <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />
          ) : undefined
        }
        ListFooterComponent={next && loading ? <ActivityIndicator color={c.accent} /> : undefined}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  card: { padding: space.md, gap: space.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  playRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.sm,
    borderRadius: radius.md,
  },
  note: { padding: space.md, borderRadius: radius.md, marginBottom: space.sm },
  empty: {
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.xxxl,
    paddingHorizontal: space.lg,
  },
});
