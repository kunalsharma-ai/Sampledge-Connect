import { Ionicons } from '@expo/vector-icons';
import {
  DEFAULT_INBOX_SETTINGS,
  INBOX_PRIORITIES,
  tenantCan,
  type InboxSettings,
  type InboxTemplate,
} from '@sampledge/contracts';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { Button } from '../../components/Button';
import { Chips } from '../../components/Chips';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { confirmThen } from '../../lib/confirm';
import { PRIORITY_LABEL } from '../../lib/inbox';
import { useApp, useWorkspace } from '../../state/AppProvider';
import { useDirectory, usePeople, useTenantRole } from '../../state/hooks';
import { useInboxSettings, useInboxTemplates } from '../../state/useInbox';
import { alpha, radius, space, type as typeScale } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

const DUE_SOON = [
  { key: '0.5', label: 'Half way' },
  { key: '0.75', label: '75% of the time' },
  { key: '0.9', label: '90% of the time' },
] as const;

/**
 * Client Inbox settings. Everyone: reply templates. Owners and admins: channels, how long a
 * client may wait per priority, warnings, auto-assign, auto-escalation and inbox teams.
 * Settings save on this phone at once and reach every device when online; templates need a
 * connection (their shortcuts must be unique).
 */
export default function InboxSettingsScreen() {
  const { theme } = useTheme();
  const c = theme.colors;
  const role = useTenantRole();
  const supervisor = tenantCan(role, 'inbox.supervise');
  const manage = tenantCan(role, 'connectors.manage');
  const saved = useInboxSettings();
  const { engine } = useWorkspace();
  const { engineState } = useApp();
  const offline = engineState?.connectivity === 'offline';
  const [draft, setDraft] = useState<InboxSettings | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => setDraft(saved), [saved]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);

  const save = async () => {
    if (!draft) return;
    setNote(null);
    try {
      await engine.saveInboxSettings(draft);
      setNote(offline ? 'Saved on this phone. It is sent when you reconnect.' : 'Saved.');
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Inbox settings' }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 100 }}>
        {manage ? (
          <Pressable
            onPress={() => router.push('/inbox/channels')}
            accessibilityRole="button"
            accessibilityLabel="Channels"
            style={[
              styles.row,
              styles.link,
              { borderColor: c.border, backgroundColor: c.surfaceRaised },
            ]}
          >
            <Ionicons name="git-network-outline" size={20} color={c.accent} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">Channels</Text>
              <Text variant="meta" tone="subtle">
                Telegram, Teams, Slack, Google Chat, LINE and more: connect, test and go live
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={c.textSubtle} />
          </Pressable>
        ) : null}

        {supervisor && draft ? (
          <SupervisorSettings draft={draft} setDraft={setDraft} />
        ) : supervisor ? (
          <Text tone="muted">
            {offline ? 'Settings load when you are online.' : 'Loading settings…'}
          </Text>
        ) : null}

        {supervisor && draft ? (
          <View style={{ gap: space.sm }}>
            {note ? (
              <Text
                variant="meta"
                tone={note === 'Saved.' || note.startsWith('Saved on') ? 'accent' : 'danger'}
              >
                {note}
              </Text>
            ) : null}
            <Button
              title="Save settings"
              icon="checkmark"
              disabled={!dirty}
              onPress={() => void save()}
            />
          </View>
        ) : null}

        <Templates />
      </ScrollView>
    </Screen>
  );
}

