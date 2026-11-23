import {
  apiBaseFor,
  apiUrl,
  CONNECTOR_CATALOG,
  tenantCan,
  type Connector,
  type TestConnectorResult,
} from '@sampledge/contracts';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Share, StyleSheet, View } from 'react-native';
import { Button } from '../../../components/Button';
import {
  CredentialInputs,
  Field,
  MODE_LABEL,
  MODE_TONE,
  Notice,
  when,
} from '../../../components/ChannelBits';
import { Chips } from '../../../components/Chips';
import { Glass } from '../../../components/Glass';
import { Pill, ProviderMark, TestModeBadge } from '../../../components/InboxBits';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { confirmThen } from '../../../lib/confirm';
import { useApp, useWorkspace } from '../../../state/AppProvider';
import { useTenantRole } from '../../../state/hooks';
import { useInboxChannels, useInboxSettings } from '../../../state/useInbox';
import { radius, space } from '../../../theme/themes';
import { useTheme } from '../../../theme/ThemeProvider';

const GRACE = [
  { key: '0', label: 'No grace' },
  { key: '1', label: '1 hour' },
  { key: '24', label: '24 hours' },
  { key: '72', label: '3 days' },
] as const;

type Panel = 'credentials' | 'simulate' | null;
type Note = { tone: 'success' | 'danger' | 'warning'; text: string } | null;

