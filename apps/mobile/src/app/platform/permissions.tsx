import {
  TENANT_PERMISSIONS,
  TENANT_PERMISSION_INFO,
  TENANT_ROLES,
  platformCan,
  type TenantPermission,
  type TenantPermissionPolicy,
  type TenantRole,
} from '@sampledge/contracts';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Button } from '../../components/Button';
import { Chips } from '../../components/Chips';
import { Section, netErrorText } from '../../components/NetworkBits';
import {
  Pill,
  usePlatformApi,
  usePlatformLive,
  usePlatformMe,
} from '../../components/PlatformBits';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { ROLE_TEXT } from '../../lib/platform';
import { space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

const GROUPS = [...new Set(TENANT_PERMISSIONS.map((p) => TENANT_PERMISSION_INFO[p].group))];
const same = (a: TenantPermissionPolicy, b: TenantPermissionPolicy) =>
  TENANT_ROLES.every((r) => a[r].length === b[r].length && a[r].every((p) => b[r].includes(p)));

/**
 * What each role may do: the default for every organization, or one organization (?org=).
 * Only super admins change it; organization owners can't. Live when another admin changes it.
 */
export default function PlatformPermissions() {
  const { org, name } = useLocalSearchParams<{ org?: string; name?: string }>();
  const { theme } = useTheme();
  const c = theme.colors;
  const api = usePlatformApi();
  const me = usePlatformMe();
  const canEdit = !!me && platformCan(me.role, 'permissions.manage');
  const [saved, setSaved] = useState<TenantPermissionPolicy | null>(null);
  const [base, setBase] = useState<TenantPermissionPolicy | null>(null);
  const [inherits, setInherits] = useState(false);
  const [own, setOwn] = useState(false);
  const [draft, setDraft] = useState<TenantPermissionPolicy | null>(null);
  const [role, setRole] = useState<TenantRole>('member');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    (org
      ? api
          .orgPermissions(org)
          .then((x) => ({ policy: x.policy, base: x.platformDefault, inherits: x.inherits }))
      : api.permissions().then((x) => ({ policy: x.policy, base: x.builtIn, inherits: false }))
    )
      .then((x) => {
        setSaved(x.policy);
        setDraft(x.policy);
        setBase(x.base);
        setInherits(x.inherits);
        setOwn(!x.inherits);
        setError(null);
      })
      .catch((e: unknown) => setError(netErrorText(e)));
  }, [api, org]);
  useEffect(load, [load]);
  usePlatformLive(
    ['permissions'],
    useCallback((t?: string) => (!t || t === org ? load() : undefined), [load, org]),
  );

  if (!draft || !saved || !base)
    return (
      <Screen edges={['bottom']}>
        <View style={{ padding: space.xl, alignItems: 'center' }}>
          {error ? <Text tone="muted">{error}</Text> : <ActivityIndicator color={c.accent} />}
        </View>
      </Screen>
    );

  const editing = canEdit && (!org || own);
  const shown = org && !own ? base : draft;
  const dirty = org ? own !== !inherits || (own && !same(draft, saved)) : !same(draft, saved);
  const toggle = (p: TenantPermission, on: boolean) =>
    setDraft({
      ...draft,
      [role]: on
        ? TENANT_PERMISSIONS.filter((x) => x === p || draft[role].includes(x))
        : draft[role].filter((x) => x !== p),
    });
  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      if (org) await api.setOrgPermissions(org, own ? draft : null);
      else await api.setPermissions(draft);
      setNote({ ok: true, text: 'Saved. People see the change within 30 seconds.' });
      load();
    } catch (e) {
      setNote({ ok: false, text: netErrorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: name ? `${name}: permissions` : 'Permissions' }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 100 }}>
        <Text variant="meta" tone="muted">
          {org
            ? 'Follow the default for every organization, or give this one its own rules. Its owners can’t change them.'
            : 'The default for every organization without its own rules. Organization owners can’t change it.'}
        </Text>
        {org ? (
          <Chips
            label="Rules for this organization"
            options={[
              { key: 'default', label: 'Use the default' },
              { key: 'own', label: 'Its own rules' },
            ]}
            selected={[own ? 'own' : 'default']}
            onToggle={(k) => canEdit && setOwn(k === 'own')}
          />
        ) : null}
        <Chips
          label="Role"
          options={TENANT_ROLES.map((r) => ({ key: r, label: ROLE_TEXT[r] }))}
          selected={[role]}
          onToggle={setRole}
        />
        {GROUPS.map((g) => (
          <Section key={g} title={g}>
            {TENANT_PERMISSIONS.filter((p) => TENANT_PERMISSION_INFO[p].group === g).map((p, i) => {
              const on = shown[role].includes(p);
              const changed = on !== base[role].includes(p);
              return (
                <View
                  key={p}
                  style={[
                    styles.row,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
                  ]}
                >
                  <Text variant="body" style={{ flex: 1 }}>
                    {TENANT_PERMISSION_INFO[p].label}
                  </Text>
                  {changed ? <Pill text="Changed" tone="warn" /> : null}
                  <Switch
                    value={on}
                    disabled={!editing || busy}
                    onValueChange={(v) => toggle(p, v)}
                    accessibilityLabel={`${ROLE_TEXT[role]}: ${TENANT_PERMISSION_INFO[p].label}`}
                  />
                </View>
              );
            })}
          </Section>
        ))}
        {note ? (
          <Text
            variant="meta"
            style={{ color: note.ok ? c.success : c.danger }}
            accessibilityLiveRegion="polite"
          >
            {note.text}
          </Text>
        ) : null}
        {canEdit ? (
          <View style={{ gap: space.sm }}>
            <Button
              title={org ? 'Save for this organization' : 'Save for every organization'}
              disabled={!dirty}
              busy={busy}
              onPress={() => void save()}
            />
            {!org && !same(saved, base) ? (
              <Button
                title="Back to SampConnect’s standard"
                kind="quiet"
                disabled={busy}
                onPress={() => {
                  setDraft(base);
                }}
              />
            ) : null}
          </View>
        ) : me ? (
          <Text variant="meta" tone="subtle">
            Only super admins change permissions.
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
});
