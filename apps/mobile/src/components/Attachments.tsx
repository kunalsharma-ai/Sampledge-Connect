import { Ionicons } from '@expo/vector-icons';
import { isAudioAttachment, isImageAttachment, isVideoAttachment } from '@sampledge/contracts';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import type { LocalAttachment } from '../db/store';
import { useWorkspace } from '../state/AppProvider';
import { alpha, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { AudioClip, DeletedClip, RECORDING_LABEL, VideoClip } from './MediaClips';
import { Text } from './Text';

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const ICONS: [RegExp, keyof typeof Ionicons.glyphMap][] = [
  [/^image\//, 'image-outline'],
  [/pdf$/, 'document-text-outline'],
  [/sheet|excel|csv/, 'grid-outline'],
  [/presentation|powerpoint/, 'easel-outline'],
  [/word|document|text\//, 'document-outline'],
  [/zip|compressed|tar/, 'archive-outline'],
  [/^audio\//, 'musical-notes-outline'],
  [/^video\//, 'videocam-outline'],
];
export const iconFor = (mime: string) => ICONS.find(([re]) => re.test(mime))?.[1] ?? 'attach-outline';

// Signed links are valid for ten minutes; reuse them for a little less.
const urlCache = new Map<string, { url: string; until: number }>();

export function useSignedUrl(attachmentId: string | null, enabled: boolean) {
  const { engine } = useWorkspace();
  const cached = attachmentId ? urlCache.get(attachmentId) : undefined;
  const [url, setUrl] = useState<string | null>(
    cached && cached.until > Date.now() ? cached.url : null,
  );
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled || !attachmentId || url) return;
    let alive = true;
    engine
      .attachmentUrl(attachmentId)
      .then((u) => {
        urlCache.set(attachmentId, { url: u, until: Date.now() + 8 * 60_000 });
        if (alive) setUrl(u);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [engine, attachmentId, enabled, url]);
  return { url, failed };
}

export async function openAttachment(
  a: Pick<LocalAttachment, 'attachmentId' | 'localUri'>,
  getUrl: (id: string) => Promise<string>,
): Promise<void> {
  const target = a.attachmentId ? await getUrl(a.attachmentId) : a.localUri;
  if (!target) return;
  if (Platform.OS === 'web') globalThis.open?.(target, '_blank');
  else await Linking.openURL(target);
}

function ImageAttachment({ a, own }: { a: LocalAttachment; own: boolean }) {
  const { theme } = useTheme();
  const { engine } = useWorkspace();
  const { url, failed } = useSignedUrl(a.attachmentId, !a.localUri);
  const src = a.localUri ?? url;
  const ratio = a.width && a.height ? a.width / a.height : 4 / 3;
  const w = 220;
  const h = Math.max(90, Math.min(300, w / ratio));
  return (
    <Pressable
      onPress={() => void openAttachment(a, (id) => engine.attachmentUrl(id))}
      accessibilityRole="imagebutton"
      accessibilityLabel={`Photo ${a.fileName}. Double tap to open`}
      style={[
        styles.image,
        { width: w, height: h, backgroundColor: alpha(theme.colors.text, 0.08) },
      ]}
    >
      {src ? (
        <Image source={{ uri: src }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={styles.center}>
          {failed ? (
            <>
              <Ionicons name="cloud-offline-outline" size={22} color={theme.colors.textMuted} />
              <Text variant="meta" tone="muted">
                Shows when online
              </Text>
            </>
          ) : (
            <ActivityIndicator color={own ? theme.colors.onAccent : theme.colors.accent} />
          )}
        </View>
      )}
      {!a.attachmentId ? (
        <View style={[styles.badge, { backgroundColor: alpha('#000000', 0.55) }]}>
          <Ionicons name="time-outline" size={12} color="#ffffff" />
          <Text variant="meta" style={{ color: '#ffffff' }}>
            Waiting to upload
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function FileAttachment({ a, own }: { a: LocalAttachment; own: boolean }) {
  const { theme } = useTheme();
  const { engine } = useWorkspace();
  const c = theme.colors;
  const fg = own ? c.bubbleOwnText : c.text;
  return (
    <Pressable
      onPress={() =>
        void openAttachment(a, (id) => engine.attachmentUrl(id)).catch(() => undefined)
      }
      accessibilityRole="button"
      accessibilityLabel={`File ${a.fileName}, ${formatBytes(a.sizeBytes)}. Double tap to open`}
      style={({ pressed }) => [
        styles.file,
        {
          backgroundColor: alpha(own ? '#000000' : c.accent, own ? 0.14 : 0.08),
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={[styles.fileIcon, { backgroundColor: alpha(own ? '#ffffff' : c.accent, 0.18) }]}>
        <Ionicons name={iconFor(a.mimeType)} size={20} color={own ? fg : c.accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="bodyStrong" numberOfLines={1} style={{ color: fg }}>
          {a.fileName}
        </Text>
        <Text variant="meta" style={{ color: fg, opacity: 0.75 }}>
          {formatBytes(a.sizeBytes)}
          {a.attachmentId ? '' : ' · waiting to upload'}
        </Text>
      </View>
      {a.attachmentId ? (
        <Ionicons name="open-outline" size={18} color={alpha(fg, 0.7)} />
      ) : (
        <Ionicons name="time-outline" size={18} color={alpha(fg, 0.7)} />
      )}
    </Pressable>
  );
}

export function AttachmentList({ items, own }: { items: LocalAttachment[]; own: boolean }) {
  if (!items.length) return null;
  return (
    <View style={styles.list}>
      {items.map((a, i) => {
        const key = a.attachmentId ?? `${a.fileName}-${i}`;
        const label = a.recording ? RECORDING_LABEL[a.recording] : a.fileName;
        if (a.deletedAt) return <DeletedClip key={key} own={own} kind={a.recording} />;
        if (isImageAttachment(a)) return <ImageAttachment key={key} a={a} own={own} />;
        if (isAudioAttachment(a))
          return (
            <AudioClip key={key} source={a} durationMs={a.durationMs} own={own} label={label} />
          );
        if (isVideoAttachment(a))
          return <VideoClip key={key} source={a} durationMs={a.durationMs} label={label} />;
        return <FileAttachment key={key} a={a} own={own} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 6, marginBottom: 6 },
  image: { borderRadius: radius.md, overflow: 'hidden', maxWidth: '100%' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  badge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  file: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.sm,
    borderRadius: radius.md,
    minWidth: 220,
  },
  fileIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
