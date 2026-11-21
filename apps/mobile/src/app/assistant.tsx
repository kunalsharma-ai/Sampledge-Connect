import { Ionicons } from '@expo/vector-icons';
import type { AiDigest, AiSearchHit, AiStatus } from '@sampledge/contracts';
import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { Button } from '../components/Button';
import { Chips } from '../components/Chips';
import { Glass } from '../components/Glass';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { Pill } from '../components/WorkRows';
import { DIGEST_STATUS_LABEL, engineLine } from '../lib/ai';
import { useWorkspace } from '../state/AppProvider';
import { conversationTitle, useConversations, usePeople } from '../state/hooks';
import { alpha, radius, space, type as typeScale } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';

type Tab = 'ask' | 'search' | 'digest';
type Turn = { role: 'user' | 'assistant'; text: string; sources?: AiSearchHit[] };

/**
 * The private assistant: ask a question about your conversations, search by meaning, or get a
 * status digest. Runs on your organization's server; answers cite the messages they used.
 */
export default function Assistant() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('ask');
  const blocked = engine.serverActionBlocker();

  useEffect(() => {
    if (blocked) return;
    const load = () =>
      void engine
        .aiStatus()
        .then(setStatus)
        .catch((e: unknown) => setStatusError(e instanceof Error ? e.message : String(e)));
    load();
    // An admin turning the assistant on or off elsewhere applies here at once.
    return engine.events.on('tenant', (e) => e.area === 'ai' && load());
  }, [engine, blocked]);

  const toggle = async (enabled: boolean) => {
    try {
      setStatus(await engine.setAiEnabled(enabled));
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'AI Assistant' }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 100 }}
          keyboardShouldPersistTaps="handled"
        >
          <Glass style={{ padding: space.md, gap: space.sm }}>
            <View style={styles.row}>
              <Ionicons name="sparkles" size={18} color={c.accent} />
              <Text variant="meta" tone="muted" style={{ flex: 1 }}>
                {blocked
                  ? `${blocked} The assistant runs on your organization's server.`
                  : status
                    ? engineLine(status)
                    : (statusError ?? 'Checking the assistant…')}
              </Text>
            </View>
            {status?.lastError ? (
              <Text variant="meta" tone="danger">
                The model server did not answer last time ({status.lastError}). Using the built-in
                assistant meanwhile.
              </Text>
            ) : null}
            {status?.canManage ? (
              <View style={styles.row}>
                <Text variant="bodyStrong" style={{ flex: 1 }}>
                  Assistant on for everyone
                </Text>
                <Switch
                  value={status.enabled}
                  onValueChange={(v) => void toggle(v)}
                  accessibilityLabel="Assistant on for everyone"
                />
              </View>
            ) : null}
            {status?.canManage && status.engine !== 'model' && status.enabled ? (
              <Pressable
                onPress={() => router.push('/admin/integrations')}
                accessibilityRole="link"
              >
                <Text variant="label" style={{ color: c.accent }}>
                  Connect a model server in Integrations
                </Text>
              </Pressable>
            ) : null}
          </Glass>
          {status && !status.enabled ? null : (
            <>
              <Chips
                label="Assistant"
                options={[
                  { key: 'ask', label: 'Ask' },
                  { key: 'search', label: 'Search' },
                  { key: 'digest', label: 'Status digest' },
                ]}
                selected={[tab]}
                onToggle={setTab}
              />
              {tab === 'ask' ? <Ask /> : tab === 'search' ? <Search /> : <Digest />}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function useInputStyle() {
  const { theme } = useTheme();
  const c = theme.colors;
  return [
    typeScale.body,
    styles.input,
    { color: c.text, backgroundColor: c.surfaceSunken, borderColor: c.border },
  ];
}

function Ask() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const input = useInputStyle();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    const question = q.trim();
    if (question.length < 2) return;
    setBusy(true);
    setError(null);
    const history = turns.slice(-10).map((t) => ({ role: t.role, text: t.text.slice(0, 4000) }));
    setTurns((all) => [...all, { role: 'user', text: question }]);
    setQ('');
    try {
      const r = await engine.aiAsk({ question, history });
      setTurns((all) => [...all, { role: 'assistant', text: r.answer, sources: r.sources }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setTurns((all) => all.slice(0, -1));
      setQ(question);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space.md }}>
      {!turns.length ? (
        <Text tone="muted">
          Ask about anything in conversations you can read, like “What did we decide about the wave
          3 incentive?” Answers list the messages they came from.
        </Text>
      ) : null}
      {turns.map((t, i) => (
        <View
          key={i}
          style={[
            styles.turn,
            t.role === 'user'
              ? { alignSelf: 'flex-end', backgroundColor: c.accent }
              : { alignSelf: 'stretch', backgroundColor: c.surfaceRaised, borderColor: c.border },
          ]}
        >
          <Text style={t.role === 'user' ? { color: c.onAccent } : undefined}>{t.text}</Text>
          {t.sources?.length ? (
            <View style={{ gap: space.sm, marginTop: space.sm }}>
              <Text variant="label" tone="muted">
                Sources
              </Text>
              {t.sources.map((h, n) => (
                <Hit key={h.messageId + n} hit={h} index={n + 1} />
              ))}
            </View>
          ) : null}
        </View>
      ))}
      {busy ? <ActivityIndicator color={c.accent} /> : null}
      {error ? (
        <Text variant="meta" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <View style={styles.row}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Ask a question"
          placeholderTextColor={c.textSubtle}
          maxLength={1000}
          accessibilityLabel="Ask a question"
          onSubmitEditing={() => void ask()}
          returnKeyType="send"
          style={[input, { flex: 1 }]}
        />
        <Pressable
          onPress={() => void ask()}
          disabled={busy || q.trim().length < 2}
          accessibilityRole="button"
          accessibilityLabel="Ask"
          style={[
            styles.send,
            { backgroundColor: q.trim().length >= 2 ? c.accent : alpha(c.text, 0.1) },
          ]}
        >
          <Ionicons
            name="arrow-up"
            size={20}
            color={q.trim().length >= 2 ? c.onAccent : c.textSubtle}
          />
        </Pressable>
      </View>
      {turns.length ? (
        <Button title="New question" kind="quiet" icon="refresh" onPress={() => setTurns([])} />
      ) : null}
    </View>
  );
}

function Search() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const input = useInputStyle();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<AiSearchHit[] | null>(null);
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (q.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const r = await engine.aiSearch({ query: q.trim(), limit: 20 });
      setHits(r.hits);
      setPending(r.pendingIndex);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space.md }}>
      <Text tone="muted">Finds messages by meaning, not just matching words.</Text>
      <View style={styles.row}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="e.g. delays with the Germany panel"
          placeholderTextColor={c.textSubtle}
          maxLength={500}
          accessibilityLabel="Search by meaning"
          onSubmitEditing={() => void run()}
          returnKeyType="search"
          style={[input, { flex: 1 }]}
        />
        <Pressable
          onPress={() => void run()}
          accessibilityRole="button"
          accessibilityLabel="Search"
          style={[styles.send, { backgroundColor: c.accent }]}
        >
          <Ionicons name="search" size={18} color={c.onAccent} />
        </Pressable>
      </View>
      {busy ? <ActivityIndicator color={c.accent} /> : null}
      {error ? (
        <Text variant="meta" tone="danger">
          {error}
        </Text>
      ) : null}
      {hits && !busy ? (
        hits.length ? (
          hits.map((h, i) => <Hit key={h.messageId + i} hit={h} />)
        ) : (
          <Text tone="muted">Nothing close to that.</Text>
        )
      ) : null}
      {pending ? (
        <Text variant="meta" tone="subtle">
          {pending} newer message{pending === 1 ? ' is' : 's are'} still being indexed.
        </Text>
      ) : null}
    </View>
  );
}

