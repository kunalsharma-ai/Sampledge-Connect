import { Ionicons } from '@expo/vector-icons';
import {
  SUPPORT_STATUSES,
  SUPPORT_STATUS_LABELS,
  SUPPORT_TEXT_MAX,
  SUPPORT_TOPIC_LABELS,
  featureHelp,
  type SupportQuery,
  type SupportSide,
} from '@sampledge/contracts';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Button } from '../../../components/Button';
import { Chips } from '../../../components/Chips';
import { BRAND } from '../../../components/FeatureHelp';
import { StatusPill, ago } from '../../../components/HelpBits';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { useApp } from '../../../state/AppProvider';
import { useTenantRole } from '../../../state/hooks';
import { useInNetwork } from '../../../state/useNetwork';
import {
  useSupportActions,
  useSupportList,
  useSupportPending,
  type SupportScope,
} from '../../../state/useSupport';
import { alpha, fonts, radius, space, type as typeScale } from '../../../theme/themes';
import { useTheme } from '../../../theme/ThemeProvider';

const SIDE_LABEL: Record<SupportSide, string> = {
  requester: '',
  org: 'Admin',
  platform: 'SampConnect support',
};

/** One question and its replies, kept live; replies written offline show until they send. */
export default function QueryThread() {
  const { theme } = useTheme();
  const c = theme.colors;
  // A notification opens this without knowing whose question it is: look in both lists.
  const params = useLocalSearchParams<{ id: string; scope?: SupportScope }>();
  const { session } = useApp();
  const role = useTenantRole();
  const network = useInNetwork();
  const admin = !network && (role === 'owner' || role === 'admin');
  const mine = useSupportList('mine');
  const team = useSupportList('org', admin);
  const lists = params.scope === 'org' ? [team.items, mine.items] : [mine.items, team.items];
  const q = lists.flatMap((l) => l ?? []).find((x) => x.queryId === params.id);
  const items = mine.items;
  const pending = useSupportPending().filter(
    (p) => (p.body as { queryId?: string }).queryId === params.id,
  );
  const { reply, update } = useSupportActions();
  const [text, setText] = useState('');

  if (!q)
    return (
      <Screen edges={['bottom']}>
        <Text tone="muted" style={{ textAlign: 'center', marginTop: space.xl }}>
          {items === null ? 'Loading…' : 'This question is no longer here.'}
        </Text>
      </Screen>
    );

  const asker = q.requesterId === session?.user.userId;
  const feature = q.featureId ? featureHelp(q.featureId) : undefined;
  const send = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    void reply(q, t);
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: q.subject }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: space.lg, gap: space.md }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: space.xs }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.sm,
                flexWrap: 'wrap',
              }}
            >
              <StatusPill status={q.status} />
              <Text variant="meta" tone="subtle">
                {SUPPORT_TOPIC_LABELS[q.topic]} ·{' '}
                {q.route === 'platform' ? 'SampConnect support' : 'Your admins'}
              </Text>
            </View>
            <Text variant="heading">{q.subject}</Text>
            {feature ? (
              <Pressable
                onPress={() => router.push({ pathname: '/help', params: { id: feature.id } })}
                accessibilityRole="link"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
              >
                <Ionicons
                  name="book-outline"
                  size={14}
                  color={theme.dark ? '#4FD1A1' : BRAND.green}
                />
                <Text variant="label" style={{ color: theme.dark ? '#4FD1A1' : BRAND.green }}>
                  {feature.title} guide
                </Text>
              </Pressable>
            ) : null}
          </View>

          <Bubble
            mine={asker}
            name={asker ? 'You' : q.requesterName}
            badge=""
            text={q.body}
            when={ago(q.createdAt)}
          />
          {q.replies.map((r) => (
            <Bubble
              key={r.replyId}
              mine={asker ? r.side === 'requester' : r.side !== 'requester'}
              name={r.authorName}
              badge={SIDE_LABEL[r.side]}
              text={r.text}
              when={ago(r.createdAt)}
            />
          ))}
          {pending
            .filter((p) => p.method === 'POST')
            .map((p, i) => (
              <Bubble
                key={`p${i}`}
                mine
                name="You"
                badge=""
                text={(p.body as { text: string }).text}
                when="Waiting to send"
              />
            ))}

          {admin && !asker ? <AdminControls q={q} onSet={(b) => void update(q, b)} /> : null}
          {asker && q.status !== 'resolved' ? (
            <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
              <Button
                kind="quiet"
                icon="checkmark-done"
                title="Mark resolved"
                onPress={() => void update(q, { status: 'resolved' })}
              />
              {q.route === 'org' ? (
                <Button
                  kind="quiet"
                  icon="headset"
                  title="Ask SampConnect support"
                  onPress={() => void update(q, { route: 'platform' })}
                />
              ) : null}
            </View>
          ) : null}
          {asker && q.status === 'resolved' ? (
            <Button
              kind="quiet"
              icon="refresh"
              title="Reopen"
              onPress={() => void update(q, { status: 'open' })}
            />
          ) : null}
        </ScrollView>

        <View
          style={[styles.composer, { borderTopColor: c.border, backgroundColor: c.surfaceRaised }]}
        >
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={asker ? 'Add a reply' : `Reply to ${q.requesterName}`}
            placeholderTextColor={c.textSubtle}
            accessibilityLabel="Reply"
            multiline
            maxLength={SUPPORT_TEXT_MAX}
            style={[
              typeScale.body,
              styles.input,
              { color: c.text, borderColor: c.border, backgroundColor: c.surfaceSunken },
            ]}
          />
          <Pressable
            onPress={send}
            disabled={!text.trim()}
            accessibilityRole="button"
            accessibilityLabel="Send reply"
            style={[styles.send, { opacity: text.trim() ? 1 : 0.5 }]}
          >
            <Ionicons name="send" size={18} color={BRAND.goldLight} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Bubble({
  mine,
  name,
  badge,
  text,
  when,
}: {
  mine: boolean;
  name: string;
  badge: string;
  text: string;
  when: string;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <View
        style={[
          styles.bubble,
          mine
            ? { backgroundColor: BRAND.green, borderBottomRightRadius: 4 }
            : {
                backgroundColor: c.surfaceRaised,
                borderColor: alpha(BRAND.gold, 0.5),
                borderWidth: 1,
                borderBottomLeftRadius: 4,
              },
        ]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text
            variant="label"
            style={{ color: mine ? BRAND.goldLight : c.text, fontFamily: fonts.semibold }}
          >
            {name}
          </Text>
          {badge && badge !== name ? (
            <View style={styles.badge}>
              <Text
                variant="meta"
                style={{ color: '#5B3B00', fontSize: 10, fontFamily: fonts.bold }}
              >
                {badge}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={{ color: mine ? '#FFFFFF' : c.text }}>{text}</Text>
        <Text variant="meta" style={{ color: mine ? 'rgba(255,255,255,0.7)' : c.textSubtle }}>
          {when}
        </Text>
      </View>
    </View>
  );
}

function AdminControls({
  q,
  onSet,
}: {
  q: SupportQuery;
  onSet: (b: { status?: string; route?: 'platform' }) => void;
}) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.admin,
        {
          borderColor: theme.colors.border,
          backgroundColor: alpha(BRAND.green, theme.dark ? 0.12 : 0.05),
        },
      ]}
    >
      <Text variant="label">Status</Text>
      <Chips
        label="Status"
        options={SUPPORT_STATUSES.map((k) => ({ key: k, label: SUPPORT_STATUS_LABELS[k] }))}
        selected={[q.status]}
        onToggle={(k) => k !== q.status && onSet({ status: k })}
      />
      {q.route === 'org' ? (
        <Button
          kind="quiet"
          icon="headset"
          title="Pass on to SampConnect support"
          onPress={() => onSet({ route: 'platform' })}
        />
      ) : (
        <Text variant="meta" tone="muted">
          SampConnect support can see and answer this question.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    maxWidth: '86%',
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    gap: 4,
  },
  badge: { backgroundColor: '#F5B83D', borderRadius: radius.pill, paddingHorizontal: 6 },
  admin: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.sm,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    padding: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    maxHeight: 120,
  },
  send: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: BRAND.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