function SupervisorSettings({
  draft,
  setDraft,
}: {
  draft: InboxSettings;
  setDraft: (s: InboxSettings) => void;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const people = useDirectory();
  const nameOf = usePeople();
  const { selfId } = useWorkspace();
  const everyone = useMemo(
    () => [
      { userId: selfId, displayName: nameOf(selfId) },
      ...people.filter((p) => p.role !== 'guest'),
    ],
    [people, selfId, nameOf],
  );
  const [teamName, setTeamName] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const set = (patch: Partial<InboxSettings>) => setDraft({ ...draft, ...patch });

  return (
    <>
      <Section title="How long a client may wait for a reply">
        <Glass style={styles.card}>
          {INBOX_PRIORITIES.map((p) => (
            <View key={p} style={styles.row}>
              <Text style={{ flex: 1 }}>{PRIORITY_LABEL[p]}</Text>
              <TextInput
                value={String(draft.sla[p])}
                onChangeText={(v) => {
                  const n = Number(v.replace(/\D/g, ''));
                  set({ sla: { ...draft.sla, [p]: Number.isFinite(n) ? n : 0 } });
                }}
                keyboardType="number-pad"
                accessibilityLabel={`${PRIORITY_LABEL[p]} reply time in minutes`}
                style={[
                  typeScale.body,
                  styles.num,
                  { color: c.text, borderColor: c.border, backgroundColor: c.surfaceSunken },
                ]}
              />
              <Text variant="meta" tone="subtle" style={{ width: 54 }}>
                min
              </Text>
            </View>
          ))}
          <Text variant="meta" tone="subtle">
            Between 5 minutes and 7 days. Defaults: urgent {DEFAULT_INBOX_SETTINGS.sla.urgent}, high{' '}
            {DEFAULT_INBOX_SETTINGS.sla.high}, normal {DEFAULT_INBOX_SETTINGS.sla.normal}, low{' '}
            {DEFAULT_INBOX_SETTINGS.sla.low}.
          </Text>
        </Glass>
      </Section>

      <Section title="Warn agents when they have used">
        <Chips
          label="Due-soon warning"
          options={[...DUE_SOON]}
          selected={[String(draft.dueSoonRatio)]}
          onToggle={(k) => set({ dueSoonRatio: Number(k) })}
        />
      </Section>

      <Section title="Automation">
        <Glass style={styles.card}>
          <Toggle
            label="Auto-assign new conversations"
            help="To the agent in the owning team with the fewest open conversations."
            value={draft.autoAssign}
            onChange={(v) => set({ autoAssign: v })}
          />
          <Toggle
            label="Escalate when a reply is overdue"
            help="Raises it to urgent and tells the escalation contacts."
            value={draft.autoEscalateOnBreach}
            onChange={(v) => set({ autoEscalateOnBreach: v })}
          />
        </Glass>
      </Section>

      <Section title="Escalation contacts">
        <Chips
          multi
          label="Escalation contacts"
          options={everyone.map((p) => ({
            key: p.userId,
            label: p.userId === selfId ? 'You' : p.displayName,
          }))}
          selected={draft.escalationContactIds}
          onToggle={(id) =>
            set({
              escalationContactIds: draft.escalationContactIds.includes(id)
                ? draft.escalationContactIds.filter((x) => x !== id)
                : [...draft.escalationContactIds, id],
            })
          }
        />
      </Section>

      <Section title="Inbox teams">
        <Text variant="meta" tone="subtle">
          Agents see conversations of their own teams, ones with no team and ones assigned to them.
        </Text>
        {draft.teams.map((t, i) => (
          <Glass key={t.teamId || `new-${i}`} style={styles.card}>
            <View style={styles.row}>
              <Ionicons name="people-outline" size={18} color={c.accent} />
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                {t.name}
              </Text>
              <Text variant="meta" tone="subtle">
                {t.memberIds.length} member{t.memberIds.length === 1 ? '' : 's'}
              </Text>
              <Pressable
                onPress={() => setEditing(editing === i ? null : i)}
                accessibilityRole="button"
                accessibilityLabel={`Edit members of ${t.name}`}
                hitSlop={8}
              >
                <Ionicons
                  name={editing === i ? 'chevron-up' : 'create-outline'}
                  size={18}
                  color={c.accent}
                />
              </Pressable>
              <Pressable
                onPress={() =>
                  confirmThen(
                    `Remove ${t.name}?`,
                    'Its conversations go back to everyone.',
                    'Remove',
                    () => set({ teams: draft.teams.filter((_, j) => j !== i) }),
                  )
                }
                accessibilityRole="button"
                accessibilityLabel={`Remove team ${t.name}`}
                hitSlop={8}
              >
                <Ionicons name="trash-outline" size={18} color={c.danger} />
              </Pressable>
            </View>
            {editing === i ? (
              <Chips
                multi
                label={`Members of ${t.name}`}
                options={everyone.map((p) => ({
                  key: p.userId,
                  label: p.userId === selfId ? 'You' : p.displayName,
                }))}
                selected={t.memberIds}
                onToggle={(id) =>
                  set({
                    teams: draft.teams.map((x, j) =>
                      j !== i
                        ? x
                        : {
                            ...x,
                            memberIds: x.memberIds.includes(id)
                              ? x.memberIds.filter((m) => m !== id)
                              : [...x.memberIds, id],
                          },
                    ),
                  })
                }
              />
            ) : (
              <Text variant="meta" tone="muted" numberOfLines={2}>
                {t.memberIds.map((m) => (m === selfId ? 'You' : nameOf(m))).join(', ') ||
                  'No members yet'}
              </Text>
            )}
          </Glass>
        ))}
        <View style={styles.row}>
          <TextInput
            value={teamName}
            onChangeText={setTeamName}
            placeholder="New team name"
            placeholderTextColor={c.textSubtle}
            accessibilityLabel="New team name"
            style={[
              typeScale.body,
              styles.input,
              { flex: 1, color: c.text, borderColor: c.border, backgroundColor: c.surfaceSunken },
            ]}
          />
          <Button
            title="Add"
            kind="quiet"
            icon="add"
            disabled={!teamName.trim()}
            onPress={() => {
              set({
                teams: [...draft.teams, { teamId: '', name: teamName.trim(), memberIds: [] }],
              });
              setEditing(draft.teams.length);
              setTeamName('');
            }}
          />
        </View>
      </Section>
    </>
  );
}

function Templates() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine, selfId } = useWorkspace();
  const role = useTenantRole();
  const nameOf = usePeople();
  const templates = useInboxTemplates();
  const [edit, setEdit] = useState<{
    id: string | null;
    name: string;
    shortcut: string;
    body: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canEdit = (t: InboxTemplate) =>
    t.createdBy === selfId || tenantCan(role, 'inbox.supervise');

  const save = async () => {
    if (!edit) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: edit.name.trim(),
        shortcut: edit.shortcut.trim() ? edit.shortcut.trim().toLowerCase() : null,
        body: edit.body.trim(),
      };
      await engine.inboxServer(
        edit.id ? 'PUT' : 'POST',
        edit.id ? `/v1/inbox/templates/${edit.id}` : '/v1/inbox/templates',
        body,
      );
      setEdit(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Reply templates">
      <Text variant="meta" tone="subtle">
        Type / and the shortcut in a reply. Variables: {'{{client.firstName}}'}, {'{{client.name}}'}
        , {'{{client.company}}'}, {'{{agent.name}}'}.
      </Text>
      {templates.map((t) => (
        <Glass key={t.templateId} style={styles.card}>
          <View style={styles.row}>
            <Text variant="label" tone="accent">
              {t.shortcut ? `/${t.shortcut}` : '—'}
            </Text>
            <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
              {t.name}
            </Text>
            {canEdit(t) ? (
              <>
                <Pressable
                  onPress={() =>
                    setEdit({
                      id: t.templateId,
                      name: t.name,
                      shortcut: t.shortcut ?? '',
                      body: t.body,
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Edit template ${t.name}`}
                  hitSlop={8}
                >
                  <Ionicons name="create-outline" size={18} color={c.accent} />
                </Pressable>
                <Pressable
                  onPress={() =>
                    confirmThen(
                      `Delete ${t.name}?`,
                      'Agents can no longer pick it.',
                      'Delete',
                      () =>
                        void engine
                          .inboxServer('DELETE', `/v1/inbox/templates/${t.templateId}`)
                          .catch((e: unknown) =>
                            setError(e instanceof Error ? e.message : String(e)),
                          ),
                    )
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Delete template ${t.name}`}
                  hitSlop={8}
                >
                  <Ionicons name="trash-outline" size={18} color={c.danger} />
                </Pressable>
              </>
            ) : null}
          </View>
          <Text variant="meta" tone="muted" numberOfLines={3}>
            {t.body}
          </Text>
          <Text variant="meta" tone="subtle">
            By {t.createdBy === selfId ? 'you' : nameOf(t.createdBy)}
          </Text>
        </Glass>
      ))}
      {error ? (
        <View style={[styles.banner, { backgroundColor: alpha(c.danger, 0.12) }]}>
          <Text variant="meta" style={{ color: c.danger }}>
            {error}
          </Text>
        </View>
      ) : null}
      {edit ? (
        <Glass style={styles.card}>
          <Text variant="heading">{edit.id ? 'Edit template' : 'New template'}</Text>
          <TextInput
            value={edit.name}
            onChangeText={(v) => setEdit({ ...edit, name: v })}
            placeholder="Name"
            placeholderTextColor={c.textSubtle}
            accessibilityLabel="Template name"
            style={[
              typeScale.body,
              styles.input,
              { color: c.text, borderColor: c.border, backgroundColor: c.surfaceSunken },
            ]}
          />
          <TextInput
            value={edit.shortcut}
            onChangeText={(v) => setEdit({ ...edit, shortcut: v })}
            placeholder="Shortcut, e.g. thanks"
            autoCapitalize="none"
            placeholderTextColor={c.textSubtle}
            accessibilityLabel="Template shortcut"
            style={[
              typeScale.body,
              styles.input,
              { color: c.text, borderColor: c.border, backgroundColor: c.surfaceSunken },
            ]}
          />
          <TextInput
            value={edit.body}
            onChangeText={(v) => setEdit({ ...edit, body: v })}
            multiline
            placeholder="Hi {{client.firstName}}, …"
            placeholderTextColor={c.textSubtle}
            accessibilityLabel="Template text"
            style={[
              typeScale.body,
              styles.input,
              {
                minHeight: 90,
                color: c.text,
                borderColor: c.border,
                backgroundColor: c.surfaceSunken,
              },
            ]}
          />
          <View style={styles.row}>
            <Button title="Cancel" kind="quiet" onPress={() => setEdit(null)} style={{ flex: 1 }} />
            <Button
              title="Save template"
              busy={busy}
              disabled={!edit.name.trim() || !edit.body.trim()}
              onPress={() => void save()}
              style={{ flex: 1 }}
            />
          </View>
          <Text variant="meta" tone="subtle">
            Templates need a connection, so a shortcut is never taken twice.
          </Text>
        </Glass>
      ) : (
        <Button
          title="New template"
          kind="quiet"
          icon="add"
          onPress={() => setEdit({ id: null, name: '', shortcut: '', body: '' })}
        />
      )}
    </Section>
  );
}

function Toggle({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text>{label}</Text>
        <Text variant="meta" tone="subtle">
          {help}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        aria-checked={value}
        trackColor={{ true: theme.colors.accent, false: alpha(theme.colors.text, 0.2) }}
      />
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="overline" tone="subtle">
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.lg, gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  link: { padding: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  num: {
    width: 80,
    textAlign: 'right',
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.sm,
    paddingVertical: 6,
  },
  input: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  banner: { padding: space.md, borderRadius: radius.md },
});
