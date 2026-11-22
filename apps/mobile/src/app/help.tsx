import { Ionicons } from '@expo/vector-icons';
import {
  FEATURE_HELP_CATEGORIES,
  FEATURE_HELP_CATEGORY_LABELS,
  featureHelp,
  searchFeatureHelp,
  type FeatureHelpEntry,
} from '@sampledge/contracts';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { BRAND, GuideView, HelpMark } from '../components/FeatureHelp';
import { Glass } from '../components/Glass';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { usePlatformMe } from '../components/PlatformBits';
import { useApp } from '../state/AppProvider';
import { alpha, fonts, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';

/** Every feature guide, searchable and grouped, the same content as the web app. */
export default function FeatureGuides() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { session } = useApp();
  const platform = usePlatformMe();
  const admin = session?.user.role === 'owner' || session?.user.role === 'admin';
  const [selected, setSelected] = useState<string | null>(id ?? null);
  const [q, setQ] = useState('');
  const entry = selected ? featureHelp(selected) : undefined;

  if (entry)
    return (
      <Screen edges={[]}>
        <View style={{ flex: 1, backgroundColor: c.surfaceRaised }}>
          <GuideView entry={entry} onBack={() => setSelected(null)} onRelated={setSelected} />
        </View>
      </Screen>
    );

  const visible = (e: FeatureHelpEntry) =>
    e.audience === 'everyone' || (e.audience === 'admins' ? admin : !!platform);
  const results = searchFeatureHelp(q).filter(visible);
  const groups = q.trim()
    ? [{ key: 'results', title: `${results.length} matching`, items: results }]
    : FEATURE_HELP_CATEGORIES.map((k) => ({
        key: k,
        title: FEATURE_HELP_CATEGORY_LABELS[k],
        items: results.filter((e) => e.category === k),
      })).filter((g) => g.items.length);

  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.intro, { borderColor: alpha(BRAND.gold, 0.5) }]}>
          <HelpMark size={36} />
          <View style={{ flex: 1 }}>
            <Text variant="heading">How SampConnect works</Text>
            <Text variant="meta" tone="muted">
              Tap the gold i next to any feature to open its guide right where you are.
            </Text>
          </View>
        </View>
        <View style={[styles.search, { backgroundColor: c.surfaceSunken, borderColor: c.border }]}>
          <Ionicons name="search" size={16} color={c.textSubtle} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search guides"
            placeholderTextColor={c.textSubtle}
            accessibilityLabel="Search guides"
            style={{ flex: 1, color: c.text, fontFamily: fonts.regular, fontSize: 15, padding: 0 }}
          />
        </View>
        {groups.length === 0 ? (
          <Text tone="muted" style={{ textAlign: 'center', marginTop: space.xl }}>
            No guide matches.
          </Text>
        ) : null}
        {groups.map((g) => (
          <View key={g.key} style={{ gap: space.sm }}>
            <Text variant="overline" style={{ color: BRAND.goldInk, marginLeft: space.xs }}>
              {g.title}
            </Text>
            <Glass>
              {g.items.map((e, i) => (
                <Pressable
                  key={e.id}
                  onPress={() => setSelected(e.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${e.title}. ${e.summary}`}
                  style={({ pressed }) => [
                    styles.row,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
                    pressed && { backgroundColor: c.surfaceSunken },
                  ]}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="bodyStrong">{e.title}</Text>
                    <Text variant="meta" tone="muted" numberOfLines={2}>
                      {e.summary}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={c.textSubtle} />
                </Pressable>
              ))}
            </Glass>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
    backgroundColor: alpha(BRAND.green, 0.1),
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
  },
});
