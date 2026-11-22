import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { PersonAvatar } from '../components/Avatar';
import { Text } from '../components/Text';
import { useWorkspace } from '../state/AppProvider';
import { conversationTitle, useCalls, usePeople } from '../state/hooks';
import { alpha, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';

/** Full-screen ringing sheet for a call someone started with you. */
export function IncomingCall() {
  const { theme, motion } = useTheme();
  const c = theme.colors;
  const { engine, store, selfId } = useWorkspace();
  const nameOf = usePeople();
  const { incoming } = useCalls();
  const [where, setWhere] = useState('');

  useEffect(() => {
    if (!incoming) return;
    void store
      .getConversation(incoming.conversationId)
      .then((conv) =>
        setWhere(conv && conv.kind !== 'dm' ? conversationTitle(conv, nameOf, selfId) : ''),
      );
  }, [incoming, store, nameOf, selfId]);

  if (!incoming) return null;
  const video = incoming.media === 'video';
  const caller = nameOf(incoming.callerId);
  const answer = async (media: 'audio' | 'video') => {
    const cur = await engine.calls.accept(media);
    if (cur) router.push({ pathname: '/call/[id]', params: { id: cur.call.callId } });
  };

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={() => void engine.calls.decline()}
    >
      <Animated.View
        entering={motion.base ? FadeIn.duration(motion.base) : undefined}
        style={[styles.fill, { backgroundColor: alpha(c.background, 0.97) }]}
        accessibilityViewIsModal
        accessibilityLiveRegion="assertive"
        accessibilityLabel={`Incoming ${video ? 'video' : 'voice'} call from ${caller}`}
      >
        <View style={styles.who}>
          <View style={[styles.halo, { borderColor: alpha(c.accent, 0.35) }]}>
            <PersonAvatar userId={incoming.callerId} name={caller} size={96} />
          </View>
          <Text variant="display" style={{ textAlign: 'center' }}>
            {caller}
          </Text>
          <Text tone="muted" style={{ textAlign: 'center' }}>
            Incoming {video ? 'video' : 'voice'} call{where ? ` in ${where}` : ''}
          </Text>
        </View>
        <View style={styles.actions}>
          <Action
            icon="close"
            label="Decline"
            color={c.danger}
            onPress={() => void engine.calls.decline()}
          />
          {video ? (
            <Action
              icon="call"
              label="Voice only"
              color={c.accentSecondary}
              onPress={() => void answer('audio')}
            />
          ) : null}
          <Action
            icon={video ? 'videocam' : 'call'}
            label="Accept"
            color={c.success}
            onPress={() => void answer(incoming.media)}
          />
        </View>
      </Animated.View>
    </Modal>
  );

  function Action({
    icon,
    label,
    color,
    onPress,
  }: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    color: string;
    onPress: () => void;
  }) {
    return (
      <View style={{ alignItems: 'center', gap: space.sm }}>
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={({ pressed }) => [
            styles.btn,
            { backgroundColor: color, transform: [{ scale: pressed ? 0.94 : 1 }] },
          ]}
        >
          <Ionicons name={icon} size={30} color="#FFFFFF" />
        </Pressable>
        <Text variant="label" tone="muted">
          {label}
        </Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'space-between', padding: space.xl, paddingVertical: 96 },
  who: { alignItems: 'center', gap: space.md },
  halo: { padding: 10, borderRadius: 999, borderWidth: 6, marginBottom: space.md },
  actions: { flexDirection: 'row', justifyContent: 'space-around' },
  btn: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
