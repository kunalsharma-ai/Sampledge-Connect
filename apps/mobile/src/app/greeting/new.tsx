import { Ionicons } from '@expo/vector-icons';
import {
  DEFAULT_GREETING_POLICY,
  GREETING_CATEGORIES,
  GREETING_STYLES,
  GREETING_TONES,
  MAX_GREETING_TITLE,
  MAX_GREETING_TO,
  MAX_MESSAGE_LENGTH,
  greetingOccasion,
  offeredOccasions,
  searchOccasions,
  upcomingOccasions,
  type GreetingCard as Card,
  type GreetingCategory,
  type GreetingOccasion,
  type GreetingPolicy,
  type GreetingStyleId,
} from '@sampledge/contracts';
import { greetingCardLook } from '@sampledge/design-tokens';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SvgXml } from 'react-native-svg';
import { Button } from '../../components/Button';
import { HeaderTitleWithHelp } from '../../components/FeatureHelp';
import { GreetingCard } from '../../components/GreetingCard';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { useWorkspace } from '../../state/AppProvider';
import { conversationTitle, useConversation, usePeople } from '../../state/hooks';
import { alpha, radius, space, type as typeScale } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

type Tab = 'upcoming' | GreetingCategory;

/**
 * Send a festival or occasion card: pick an occasion and style, choose a message or write your
 * own, and send. It is an ordinary queued message, so it shows at once and works offline.
 */
