import { Ionicons } from '@expo/vector-icons';
import { MAX_POLL_OPTIONS } from '@sampledge/contracts';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { Button } from '../../components/Button';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { pollDraftProblem } from '../../lib/polls';
import { useWorkspace } from '../../state/AppProvider';
import { alpha, radius, space, type as typeScale } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

const CLOSES: { key: string; label: string; ms: number | null }[] = [
  { key: 'never', label: 'Until I close it', ms: null },
  { key: '1h', label: '1 hour', ms: 3_600_000 },
  { key: '1d', label: '1 day', ms: 86_400_000 },
  { key: '1w', label: '1 week', ms: 7 * 86_400_000 },
];

/**
 * New poll for a conversation, or (with `edit`) changes to one nobody has voted on yet.
 * Works offline: it shows at once and is sent on reconnect.
 */
export default function NewPoll() {
  const { conversationId, edit } = useLocalSearchParams<{
    conversationId: string;
    /** Server id of the poll message to change. */
    edit?: string;
  }>();
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [closes, setCloses] = useState('never');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = engine.queueBlocker();
  // When editing: keep the current closing time unless another one is picked.
  const [keepCloses, setKeepCloses] = useState<string | null>(null);

  useEffect(() => {
    if (!edit) return;
    void engine.store.getMessageByServerId(edit).then((m) => {
      if (!m?.poll) return;
      setQuestion(m.poll.question);
      setOptions(m.poll.options.map((o) => o.text));
      setMultiple(m.poll.multiple);
      setAnonymous(m.poll.anonymous);
      if (m.poll.closesAt) {
        setKeepCloses(m.poll.closesAt);
        setCloses('keep');
      }
    });
  }, [edit, engine]);
  const closeChoices = keepCloses
    ? [
        {
          key: 'keep',
          label: `Keep (${new Date(keepCloses).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })})`,
          ms: null,
        },
        ...CLOSES,
      ]
    : CLOSES;

  const input = [
    typeScale.body,
    styles.input,
    { color: c.text, backgroundColor: c.surfaceSunken, borderColor: c.border },
  ];

  const post = async () => {
    const problem = pollDraftProblem(question, options);
    if (problem) return setError(problem);
    const ms = CLOSES.find((x) => x.key === closes)?.ms ?? null;
    setBusy(true);
    setError(null);
    if (edit) {
      try {
        await engine.editPoll(edit, {
          question: question.trim(),
          options: options.map((o) => o.trim()).filter(Boolean),
          multiple,
          anonymous,
          closesAt:
            closes === 'keep' ? keepCloses : ms ? new Date(Date.now() + ms).toISOString() : null,
        });
        router.back();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
      }
      return;
    }
    try {
      await engine.createPoll(conversationId, {
        question: question.trim(),
        options: options.map((o) => o.trim()).filter(Boolean),
        multiple,
        anonymous,
        closesAt: ms ? new Date(Date.now() + ms).toISOString() : null,
      });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: edit ? 'Edit poll' : 'New poll' }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: 6 }}>
            <Text variant="label" tone="muted">
              Question
            </Text>
            <TextInput
              value={question}
              onChangeText={(t) => {
                setQuestion(t);
                setError(null);
              }}
              placeholder="What should we decide?"
              placeholderTextColor={c.textSubtle}
              maxLength={300}
              multiline
              accessibilityLabel="Question"
              style={input}
            />
          </View>
          <View style={{ gap: 6 }}>
            <Text variant="label" tone="muted">
              Options
            </Text>
            {options.map((o, i) => (
              <View key={i} style={styles.optionRow}>
                <TextInput
                  value={o}
                  onChangeText={(t) => {
                    setOptions((all) => all.map((x, j) => (j === i ? t : x)));
                    setError(null);
                  }}
                  placeholder={`Option ${i + 1}`}
                  placeholderTextColor={c.textSubtle}
                  maxLength={200}
                  accessibilityLabel={`Option ${i + 1}`}
                  style={[input, { flex: 1 }]}
                />
                {options.length > 2 ? (
                  <Pressable
                    onPress={() => setOptions((all) => all.filter((_, j) => j !== i))}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove option ${i + 1}`}
                    hitSlop={8}
                  >
                    <Ionicons name="close-circle" size={22} color={c.textSubtle} />
                  </Pressable>
                ) : null}
              </View>
            ))}
            {options.length < MAX_POLL_OPTIONS ? (
              <Button
                title="Add option"
                kind="quiet"
                icon="add"
                onPress={() => setOptions((all) => [...all, ''])}
              />
            ) : null}
          </View>
          <Glass style={{ padding: space.md, gap: space.md }}>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">Allow more than one choice</Text>
              </View>
              <Switch
                value={multiple}
                onValueChange={setMultiple}
                accessibilityLabel="Allow more than one choice"
              />
            </View>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">Anonymous</Text>
                <Text variant="meta" tone="muted">
                  Only counts are shown. Nobody, not even admins, sees who voted for what.
                </Text>
              </View>
              <Switch
                value={anonymous}
                onValueChange={setAnonymous}
                accessibilityLabel="Anonymous"
              />
            </View>
          </Glass>
          <View style={{ gap: 6 }}>
            <Text variant="label" tone="muted">
              Voting closes
            </Text>
            <View style={styles.chips} accessibilityRole="radiogroup">
              {closeChoices.map((x) => {
                const on = x.key === closes;
                return (
                  <Pressable
                    key={x.key}
                    onPress={() => setCloses(x.key)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: on ? c.accent : alpha(c.text, 0.06),
                        borderColor: on ? c.accent : c.border,
                      },
                    ]}
                  >
                    <Text variant="label" style={{ color: on ? c.onAccent : c.text }}>
                      {x.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          {error || blocked ? (
            <Text variant="meta" tone="danger" accessibilityLiveRegion="polite">
              {error ?? `${blocked}`}
            </Text>
          ) : null}
          <Button
            title={edit ? 'Save changes' : 'Post poll'}
            icon="stats-chart"
            busy={busy}
            disabled={!!blocked}
            onPress={() => void post()}
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
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
