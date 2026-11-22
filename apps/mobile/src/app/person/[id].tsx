import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { StatusLine } from '../../components/StatusLine';
import { Text } from '../../components/Text';
import { zoneLabel } from '../../lib/time';
import { useWorkspace } from '../../state/AppProvider';
import { useConversations, useNow, useProfile } from '../../state/hooks';
import { space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

/** Someone's profile card: photo, role, contact details, local time and a direct message. */
export default function Person() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine, selfId } = useWorkspace();
  const u = useProfile(id);
  const { conversations } = useConversations();
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!u)
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ title: '' }} />
        <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />
      </Screen>
    );

  const self = u.userId === selfId;
  const localTime = (() => {
    if (!u.timeZone) return null;
    try {
      const t = new Date(now).toLocaleTimeString([], {
        timeZone: u.timeZone,
        hour: 'numeric',
        minute: '2-digit',
      });
      return `${t} local time (${zoneLabel(u.timeZone)})`;
    } catch {
      return null;
    }
  })();

  const message = async () => {
    const dm = conversations.find(
      (x) => x.kind === 'dm' && x.memberIds.includes(u.userId) && x.memberIds.length === 2,
    );
    if (dm)
      return router.push({ pathname: '/conversation/[id]', params: { id: dm.conversationId } });
    setBusy(true);
    setError(null);
    try {
      const cid = await engine.createConversation({ kind: 'dm', memberIds: [u.userId] });
      router.push({ pathname: '/conversation/[id]', params: { id: cid } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const rows: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    value: string;
    href?: string;
  }[] = [
    ...(u.department
      ? [{ icon: 'business-outline' as const, label: 'Department', value: u.department }]
      : []),
    ...(u.email
      ? [
          {
            icon: 'mail-outline' as const,
            label: 'Email',
            value: u.email,
            href: `mailto:${u.email}`,
          },
        ]
      : []),
    ...(u.phone
      ? [
          {
            icon: 'call-outline' as const,
            label: 'Phone',
            value: u.phone,
            href: `tel:${u.phone.replace(/[^+\d]/g, '')}`,
          },
        ]
      : []),
    ...(localTime ? [{ icon: 'time-outline' as const, label: 'Time', value: localTime }] : []),
  ];

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: '' }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}>
        <View style={styles.hero}>
          <Avatar name={u.displayName} uri={u.avatarUrl} size={112} />
          <Text variant="title" style={{ textAlign: 'center' }}>
            {u.displayName}
            {self ? ' (you)' : ''}
          </Text>
          {u.title ? (
            <Text tone="muted" style={{ textAlign: 'center' }}>
              {u.title}
            </Text>
          ) : null}
          <StatusLine status={u.userStatus} schedule={u.dndSchedule} center />
        </View>
        {self ? (
          <Button
            title="Edit profile and photo"
            icon="create-outline"
            kind="quiet"
            onPress={() => router.push('/settings/profile')}
          />
        ) : (
          <Button
            title="Message"
            icon="chatbubble-outline"
            busy={busy}
            onPress={() => void message()}
          />
        )}
        {error ? (
          <Text variant="meta" tone="danger">
            {error}
          </Text>
        ) : null}
        {rows.length ? (
          <Glass>
            {rows.map((r, i) => (
              <Pressable
                key={r.label}
                disabled={!r.href}
                onPress={() => r.href && void Linking.openURL(r.href)}
                accessibilityRole={r.href ? 'link' : undefined}
                accessibilityLabel={`${r.label}: ${r.value}`}
                style={[
                  styles.row,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
                ]}
              >
                <Ionicons name={r.icon} size={20} color={c.accent} />
                <View style={{ flex: 1 }}>
                  <Text variant="meta" tone="muted">
                    {r.label}
                  </Text>
                  <Text tone={r.href ? 'accent' : undefined}>{r.value}</Text>
                </View>
              </Pressable>
            ))}
          </Glass>
        ) : null}
        {u.bio ? (
          <View style={{ gap: space.xs }}>
            <Text variant="label" tone="muted">
              About
            </Text>
            <Text>{u.bio}</Text>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.sm, paddingTop: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
});