/** One channel: webhook URL, health, test, go live, credentials, pause, team and remove. */
export default function ChannelScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  const c = theme.colors;
  const role = useTenantRole();
  const manage = tenantCan(role, 'connectors.manage');
  const ch = useInboxChannels(manage).find((x) => x.connectorId === id);
  const settings = useInboxSettings();
  const { engine } = useWorkspace();
  const { engineState, session } = useApp();
  const offline = engineState?.connectivity === 'offline';
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [panel, setPanel] = useState<Panel>(null);

  if (!ch) {
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ title: 'Channel' }} />
        <View style={{ padding: space.lg }}>
          <Text tone="muted">
            {manage
              ? 'This channel was removed, or is still loading.'
              : 'Only owners and admins manage channels.'}
          </Text>
        </View>
      </Screen>
    );
  }
  const d = CONNECTOR_CATALOG[ch.provider];
  const path = `/v1/connectors/${ch.connectorId}`;
  const webhook =
    ch.webhookPath && session ? apiUrl(apiBaseFor(session.serverUrl), ch.webhookPath) : null;

  const act = async (key: string, run: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    setNote(null);
    try {
      await run();
      setNote({ tone: 'success', text: ok });
      return true;
    } catch (e) {
      setNote({ tone: 'danger', text: e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      setBusy(null);
    }
  };
  const patch = (body: Record<string, unknown>) =>
    engine.inboxServer<Connector>('PATCH', path, body);

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: ch.name }} />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 100 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.row}>
          <ProviderMark provider={ch.provider} size={44} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="heading">{ch.name}</Text>
            <View style={[styles.row, { flexWrap: 'wrap' }]}>
              <Pill text={MODE_LABEL[d.mode]} tone={MODE_TONE[d.mode]} />
              {ch.environment === 'test' ? (
                <TestModeBadge />
              ) : (
                <Pill text="Live" tone="accent" icon="shield-checkmark-outline" />
              )}
              <Pill
                text={
                  ch.status === 'active'
                    ? 'Active'
                    : ch.status === 'error'
                      ? 'Needs attention'
                      : 'Paused'
                }
                tone={
                  ch.status === 'active' ? 'success' : ch.status === 'error' ? 'danger' : 'warning'
                }
              />
            </View>
          </View>
        </View>

        {offline ? (
          <Notice
            tone="warning"
            text="You're offline. Changes to channels wait for a connection."
          />
        ) : null}
        {note ? <Notice tone={note.tone} text={note.text} /> : null}
        {ch.missingCredentials.length ? (
          <Notice
            tone="warning"
            text={`Missing: ${ch.missingCredentials.map((k) => d.credentialFields.find((f) => f.key === k)?.label ?? k).join(', ')}. The channel stays inactive until they're set.`}
          />
        ) : null}
        {ch.health.lastError && ch.status !== 'active' ? (
          <Notice
            tone="danger"
            text={`Last error ${when(ch.health.lastErrorAt)}: ${ch.health.lastError}`}
          />
        ) : null}

        <Glass style={styles.card}>
          <Stat label="Last client message" value={when(ch.health.lastInboundAt)} />
          <Stat label="Last reply sent" value={when(ch.health.lastOutboundAt)} />
          <Stat
            label="Queued replies"
            value={`${ch.health.queued}${ch.health.circuitOpenUntil ? ' · paused after failures' : ''}`}
          />
          <Stat
            label="Rejected webhooks"
            value={String(ch.health.rejectedWebhooks)}
            warn={ch.health.rejectedWebhooks > 0}
          />
          {d.credentialFields
            .filter((f) => ch.credentialHints[f.key])
            .map((f) => (
              <Stat key={f.key} label={f.label} value={ch.credentialHints[f.key]!} mono />
            ))}
        </Glass>

        {webhook ? (
          <Glass style={styles.card}>
            <Text variant="label">Webhook URL (paste into {d.name})</Text>
            <View
              style={[styles.code, { borderColor: c.border, backgroundColor: c.surfaceSunken }]}
            >
              <Text variant="meta" tone="muted" selectable style={{ fontFamily: 'monospace' }}>
                {webhook}
              </Text>
            </View>
            <View style={styles.row}>
              <Button
                title="Share URL"
                kind="quiet"
                icon="share-outline"
                onPress={() => void Share.share({ message: webhook })}
                style={{ flex: 1 }}
              />
              <Button
                title="New URL"
                kind="quiet"
                icon="refresh"
                disabled={offline}
                busy={busy === 'url'}
                onPress={() =>
                  void act(
                    'url',
                    () => engine.inboxServer('POST', `${path}/webhook-url`),
                    'New webhook URL issued. Update it in the provider.',
                  )
                }
                style={{ flex: 1 }}
              />
            </View>
          </Glass>
        ) : null}

        <View style={{ gap: space.sm }}>
          <Button
            title="Test connection"
            icon="pulse"
            kind="quiet"
            disabled={offline}
            busy={busy === 'test'}
            onPress={async () => {
              setBusy('test');
              setNote(null);
              try {
                const r = await engine.inboxServer<TestConnectorResult>('POST', `${path}/test`);
                setNote({
                  tone: r.ok ? 'success' : 'danger',
                  text: `${r.ok ? 'Connection works' : 'Connection failed'}: ${r.message}`,
                });
              } catch (e) {
                setNote({ tone: 'danger', text: e instanceof Error ? e.message : String(e) });
              } finally {
                setBusy(null);
              }
            }}
          />
          {ch.environment === 'test' && ch.webhookPath ? (
            <Button
              title="Simulate client message"
              icon="send"
              kind="quiet"
              disabled={offline}
              onPress={() => setPanel(panel === 'simulate' ? null : 'simulate')}
            />
          ) : null}
          {panel === 'simulate' ? (
            <Simulate
              connector={ch}
              disabled={offline}
              onDone={(conversationId) => {
                setPanel(null);
                setNote({
                  tone: 'success',
                  text: 'Signed test message delivered. It went through the same checks as a real webhook.',
                });
                if (conversationId) router.push(`/inbox/${conversationId}`);
              }}
            />
          ) : null}
          {ch.environment === 'live' ? (
            <Button
              title={ch.missingCredentials.length ? 'Add credentials' : 'Rotate credentials'}
              icon="key-outline"
              kind="quiet"
              disabled={offline}
              onPress={() => setPanel(panel === 'credentials' ? null : 'credentials')}
            />
          ) : null}
          {panel === 'credentials' ? (
            <Credentials
              connector={ch}
              disabled={offline}
              onDone={() => {
                setPanel(null);
                setNote({ tone: 'success', text: 'Credentials saved.' });
              }}
            />
          ) : null}
          <Button
            title={ch.environment === 'test' ? 'Go live' : 'Back to test mode'}
            icon={ch.environment === 'test' ? 'shield-checkmark-outline' : 'flask-outline'}
            kind="quiet"
            disabled={offline}
            busy={busy === 'env'}
            onPress={async () => {
              const live = ch.environment === 'test';
              const ok = await act(
                'env',
                () => patch({ environment: live ? 'live' : 'test' }),
                live
                  ? 'Switched to live. Enter the real credentials next.'
                  : 'Switched to test mode.',
              );
              setPanel(ok && live ? 'credentials' : null);
            }}
          />
          <Button
            title={ch.status === 'paused' ? 'Resume' : 'Pause'}
            icon={ch.status === 'paused' ? 'play' : 'pause'}
            kind="quiet"
            disabled={offline}
            busy={busy === 'status'}
            onPress={() =>
              void act(
                'status',
                () => patch({ status: ch.status === 'paused' ? 'active' : 'paused' }),
                ch.status === 'paused' ? 'Channel resumed.' : 'Channel paused.',
              )
            }
          />
        </View>

        {settings?.teams.length ? (
          <View style={{ gap: 4 }}>
            <Text variant="label">Owning team</Text>
            <Chips
              label="Owning team"
              options={[
                { key: '', label: 'Everyone in the inbox' },
                ...settings.teams.map((t) => ({ key: t.teamId, label: t.name })),
              ]}
              selected={[ch.teamId ?? '']}
              onToggle={(t) => {
                if (!offline) void act('team', () => patch({ teamId: t || null }), 'Team saved.');
              }}
            />
          </View>
        ) : null}

        <Button
          title="Remove channel"
          icon="trash-outline"
          kind="danger"
          disabled={offline}
          busy={busy === 'remove'}
          onPress={() =>
            confirmThen(
              `Remove ${ch.name}?`,
              'Its conversations stay in the inbox.',
              'Remove',
              () => {
                void act(
                  'remove',
                  () => engine.inboxServer('DELETE', path),
                  'Channel removed.',
                ).then((ok) => ok && router.back());
              },
            )
          }
        />
        <Text variant="meta" tone="subtle">
          {d.credentialRotation}
        </Text>
      </ScrollView>
    </Screen>
  );
}

