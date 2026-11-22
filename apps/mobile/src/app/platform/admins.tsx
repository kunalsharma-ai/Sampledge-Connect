import {
  PLATFORM_ROLES,
  PLATFORM_ROLE_INFO,
  platformCan,
  type PlatformAccount,
  type PlatformAdmin,
  type PlatformRole,
} from '@sampledge/contracts';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Chips } from '../../components/Chips';
import { Field, Section, SmallButton, netErrorText } from '../../components/NetworkBits';
import {
  Pill,
  shortDate,
  usePlatformApi,
  usePlatformLive,
  usePlatformMe,
} from '../../components/PlatformBits';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

const ROLE_OPTIONS = PLATFORM_ROLES.map((r) => ({ key: r, label: PLATFORM_ROLE_INFO[r].label }));

function confirm(title: string, body: string, go: () => void) {
  if (Platform.OS === 'web') return go();
  Alert.alert(title, body, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Continue', style: 'destructive', onPress: go },
  ]);
}

/**
 * Who runs SampConnect: everyone with a platform role. Super admins change roles, remove
 * people and add anyone with a work account. Changes show live on every device.
 */
export default function PlatformAdmins() {
  const { theme } = useTheme();
  const c = theme.colors;
  const api = usePlatformApi();
  const me = usePlatformMe();
  const manage = !!me && platformCan(me.role, 'admins.manage');
  const [list, setList] = useState<PlatformAdmin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<PlatformAccount[]>([]);
  const [role, setRole] = useState<PlatformRole>('support');

  const load = useCallback(() => {
    api
      .admins()
      .then((x) => {
        setList(x);
        setError(null);
      })
      .catch((e: unknown) => setError(netErrorText(e)));
  }, [api]);
  useEffect(load, [load]);
  usePlatformLive(['admins'], load);

  useEffect(() => {
    if (!manage || q.trim().length < 2) return setFound([]);
    const t = setTimeout(() => {
      api
        .accounts(q.trim())
        .then(setFound)
        .catch(() => setFound([]));
    }, 300);
    return () => clearTimeout(t);
  }, [api, manage, q]);

  const run = (step: () => Promise<string>) =>
    step()
      .then((text) => {
        setNote({ text, ok: true });
        setOpen(null);
        load();
      })
      .catch((e: unknown) => setNote({ text: netErrorText(e), ok: false }));

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Platform admins' }} />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 100 }}
        keyboardShouldPersistTaps="handled"
      >
        {note ? (
          <Text
            variant="meta"
            style={{ color: note.ok ? c.success : c.danger }}
            accessibilityLiveRegion="polite"
          >
            {note.text}
          </Text>
        ) : null}
        {!list ? (
          <View style={{ padding: space.xl, alignItems: 'center' }}>
            {error ? <Text tone="muted">{error}</Text> : <ActivityIndicator color={c.accent} />}
          </View>
        ) : (
          <Section title={`${list.length} platform admin${list.length === 1 ? '' : 's'}`}>
            {list.map((a, i) => (
              <View
                key={a.adminId}
                style={[
                  styles.pad,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
                ]}
              >
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {a.name}
                      {a.you ? ' (you)' : ''}
                    </Text>
                    <Text variant="meta" tone="muted" numberOfLines={1}>
                      {a.email} · {a.orgName}
                    </Text>
                    <Text variant="meta" tone="subtle">
                      {a.bootstrap
                        ? 'From the server’s first super admin setting'
                        : `Added ${shortDate(a.addedAt)}${a.addedByName ? ` by ${a.addedByName}` : ''}`}
                      {a.twoStep ? ' · two-step on' : ' · no two-step'}
                    </Text>
                  </View>
                  <Pill
                    text={PLATFORM_ROLE_INFO[a.role].label}
                    tone={a.role === 'owner' ? 'accent' : 'neutral'}
                  />
                </View>
                {manage ? (
                  open === a.adminId ? (
                    <View style={{ gap: space.sm, marginTop: space.sm }}>
                      <Chips
                        label={`Role for ${a.name}`}
                        options={ROLE_OPTIONS}
                        selected={[a.role]}
                        onToggle={(r) =>
                          r !== a.role &&
                          run(async () => {
                            await api.setRole(a.adminId, r);
                            return `${a.name} is now ${PLATFORM_ROLE_INFO[r].label.toLowerCase()}.`;
                          })
                        }
                      />
                      <View style={styles.row}>
                        <SmallButton
                          title="Remove"
                          kind="danger"
                          icon="person-remove-outline"
                          onPress={() =>
                            confirm(
                              `Remove ${a.name}?`,
                              'They lose access to the super admin console straight away.',
                              () =>
                                run(async () => {
                                  await api.removeAdmin(a.adminId);
                                  return `${a.name} is no longer a platform admin.`;
                                }),
                            )
                          }
                        />
                        <SmallButton title="Done" onPress={() => setOpen(null)} />
                      </View>
                    </View>
                  ) : (
                    <View style={{ marginTop: space.sm, alignSelf: 'flex-start' }}>
                      <SmallButton
                        title="Change"
                        icon="create-outline"
                        onPress={() => setOpen(a.adminId)}
                      />
                    </View>
                  )
                ) : null}
              </View>
            ))}
          </Section>
        )}

        {manage ? (
          <Section title="Add a platform admin">
            <View style={[styles.pad, { gap: space.sm }]}>
              <Field
                label="Find a work account"
                placeholder="Name or email, in any organization"
                value={q}
                onChangeText={setQ}
                autoCapitalize="none"
              />
              <Chips label="Role" options={ROLE_OPTIONS} selected={[role]} onToggle={setRole} />
              <Text variant="meta" tone="subtle">
                {PLATFORM_ROLE_INFO[role].description}
              </Text>
              {found.map((p) => (
                <View
                  key={`${p.tenantId}:${p.userId}`}
                  style={[styles.row, { paddingVertical: 4 }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text variant="body" numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text variant="meta" tone="muted" numberOfLines={1}>
                      {p.email} · {p.orgName}
                    </Text>
                  </View>
                  {p.role ? (
                    <Pill text={PLATFORM_ROLE_INFO[p.role].label} />
                  ) : (
                    <SmallButton
                      title="Add"
                      kind="primary"
                      onPress={() =>
                        run(async () => {
                          await api.addAdmin({ tenantId: p.tenantId, userId: p.userId, role });
                          setQ('');
                          return `${p.name} added as ${PLATFORM_ROLE_INFO[role].label.toLowerCase()}.`;
                        })
                      }
                    />
                  )}
                </View>
              ))}
            </View>
          </Section>
        ) : me ? (
          <Text variant="meta" tone="subtle">
            Only super admins can add or change platform admins.
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { padding: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
