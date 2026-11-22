import type { InboxConversationDetail } from '@sampledge/contracts';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Button } from '../../components/Button';
import { Chips } from '../../components/Chips';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { isHandoff, PROVIDER_META } from '../../lib/inbox';
import { useWorkspace } from '../../state/AppProvider';
import { useInboxChannels } from '../../state/useInbox';
import { alpha, radius, space, type as typeScale } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * Signal and iMessage have no business API: when a client writes there, the agent logs the
 * conversation here, and replies open the client's app with the text ready. Needs a connection.
 */
export default function NewHandoffConversation() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const channels = useInboxChannels().filter((x) => isHandoff(x.provider) && x.status !== 'paused');
  const [connectorId, setConnectorId] = useState<string | null>(null);
  const [clientName, setClientName] = useState('');
  const [handle, setHandle] = useState('');
  const [subject, setSubject] = useState('');
  const [firstMessage, setFirstMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = connectorId ?? channels[0]?.connectorId ?? null;

  const save = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const d = await engine.inboxServer<InboxConversationDetail>(
        'POST',
        '/v1/inbox/conversations',
        {
          connectorId: chosen,
          clientName: clientName.trim(),
          handle: handle.trim(),
          subject: subject.trim(),
          ...(firstMessage.trim() ? { firstMessage: firstMessage.trim() } : {}),
        },
      );
      router.replace(`/inbox/${d.conversation.conversationId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
    opts: { multiline?: boolean; placeholder?: string } = {},
  ) => (
    <View style={{ gap: space.xs }}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={set}
        multiline={opts.multiline}
        placeholder={opts.placeholder}
        placeholderTextColor={c.textSubtle}
        accessibilityLabel={label}
        style={[
          typeScale.body,
          styles.input,
          { color: c.text, borderColor: c.border, backgroundColor: c.surfaceSunken },
          opts.multiline ? { minHeight: 90 } : null,
        ]}
      />
    </View>
  );

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Log a conversation' }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
          <Text tone="muted">
            For clients who wrote to you on Signal or iMessage. Replies you write here open the app
            with the text ready to send.
          </Text>
          {error ? (
            <View style={[styles.banner, { backgroundColor: alpha(c.danger, 0.12) }]}>
              <Text variant="meta" style={{ color: c.danger }}>
                {error}
              </Text>
            </View>
          ) : null}
          {channels.length ? (
            <Chips
              label="Channel"
              options={channels.map((x) => ({
                key: x.connectorId,
                label: `${PROVIDER_META[x.provider].name} · ${x.name}`,
              }))}
              selected={chosen ? [chosen] : []}
              onToggle={setConnectorId}
            />
          ) : (
            <Text tone="muted">
              No Signal or iMessage channel is set up. An admin adds one on the web.
            </Text>
          )}
          {field('Client name', clientName, setClientName)}
          {field('Phone or Apple ID', handle, setHandle, { placeholder: '+44 7700 900123' })}
          {field('Subject', subject, setSubject)}
          {field('What they wrote (optional)', firstMessage, setFirstMessage, { multiline: true })}
          <Button
            title="Start conversation"
            icon="add-circle-outline"
            busy={busy}
            disabled={!chosen || !clientName.trim() || !handle.trim() || !subject.trim()}
            onPress={() => void save()}
          />
          <Text variant="meta" tone="subtle">
            Needs a connection, so the conversation is created once for every agent.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  banner: { padding: space.md, borderRadius: radius.md },
});
