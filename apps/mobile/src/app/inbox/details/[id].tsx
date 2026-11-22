import { Ionicons } from '@expo/vector-icons';
import {
  INBOX_PRIORITIES,
  INBOX_STATUSES,
  LINK_MODULES,
  type InboxConversationDetail,
} from '@sampledge/contracts';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { PersonAvatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { Chips } from '../../../components/Chips';
import { Glass } from '../../../components/Glass';
import { Pill, ProviderMark, SlaPill, TestModeBadge } from '../../../components/InboxBits';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { PRIORITY_LABEL, PROVIDER_META, snoozeOptions, STATUS_LABEL } from '../../../lib/inbox';
import { useWorkspace } from '../../../state/AppProvider';
import { useDirectory, useNow, usePeople } from '../../../state/hooks';
import { useInboxConversation, useInboxSettings } from '../../../state/useInbox';
import { alpha, radius, space, type as typeScale } from '../../../theme/themes';
import { useTheme } from '../../../theme/ThemeProvider';

const RECORD_TYPES: Record<(typeof LINK_MODULES)[number], string[]> = {
  sampforce: ['opportunity', 'account', 'lead'],
  samptrek: ['project'],
};
const MODULE_NAME = { sampforce: 'SampForce', samptrek: 'Samptrek' } as const;

/**
 * The client and how the conversation is being worked: owner, team, status, priority, tags,
 * snooze, service level, escalation and linked SampForce and Samptrek records. Ownership
 * changes work offline (sent on reconnect); escalating, linking and logging need a connection.
 */
export default function InboxDetails() {
  const { id, log } = useLocalSearchParams<{ id: string; log?: string }>();
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine, selfId } = useWorkspace();
  const nameOf = usePeople();
  const people = useDirectory();
  const settings = useInboxSettings();
  const now = useNow();
  const { detail } = useInboxConversation(id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pickOwner, setPickOwner] = useState(false);
  const [tag, setTag] = useState('');
  const [reason, setReason] = useState('');
  const [logText, setLogText] = useState('');
  const [link, setLink] = useState({
    module: 'sampforce' as (typeof LINK_MODULES)[number],
    recordType: 'opportunity',
    externalId: '',
    label: '',
  });

  if (!detail)
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ title: 'Details' }} />
        <Text tone="muted" style={{ padding: space.xl, textAlign: 'center' }}>
          Loading…
        </Text>
      </Screen>
    );
  const conv = detail.conversation;
  const client = detail.client;
  const update = (patch: Parameters<typeof engine.inboxUpdate>[1]) =>
    void engine.inboxUpdate(conv.conversationId, patch).catch((e: unknown) => setError(String(e)));
  const server = async (key: string, run: () => Promise<unknown>, done?: () => void) => {
    setBusy(key);
    setError(null);
    try {
      await run();
      done?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const path = `/v1/inbox/conversations/${conv.conversationId}`;
  const handoff = conv.channelMode === 'handoff';
  const teams = settings?.teams ?? [];
  const owner = conv.assigneeId;

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Details' }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}>
        {error ? (
          <View style={[styles.banner, { backgroundColor: alpha(c.danger, 0.12) }]}>
            <Text variant="meta" style={{ color: c.danger }}>
              {error}
            </Text>
          </View>
        ) : null}

        <Glass style={styles.card}>
          <View style={styles.row}>
            <ProviderMark provider={conv.provider} size={44} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="heading">{client.name}</Text>
              <Text variant="meta" tone="muted">
                {[client.title, client.company].filter(Boolean).join(' · ') || 'Client'}
              </Text>
            </View>
            {conv.testMode ? <TestModeBadge /> : null}
          </View>
          {client.email ? (
            <InfoLine
              icon="mail-outline"
              text={client.email}
              onPress={() => void Linking.openURL(`mailto:${client.email}`)}
            />
          ) : null}
          {client.phone ? (
            <InfoLine
              icon="call-outline"
              text={client.phone}
              onPress={() => void Linking.openURL(`tel:${client.phone}`)}
            />
          ) : null}
          {client.identities.map((i) => (
            <View key={i.accountId} style={styles.row}>
              <ProviderMark provider={i.provider} size={18} />
              <Text variant="meta" tone="muted" style={{ flex: 1 }} numberOfLines={1}>
                {PROVIDER_META[i.provider].name}: {i.displayName}
                {i.handle ? ` (@${i.handle.replace(/^@/, '')})` : ''}
              </Text>
            </View>
          ))}
          {client.ownerId ? (
            <Text variant="meta" tone="subtle">
              Account owner: {client.ownerId === selfId ? 'you' : nameOf(client.ownerId)}
            </Text>
          ) : null}
          <Text variant="meta" tone="subtle">
            {client.conversationCount} conversation{client.conversationCount === 1 ? '' : 's'} with
            this client
          </Text>
        </Glass>

        <Section title="Owner">
          <Pressable
            onPress={() => setPickOwner((x) => !x)}
            accessibilityRole="button"
            accessibilityLabel="Change who owns this conversation"
            style={[styles.pick, { borderColor: c.border, backgroundColor: c.surfaceRaised }]}
          >
            {owner ? (
              <PersonAvatar userId={owner} name={nameOf(owner)} size={24} />
            ) : (
              <Ionicons name="person-outline" size={20} color={c.textSubtle} />
            )}
            <Text style={{ flex: 1 }}>
              {owner ? (owner === selfId ? 'You' : nameOf(owner)) : 'Unassigned'}
            </Text>
            <Ionicons
              name={pickOwner ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={c.textSubtle}
            />
          </Pressable>
          {pickOwner ? (
            <View style={[styles.list, { borderColor: c.border }]}>
              {[
                { userId: '', displayName: 'Unassigned' },
                { userId: selfId, displayName: 'Me' },
                ...people,
              ]
                .filter((p, i, all) => all.findIndex((x) => x.userId === p.userId) === i)
                .map((p) => {
                  const on = (owner ?? '') === p.userId;
                  return (
                    <Pressable
                      key={p.userId || 'none'}
                      onPress={() => {
                        update({ assigneeId: p.userId || null });
                        setPickOwner(false);
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      aria-checked={on}
                      style={[styles.listRow, { borderBottomColor: c.border }]}
                    >
                      <Text style={{ flex: 1 }}>{p.displayName}</Text>
                      {on ? <Ionicons name="checkmark" size={18} color={c.accent} /> : null}
                    </Pressable>
                  );
                })}
            </View>
          ) : null}
          {teams.length ? (
            <Chips
              label="Team"
              options={[
                { key: '', label: 'No team' },
                ...teams.map((t) => ({ key: t.teamId, label: t.name })),
              ]}
              selected={[conv.teamId ?? '']}
              onToggle={(k) => update({ teamId: k || null })}
            />
          ) : null}
        </Section>

        <Section title="Status">
          <Chips
            label="Status"
            options={INBOX_STATUSES.filter((s) => s !== 'snoozed').map((s) => ({
              key: s,
              label: STATUS_LABEL[s],
            }))}
            selected={[conv.status]}
            onToggle={(k) => update({ status: k, snoozedUntil: null })}
          />
          <Text variant="meta" tone="subtle">
            {conv.status === 'snoozed' && conv.snoozedUntil
              ? `Snoozed until ${new Date(conv.snoozedUntil).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}. It reopens when the client writes.`
              : 'Snooze until'}
          </Text>
          <Chips
            label="Snooze until"
            options={snoozeOptions(new Date(now)).map((o) => ({ key: o.until, label: o.label }))}
            selected={[]}
            onToggle={(until) => update({ status: 'snoozed', snoozedUntil: until })}
          />
        </Section>

        <Section title="Priority">
          <Chips
            label="Priority"
            options={INBOX_PRIORITIES.map((p) => ({ key: p, label: PRIORITY_LABEL[p] }))}
            selected={[conv.priority]}
            onToggle={(k) => update({ priority: k })}
          />
          <View style={styles.row}>
            <SlaPill sla={conv.sla} now={now} />
            <Text variant="meta" tone="subtle" style={{ flex: 1 }}>
              {conv.sla.dueAt
                ? `Reply due ${new Date(conv.sla.dueAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`
                : conv.sla.firstResponseAt
                  ? `First reply ${new Date(conv.sla.firstResponseAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`
                  : 'Nothing owed right now'}
            </Text>
          </View>
        </Section>

        <Section title="Tags">
          <View style={[styles.row, { flexWrap: 'wrap' }]}>
            {conv.tags.map((t) => (
              <Pressable
                key={t}
                onPress={() => update({ tags: conv.tags.filter((x) => x !== t) })}
                accessibilityRole="button"
                accessibilityLabel={`Remove tag ${t}`}
                style={[styles.tag, { backgroundColor: alpha(c.accent, 0.12) }]}
              >
                <Text variant="meta" tone="accent">
                  {t}
                </Text>
                <Ionicons name="close" size={12} color={c.accent} />
              </Pressable>
            ))}
          </View>
          <TextInput
            value={tag}
            onChangeText={setTag}
            onSubmitEditing={() => {
              const t = tag.trim().toLowerCase();
              if (t && !conv.tags.includes(t)) update({ tags: [...conv.tags, t] });
              setTag('');
            }}
            placeholder="Add a tag"
            placeholderTextColor={c.textSubtle}
            returnKeyType="done"
            accessibilityLabel="Add a tag"
            style={[
              typeScale.body,
              styles.input,
              { color: c.text, borderColor: c.border, backgroundColor: c.surfaceSunken },
            ]}
          />
        </Section>

        {handoff || log ? (
          <Section title={`Log what the client wrote in ${PROVIDER_META[conv.provider].name}`}>
            <TextInput
              value={logText}
              onChangeText={setLogText}
              multiline
              autoFocus={!!log}
              placeholder="Paste or type the client's message"
              placeholderTextColor={c.textSubtle}
              accessibilityLabel="Client message to log"
              style={[
                typeScale.body,
                styles.input,
                {
                  minHeight: 70,
                  color: c.text,
                  borderColor: c.border,
                  backgroundColor: c.surfaceSunken,
                },
              ]}
            />
            <Button
              title="Log message"
              icon="download-outline"
              kind="quiet"
              busy={busy === 'log'}
              disabled={!logText.trim()}
              onPress={() =>
                void server(
                  'log',
                  () =>
                    engine.inboxServer(
                      'POST',
                      `${path}/log-inbound`,
                      { text: logText.trim() },
                      conv.conversationId,
                    ),
                  () => setLogText(''),
                )
              }
            />
          </Section>
        ) : null}

        <Section title="Escalation">
          {conv.escalation ? (
            <View style={[styles.banner, { backgroundColor: alpha(c.danger, 0.1) }]}>
              <Text variant="label" style={{ color: c.danger }}>
                Level {conv.escalation.level}: {conv.escalation.reason}
              </Text>
              <Text variant="meta" tone="subtle">
                {conv.escalation.by ? `${nameOf(conv.escalation.by)} · ` : ''}
                {new Date(conv.escalation.at).toLocaleString()}
              </Text>
            </View>
          ) : null}
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Why it needs a supervisor"
            placeholderTextColor={c.textSubtle}
            accessibilityLabel="Escalation reason"
            style={[
              typeScale.body,
              styles.input,
              { color: c.text, borderColor: c.border, backgroundColor: c.surfaceSunken },
            ]}
          />
          <Button
            title={conv.escalation ? 'Escalate again' : 'Escalate'}
            icon="flag-outline"
            kind="danger"
            busy={busy === 'esc'}
            disabled={!reason.trim()}
            onPress={() =>
              void server(
                'esc',
                () =>
                  engine.inboxServer(
                    'POST',
                    `${path}/escalate`,
                    { reason: reason.trim() },
                    conv.conversationId,
                  ),
                () => setReason(''),
              )
            }
          />
        </Section>

        <Section title="Linked records">
          {conv.links.length === 0 ? (
            <Text variant="meta" tone="subtle">
              Link the SampForce opportunity or Samptrek project this conversation is about.
            </Text>
          ) : null}
          {conv.links.map((l) => (
            <View
              key={l.linkId}
              style={[styles.pick, { borderColor: c.border, backgroundColor: c.surfaceRaised }]}
            >
              <Ionicons name="link-outline" size={16} color={c.accent} />
              <View style={{ flex: 1 }}>
                <Text
                  variant="label"
                  onPress={l.url ? () => void Linking.openURL(l.url!) : undefined}
                >
                  {l.label}
                </Text>
                <Text variant="meta" tone="subtle">
                  {MODULE_NAME[l.module]} {l.recordType} · {l.externalId}
                </Text>
              </View>
              {l.verified ? <Pill text="Verified" tone="success" /> : <Pill text="Unverified" />}
              <Pressable
                onPress={() =>
                  void server('unlink', () =>
                    engine.inboxServer(
                      'DELETE',
                      `${path}/links/${l.linkId}`,
                      undefined,
                      conv.conversationId,
                    ),
                  )
                }
                accessibilityRole="button"
                accessibilityLabel={`Remove link ${l.label}`}
                hitSlop={8}
              >
                <Ionicons name="close" size={16} color={c.textSubtle} />
              </Pressable>
            </View>
          ))}
          <Chips
            label="Module"
            options={LINK_MODULES.map((m) => ({ key: m, label: MODULE_NAME[m] }))}
            selected={[link.module]}
            onToggle={(m) => setLink((x) => ({ ...x, module: m, recordType: RECORD_TYPES[m][0]! }))}
          />
          <Chips
            label="Record type"
            options={RECORD_TYPES[link.module].map((t) => ({
              key: t,
              label: t[0]!.toUpperCase() + t.slice(1),
            }))}
            selected={[link.recordType]}
            onToggle={(t) => setLink((x) => ({ ...x, recordType: t }))}
          />
          <View style={styles.row}>
            <TextInput
              value={link.externalId}
              onChangeText={(v) => setLink((x) => ({ ...x, externalId: v }))}
              placeholder="Record ID"
              placeholderTextColor={c.textSubtle}
              accessibilityLabel="Record ID"
              style={[
                typeScale.body,
                styles.input,
                { flex: 1, color: c.text, borderColor: c.border, backgroundColor: c.surfaceSunken },
              ]}
            />
            <TextInput
              value={link.label}
              onChangeText={(v) => setLink((x) => ({ ...x, label: v }))}
              placeholder="Name"
              placeholderTextColor={c.textSubtle}
              accessibilityLabel="Record name"
              style={[
                typeScale.body,
                styles.input,
                {
                  flex: 1.4,
                  color: c.text,
                  borderColor: c.border,
                  backgroundColor: c.surfaceSunken,
                },
              ]}
            />
          </View>
          <Button
            title="Link record"
            icon="link-outline"
            kind="quiet"
            busy={busy === 'link'}
            disabled={!link.externalId.trim() || !link.label.trim()}
            onPress={() =>
              void server(
                'link',
                () =>
                  engine.inboxServer<InboxConversationDetail>(
                    'POST',
                    `${path}/links`,
                    {
                      module: link.module,
                      recordType: link.recordType,
                      externalId: link.externalId.trim(),
                      label: link.label.trim(),
                    },
                    conv.conversationId,
                  ),
                () => setLink((x) => ({ ...x, externalId: '', label: '' })),
              )
            }
          />
        </Section>
        <Text variant="meta" tone="subtle">
          Owner, status, priority, team and tags save on this phone at once and reach the other
          agents when you are online. Escalating, linking and logging need a connection.
        </Text>
      </ScrollView>
    </Screen>
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

function InfoLine({
  icon,
  text,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="link" style={styles.row}>
      <Ionicons name={icon} size={15} color={theme.colors.accent} />
      <Text variant="label" tone="accent">
        {text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.lg, gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  banner: { padding: space.md, borderRadius: radius.md, gap: 2 },
  pick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  list: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  input: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
});