function Digest() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine, selfId } = useWorkspace();
  const nameOf = usePeople();
  const { conversations } = useConversations();
  const [since, setSince] = useState<'24' | '168'>('168');
  const [d, setD] = useState<AiDigest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError(null);
    engine
      .aiDigest({ sinceHours: Number(since) })
      .then((r) => alive && setD(r))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [engine, since]);

  const title = (id: string) => {
    const conv = conversations.find((x) => x.conversationId === id);
    return conv ? conversationTitle(conv, nameOf, selfId) : 'A conversation';
  };
  const tone = (s: keyof typeof DIGEST_STATUS_LABEL) =>
    s === 'on_track' ? c.success : s === 'needs_attention' ? c.warning : c.textSubtle;

  return (
    <View style={{ gap: space.md }}>
      <Chips
        label="Since"
        options={[
          { key: '24', label: 'Last day' },
          { key: '168', label: 'Last week' },
        ]}
        selected={[since]}
        onToggle={setSince}
      />
      {busy ? <ActivityIndicator color={c.accent} /> : null}
      {error ? (
        <Text variant="meta" tone="danger">
          {error}
        </Text>
      ) : null}
      {d && !busy
        ? d.items.map((it) => (
            <Pressable
              key={it.conversationId}
              onPress={() =>
                router.push({ pathname: '/summary/[id]', params: { id: it.conversationId } })
              }
              accessibilityRole="button"
              accessibilityLabel={`${title(it.conversationId)}: ${DIGEST_STATUS_LABEL[it.status]}. Open summary`}
            >
              <Glass style={{ padding: space.md, gap: 6 }}>
                <View style={styles.row}>
                  <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                    {title(it.conversationId)}
                  </Text>
                  <Pill label={DIGEST_STATUS_LABEL[it.status]} color={tone(it.status)} />
                </View>
                <Text variant="meta" tone="muted" numberOfLines={3}>
                  {it.summary || `${it.messageCount} messages`}
                </Text>
              </Glass>
            </Pressable>
          ))
        : null}
      {d && !busy && d.suggestedTasks.length ? (
        <View style={{ gap: space.sm }}>
          <Text variant="label" tone="muted">
            Suggested tasks
          </Text>
          {d.suggestedTasks.map((t, i) => (
            <Pressable
              key={i}
              onPress={() =>
                router.push({
                  pathname: '/task/new',
                  params: {
                    conversationId: t.conversationId,
                    title: t.text,
                    ...(t.messageId ? { messageId: t.messageId } : {}),
                  },
                })
              }
              accessibilityRole="button"
              accessibilityLabel={`Create task: ${t.text}`}
              style={[styles.suggest, { borderColor: c.border }]}
            >
              <Ionicons name="add-circle-outline" size={20} color={c.accent} />
              <View style={{ flex: 1 }}>
                <Text>{t.text}</Text>
                <Text variant="meta" tone="muted">
                  {title(t.conversationId)}
                  {t.due ? ` · ${t.due}` : ''}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Hit({ hit: h, index }: { hit: AiSearchHit; index?: number }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { selfId } = useWorkspace();
  const nameOf = usePeople();
  const { conversations } = useConversations();
  const conv = conversations.find((x) => x.conversationId === h.conversationId);
  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: '/conversation/[id]',
          params: { id: h.conversationId, focus: h.messageId },
        })
      }
      accessibilityRole="button"
      accessibilityHint="Opens the message"
      style={({ pressed }) => [
        styles.hit,
        { borderColor: c.border, backgroundColor: pressed ? alpha(c.accent, 0.08) : 'transparent' },
      ]}
    >
      <Text variant="meta" tone="muted">
        {index ? `[${index}] ` : ''}
        {h.senderId === selfId ? 'You' : nameOf(h.senderId)}
        {conv ? ` in ${conversationTitle(conv, nameOf, selfId)}` : ''} ·{' '}
        {new Date(h.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}
        {h.fromTranscript ? ' · Transcript' : ''}
      </Text>
      <Text numberOfLines={3}>{h.text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: {
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  send: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  turn: {
    maxWidth: '100%',
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  hit: {
    gap: 2,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  suggest: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
