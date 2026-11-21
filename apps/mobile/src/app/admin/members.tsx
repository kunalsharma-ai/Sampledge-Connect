import { Ionicons } from '@expo/vector-icons';
import type { TenantRole } from '@sampledge/contracts';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { Chips } from '../../components/Chips';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { ROLE_LABEL } from '../../lib/admin';
import { useApp, useWorkspace } from '../../state/AppProvider';
import { useTenantRole } from '../../state/hooks';
import type { DirectoryUser } from '../../sync/transport';
import { alpha, radius, space, type as typeScale } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

/** Members for owners and admins: add, change role, reset two-step, deactivate. */
export default function Members() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine, selfId } = useWorkspace();
  const myRole = useTenantRole();
  const [all, setAll] = useState<DirectoryUser[] | null>(null);
  const [q, setQ] = useState('');
  const [show, setShow] = useState<'active' | 'deactivated'>('active');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<DirectoryUser | null>(null);
  const blocked = engine.serverActionBlocker();

  const load = useCallback(() => {
    if (engine.serverActionBlocker()) return;
    engine
      .listMembers()
      .then((u) => {
        setAll(u);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [engine]);
  // Reload when you come back to the list, when a change is made here, and after each sync
  // (which brings changes made by other admins on the web or other devices).
  useFocusEffect(load);
  const lastSyncAt = useApp().engineState?.lastSyncAt;
  useEffect(load, [load, lastSyncAt]);
  useEffect(() => engine.events.on('members', load), [engine, load]);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (all ?? []).filter(
      (u) =>
        u.status === show &&
        (!t || u.displayName.toLowerCase().includes(t) || u.email.toLowerCase().includes(t)),
    );
  }, [all, q, show]);
  const offCount = (all ?? []).filter((u) => u.status === 'deactivated').length;

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen
        options={{
          title: 'Members',
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/admin/add-member')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Add member"
              style={{ paddingHorizontal: space.sm }}
            >
              <Ionicons name="person-add-outline" size={22} color={c.accent} />
            </Pressable>
          ),
        }}
      />
      <View style={{ padding: space.lg, paddingBottom: space.sm, gap: space.sm }}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search by name or email"
          placeholderTextColor={c.textSubtle}
          autoCapitalize="none"
          accessibilityLabel="Search members"
          style={[
            typeScale.body,
            styles.input,
            { color: c.text, backgroundColor: c.surfaceSunken, borderColor: c.border },
          ]}
        />
        <Chips
          label="Show"
          options={[
            { key: 'active', label: `Active${all ? ` (${all.length - offCount})` : ''}` },
            { key: 'deactivated', label: `Deactivated${all ? ` (${offCount})` : ''}` },
          ]}
          selected={[show]}
          onToggle={setShow}
        />
        {error || blocked ? (
          <Text variant="meta" tone="danger">
            {error ?? `${blocked} Members are managed on the server.`}
          </Text>
        ) : null}
      </View>
      <FlatList
        data={list}
        keyExtractor={(u) => u.userId}
        onRefresh={load}
        refreshing={false}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 80, gap: space.sm }}
        renderItem={({ item: u }) => (
          <Pressable
            onPress={() => setOpen(u)}
            accessibilityRole="button"
            accessibilityLabel={`${u.displayName}, ${ROLE_LABEL[u.role as TenantRole] ?? u.role}${u.status === 'deactivated' ? ', deactivated' : ''}`}
          >
            <Glass style={styles.row}>
              <Avatar name={u.displayName} size={40} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {u.displayName}
                  {u.userId === selfId ? ' (you)' : ''}
                </Text>
                <Text variant="meta" tone="muted" numberOfLines={1}>
                  {u.email}
                </Text>
              </View>
              <View
                style={[
                  styles.role,
                  {
                    backgroundColor: alpha(u.role === 'guest' ? c.warning : c.accent, 0.14),
                  },
                ]}
              >
                <Text variant="meta" style={{ color: u.role === 'guest' ? c.warning : c.accent }}>
                  {ROLE_LABEL[u.role as TenantRole] ?? u.role}
                </Text>
              </View>
            </Glass>
          </Pressable>
        )}
        ListEmptyComponent={
          all ? (
            <Text tone="muted" style={{ textAlign: 'center', marginTop: space.xl }}>
              {q ? 'Nobody matches that.' : 'Nobody here.'}
            </Text>
          ) : !blocked ? (
            <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />
          ) : undefined
        }
      />
      <MemberSheet
        member={open}
        self={open?.userId === selfId}
        canManage={myRole === 'owner' || myRole === 'admin'}
        onClose={() => setOpen(null)}
        onChanged={(u) => {
          setAll((xs) => xs?.map((x) => (x.userId === u.userId ? { ...x, ...u } : x)) ?? xs);
          setOpen((o) => (o ? { ...o, ...u } : o));
        }}
      />
    </Screen>
  );
}

