import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { MAX_MESSAGE_LENGTH } from '@sampledge/contracts';
import type { LocalMessage } from '../db/store';
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
  const loaded = useRef(false);
  const typingSent = useRef(false);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const editing = mode?.kind === 'edit';
  const savedDraft = useRef('');

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

  const canSend = text.trim().length > 0 && text.length <= MAX_MESSAGE_LENGTH;
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
    setText('');
    setPicked([]);
    typingSent.current = false;
    engine.setTyping(conversationId, false);
    const replyTo = mode?.kind === 'reply' ? mode.message.messageId : null;
    onCancelMode();
    await engine.send(conversationId, body, { replyTo, mentions });
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
      <View
        style={[
          styles.field,
          { backgroundColor: c.surfaceRaised, borderColor: over ? c.danger : c.border },
        ]}
      >
        <TextInput
          ref={input}
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={c.textSubtle}
          multiline
          style={[styles.input, { color: c.text }]}
          accessibilityLabel="Message"
          submitBehavior="newline"
        />
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
      </View>
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
    paddingLeft: space.lg,
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
  send: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
