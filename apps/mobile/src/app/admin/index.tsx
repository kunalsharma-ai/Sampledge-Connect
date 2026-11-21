import { Ionicons } from '@expo/vector-icons';
import type { AdminOverview } from '@sampledge/contracts';
import { router, Stack, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { formatBytes } from '../../components/Attachments';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { auditLine, percent, roleSummary } from '../../lib/admin';
import { useApp, useWorkspace } from '../../state/AppProvider';
import { radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

/** Administration home for owners and admins: the organization at a glance. */
export default function Admin() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const [o, setO] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const blocked = engine.serverActionBlocker();

  const load = useCallback(() => {
    if (engine.serverActionBlocker()) return;
    setLoading(true);
    engine
      .adminOverview()
      .then((r) => {
        setO(r);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [engine]);
  // Fresh numbers each time you open it, and after each sync (changes made on other devices).
  useFocusEffect(load);
  const lastSyncAt = useApp().engineState?.lastSyncAt;
  useEffect(load, [load, lastSyncAt]);

  const links: {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    href: Href;
    hint?: string;
  }[] = [
    { label: 'Members', icon: 'people-outline', href: '/admin/members' },
    { label: 'Audit log', icon: 'list-outline', href: '/admin/audit' },
    { label: 'Devices', icon: 'phone-portrait-outline', href: '/admin/devices' },
    { label: 'Integrations', icon: 'extension-puzzle-outline', href: '/admin/integrations' },
    { label: 'Branding', icon: 'color-palette-outline', href: '/admin/branding' },
    { label: 'Recordings', icon: 'recording-outline', href: '/recordings' },
  ];

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Administration' }} />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={loading && !!o} onRefresh={load} />}
      >
        {!o ? (
          <View style={styles.center}>
            {error || blocked ? (
              <Text tone="muted" style={{ textAlign: 'center' }}>
                {error ?? `${blocked} Administration needs the server.`}
              </Text>
            ) : (
              <ActivityIndicator color={c.accent} />
            )}
          </View>
        ) : (
          <>
            <View>
              <Text variant="title">{o.organization.name}</Text>
              <Text variant="meta" tone="muted">
                {o.organization.slug} · since{' '}
                {new Date(o.organization.createdAt).toLocaleDateString([], {
                  month: 'short',
                  year: 'numeric',
                })}
              </Text>
            </View>
            <View style={styles.grid}>
              <Stat
                icon="people-outline"
                value={`${o.members.active}`}
                label={`active members${o.members.deactivated ? ` · ${o.members.deactivated} off` : ''}`}
              />
              <Stat
                icon="shield-checkmark-outline"
                value={`${percent(o.members.twoStepOn, o.members.active)}%`}
                label="use two-step sign-in"
                warn={percent(o.members.twoStepOn, o.members.active) < 50}
              />
              <Stat
                icon="phone-portrait-outline"
                value={`${o.devices.active}`}
                label={`devices · ${o.devices.seenLast7Days} seen this week`}
              />
              <Stat
                icon="chatbubbles-outline"
                value={`${o.activity.messagesLast7Days}`}
                label={`messages this week · ${o.activity.conversations} conversations`}
              />
              <Stat icon="cloud-outline" value={formatBytes(o.storageBytes)} label="files stored" />
              <Stat
                icon="card-outline"
                value={o.plan.name ?? 'No plan'}
                label={o.plan.status.replace(/_/g, ' ')}
                warn={o.plan.status === 'past_due'}
              />
            </View>
            <Glass style={{ padding: space.md, gap: space.sm }}>
              <Row
                icon="key-outline"
                text={
                  o.signIn.ssoEnabled
                    ? o.signIn.passwordLogin
                      ? 'Single sign-on is on; passwords still work.'
                      : 'Single sign-on only (the owner can still use a password).'
                    : 'People sign in with email and password.'
                }
              />
              <Row
                icon="extension-puzzle-outline"
                text={`${o.integrations.connected} integration${o.integrations.connected === 1 ? '' : 's'} connected${o.integrations.failing ? `, ${o.integrations.failing} failing` : ''}`}
                danger={o.integrations.failing > 0}
              />
              <Row icon="person-outline" text={roleSummary(o.members.byRole)} />
            </Glass>
            <Glass>
              {links.map((l, i) => (
                <Pressable
                  key={l.label}
                  onPress={() => router.push(l.href)}
                  accessibilityRole="button"
                  style={[
                    styles.link,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
                  ]}
                >
                  <Ionicons name={l.icon} size={20} color={c.accent} />
                  <Text variant="bodyStrong" style={{ flex: 1 }}>
                    {l.label}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={c.textSubtle} />
                </Pressable>
              ))}
            </Glass>
            {o.security.length ? (
              <View style={{ gap: space.sm }}>
                <Text variant="overline" tone="subtle">
                  Recent security events
                </Text>
                {o.security.map((e) => (
                  <View key={e.id} style={[styles.event, { borderColor: c.border }]}>
                    <Text variant="label" numberOfLines={2}>
                      {auditLine(e)}
                    </Text>
                    <Text variant="meta" tone="muted">
                      {new Date(e.at).toLocaleString([], {
                        day: 'numeric',
                        month: 'short',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                      {e.ip ? ` · ${e.ip}` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function Stat({
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

function Row({
  icon,
  text,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  danger?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={18} color={danger ? theme.colors.danger : theme.colors.accent} />
      <Text variant="label" tone={danger ? 'danger' : undefined} style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: space.xl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  stat: { width: '48.5%', padding: space.md, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  link: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  event: {
    gap: 2,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
