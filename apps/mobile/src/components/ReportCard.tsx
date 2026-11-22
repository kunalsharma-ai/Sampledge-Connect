import { Ionicons } from '@expo/vector-icons';
import type { ModerationActionKind, ModerationReport } from '@sampledge/contracts';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ACTION_TEXT, REASON_TEXT, TARGET_TEXT, actionsFor } from '../lib/moderation';
import { personLine } from '../lib/network';
import { alpha, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Glass } from './Glass';
import { Field, SmallButton, Tag } from './NetworkBits';
import { Text } from './Text';

const when = (iso: string) =>
  new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/**
 * One report: what was reported (as it looked then), who posted it, who reported it, and the
 * actions this moderator may take. Destructive actions ask once, with an optional note.
 */
export function ReportCard({
  report: r,
  kind,
  onAct,
}: {
  report: ModerationReport;
  kind: 'platform' | 'community';
  onAct: (action: ModerationActionKind, note: string) => void;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [confirm, setConfirm] = useState<ModerationActionKind | null>(null);
  const [note, setNote] = useState('');
  const icon: keyof typeof Ionicons.glyphMap =
    r.targetType === 'message'
      ? 'chatbubble-outline'
      : r.targetType === 'status'
        ? 'radio-button-on-outline'
        : r.targetType === 'community'
          ? 'people-outline'
          : 'person-outline';
  return (
    <Glass style={{ padding: space.md, gap: space.sm }}>
      <View style={styles.head}>
        <View style={[styles.icon, { backgroundColor: alpha(c.danger, 0.12) }]}>
          <Ionicons name={icon} size={15} color={c.danger} />
        </View>
        <Text variant="bodyStrong">{TARGET_TEXT[r.targetType]}</Text>
        <View style={[styles.reason, { backgroundColor: alpha(c.danger, 0.14) }]}>
          <Text variant="meta" style={{ color: c.danger }}>
            {REASON_TEXT[r.reason]}
          </Text>
        </View>
        {r.alsoReported ? <Tag text={`+${r.alsoReported} more`} /> : null}
        {r.targetState !== 'active' ? (
          <Tag text={r.targetState === 'removed' ? 'Removed' : 'Suspended'} />
        ) : null}
      </View>
      {r.snapshot ? (
        <View
          style={[
            styles.quote,
            { borderLeftColor: alpha(c.danger, 0.6), backgroundColor: alpha(c.text, 0.05) },
          ]}
        >
          <Text
            tone={r.targetState === 'removed' ? 'muted' : undefined}
            style={r.targetState === 'removed' ? { textDecorationLine: 'line-through' } : undefined}
            selectable
          >
            {r.snapshot}
          </Text>
        </View>
      ) : null}
      {r.subject ? (
        <Text variant="meta" tone="muted">
          {r.targetType === 'community'
            ? 'Owner'
            : r.targetType === 'user'
              ? 'Reported'
              : 'Posted by'}
          : <Text variant="meta">{r.subject.displayName}</Text> · {personLine(r.subject)}
        </Text>
      ) : null}
      {r.reporter ? (
        <Text variant="meta" tone="muted">
          Reported by <Text variant="meta">{r.reporter.displayName}</Text> · {when(r.createdAt)}
        </Text>
      ) : null}
      {r.community ? (
        <Text variant="meta" tone="muted">
          In {r.community.name}
        </Text>
      ) : null}
      {r.details ? (
        <Text variant="meta" tone="muted">
          Their note: {r.details}
        </Text>
      ) : null}
      {r.resolution ? (
        <View style={styles.resolved}>
          <Ionicons name="checkmark-circle" size={14} color={c.success} />
          <Text variant="meta" tone="muted" style={{ flex: 1 }}>
            {ACTION_TEXT[r.resolution.action].done} by {r.resolution.by} · {when(r.resolution.at)}
            {r.resolution.note ? ` · “${r.resolution.note}”` : ''}
          </Text>
        </View>
      ) : confirm ? (
        <View style={{ gap: space.sm }}>
          <Text variant="label">{ACTION_TEXT[confirm].label}?</Text>
          <Text variant="meta" tone="muted">
            {ACTION_TEXT[confirm].confirm}
          </Text>
          <Field
            label="Note for other moderators (optional)"
            value={note}
            onChangeText={setNote}
            maxLength={500}
          />
          <View style={styles.actions}>
            <SmallButton title="Cancel" onPress={() => setConfirm(null)} />
            <Button
              title={ACTION_TEXT[confirm].label}
              kind={ACTION_TEXT[confirm].danger ? 'danger' : 'primary'}
              onPress={() => {
                onAct(confirm, note.trim());
                setConfirm(null);
                setNote('');
              }}
            />
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          {actionsFor(r, kind).map((a) => (
            <SmallButton
              key={a}
              title={ACTION_TEXT[a].label}
              kind={ACTION_TEXT[a].danger ? 'danger' : 'quiet'}
              onPress={() => setConfirm(a)}
            />
          ))}
        </View>
      )}
    </Glass>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  icon: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reason: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  quote: {
    borderLeftWidth: 2,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 6,
  },
  resolved: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
});
