import { Ionicons } from '@expo/vector-icons';
import type { MessageStatus } from '@sampledge/contracts';
import { useTheme } from '../theme/ThemeProvider';

export const STATUS_LABEL: Record<MessageStatus, string> = {
  draft: 'Draft',
  queued: 'Queued on this device',
  sending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Not sent',
};

/** Distinct glyph per status so "queued" can never be mistaken for "sent". */
export function StatusIcon({ status, onAccent }: { status: MessageStatus; onAccent?: boolean }) {
  const { theme } = useTheme();
  const base = onAccent ? theme.colors.bubbleOwnText : theme.colors.textSubtle;
  const map: Record<MessageStatus, { name: keyof typeof Ionicons.glyphMap; color: string }> = {
    draft: { name: 'create-outline', color: base },
    queued: { name: 'time-outline', color: base },
    sending: { name: 'arrow-up-circle-outline', color: base },
    sent: { name: 'checkmark', color: base },
    delivered: { name: 'checkmark-done', color: base },
    read: { name: 'checkmark-done', color: onAccent ? '#FFFFFF' : theme.colors.accentSecondary },
    failed: { name: 'alert-circle', color: theme.colors.danger },
  };
  const s = map[status];
  return (
    <Ionicons name={s.name} size={14} color={s.color} accessibilityLabel={STATUS_LABEL[status]} />
  );
}
