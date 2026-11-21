import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { MAX_MESSAGE_LENGTH } from '@sampledge/contracts';
import { useWorkspace } from '../state/AppProvider';
import { alpha, fonts, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

/**
 * Message composer. The draft autosaves to the local database, so it survives app kills.
 * Sending writes to the durable outbox first; the button never waits on the network.
 */
export function Composer({
  conversationId,
  placeholder,
}: {
  conversationId: string;
  placeholder: string;
}) {
  const { theme, motion } = useTheme();
  const { store, engine } = useWorkspace();
  const c = theme.colors;
  const [text, setText] = useState('');
  const loaded = useRef(false);
  const typingSent = useRef(false);

  useEffect(() => {
    loaded.current = false;
    void store.getDraft(conversationId).then((d) => {
      setText(d);
      loaded.current = true;
    });
  }, [store, conversationId]);

  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => void store.saveDraft(conversationId, text), 400);
    const typing = text.trim().length > 0;
    if (typing !== typingSent.current) {
      typingSent.current = typing;
      engine.setTyping(conversationId, typing);
    }
    return () => clearTimeout(t);
  }, [text, store, engine, conversationId]);

  const canSend = text.trim().length > 0 && text.length <= MAX_MESSAGE_LENGTH;
  const send = async () => {
    if (!canSend) return;
    const body = text;
    setText('');
    typingSent.current = false;
    engine.setTyping(conversationId, false);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await engine.send(conversationId, body);
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
      <View
        style={[
          styles.field,
          { backgroundColor: c.surfaceRaised, borderColor: over ? c.danger : c.border },
        ]}
      >
        <TextInput
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
            accessibilityLabel="Send message"
            style={[styles.send, { backgroundColor: c.accent }]}
          >
            <Ionicons name="arrow-up" size={18} color={c.onAccent} />
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
