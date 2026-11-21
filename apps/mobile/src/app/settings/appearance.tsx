import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { useTenantRole } from '../../state/hooks';
import { customTheme, fonts, radius, space, THEMES, type Theme } from '../../theme/themes';
import { useTheme, type ThemePreference } from '../../theme/ThemeProvider';

const HEX = /^#([0-9a-f]{6})$/i;

export default function Appearance() {
  const { theme, preference, setPreference, brand, setBrand, org, orgThemeActive } = useTheme();
  const role = useTenantRole();
  const locked = !!org?.enforceTheme;
  const [primary, setPrimary] = useState(brand.primary);
  const [secondary, setSecondary] = useState(brand.secondary);

  const options: { key: ThemePreference; label: string; preview: Theme }[] = [
    { key: 'system', label: 'Match device', preview: THEMES.midnight },
    ...(Object.values(THEMES).map((t) => ({ key: t.id, label: t.name, preview: t })) as {
      key: ThemePreference;
      label: string;
      preview: Theme;
    }[]),
    { key: 'custom', label: 'Custom brand', preview: customTheme(brand) },
    ...(org
      ? [
          {
            key: 'org' as ThemePreference,
            label: org.organizationName,
            preview: customTheme({
              primary: org.primary,
              secondary: org.secondary,
              dark: org.dark,
            }),
          },
        ]
      : []),
  ];

  const applyBrand = (next: Partial<typeof brand>) => {
    const merged = { ...brand, ...next };
    if (HEX.test(merged.primary) && HEX.test(merged.secondary)) setBrand(merged);
  };

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        {org ? (
          <Glass style={{ padding: space.md, gap: space.sm }}>
            <View style={styles.field}>
              {org.logo ? (
                <Image
                  source={{ uri: org.logo }}
                  style={styles.logo}
                  resizeMode="contain"
                  accessibilityLabel={`${org.displayName} logo`}
                />
              ) : (
                <Ionicons name="color-palette-outline" size={22} color={theme.colors.accent} />
              )}
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">{org.displayName}</Text>
                <Text variant="meta" tone="muted">
                  {locked
                    ? `${org.organizationName} sets the theme for everyone.`
                    : orgThemeActive
                      ? `You are on the ${org.organizationName} theme.`
                      : `${org.organizationName} has its own theme. Pick it below.`}
                </Text>
              </View>
            </View>
            {role === 'owner' ? (
              <Pressable onPress={() => router.push('/admin/branding')} accessibilityRole="link">
                <Text variant="label" tone="accent">
                  Edit organization branding
                </Text>
              </Pressable>
            ) : null}
          </Glass>
        ) : null}
        <Text variant="overline" tone="subtle">
          Theme
        </Text>
        <View style={styles.grid}>
          {options.map((o) => {
            const active = orgThemeActive ? o.key === 'org' : preference === o.key;
            const c = o.preview.colors;
            return (
              <Pressable
                key={o.key}
                onPress={() => setPreference(o.key)}
                disabled={locked}
                accessibilityRole="radio"
                accessibilityState={{ checked: active, disabled: locked }}
                accessibilityLabel={o.label}
                style={[
                  styles.tile,
                  {
                    opacity: locked && !active ? 0.45 : 1,
                    borderColor: active ? theme.colors.accent : theme.colors.border,
                    borderWidth: active ? 2 : StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <View style={[styles.swatch, { backgroundColor: c.background }]}>
                  {o.key === 'system' ? (
                    <View
                      style={[styles.half, { backgroundColor: THEMES.arctic.colors.background }]}
                    />
                  ) : null}
                  <View style={[styles.mockCard, { backgroundColor: c.surface }]}>
                    <View
                      style={[styles.mockBubble, { backgroundColor: c.bubbleOther, width: '60%' }]}
                    />
                    <View
                      style={[
                        styles.mockBubble,
                        { backgroundColor: c.accent, width: '45%', alignSelf: 'flex-end' },
                      ]}
                    />
                    <View style={[styles.mockDot, { backgroundColor: c.accentSecondary }]} />
                  </View>
                </View>
                <View style={styles.tileLabel}>
                  <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>
                    {o.label}
                  </Text>
                  {active ? (
                    <Ionicons name="checkmark-circle" size={18} color={theme.colors.accent} />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>

        {preference === 'custom' && !orgThemeActive ? (
          <Glass style={{ padding: space.lg, gap: space.md }}>
            <Text variant="heading">Brand colours</Text>
            <Text variant="meta" tone="muted">
              Organisation branding. Text and button contrast is adjusted automatically to stay
              readable.
            </Text>
            {(
              [
                ['Primary', primary, setPrimary, 'primary'],
                ['Secondary', secondary, setSecondary, 'secondary'],
              ] as const
            ).map(([label, value, set, key]) => (
              <View key={key} style={styles.field}>
                <View
                  style={[
                    styles.colorChip,
                    {
                      backgroundColor: HEX.test(value) ? value : 'transparent',
                      borderColor: theme.colors.border,
                    },
                  ]}
                />
                <Text variant="label" style={{ width: 80 }}>
                  {label}
                </Text>
                <TextInput
                  value={value}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={7}
                  onChangeText={(v) => {
                    set(v);
                    applyBrand({ [key]: v });
                  }}
                  style={[
                    styles.input,
                    {
                      color: theme.colors.text,
                      borderColor: HEX.test(value) ? theme.colors.border : theme.colors.danger,
                      backgroundColor: theme.colors.surfaceSunken,
                    },
                  ]}
                  accessibilityLabel={`${label} colour hex`}
                />
              </View>
            ))}
            <View style={styles.field}>
              <Text variant="label" style={{ flex: 1 }}>
                Dark variant
              </Text>
              <Switch
                value={brand.dark}
                onValueChange={(dark) => applyBrand({ dark })}
                trackColor={{ true: theme.colors.accent }}
              />
            </View>
          </Glass>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile: { width: '47.5%', borderRadius: radius.lg, overflow: 'hidden' },
  swatch: { height: 96, padding: 10, justifyContent: 'flex-end' },
  half: { position: 'absolute', top: 0, bottom: 0, right: 0, left: '50%' },
  mockCard: { borderRadius: 10, padding: 8, gap: 5 },
  mockBubble: { height: 9, borderRadius: 5 },
  mockDot: { position: 'absolute', right: 8, top: -6, width: 12, height: 12, borderRadius: 6 },
  tileLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  field: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  logo: { width: 36, height: 36, borderRadius: 8 },
  colorChip: { width: 22, height: 22, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth },
  input: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 15,
    paddingHorizontal: space.md,
    paddingVertical: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
});
