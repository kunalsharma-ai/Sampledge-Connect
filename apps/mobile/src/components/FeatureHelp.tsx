import { Ionicons } from '@expo/vector-icons';
import {
  FEATURE_HELP_AUDIENCE_LABELS,
  FEATURE_HELP_CATEGORY_LABELS,
  featureHelp,
  type FeatureHelpEntry,
  type FeatureHelpId,
} from '@sampledge/contracts';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { alpha, fonts, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

/**
 * The gold-ringed "i" next to a feature, and the guide it opens. Content comes from
 * @sampledge/contracts (FEATURE_HELP), the same text the web app shows.
 *
 * Brand colors are fixed (SampConnect green and gold) so the mark looks the same on every theme.
 */
export const BRAND = {
  green: '#12825C',
  greenDeep: '#0F6B4F',
  greenBright: '#1FA374',
  gold: '#F5B83D',
  goldLight: '#F8C95A',
  goldInk: '#C98A0B',
} as const;

export function HelpMark({ size = 22 }: { size?: number }) {
  return (
    <LinearGradient
      colors={[BRAND.greenBright, BRAND.green, BRAND.greenDeep]}
      start={{ x: 0.2, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={[
        styles.mark,
        { width: size, height: size, borderRadius: size / 2, borderColor: BRAND.gold },
      ]}
    >
      <Text
        style={{
          color: BRAND.goldLight,
          fontFamily: fonts.bold,
          fontSize: size * 0.6,
          lineHeight: size * 0.75,
          includeFontPadding: false,
        }}
        accessible={false}
      >
        i
      </Text>
    </LinearGradient>
  );
}

/** A tappable help mark that opens the feature's guide in a bottom sheet. */
export function FeatureHelp({ id, size = 22 }: { id: FeatureHelpId; size?: number }) {
  const [open, setOpen] = useState(false);
  const entry = featureHelp(id);
  if (!entry) return null;
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`About ${entry.title}`}
        accessibilityHint="Opens a short guide to this feature"
        testID={`feature-help-${id}`}
        style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.92 : 1 }] })}
      >
        <HelpMark size={size} />
      </Pressable>
      {open ? <FeatureHelpSheet id={id} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** A stack header title with the help mark beside it. */
export function HeaderTitleWithHelp({ title, id }: { title: string; id: FeatureHelpId }) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, maxWidth: 260 }}>
      <Text
        numberOfLines={1}
        style={{
          fontFamily: fonts.semibold,
          fontSize: 17,
          color: theme.colors.text,
          flexShrink: 1,
        }}
        accessibilityRole="header"
      >
        {title}
      </Text>
      <FeatureHelp id={id} size={20} />
    </View>
  );
}

function FeatureHelpSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { theme, motion } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [current, setCurrent] = useState(id);
  const entry = featureHelp(current) ?? featureHelp(id)!;
  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <Animated.View
        entering={motion.fast ? FadeIn.duration(motion.fast) : undefined}
        style={[styles.backdrop, { backgroundColor: alpha('#000000', theme.dark ? 0.55 : 0.35) }]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <Animated.View
          entering={motion.base ? SlideInDown.duration(motion.base) : undefined}
          style={{ paddingBottom: insets.bottom + space.sm, paddingHorizontal: space.sm }}
        >
          <View
            accessibilityViewIsModal
            style={[
              styles.sheet,
              {
                backgroundColor: theme.colors.surfaceRaised,
                borderColor: alpha(BRAND.gold, 0.45),
                maxHeight: height * 0.82,
              },
            ]}
          >
            <GuideView
              entry={entry}
              onBack={current !== id ? () => setCurrent(id) : undefined}
              onRelated={setCurrent}
              onClose={onClose}
              onAll={() => {
                onClose();
                router.push({ pathname: '/help', params: { id: entry.id } });
              }}
            />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

/** The guide itself, shared by the bottom sheet and the Feature guides screen. */
export function GuideView({
  entry,
  onBack,
  onRelated,
  onClose,
  onAll,
}: {
  entry: FeatureHelpEntry;
  onBack?: () => void;
  onRelated: (id: string) => void;
  onClose?: () => void;
  onAll?: () => void;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const audience = FEATURE_HELP_AUDIENCE_LABELS[entry.audience];
  return (
    <>
      <LinearGradient
        colors={[BRAND.greenDeep, BRAND.green, '#169A6C']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hero}
      >
        <View style={styles.heroGlow} pointerEvents="none" />
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
          {onBack ? (
            <Pressable
              onPress={onBack}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={styles.heroIcon}
            >
              <Ionicons name="arrow-back" size={18} color="#FFFFFF" />
            </Pressable>
          ) : (
            <View style={[styles.heroIcon, { borderColor: BRAND.gold, borderWidth: 1.5 }]}>
              <Ionicons name="sparkles" size={16} color={BRAND.goldLight} />
            </View>
          )}
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="overline" style={{ color: BRAND.goldLight }}>
              {FEATURE_HELP_CATEGORY_LABELS[entry.category]}
            </Text>
            <Text variant="title" style={{ color: '#FFFFFF' }} accessibilityRole="header">
              {entry.title}
            </Text>
            <Text
              variant="label"
              style={{ color: 'rgba(255,255,255,0.88)', fontFamily: fonts.regular }}
            >
              {entry.summary}
            </Text>
            {audience ? (
              <View style={styles.audience}>
                <Ionicons name="shield-checkmark" size={11} color="#3D2A00" />
                <Text variant="meta" style={{ color: '#3D2A00', fontFamily: fonts.semibold }}>
                  {audience}
                </Text>
              </View>
            ) : null}
          </View>
          {onClose ? (
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={22} color="rgba(255,255,255,0.85)" />
            </Pressable>
          ) : null}
        </View>
        <LinearGradient
          colors={[BRAND.gold, BRAND.goldLight, 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.heroRule}
        />
      </LinearGradient>

      <ScrollView
        style={{ flexShrink: 1 }}
        contentContainerStyle={{ padding: space.lg, gap: space.lg }}
      >
        <Part icon="bulb-outline" label="What it is">
          <Text>{entry.what}</Text>
        </Part>
        <Part icon="heart-outline" label="Why it helps">
          <Text>{entry.why}</Text>
        </Part>
        <Part icon="location-outline" label="Where to find it">
          <Text>{entry.where.mobile}</Text>
          <Text variant="meta" tone="subtle">
            On the web: {entry.where.web}
          </Text>
        </Part>
        <Part icon="compass-outline" label="How to use it">
          {entry.how.map((step, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: space.sm }}>
              <View style={styles.step}>
                <Text style={{ color: BRAND.goldLight, fontFamily: fonts.bold, fontSize: 12 }}>
                  {i + 1}
                </Text>
              </View>
              <Text style={{ flex: 1 }}>{step}</Text>
            </View>
          ))}
        </Part>
        {entry.tips?.length ? (
          <View
            style={[
              styles.tips,
              { backgroundColor: alpha(BRAND.gold, 0.12), borderColor: alpha(BRAND.gold, 0.45) },
            ]}
          >
            {entry.tips.map((t) => (
              <View key={t} style={{ flexDirection: 'row', gap: space.sm }}>
                <Ionicons
                  name="sparkles"
                  size={14}
                  color={BRAND.goldInk}
                  style={{ marginTop: 2 }}
                />
                <Text variant="label" style={{ flex: 1, fontFamily: fonts.regular }}>
                  {t}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {entry.related?.length ? (
          <View style={{ gap: space.sm }}>
            <Text variant="overline" tone="subtle">
              Related
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {entry.related.map((r) => {
                const e = featureHelp(r);
                return e ? (
                  <Pressable
                    key={r}
                    onPress={() => onRelated(r)}
                    accessibilityRole="button"
                    accessibilityLabel={`Guide: ${e.title}`}
                    style={({ pressed }) => [
                      styles.chip,
                      {
                        borderColor: pressed ? BRAND.gold : alpha(BRAND.green, 0.5),
                        backgroundColor: pressed ? alpha(BRAND.green, 0.12) : 'transparent',
                      },
                    ]}
                  >
                    <Text variant="label">{e.title}</Text>
                  </Pressable>
                ) : null;
              })}
            </View>
          </View>
        ) : null}
        {onAll ? (
          <Pressable
            onPress={onAll}
            accessibilityRole="button"
            style={[styles.all, { borderTopColor: c.border }]}
          >
            <Ionicons name="book-outline" size={16} color={theme.dark ? '#4FD1A1' : BRAND.green} />
            <Text variant="label" style={{ color: theme.dark ? '#4FD1A1' : BRAND.green }}>
              All feature guides
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </>
  );
}

function Part({
  icon,
  label,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: space.xs + 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Ionicons name={icon} size={14} color={BRAND.goldInk} />
        <Text variant="overline" tone="subtle">
          {label}
        </Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    shadowColor: '#0F6B4F',
    shadowOpacity: 0.35,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderRadius: radius.xl, borderWidth: 1, overflow: 'hidden' },
  hero: { padding: space.lg, paddingBottom: space.lg + 3, overflow: 'hidden' },
  heroGlow: {
    position: 'absolute',
    right: -40,
    top: -50,
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: 'rgba(245,184,61,0.22)',
  },
  heroIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  heroRule: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3 },
  audience: {
    marginTop: space.xs,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F5B83D',
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  step: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#12825C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tips: { borderWidth: 1, borderRadius: radius.lg, padding: space.md, gap: space.sm },
  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 6,
  },
  all: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.md,
  },
});
