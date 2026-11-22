import { Ionicons } from '@expo/vector-icons';
import {
  SUPPORT_STATUS_LABELS,
  featureHelp,
  type HelpFaq,
  type SupportStatus,
} from '@sampledge/contracts';
import { useState } from 'react';
import { LayoutAnimation, Pressable, StyleSheet, View } from 'react-native';
import { alpha, fonts, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { BRAND } from './FeatureHelp';
import { Text } from './Text';

/** One question that opens to its answer, with a link to the feature's guide. */
export function FaqRow({
  f,
  initiallyOpen = false,
  onGuide,
  divider,
}: {
  f: HelpFaq;
  initiallyOpen?: boolean;
  onGuide: (id: string) => void;
  divider?: boolean;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [open, setOpen] = useState(initiallyOpen);
  const guide = f.featureId ? featureHelp(f.featureId) : undefined;
  return (
    <View
      style={[
        divider && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
        open && { backgroundColor: alpha(BRAND.green, theme.dark ? 0.12 : 0.06) },
      ]}
    >
      <Pressable
        onPress={() => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setOpen(!open);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        style={styles.faqHead}
      >
        <View style={[styles.q, { backgroundColor: open ? BRAND.green : c.surfaceSunken }]}>
          <Text
            style={{
              color: open ? BRAND.goldLight : c.textSubtle,
              fontFamily: fonts.bold,
              fontSize: 11,
            }}
          >
            Q
          </Text>
        </View>
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          {f.question}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={c.textSubtle} />
      </Pressable>
      {open ? (
        <View
          style={{
            paddingLeft: 52,
            paddingRight: space.lg,
            paddingBottom: space.md,
            gap: space.sm,
          }}
        >
          <Text>{f.answer}</Text>
          {guide ? (
            <Pressable
              onPress={() => onGuide(guide.id)}
              accessibilityRole="link"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              <Ionicons
                name="book-outline"
                size={14}
                color={theme.dark ? '#4FD1A1' : BRAND.green}
              />
              <Text variant="label" style={{ color: theme.dark ? '#4FD1A1' : BRAND.green }}>
                Read the {guide.title} guide
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const STATUS_COLORS: Record<SupportStatus, [string, string]> = {
  open: ['#F5B83D', '#8A5A00'],
  in_progress: ['#2563EB', '#2563EB'],
  answered: ['#12825C', '#12825C'],
  resolved: ['#64748B', '#64748B'],
};

export function StatusPill({ status }: { status: SupportStatus | 'sending' }) {
  const { theme } = useTheme();
  if (status === 'sending')
    return (
      <View style={[styles.pill, { backgroundColor: theme.colors.surfaceSunken }]}>
        <Text variant="meta" tone="subtle">
          Waiting to send
        </Text>
      </View>
    );
  const [bg, fg] = STATUS_COLORS[status];
  return (
    <View style={[styles.pill, { backgroundColor: alpha(bg, 0.16) }]}>
      <Text
        variant="meta"
        style={{
          color:
            theme.dark && status !== 'resolved'
              ? status === 'open'
                ? BRAND.goldLight
                : '#7FD9B5'
              : fg,
          fontFamily: fonts.semibold,
        }}
      >
        {SUPPORT_STATUS_LABELS[status]}
      </Text>
    </View>
  );
}

export const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

const styles = StyleSheet.create({
  faqHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
  },
  q: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
});
