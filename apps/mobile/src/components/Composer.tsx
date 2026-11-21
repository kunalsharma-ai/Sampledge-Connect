import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import {
  BLOCKED_EXTENSIONS,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_CLIP_DURATION_MS,
  MAX_MESSAGE_LENGTH,
} from '@sampledge/contracts';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import type { LocalMessage, PendingFileInput } from '../db/store';
import { keepPickedFile } from '../lib/localFiles';
import { formatBytes } from './Attachments';
import {
  activeMentionQuery,
  filterCandidates,
  insertMention,
  mentionsInText,
  type MentionCandidate,
} from '../lib/mentions';
import { useWorkspace } from '../state/AppProvider';
import { alpha, fonts, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Avatar } from './Avatar';
import { Text } from './Text';
import { useVoiceRecorder, VoiceRecordBar } from './VoiceRecorder';

export type ComposerMode =
  | { kind: 'reply'; message: LocalMessage; senderName: string }
  | { kind: 'edit'; message: LocalMessage }
  | null;

/**
 * Message composer. The draft autosaves to the local database, so it survives app kills.
 * Sending writes to the durable outbox first; the button never waits on the network.
 * Typing "@" suggests conversation members; replying and editing show a banner above the field.
 */
export function Composer({
  conversationId,
  placeholder,
  members,
  mode,
  onCancelMode,
}: {
  conversationId: string;
  placeholder: string;
  /** Conversation members other than you, for @mention suggestions. */
  members: MentionCandidate[];
  mode: ComposerMode;
  onCancelMode: () => void;
}) {
  const { theme, motion } = useTheme();
  const { store, engine } = useWorkspace();
  const c = theme.colors;
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<MentionCandidate[]>([]);
  const [files, setFiles] = useState<PendingFileInput[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const loaded = useRef(false);
  const typingSent = useRef(false);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const editing = mode?.kind === 'edit';
  const savedDraft = useRef('');
  const voice = useVoiceRecorder();

  useEffect(() => {
    loaded.current = false;
    void store.getDraft(conversationId).then((d) => {
      setText(d);
      loaded.current = true;
    });
  }, [store, conversationId]);

  // Entering edit mode swaps the draft out for the message text; leaving restores it.
  useEffect(() => {
    if (mode?.kind === 'edit') {
      savedDraft.current = text;
      setText(mode.message.text);
      setPicked(members.filter((m) => mode.message.mentions.includes(m.userId)));
    }
    if (mode) input.current?.focus();
  }, [mode]);

  useEffect(() => {
    if (!loaded.current || editing) return;
    const t = setTimeout(() => void store.saveDraft(conversationId, text), 400);
    const typing = text.trim().length > 0;
    if (typing !== typingSent.current) {
      typingSent.current = typing;
      engine.setTyping(conversationId, typing);
    }
    return () => clearTimeout(t);
  }, [text, store, engine, conversationId, editing]);

  const query = activeMentionQuery(text);
  const suggestions = useMemo(
    () => (query === null ? [] : filterCandidates(query, members)),
    [query, members],
  );

  const canSend =
    (text.trim().length > 0 || (files.length > 0 && !editing)) && text.length <= MAX_MESSAGE_LENGTH;
  /** With nothing typed or attached, the send button becomes the voice message mic. */
  const showMic = !editing && !canSend && text.trim().length === 0;

  /** Checks limits the server enforces, then copies the file into app storage. */
  const addPicked = async (
    picks: {
      uri: string;
      name: string;
      mimeType?: string | null;
      size?: number | null;
      width?: number;
      height?: number;
      recording?: 'video' | null;
      durationMs?: number | null;
    }[],
  ) => {
    setAttachOpen(false);
    setFileError(null);
    const next: PendingFileInput[] = [];
    for (const p of picks) {
      const ext = p.name.includes('.') ? p.name.split('.').pop()!.toLowerCase() : '';
      if ((BLOCKED_EXTENSIONS as readonly string[]).includes(ext)) {
        setFileError(`${p.name}: this file type is not allowed`);
        continue;
      }
      if ((p.size ?? 0) > MAX_ATTACHMENT_BYTES) {
        setFileError(`${p.name} is over the ${formatBytes(MAX_ATTACHMENT_BYTES)} limit`);
        continue;
      }
      if (files.length + next.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
        setFileError(`Up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message`);
        break;
      }
      next.push({
        localUri: await keepPickedFile(p.uri, p.name),
        fileName: p.name,
        mimeType: p.mimeType || 'application/octet-stream',
        sizeBytes: p.size ?? 0,
        width: p.width ?? null,
        height: p.height ?? null,
        recording: p.recording ?? null,
        durationMs: p.durationMs ?? null,
      });
    }
    setFiles((f) => [...f, ...next]);
  };

  const pickPhotos = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.9,
    });
    if (r.canceled) return setAttachOpen(false);
    await addPicked(
      r.assets.map((a, i) => ({
        uri: a.uri,
        name: a.fileName ?? `photo-${Date.now()}-${i}.jpg`,
        mimeType: a.mimeType ?? 'image/jpeg',
        size: a.fileSize,
        width: a.width,
        height: a.height,
      })),
    );
  };

  /** Phones only: records a video message with the system camera (up to 30 minutes). */
  const recordVideo = async () => {
    setFileError(null);
    const cam = await ImagePicker.requestCameraPermissionsAsync();
    if (!cam.granted) {
      setAttachOpen(false);
      return setFileError('Allow camera access to record a video message.');
    }
    const r = await ImagePicker.launchCameraAsync({
      mediaTypes: ['videos'],
      videoMaxDuration: MAX_CLIP_DURATION_MS / 1000,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
    });
    if (r.canceled) return setAttachOpen(false);
    const a = r.assets[0]!;
    const ext = a.mimeType === 'video/quicktime' ? 'mov' : 'mp4';
    await addPicked([
      {
        uri: a.uri,
        name: a.fileName ?? `Video message ${Date.now()}.${ext}`,
        mimeType: a.mimeType ?? 'video/mp4',
        size: a.fileSize,
        width: a.width,
        height: a.height,
        recording: 'video',
        durationMs: a.duration ? Math.min(MAX_CLIP_DURATION_MS, Math.round(a.duration)) : null,
      },
    ]);
  };

  const sendClip = async (clip: PendingFileInput) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const replyTo = mode?.kind === 'reply' ? mode.message.messageId : null;
    onCancelMode();
    await engine.send(conversationId, '', { replyTo, files: [clip] });
  };

  const pickFiles = async () => {
    const r = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (r.canceled) return setAttachOpen(false);
    await addPicked(
      r.assets.map((a) => ({ uri: a.uri, name: a.name, mimeType: a.mimeType, size: a.size })),
    );
  };
  const leaveEdit = () => {
    setText(savedDraft.current);
    savedDraft.current = '';
    setPicked([]);
    onCancelMode();
  };

  const send = async () => {
    if (!canSend) return;
    const body = text;
    const mentions = mentionsInText(body, picked);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (mode?.kind === 'edit') {
      const target = mode.message;
      leaveEdit();
      if (body.trim() !== target.text) await engine.edit(target.clientId, body, mentions);
      return;
    }
    const attached = files;
    setText('');
    setPicked([]);
    setFiles([]);
    setFileError(null);
    typingSent.current = false;
    engine.setTyping(conversationId, false);
    const replyTo = mode?.kind === 'reply' ? mode.message.messageId : null;
    onCancelMode();
    await engine.send(conversationId, body, { replyTo, mentions, files: attached });
  };

  const pick = (m: MentionCandidate) => {
    setText((t) => insertMention(t, m.name));
    setPicked((p) => (p.some((x) => x.userId === m.userId) ? p : [...p, m]));
    input.current?.focus();
  };

  const sendStyle = useAnimatedStyle(() => ({
    transform: [{ scale: withTiming(canSend ? 1 : 0.88, { duration: motion.fast }) }],
    opacity: withTiming(canSend ? 1 : 0.45, { duration: motion.fast }),
  }));
  const over = text.length > MAX_MESSAGE_LENGTH;

  return (
    <View
      style={[
        styles.wrap,
        { borderTopColor: c.border, backgroundColor: alpha(c.background, 0.92) },
      ]}
    >
      {suggestions.length ? (
        <Animated.View
          entering={motion.fast ? FadeIn.duration(motion.fast) : undefined}
          exiting={motion.fast ? FadeOut.duration(motion.fast) : undefined}
          style={[styles.suggest, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}
          accessibilityLabel="Mention suggestions"
        >
          {suggestions.map((m, i) => (
            <Pressable
              key={m.userId}
              onPress={() => pick(m)}
              accessibilityRole="button"
              accessibilityLabel={`Mention ${m.name}`}
              style={({ pressed }) => [
                styles.suggestRow,
                i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border },
                pressed && { backgroundColor: alpha(c.accent, 0.1) },
              ]}
            >
              <Avatar name={m.name} size={28} />
              <Text variant="bodyStrong">{m.name}</Text>
            </Pressable>
          ))}
        </Animated.View>
      ) : null}
      {mode ? (
        <View style={[styles.banner, { borderLeftColor: c.accent }]}>
          <Ionicons
            name={mode.kind === 'edit' ? 'create-outline' : 'arrow-undo-outline'}
            size={16}
            color={c.accent}
          />
          <View style={{ flex: 1 }}>
            <Text variant="label" tone="accent">
              {mode.kind === 'edit' ? 'Editing message' : `Replying to ${mode.senderName}`}
            </Text>
            <Text variant="meta" tone="muted" numberOfLines={1}>
              {mode.message.text}
            </Text>
          </View>
          <Pressable
            onPress={mode.kind === 'edit' ? leaveEdit : onCancelMode}
            accessibilityRole="button"
            accessibilityLabel={mode.kind === 'edit' ? 'Cancel editing' : 'Cancel reply'}
            hitSlop={10}
          >
            <Ionicons name="close-circle" size={20} color={c.textSubtle} />
          </Pressable>
        </View>
      ) : null}
      {files.length ? (
        <View style={styles.files} accessibilityLabel="Attached files">
          {files.map((f, i) => (
            <View
              key={`${f.localUri}-${i}`}
              style={[styles.fileChip, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}
            >
              <Ionicons
                name={f.mimeType.startsWith('image/') ? 'image-outline' : 'document-outline'}
                size={16}
                color={c.accent}
              />
              <Text variant="meta" numberOfLines={1} style={{ maxWidth: 150 }}>
                {f.fileName}
              </Text>
              <Text variant="meta" tone="subtle">
                {formatBytes(f.sizeBytes)}
              </Text>
              <Pressable
                onPress={() => setFiles((all) => all.filter((_, j) => j !== i))}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${f.fileName}`}
                hitSlop={8}
              >
                <Ionicons name="close-circle" size={16} color={c.textSubtle} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {fileError || voice.error ? (
        <Text variant="meta" tone="danger" style={{ marginLeft: 6 }}>
          {fileError ?? voice.error}
        </Text>
      ) : null}
      {attachOpen ? (
        <Animated.View
          entering={motion.fast ? FadeIn.duration(motion.fast) : undefined}
          style={[styles.attachMenu, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}
        >
          <Pressable
            onPress={() => void pickPhotos()}
            accessibilityRole="button"
            style={styles.attachRow}
          >
            <Ionicons name="images-outline" size={20} color={c.accent} />
            <Text variant="bodyStrong">Photos</Text>
          </Pressable>
          <Pressable
            onPress={() => void pickFiles()}
            accessibilityRole="button"
            style={[
              styles.attachRow,
              { borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border },
            ]}
          >
            <Ionicons name="document-attach-outline" size={20} color={c.accent} />
            <Text variant="bodyStrong">Files</Text>
          </Pressable>
          {Platform.OS !== 'web' ? (
            <Pressable
              onPress={() => void recordVideo()}
              accessibilityRole="button"
              style={[
                styles.attachRow,
                { borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border },
              ]}
            >
              <Ionicons name="videocam-outline" size={20} color={c.accent} />
              <Text variant="bodyStrong">Video message</Text>
            </Pressable>
          ) : null}
        </Animated.View>
      ) : null}
      {voice.active ? (
        <VoiceRecordBar voice={voice} onSend={(clip) => void sendClip(clip)} />
      ) : (
        <View
          style={[
            styles.field,
            { backgroundColor: c.surfaceRaised, borderColor: over ? c.danger : c.border },
          ]}
        >
          {!editing ? (
            <Pressable
              onPress={() => setAttachOpen((o) => !o)}
              accessibilityRole="button"
              accessibilityLabel="Attach"
              accessibilityState={{ expanded: attachOpen }}
              hitSlop={6}
              style={styles.attach}
            >
              <Ionicons name={attachOpen ? 'close' : 'add'} size={22} color={c.accent} />
            </Pressable>
          ) : null}
          <TextInput
            ref={input}
            value={text}
            onChangeText={(t) => {
              setText(t);
              if (voice.error) voice.clearError();
            }}
            placeholder={placeholder}
            placeholderTextColor={c.textSubtle}
            multiline
            style={[styles.input, { color: c.text }]}
            accessibilityLabel="Message"
            submitBehavior="newline"
          />
          {showMic ? (
            <Pressable
              onPress={() => {
                setAttachOpen(false);
                void voice.start();
              }}
              accessibilityRole="button"
              accessibilityLabel="Record voice message"
              style={[styles.send, { backgroundColor: alpha(c.accent, 0.14) }]}
            >
              <Ionicons name="mic" size={19} color={c.accent} />
            </Pressable>
          ) : (
            <Animated.View style={sendStyle}>
              <Pressable
                onPress={send}
                disabled={!canSend}
                accessibilityRole="button"
                accessibilityLabel={editing ? 'Save edit' : 'Send message'}
                style={[styles.send, { backgroundColor: c.accent }]}
              >
                <Ionicons name={editing ? 'checkmark' : 'arrow-up'} size={18} color={c.onAccent} />
              </Pressable>
            </Animated.View>
          )}
        </View>
      )}
      {over ? (
        <Text variant="meta" tone="danger" style={{ marginTop: 4, marginLeft: 6 }}>
          {text.length - MAX_MESSAGE_LENGTH} characters over the limit
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: space.sm,
  },
  suggest: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderLeftWidth: 3,
    paddingLeft: space.sm,
    marginHorizontal: space.xs,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: space.sm,
    paddingRight: 5,
    paddingVertical: 5,
  },
  input: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 15.5,
    lineHeight: 21,
    maxHeight: 140,
    paddingTop: 7,
    paddingBottom: 7,
  },
  attach: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  files: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  fileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  attachMenu: {
    alignSelf: 'flex-start',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    minWidth: 180,
  },
  attachRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  send: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