function MemberSheet({
  member: m,
  self,
  canManage,
  onClose,
  onChanged,
}: {
  member: DirectoryUser | null;
  self: boolean;
  canManage: boolean;
  onClose: () => void;
  onChanged: (u: Partial<DirectoryUser> & { userId: string }) => void;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  useEffect(() => setNote(null), [m?.userId]);
  if (!m) return null;
  const locked = self || m.role === 'owner' || !canManage;
  const off = m.status === 'deactivated';

  const run = async (key: string, step: () => Promise<string>) => {
    setBusy(key);
    setNote(null);
    try {
      setNote({ text: await step(), ok: true });
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally {
      setBusy(null);
    }
  };
  const confirm = (title: string, body: string, go: () => void) => {
    if (Platform.OS === 'web') return go();
    Alert.alert(title, body, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Continue', style: 'destructive', onPress: go },
    ]);
  };

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: alpha('#000000', 0.45) }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}>
          <View style={styles.row}>
            <Avatar name={m.displayName} size={44} />
            <View style={{ flex: 1 }}>
              <Text variant="heading" numberOfLines={1}>
                {m.displayName}
              </Text>
              <Text variant="meta" tone="muted" numberOfLines={1}>
                {m.email}
                {off ? ' · deactivated' : ''}
              </Text>
            </View>
          </View>
          {locked ? (
            <Text variant="meta" tone="muted">
              {self
                ? 'You can’t change your own role or status here.'
                : m.role === 'owner'
                  ? 'The organization owner can’t be changed here.'
                  : 'Only owners and admins can change members.'}
            </Text>
          ) : (
            <>
              <View style={{ gap: 6 }}>
                <Text variant="label" tone="muted">
                  Role
                </Text>
                <Chips
                  label="Role"
                  options={(['admin', 'member', 'guest'] as const).map((r) => ({
                    key: r,
                    label: ROLE_LABEL[r],
                  }))}
                  selected={[m.role as 'admin' | 'member' | 'guest']}
                  onToggle={(role) =>
                    role !== m.role &&
                    void run('role', async () => {
                      const u = await engine.updateMember(m.userId, { role });
                      onChanged(u);
                      return `${m.displayName} is now ${ROLE_LABEL[role].toLowerCase()}.`;
                    })
                  }
                />
              </View>
              <Button
                title="Reset two-step verification"
                kind="quiet"
                icon="key-outline"
                busy={busy === 'mfa'}
                disabled={!!busy || off}
                onPress={() =>
                  confirm(
                    'Reset two-step verification?',
                    `${m.displayName} sets it up again at their next sign-in.`,
                    () =>
                      void run('mfa', async () => {
                        await engine.resetMemberMfa(m.userId);
                        return `${m.displayName} will set up two-step verification again at the next sign-in.`;
                      }),
                  )
                }
              />
              <Button
                title={off ? 'Reactivate' : 'Deactivate'}
                kind={off ? 'quiet' : 'danger'}
                icon={off ? 'person-add-outline' : 'person-remove-outline'}
                busy={busy === 'status'}
                disabled={!!busy}
                onPress={() =>
                  off
                    ? void run('status', async () => {
                        const u = await engine.updateMember(m.userId, { status: 'active' });
                        onChanged(u);
                        return `${m.displayName} can sign in again.`;
                      })
                    : confirm(
                        `Deactivate ${m.displayName}?`,
                        'They are signed out of every device right away and can’t sign in. Their messages stay.',
                        () =>
                          void run('status', async () => {
                            const u = await engine.updateMember(m.userId, {
                              status: 'deactivated',
                            });
                            onChanged(u);
                            return `${m.displayName} is deactivated and signed out everywhere.`;
                          }),
                      )
                }
              />
            </>
          )}
          <Button
            title="Activity"
            kind="quiet"
            icon="list-outline"
            onPress={() => {
              onClose();
              router.push({
                pathname: '/admin/audit',
                params: { actorId: m.userId, actorName: m.displayName },
              });
            }}
          />
          {note ? (
            <Text
              variant="meta"
              tone={note.ok ? 'muted' : 'danger'}
              accessibilityLiveRegion="polite"
            >
              {note.text}
            </Text>
          ) : null}
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={[styles.cancel, { backgroundColor: c.surfaceSunken }]}
          >
            <Text variant="bodyStrong" tone="muted">
              Done
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  input: {
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm },
  role: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  backdrop: { flex: 1, justifyContent: 'flex-end', padding: space.md },
  sheet: {
    padding: space.lg,
    gap: space.md,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cancel: { height: 46, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
});
