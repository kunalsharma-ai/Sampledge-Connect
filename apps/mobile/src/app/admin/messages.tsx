import {
  EDIT_WINDOW_CHOICES,
  editWindowLabel,
  type MessageEditingPolicy,
} from '@sampledge/contracts';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';
import { Button } from '../../components/Button';
import { Chips } from '../../components/Chips';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { useWorkspace } from '../../state/AppProvider';
import { useMessageEditing } from '../../state/useMessageEditing';
import { space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

const windowKey = (m: number | null) => (m == null ? 'none' : String(m));

/**
 * Administration → Messages: whether people can edit their messages, for how long, and who
 * sees earlier versions (docs/editing.md). Applies live on every device.
 */
export default function MessageRules() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const state = useMessageEditing();
  const [draft, setDraft] = useState<MessageEditingPolicy>(state.policy);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const blocked = engine.serverActionBlocker();
  useEffect(() => setDraft(state.policy), [state.policy]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.policy);

  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      await engine.setMessageEditing(draft);
      setNote({ text: 'Saved. Everyone’s apps update now.', error: false });
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Messages' }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}>
        {!state.canManage ? (
          <Text tone="muted">
            Only owners and admins change message rules. Your role doesn’t include “Set message
            editing rules”.
          </Text>
        ) : null}
        <Glass>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">People can edit their own messages</Text>
              <Text variant="meta" tone="muted">
                Off: Edit disappears everywhere. Deleting still works.
              </Text>
            </View>
            <Switch
              value={draft.allowEditing}
              disabled={!state.canManage}
              onValueChange={(allowEditing) => setDraft({ ...draft, allowEditing })}
              trackColor={{ true: c.accent }}
              accessibilityLabel="People can edit their own messages"
              aria-checked={draft.allowEditing}
            />
          </View>
        </Glass>
        <View style={{ gap: space.sm, opacity: draft.allowEditing ? 1 : 0.5 }}>
          <Text variant="bodyStrong">Time limit</Text>
          <Text variant="meta" tone="muted">
            How long after sending a message can still be changed.
          </Text>
          <Chips
            label="Time limit for editing"
            options={EDIT_WINDOW_CHOICES.map((m) => ({
              key: windowKey(m),
              label: m == null ? 'No limit' : editWindowLabel(m),
            }))}
            selected={[windowKey(draft.editWindowMinutes)]}
            onToggle={(k) =>
              state.canManage &&
              draft.allowEditing &&
              setDraft({ ...draft, editWindowMinutes: k === 'none' ? null : Number(k) })
            }
          />
        </View>
        <View style={{ gap: space.sm }}>
          <Text variant="bodyStrong">Who can see earlier versions</Text>
          <Text variant="meta" tone="muted">
            Every edit keeps the text it replaced. Long-press an edited message → Edit history.
          </Text>
          <Chips
            label="Who can see earlier versions"
            options={[
              { key: 'everyone' as const, label: 'Everyone in the conversation' },
              { key: 'moderators' as const, label: 'Sender, moderators, admins' },
            ]}
            selected={[draft.historyVisibleTo]}
            onToggle={(historyVisibleTo) =>
              state.canManage && setDraft({ ...draft, historyVisibleTo })
            }
          />
        </View>
        <Text variant="meta" tone="muted">
          Every edit goes in the audit log (who, which message and when, never the text).
          SampConnect’s super admins can also turn editing off for a role.
        </Text>
        {state.canManage ? (
          <Button
            title={blocked ? 'Needs a connection' : busy ? 'Saving…' : 'Save rules'}
            disabled={!dirty || busy || !!blocked}
            onPress={() => void save()}
          />
        ) : null}
        {note ? (
          <Text
            variant="meta"
            tone={note.error ? 'danger' : 'muted'}
            accessibilityLiveRegion="polite"
          >
            {note.text}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