function Stat({
  label,
  value,
  warn,
  mono,
}: {
  label: string;
  value: string;
  warn?: boolean;
  mono?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.row}>
      <Text variant="meta" tone="subtle" style={{ flex: 1 }}>
        {label}
      </Text>
      <Text
        variant="meta"
        style={[
          warn ? { color: theme.colors.warning } : null,
          mono ? { fontFamily: 'monospace' } : null,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function Credentials({
  connector,
  disabled,
  onDone,
}: {
  connector: Connector;
  disabled: boolean;
  onDone: () => void;
}) {
  const { engine } = useWorkspace();
  const d = CONNECTOR_CATALOG[connector.provider];
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [grace, setGrace] = useState<'0' | '1' | '24' | '72'>('24');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filled = Object.fromEntries(Object.entries(creds).filter(([, v]) => v.trim()));
  return (
    <Glass style={styles.card}>
      <Text variant="heading">{d.name} credentials</Text>
      <CredentialInputs
        descriptor={d}
        values={creds}
        onChange={setCreds}
        hints={connector.credentialHints}
      />
      <Text variant="label">Keep accepting the old secret for</Text>
      <Chips label="Grace period" options={[...GRACE]} selected={[grace]} onToggle={setGrace} />
      <Text variant="meta" tone="subtle">
        So webhooks already on their way are not rejected during the switch.
      </Text>
      {error ? <Notice tone="danger" text={error} /> : null}
      <Button
        title="Save credentials"
        icon="key-outline"
        busy={busy}
        disabled={disabled || Object.keys(filled).length === 0}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            await engine.inboxServer('PUT', `/v1/connectors/${connector.connectorId}/credentials`, {
              credentials: filled,
              graceHours: Number(grace),
            });
            onDone();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </Glass>
  );
}

function Simulate({
  connector,
  disabled,
  onDone,
}: {
  connector: Connector;
  disabled: boolean;
  onDone: (conversationId: string | null) => void;
}) {
  const { engine } = useWorkspace();
  const [fromName, setFromName] = useState('Elena Garcia');
  const [fromHandle, setFromHandle] = useState('@elena.garcia');
  const [text, setText] = useState(
    'Hi! Could you share the latest fieldwork numbers for the Q3 brand tracker?',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Glass style={styles.card}>
      <Text variant="heading">Simulate a client message</Text>
      <Text variant="meta" tone="muted">
        Builds a {CONNECTOR_CATALOG[connector.provider].name} webhook as the provider would, signs
        it with this channel's test secret and runs it through verification.
      </Text>
      <Field label="Client name" value={fromName} onChangeText={setFromName} />
      <Field label="Handle" value={fromHandle} onChangeText={setFromHandle} autoCapitalize="none" />
      <Field label="Message" value={text} onChangeText={setText} multiline />
      {error ? <Notice tone="danger" text={error} /> : null}
      <Button
        title="Send test message"
        icon="send"
        busy={busy}
        disabled={disabled || !text.trim() || !fromName.trim()}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            const r = await engine.inboxServer<{ conversationIds: string[] }>(
              'POST',
              `/v1/connectors/${connector.connectorId}/simulate-inbound`,
              { fromName, fromHandle, text },
            );
            onDone(r.conversationIds?.[0] ?? null);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </Glass>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.lg, gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  code: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, padding: space.sm },
});
