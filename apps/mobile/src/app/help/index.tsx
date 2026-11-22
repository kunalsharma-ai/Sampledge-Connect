import { Ionicons } from '@expo/vector-icons';
import {
  FEATURE_HELP,
  FEATURE_HELP_CATEGORIES,
  FEATURE_HELP_CATEGORY_LABELS,
  HELP_FAQS,
  featureHelp,
  searchFaqs,
  searchFeatureHelp,
  type FeatureHelpEntry,
  type SupportQuery,
} from '@sampledge/contracts';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { BRAND, GuideView, HelpMark } from '../../components/FeatureHelp';
import { FaqRow, StatusPill, ago } from '../../components/HelpBits';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { useApp } from '../../state/AppProvider';
import { useTenantRole } from '../../state/hooks';
import { useInNetwork } from '../../state/useNetwork';
import { useSupportList, useSupportPending, type SupportScope } from '../../state/useSupport';
import { alpha, fonts, radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

type Tab = 'home' | 'guides' | 'faqs' | 'mine' | 'team';

/**
 * The Help center: feature guides, FAQs, and questions to your admins or SampConnect support,
 * the same content and the same questions as on the web.
 */
export default function HelpCenter() {
  const { theme } = useTheme();
  const c = theme.colors;
  const params = useLocalSearchParams<{ id?: string; tab?: Tab }>();
  const { session } = useApp();
  const role = useTenantRole();
  const network = useInNetwork();
  const admin = !network && (role === 'owner' || role === 'admin');
  const [tab, setTab] = useState<Tab>(params.id ? 'guides' : (params.tab ?? 'home'));
  const [guide, setGuide] = useState<string | null>(params.id ?? null);
  const [q, setQ] = useState('');
  const mine = useSupportList('mine');
  const team = useSupportList('org', admin);

  const visible = (e: FeatureHelpEntry) =>
    e.audience === 'everyone' || (e.audience === 'admins' && admin);
  const faqs = HELP_FAQS.filter((f) => !f.adminOnly || admin);
  const entry = guide ? featureHelp(guide) : undefined;
  const openGuide = (id: string) => {
    setGuide(id);
    setTab('guides');
    setQ('');
  };

  if (tab === 'guides' && entry)
    return (
      <Screen edges={[]}>
        <View style={{ flex: 1, backgroundColor: c.surfaceRaised }}>
          <GuideView entry={entry} onBack={() => setGuide(null)} onRelated={setGuide} />
          <Pressable
            onPress={() => router.push({ pathname: '/help/ask', params: { featureId: entry.id } })}
            accessibilityRole="button"
            style={[styles.askBar, { borderTopColor: c.border }]}
          >
            <Text variant="label" tone="muted">
              Still unsure?
            </Text>
            <Text variant="label" style={{ color: theme.dark ? '#4FD1A1' : BRAND.green }}>
              Ask about {entry.title}
            </Text>
          </Pressable>
        </View>
      </Screen>
    );

  const firstName = (session?.user.displayName ?? '').split(' ')[0];
  const unread = (mine.items ?? []).filter(
    (x) => x.status === 'answered' && x.lastReplySide && x.lastReplySide !== 'requester',
  ).length;
  const teamOpen = (team.items ?? []).filter(
    (x) => x.status === 'open' || x.status === 'in_progress',
  ).length;
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'home', label: 'Overview' },
    { key: 'guides', label: 'Guides' },
    { key: 'faqs', label: 'FAQs' },
    { key: 'mine', label: 'My questions', count: unread },
    ...(admin ? [{ key: 'team' as Tab, label: 'Team', count: teamOpen }] : []),
  ];
  const searching = q.trim().length > 0;

  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 80 }}
        keyboardShouldPersistTaps="handled"
        stickyHeaderIndices={[1]}
      >
        <LinearGradient
          colors={['#0B5A41', BRAND.greenDeep, BRAND.green, '#169A6C']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.glow} pointerEvents="none" />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="help-buoy" size={14} color={BRAND.goldLight} />
            <Text variant="overline" style={{ color: BRAND.goldLight }}>
              Help center
            </Text>
          </View>
          <Text variant="display" style={{ color: '#FFFFFF', marginTop: space.xs }}>
            How can we help{firstName ? `, ${firstName}` : ''}?
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.86)', marginTop: 2 }}>
            Guides, quick answers and a direct line to your admins or SampConnect support.
          </Text>
          <View style={styles.search}>
            <Ionicons name="search" size={18} color={BRAND.green} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search guides and answers"
              placeholderTextColor="#4B6B5E"
              accessibilityLabel="Search help"
              style={{
                flex: 1,
                color: '#0B3B2B',
                fontFamily: fonts.regular,
                fontSize: 15,
                padding: 0,
              }}
            />
          </View>
        </LinearGradient>

        <View
          style={[styles.tabsWrap, { backgroundColor: c.background, borderBottomColor: c.border }]}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabs}
          >
            {tabs.map((t) => {
              const on = !searching && tab === t.key;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => {
                    setTab(t.key);
                    setGuide(null);
                    setQ('');
                  }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  aria-selected={on}
                  style={[
                    styles.tab,
                    on
                      ? { backgroundColor: BRAND.green, borderColor: BRAND.gold }
                      : { borderColor: c.border },
                  ]}
                >
                  <Text variant="label" style={{ color: on ? '#FFFFFF' : c.textMuted }}>
                    {t.label}
                  </Text>
                  {t.count ? (
                    <View style={styles.count}>
                      <Text style={{ fontSize: 11, fontFamily: fonts.bold, color: '#3D2A00' }}>
                        {t.count}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View style={{ padding: space.lg, gap: space.lg }}>
          {searching ? (
            <>
              {searchFeatureHelp(q)
                .filter(visible)
                .slice(0, 5)
                .map((g) => (
                  <GuideRow key={g.id} e={g} onPress={() => openGuide(g.id)} />
                ))}
              <Glass>
                {searchFaqs(q, faqs)
                  .slice(0, 8)
                  .map((f, i) => (
                    <FaqRow
                      key={f.id}
                      f={f}
                      onGuide={openGuide}
                      divider={i > 0}
                      initiallyOpen={i === 0}
                    />
                  ))}
              </Glass>
              <AskCard text="Not what you were looking for?" />
            </>
          ) : tab === 'home' ? (
            <>
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Tile
                  icon="book"
                  title="Guides"
                  text={`${FEATURE_HELP.filter(visible).length} features`}
                  onPress={() => setTab('guides')}
                />
                <Tile
                  icon="help-circle"
                  title="FAQs"
                  text={`${faqs.length} answers`}
                  onPress={() => setTab('faqs')}
                />
                <Tile
                  icon="chatbubble-ellipses"
                  title="Ask"
                  text="Get help"
                  onPress={() => router.push('/help/ask')}
                  accent
                />
              </View>
              {mine.items?.length ? (
                <Section title="Your recent questions">
                  <Glass>
                    {mine.items.slice(0, 3).map((x, i) => (
                      <QueryRow key={x.queryId} q={x} scope="mine" divider={i > 0} />
                    ))}
                  </Glass>
                </Section>
              ) : null}
              <Section title="Popular questions">
                <Glass>
                  {['not-answered', 'offline', 'edit-delete', 'record', 'ai-private']
                    .map((id) => faqs.find((f) => f.id === id))
                    .filter((f) => !!f)
                    .map((f, i) => (
                      <FaqRow key={f.id} f={f} onGuide={openGuide} divider={i > 0} />
                    ))}
                </Glass>
              </Section>
              <AskCard text="Can’t find what you need?" />
            </>
          ) : tab === 'guides' ? (
            FEATURE_HELP_CATEGORIES.map((cat) => {
              const items = (FEATURE_HELP as readonly FeatureHelpEntry[]).filter(
                (e) => e.category === cat && visible(e),
              );
              return items.length ? (
                <Section key={cat} title={FEATURE_HELP_CATEGORY_LABELS[cat]}>
                  <Glass>
                    {items.map((e, i) => (
                      <GuideRow
                        key={e.id}
                        e={e}
                        onPress={() => setGuide(e.id)}
                        divider={i > 0}
                        flat
                      />
                    ))}
                  </Glass>
                </Section>
              ) : null;
            })
          ) : tab === 'faqs' ? (
            <>
              {FEATURE_HELP_CATEGORIES.map((cat) => {
                const items = faqs.filter((f) => f.category === cat);
                return items.length ? (
                  <Section key={cat} title={FEATURE_HELP_CATEGORY_LABELS[cat]}>
                    <Glass>
                      {items.map((f, i) => (
                        <FaqRow key={f.id} f={f} onGuide={openGuide} divider={i > 0} />
                      ))}
                    </Glass>
                  </Section>
                ) : null;
              })}
              <AskCard text="Didn’t find your answer?" />
            </>
          ) : (
            <Queries
              scope={tab === 'team' ? 'org' : 'mine'}
              items={(tab === 'team' ? team : mine).items}
            />
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="overline" style={{ color: BRAND.goldInk, marginLeft: space.xs }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Tile({
  icon,
  title,
  text,
  onPress,
  accent,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  text: string;
  onPress: () => void;
  accent?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${text}`}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: accent ? BRAND.green : theme.colors.surface,
          borderColor: accent ? BRAND.gold : theme.colors.border,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
      ]}
    >
      <View
        style={[
          styles.tileIcon,
          { backgroundColor: accent ? 'rgba(255,255,255,0.16)' : BRAND.green },
        ]}
      >
        <Ionicons name={icon} size={18} color={BRAND.goldLight} />
      </View>
      <Text variant="bodyStrong" style={accent ? { color: '#FFFFFF' } : undefined}>
        {title}
      </Text>
      <Text
        variant="meta"
        style={{ color: accent ? 'rgba(255,255,255,0.85)' : theme.colors.textMuted }}
      >
        {text}
      </Text>
    </Pressable>
  );
}

function GuideRow({
  e,
  onPress,
  divider,
  flat,
}: {
  e: FeatureHelpEntry;
  onPress: () => void;
  divider?: boolean;
  flat?: boolean;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const row = (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${e.title}. ${e.summary}`}
      style={({ pressed }) => [
        styles.row,
        divider && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
        pressed && { backgroundColor: c.surfaceSunken },
      ]}
    >
      <HelpMark size={22} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{e.title}</Text>
        <Text variant="meta" tone="muted" numberOfLines={2}>
          {e.summary}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={c.textSubtle} />
    </Pressable>
  );
  return flat ? row : <Glass>{row}</Glass>;
}

function AskCard({ text }: { text: string }) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.askCard,
        {
          borderColor: alpha(BRAND.gold, 0.55),
          backgroundColor: alpha(BRAND.green, theme.dark ? 0.16 : 0.08),
        },
      ]}
    >
      <View style={styles.askIcon}>
        <Ionicons name="headset" size={20} color={BRAND.goldLight} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">{text}</Text>
        <Text variant="meta" tone="muted">
          Ask your admins or SampConnect support.
        </Text>
      </View>
      <Pressable
        onPress={() => router.push('/help/ask')}
        accessibilityRole="button"
        style={styles.askBtn}
      >
        <Text variant="label" style={{ color: '#FFFFFF' }}>
          Ask
        </Text>
      </Pressable>
    </View>
  );
}

function Queries({ scope, items }: { scope: SupportScope; items: SupportQuery[] | null }) {
  const { theme } = useTheme();
  const pending = useSupportPending().filter(
    (p) => scope === 'mine' && p.method === 'POST' && p.path === '/v1/support/queries',
  );
  if (items === null && !pending.length)
    return (
      <Text tone="muted" style={{ textAlign: 'center', marginTop: space.xl }}>
        Loading questions…
      </Text>
    );
  if (!items?.length && !pending.length)
    return (
      <View style={{ alignItems: 'center', gap: space.sm, marginTop: space.xl }}>
        <View style={[styles.askIcon, { width: 56, height: 56, borderRadius: 28 }]}>
          <Ionicons name="chatbubble-ellipses" size={24} color={BRAND.goldLight} />
        </View>
        <Text variant="heading">{scope === 'mine' ? 'No questions yet' : 'No questions here'}</Text>
        <Text tone="muted" style={{ textAlign: 'center' }}>
          {scope === 'mine'
            ? 'Questions you ask, and every reply, show here on all your devices.'
            : 'Questions from your team show here, live.'}
        </Text>
        {scope === 'mine' ? <AskCard text="Need a hand?" /> : null}
      </View>
    );
  return (
    <Glass>
      {pending.map((p, i) => (
        <View
          key={i}
          style={[
            styles.row,
            i > 0 && {
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: theme.colors.border,
            },
          ]}
        >
          <View style={{ flex: 1, gap: 4 }}>
            <StatusPill status="sending" />
            <Text variant="bodyStrong" numberOfLines={1}>
              {(p.body as { subject: string }).subject}
            </Text>
          </View>
        </View>
      ))}
      {(items ?? []).map((x, i) => (
        <QueryRow key={x.queryId} q={x} scope={scope} divider={i > 0 || pending.length > 0} />
      ))}
    </Glass>
  );
}

function QueryRow({
  q,
  scope,
  divider,
}: {
  q: SupportQuery;
  scope: SupportScope;
  divider?: boolean;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const fresh =
    q.status !== 'resolved' &&
    !!q.lastReplySide &&
    (scope === 'mine' ? q.lastReplySide !== 'requester' : q.lastReplySide === 'requester');
  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: '/help/query/[id]', params: { id: q.queryId, scope } })
      }
      accessibilityRole="button"
      accessibilityLabel={`${q.subject}, ${q.status}`}
      style={({ pressed }) => [
        styles.row,
        divider && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
        pressed && { backgroundColor: c.surfaceSunken },
      ]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <StatusPill status={q.status} />
          {fresh ? <View style={styles.dot} accessibilityLabel="New reply" /> : null}
          <Text variant="meta" tone="subtle" style={{ marginLeft: 'auto' }}>
            {ago(q.updatedAt)}
          </Text>
        </View>
        <Text variant="bodyStrong" numberOfLines={1}>
          {q.subject}
        </Text>
        <Text variant="meta" tone="muted" numberOfLines={1}>
          {scope === 'mine'
            ? `${q.route === 'platform' ? 'SampConnect support' : 'Your admins'} · ${q.replies.length} ${q.replies.length === 1 ? 'reply' : 'replies'}`
            : `${q.requesterName}${q.route === 'platform' ? ' · with SampConnect support' : ''}`}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={c.textSubtle} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xl,
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    right: -60,
    top: -60,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(245,184,61,0.22)',
  },
  search: {
    marginTop: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    borderWidth: 2,
    borderColor: 'rgba(245,184,61,0.7)',
  },
  tabsWrap: { borderBottomWidth: StyleSheet.hairlineWidth },
  tabs: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  count: { backgroundColor: '#F5B83D', borderRadius: radius.pill, paddingHorizontal: 6 },
  tile: { flex: 1, borderWidth: 1, borderRadius: radius.lg, padding: space.md, gap: 4 },
  tileIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#F5B83D',
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
  },
  askCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: space.lg,
  },
  askIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#12825C',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#F5B83D',
  },
  askBtn: {
    backgroundColor: '#12825C',
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: '#F5B83D',
  },
  askBar: {
    flexDirection: 'row',
    gap: space.sm,
    padding: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#F5B83D' },
});
