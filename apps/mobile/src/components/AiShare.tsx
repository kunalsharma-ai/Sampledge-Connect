import type { AiProposal } from '@sampledge/contracts';
import { useState } from 'react';
import { StyleSheet, Switch, TextInput, View } from 'react-native';
import { riskSentence } from '../lib/ai';
import { useWorkspace } from '../state/AppProvider';
import { radius, space, type as typeScale } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Glass } from './Glass';
import { Text } from './Text';

/**
 * Share AI output in a conversation, with confirmation: the server drafts it, the person reads
 * and may edit it, and it is sent only when they press Send. Sensitive drafts need a tick.
 */
export function AiShare({
  conversationId,
  text,
  onDone,
}: {
  conversationId: string;
  text: string;
  onDone: (sent: boolean) => void;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const [draft, setDraft] = useState<AiProposal | null>(null);
  const [body, setBody] = useState(text);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (step: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await step();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const warning = draft ? riskSentence(draft.risk) : null;
  return (
    <Glass style={{ padding: space.md, gap: space.md }}>
      <Text variant="bodyStrong">Share in the conversation</Text>
      <Text variant="meta" tone="muted">
        It goes out as you, only after you press Send. Edit it first if you like.
      </Text>
      <TextInput
        value={body}
        onChangeText={(t) => {
          setBody(t);
          setDraft(null);
          setAck(false);
        }}
        multiline
        maxLength={8000}
        accessibilityLabel="Message to share"
        style={[
          typeScale.body,
          styles.input,
          { color: c.text, backgroundColor: c.surfaceSunken, borderColor: c.border },
        ]}
      />
      {warning ? (
        <View style={styles.ack}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="label" tone="danger">
              Sensitive
            </Text>
            <Text variant="meta" tone="muted">
              {warning}
            </Text>
          </View>
          <Switch value={ack} onValueChange={setAck} accessibilityLabel="I checked it, send it" />
        </View>
      ) : null}
      {error ? (
        <Text variant="meta" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            title="Cancel"
            kind="quiet"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                if (draft) await engine.aiDismiss(draft.proposalId).catch(() => undefined);
                onDone(false);
              })
            }
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            title="Send"
            icon="send"
            busy={busy}
            disabled={!body.trim() || (!!warning && !ack)}
            onPress={() =>
              void run(async () => {
                const p = draft ?? (await engine.aiPropose(conversationId, body.trim()));
                setDraft(p);
                // A sensitive draft stops here until the person ticks that they checked it.
                if (p.risk.level === 'sensitive' && !ack) return;
                await engine.aiConfirm(p.proposalId, {
                  confirm: true,
                  acknowledgeRisk: ack,
                  text: body.trim(),
                });
                onDone(true);
              })
            }
          />
        </View>
      </View>
    </Glass>
  );
}

const styles = StyleSheet.create({
  input: {
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  ack: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