export default function NewGreeting() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine, selfId } = useWorkspace();
  const nameOf = usePeople();
  const conv = useConversation(conversationId);
  const { width } = useWindowDimensions();
  const [policy, setPolicy] = useState<GreetingPolicy>(DEFAULT_GREETING_POLICY);
  const [tab, setTab] = useState<Tab>('upcoming');
  const [query, setQuery] = useState('');
  const [occasionId, setOccasionId] = useState('');
  const [styleId, setStyleId] = useState<GreetingStyleId>('radiant');
  const [messageIndex, setMessageIndex] = useState(0);
  const [title, setTitle] = useState('');
  const [to, setTo] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void engine.getGreetingPolicy().then(setPolicy);
    return engine.events.on('greetingPolicy', setPolicy);
  }, [engine]);

  const offered = useMemo(() => offeredOccasions(policy), [policy]);
  const upcoming = useMemo(() => upcomingOccasions(offered), [offered]);
  const occasion = greetingOccasion(occasionId);

  const choose = (o: GreetingOccasion) => {
    setOccasionId(o.id);
    setTitle(o.titles[0] ?? o.name);
    setMessageIndex(0);
    setText(o.messages[0]?.text ?? '');
    if (o.quiet && styleId === 'festive') setStyleId('minimal');
  };

  // First open: start on what's coming up, and greet the other person in a DM by first name.
  useEffect(() => {
    if (occasionId || !offered.length) return;
    setTab(upcoming.length ? 'upcoming' : offered[0]!.category);
    choose(upcoming[0] ?? offered[0]!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offered, upcoming]);
  useEffect(() => {
    if (conv?.kind === 'dm' && !to)
      setTo(conversationTitle(conv, nameOf, selfId).split(' ')[0] ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv]);

  const list = query.trim()
    ? searchOccasions(offered, query)
    : tab === 'upcoming'
      ? upcoming
      : offered.filter((o) => o.category === tab);
  const tabs: { id: Tab; name: string }[] = [
    ...(upcoming.length ? [{ id: 'upcoming' as const, name: 'Coming up' }] : []),
    ...GREETING_CATEGORIES.filter((x) => !policy.hiddenCategories.includes(x.id)),
  ];

  const card: Card | null = occasion
    ? {
        occasionId: occasion.id as Card['occasionId'],
        styleId,
        title: title.trim() || occasion.titles[0]!,
        to: to.trim() || null,
      }
    : null;
  const from = nameOf(selfId, { asWritten: true }).split(' ')[0];

  const send = async () => {
    if (!card || !text.trim()) return setError('Write a message for the card');
    setBusy(true);
    try {
      await engine.send(conversationId, text.trim(), { greeting: card });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const input = [
    typeScale.body,
    styles.input,
    { color: c.text, backgroundColor: c.surfaceSunken, borderColor: c.border },
  ];
  const chip = (on: boolean) => [
    styles.chip,
    { backgroundColor: on ? c.accent : c.surfaceRaised, borderColor: on ? c.accent : c.border },
  ];

  if (!policy.enabled || !offered.length)
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen
          options={{
            title: 'Greeting card',
            headerTitle: () => <HeaderTitleWithHelp title="Greeting card" id="greeting-cards" />,
          }}
        />
        <View style={{ padding: space.xl }}>
          <Text variant="body" tone="muted">
            Greeting cards aren’t available in this organization.
          </Text>
        </View>
      </Screen>
    );

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen
        options={{
          title: 'Greeting card',
          headerTitle: () => <HeaderTitleWithHelp title="Greeting card" id="greeting-cards" />,
        }}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
        >
          <View
            style={[styles.search, { backgroundColor: c.surfaceSunken, borderColor: c.border }]}
          >
            <Ionicons name="search" size={18} color={c.textSubtle} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search: Diwali, birthday, Eid…"
              placeholderTextColor={c.textSubtle}
              accessibilityLabel="Search occasions"
              style={[typeScale.body, { flex: 1, color: c.text, paddingVertical: 10 }]}
            />
          </View>
          {!query.trim() ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
            >
              {tabs.map((t) => (
                <Pressable
                  key={t.id}
                  onPress={() => setTab(t.id)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === t.id }}
                  style={chip(tab === t.id)}
                >
                  <Text variant="label" style={{ color: tab === t.id ? c.onAccent : c.textMuted }}>
                    {t.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
          >
            {list.map((o) => {
              const on = o.id === occasionId;
              return (
                <Pressable
                  key={o.id}
                  onPress={() => choose(o)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={o.name}
                  style={[
                    styles.occasion,
                    {
                      backgroundColor: on ? alpha(c.accent, 0.16) : c.surfaceRaised,
                      borderColor: on ? c.accent : c.border,
                    },
                  ]}
                >
                  <Text style={{ fontSize: 24 }}>{o.emoji}</Text>
                  <Text variant="label" numberOfLines={2} style={{ textAlign: 'center' }}>
                    {o.name}
                  </Text>
                </Pressable>
              );
            })}
            {!list.length ? (
              <Text variant="meta" tone="muted">
                No occasions match “{query}”.
              </Text>
            ) : null}
          </ScrollView>

          {card ? (
            <View style={{ alignItems: 'center' }}>
              <GreetingCard
                card={card}
                text={text.trim() || '…'}
                from={from}
                width={Math.min(width - space.lg * 2, 380)}
              />
            </View>
          ) : null}

          {occasion ? (
            <>
              <View style={{ gap: 8 }}>
                <Text variant="label" tone="muted">
                  Style
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 10 }}
                >
                  {GREETING_STYLES.map((s) => {
                    const look = greetingCardLook(occasion.id, s.id, { quiet: occasion.quiet });
                    const on = s.id === styleId;
                    return (
                      <Pressable
                        key={s.id}
                        onPress={() => setStyleId(s.id)}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={`${s.name}: ${s.description}`}
                        style={[
                          styles.styleTile,
                          {
                            backgroundColor: look.panel.bg,
                            borderColor: on ? c.accent : c.border,
                            borderWidth: on ? 2 : 1,
                          },
                        ]}
                      >
                        <SvgXml xml={look.svg} width={104} height={104 / look.aspect} />
                        <Text
                          variant="meta"
                          style={{ color: look.panel.fg, paddingHorizontal: 6, paddingBottom: 4 }}
                        >
                          {s.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
              <View style={{ gap: 8 }}>
                <Text variant="label" tone="muted">
                  Message
                </Text>
                {occasion.messages.map((m, i) => {
                  const on = i === messageIndex && text === m.text;
                  return (
                    <Pressable
                      key={i}
                      onPress={() => {
                        setMessageIndex(i);
                        setText(m.text);
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      style={[
                        styles.message,
                        {
                          backgroundColor: on ? alpha(c.accent, 0.12) : c.surfaceRaised,
                          borderColor: on ? c.accent : c.border,
                        },
                      ]}
                    >
                      <Text variant="label" style={{ color: c.accent }}>
                        {GREETING_TONES.find((t) => t.id === m.tone)?.name}
                      </Text>
                      <Text variant="meta" tone="muted" numberOfLines={2}>
                        {m.text}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={{ gap: 6 }}>
                <Text variant="label" tone="muted">
                  Headline
                </Text>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  maxLength={MAX_GREETING_TITLE}
                  accessibilityLabel="Headline"
                  style={input}
                />
              </View>
              <View style={{ gap: 6 }}>
                <Text variant="label" tone="muted">
                  To (optional)
                </Text>
                <TextInput
                  value={to}
                  onChangeText={setTo}
                  maxLength={MAX_GREETING_TO}
                  placeholder="Priya, team, everyone"
                  placeholderTextColor={c.textSubtle}
                  accessibilityLabel="To"
                  style={input}
                />
              </View>
              <View style={{ gap: 6 }}>
                <Text variant="label" tone="muted">
                  Your words (edit freely)
                </Text>
                <TextInput
                  value={text}
                  onChangeText={(t) => {
                    setText(t);
                    setError(null);
                  }}
                  maxLength={MAX_MESSAGE_LENGTH}
                  multiline
                  accessibilityLabel="Message"
                  style={[input, { minHeight: 110, textAlignVertical: 'top' }]}
                />
              </View>
            </>
          ) : null}
          {error ? (
            <Text variant="meta" style={{ color: c.danger }}>
              {error}
            </Text>
          ) : null}
          <Button
            title="Send card"
            icon="send"
            onPress={() => void send()}
            busy={busy}
            disabled={!card}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
  },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  occasion: {
    width: 92,
    minHeight: 84,
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: 6,
  },
  styleTile: { borderRadius: radius.md, overflow: 'hidden' },
  message: { borderWidth: 1, borderRadius: radius.md, padding: 10, gap: 2 },
});
