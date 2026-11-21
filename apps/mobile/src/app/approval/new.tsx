import { APPROVAL_CATEGORIES, type ApprovalCategory } from '@sampledge/contracts';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
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
import { APPROVAL_CATEGORY_LABEL, dueChoices, parseAmount, titleFrom } from '../../lib/work';
import { useWorkspace } from '../../state/AppProvider';
import { useMessages, usePeopleChoices } from '../../state/hooks';
import { radius, space, type as typeScale } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

/** Ask people to approve something, from a message or on its own. Works offline (sent on reconnect). */
export default function NewApproval() {
  const { conversationId, messageId } = useLocalSearchParams<{
    conversationId?: string;
    messageId?: string;
  }>();
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine, selfId } = useWorkspace();
  const { messages } = useMessages(conversationId ?? '');
  const source = messageId ? messages.find((m) => m.messageId === messageId) : undefined;
  const people = usePeopleChoices(conversationId).filter((p) => p.key !== selfId);
  const due = useMemo(() => dueChoices(new Date()), []);

  const [title, setTitle] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ApprovalCategory>('general');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [approvers, setApprovers] = useState<string[]>([]);
  const [policy, setPolicy] = useState<'any' | 'all'>('any');
  const [dueKey, setDueKey] = useState('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = engine.queueBlocker();
  const shownTitle = title ?? titleFrom(source?.text);

  const input = [
    typeScale.body,
    styles.input,
    { color: c.text, backgroundColor: c.surfaceSunken, borderColor: c.border },
  ];

  const save = async () => {
    if (!shownTitle.trim()) return setError('Say what needs approving.');
    if (!approvers.length) return setError('Pick at least one approver.');
    let money = null;
    if (amount.trim()) {
      const minor = parseAmount(amount);
      if (minor === null) return setError('Enter the amount as a number, like 1250 or 1,250.50.');
      if (!/^[A-Z]{3}$/.test(currency)) return setError('Currency is a 3-letter code, like USD.');
      money = { amountMinor: minor, currency };
    }
    setBusy(true);
    setError(null);
    try {
      const at = due.find((d) => d.key === dueKey)?.at ?? null;
      const a = await engine.createApproval({
        title: shownTitle.trim(),
        description: description.trim(),
        category,
        amount: money,
        approverIds: approvers,
        policy: approvers.length > 1 ? policy : 'any',
        dueAt: at ? at.toISOString() : null,
        conversationId: conversationId ?? null,
        sourceMessageId: messageId ?? null,
      });
      router.replace({ pathname: '/approval/[id]', params: { id: a.approvalId } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Request approval' }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
        >
          {source ? (
            <View style={[styles.quote, { borderColor: c.accent }]}>
              <Text variant="meta" tone="muted" numberOfLines={3}>
                {source.text}
              </Text>
            </View>
          ) : null}
          <View style={{ gap: 6 }}>
            <Text variant="label" tone="muted">
              What needs approving
            </Text>
            <TextInput
              value={shownTitle}
              onChangeText={(t) => {
                setTitle(t);
                setError(null);
              }}
              placeholder="e.g. Raise incentive to $5 per complete"
              placeholderTextColor={c.textSubtle}
              maxLength={200}
              accessibilityLabel="What needs approving"
              style={input}
            />
          </View>
          <View style={{ gap: 6 }}>
            <Text variant="label" tone="muted">
              Details (optional)
            </Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Why, and anything the approvers need"
              placeholderTextColor={c.textSubtle}
              maxLength={4000}
              multiline
              accessibilityLabel="Details"
              style={[input, { minHeight: 72, textAlignVertical: 'top' }]}
            />
          </View>
          <View style={{ gap: 6 }}>
            <Text variant="label" tone="muted">
              Category
            </Text>
            <Chips
              label="Category"
              options={APPROVAL_CATEGORIES.map((k) => ({
                key: k,
                label: APPROVAL_CATEGORY_LABEL[k],
              }))}
              selected={[category]}
              onToggle={setCategory}
            />
          </View>
          <View style={{ gap: 6 }}>
            <Text variant="label" tone="muted">
              Amount (optional)
            </Text>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <TextInput
                value={amount}
                onChangeText={(t) => {
                  setAmount(t);
                  setError(null);
                }}
                placeholder="0.00"
                placeholderTextColor={c.textSubtle}
                keyboardType="decimal-pad"
                accessibilityLabel="Amount"
                style={[input, { flex: 1 }]}
              />
              <TextInput
                value={currency}
                onChangeText={(t) => setCurrency(t.toUpperCase().slice(0, 3))}
                autoCapitalize="characters"
                maxLength={3}
                accessibilityLabel="Currency"
                style={[input, { width: 80, textAlign: 'center' }]}
              />
            </View>
          </View>
          <View style={{ gap: 6 }}>
            <Text variant="label" tone="muted">
              Approvers
            </Text>
            {people.length ? (
              <Chips
                label="Approvers"
                multi
                options={people}
                selected={approvers}
                onToggle={(u) => {
                  setError(null);
                  setApprovers((all) =>
                    all.includes(u) ? all.filter((x) => x !== u) : [...all, u].slice(0, 10),
                  );
                }}
              />
            ) : (
              <Text variant="meta" tone="muted">
                Nobody else is in this conversation. Add people first.
              </Text>
            )}
          </View>
          {approvers.length > 1 ? (
            <View style={{ gap: 6 }}>
              <Text variant="label" tone="muted">
                Who has to approve
              </Text>
              <Chips
                label="Who has to approve"
                options={[
                  { key: 'any', label: 'Any one of them' },
                  { key: 'all', label: 'Everyone' },
                ]}
                selected={[policy]}
                onToggle={setPolicy}
              />
            </View>
          ) : null}
          <View style={{ gap: 6 }}>
            <Text variant="label" tone="muted">
              Decide by
            </Text>
            <Chips label="Decide by" options={due} selected={[dueKey]} onToggle={setDueKey} />
          </View>
          {error || blocked ? (
            <Text variant="meta" tone="danger" accessibilityLiveRegion="polite">
              {error ?? `${blocked}`}
            </Text>
          ) : null}
          <Button
            title="Send request"
            icon="shield-checkmark-outline"
            busy={busy}
            disabled={!!blocked}
            onPress={() => void save()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  quote: { borderLeftWidth: 3, paddingLeft: space.md, paddingVertical: 2 },
});
