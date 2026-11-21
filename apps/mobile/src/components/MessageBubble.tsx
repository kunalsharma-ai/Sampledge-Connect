import { memo } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { LocalMessage } from '../db/store';
import { radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { STATUS_LABEL, StatusIcon } from './StatusIcon';
import { Text } from './Text';

interface Props {
  message: LocalMessage;
  own: boolean;
  senderName: string;
  /** First message in a run from the same sender shows the name. */
  showSender: boolean;
  animate: boolean;
  onRetry: (clientId: string) => void;
  onDiscard: (clientId: string) => void;
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function MessageBubbleImpl({
  message: m,
  own,
  senderName,
  showSender,
  animate,
  onRetry,
  onDiscard,
}: Props) {
  const { theme, motion } = useTheme();
  const c = theme.colors;
  const unsent = m.status === 'queued' || m.status === 'sending' || m.status === 'failed';

  const openActions = () => {
    if (!own || !unsent) return;
    const title =
      m.status === 'failed'
        ? `Not sent: ${m.error ?? 'unknown error'}`
        : 'This message is queued on your device';
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title,
          options: ['Retry now', 'Delete unsent message', 'Cancel'],
          destructiveButtonIndex: 1,
          cancelButtonIndex: 2,
        },
        (i) => (i === 0 ? onRetry(m.clientId) : i === 1 ? onDiscard(m.clientId) : undefined),
      );
    } else {
      Alert.alert('Unsent message', title, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => onDiscard(m.clientId) },
        { text: 'Retry now', onPress: () => onRetry(m.clientId) },
      ]);
    }
  };

  const deleted = !!m.deletedAt;
  const bubbleColor = own ? c.bubbleOwn : c.bubbleOther;
  const textColor = own ? c.bubbleOwnText : c.text;

  return (
    <Animated.View
      entering={animate && motion.base ? FadeInDown.duration(motion.base) : undefined}
      style={[styles.row, own ? styles.rowOwn : styles.rowOther]}
    >
      {showSender && !own ? (
        <Text variant="label" tone="muted" style={styles.sender}>
          {senderName}
        </Text>
      ) : null}
      <Pressable
        onLongPress={openActions}
        onPress={m.status === 'failed' ? openActions : undefined}
        accessibilityHint={unsent && own ? 'Double tap and hold for retry options' : undefined}
        accessibilityLabel={`${own ? 'You' : senderName}: ${deleted ? 'message deleted' : m.text}. ${own ? STATUS_LABEL[m.status] : ''}`}
        style={[
          styles.bubble,
          own ? styles.bubbleOwn : styles.bubbleOther,
          {
            backgroundColor: bubbleColor,
            borderColor: c.border,
            opacity: m.status === 'queued' || m.status === 'sending' ? 0.86 : 1,
          },
          m.status === 'failed' && { borderColor: c.danger, borderWidth: 1 },
        ]}
      >
        <Text
          variant="body"
          style={{
            color: textColor,
            fontStyle: deleted ? 'italic' : 'normal',
            opacity: deleted ? 0.7 : 1,
          }}
        >
          {deleted ? 'This message was deleted' : m.text}
        </Text>
        <View style={styles.meta}>
          {m.editedAt && !deleted ? (
            <Text variant="meta" style={{ color: textColor, opacity: 0.7 }}>
              edited
            </Text>
          ) : null}
          <Text variant="meta" style={{ color: textColor, opacity: 0.7 }}>
            {time(m.createdAt)}
          </Text>
          {own ? <StatusIcon status={m.status} onAccent /> : null}
        </View>
      </Pressable>
      {own && m.status === 'failed' ? (
        <Text variant="meta" tone="danger" style={styles.failNote}>
          Not sent. Tap to retry.
        </Text>
      ) : null}
    </Animated.View>
  );
}

export const MessageBubble = memo(MessageBubbleImpl);

const styles = StyleSheet.create({
  row: { paddingHorizontal: space.lg, marginTop: 3 },
  rowOwn: { alignItems: 'flex-end' },
  rowOther: { alignItems: 'flex-start' },
  sender: { marginTop: space.md, marginBottom: 3, marginLeft: space.xs },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: 14,
    paddingTop: 9,
    paddingBottom: 7,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bubbleOwn: { borderBottomRightRadius: 6 },
  bubbleOther: { borderBottomLeftRadius: 6 },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 5,
    marginTop: 3,
  },
  failNote: { marginTop: 3, marginRight: space.xs },
});
