import { Ionicons } from '@expo/vector-icons';
import type { PlatformMe } from '@sampledge/contracts';
import { router, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { platformApi } from '../lib/platform';
import { TransportError } from '../sync/transport';
import { useWorkspace } from '../state/AppProvider';
import { alpha, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Glass } from './Glass';
import { Text } from './Text';

/** The console API bound to this workspace's engine. */
export function usePlatformApi() {
  const { engine } = useWorkspace();
  return useMemo(() => platformApi(engine), [engine]);
}

/**
 * Reload when another platform admin (or you on another device) changes one of these areas,
 * and after every reconnect.
 */
export function usePlatformLive(
  areas: ('orgs' | 'admins' | 'billing' | 'audit' | 'me')[],
  fn: (tenantId?: string) => void,
) {
  const { engine } = useWorkspace();
  const key = areas.join(',');
  useEffect(
    () =>
      engine.events.on('platform', (e) => {
        if (e.area === null || areas.includes(e.area)) fn(e.tenantId);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, fn, key],
  );
}

/** Your platform role (null when you have none); live when it changes. */
export function usePlatformMe(): PlatformMe | null {
  const api = usePlatformApi();
  const [me, setMe] = useState<PlatformMe | null>(null);
  const load = useMemo(
    () => () => {
      api
        .me()
        .then(setMe)
        .catch((e: unknown) => {
          // Offline keeps what we knew; a refusal means you're not (or no longer) a platform admin.
          if (e instanceof TransportError && e.kind === 'api') setMe(null);
        });
    },
    [api],
  );
  useEffect(load, [load]);
  usePlatformLive(['me'], load);
  return me;
}

export function Stat({
  icon,
  value,
  label,
  warn,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
  warn?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Glass style={styles.stat}>
      <Ionicons name={icon} size={18} color={warn ? theme.colors.warning : theme.colors.accent} />
      <Text variant="heading" numberOfLines={1}>
        {value}
      </Text>
      <Text variant="meta" tone="muted" numberOfLines={2}>
        {label}
      </Text>
    </Glass>
  );
}

export function LinkRow({
  icon,
  label,
  hint,
  href,
  divider,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint?: string;
  href: Href;
  divider?: boolean;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <Pressable
      onPress={() => router.push(href)}
      accessibilityRole="button"
      style={[
        styles.link,
        divider && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
      ]}
    >
      <Ionicons name={icon} size={20} color={c.accent} />
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">{label}</Text>
        {hint ? (
          <Text variant="meta" tone="muted">
            {hint}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={c.textSubtle} />
    </Pressable>
  );
}

/** A small coloured pill: ok (green), warn (amber), danger (red), or neutral. */
export function Pill({
  text,
  tone = 'neutral',
}: {
  text: string;
  tone?: 'ok' | 'warn' | 'danger' | 'accent' | 'neutral';
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const color =
    tone === 'ok'
      ? c.success
      : tone === 'warn'
        ? c.warning
        : tone === 'danger'
          ? c.danger
          : tone === 'accent'
            ? c.accent
            : c.textMuted;
  return (
    <View style={[styles.pill, { backgroundColor: alpha(color, 0.14) }]}>
      <Text variant="meta" style={{ color }}>
        {text}
      </Text>
    </View>
  );
}

export const shortDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';
export const shortTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString([], {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';

const styles = StyleSheet.create({
  stat: { width: '48.5%', padding: space.md, gap: 4 },
  link: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
});
