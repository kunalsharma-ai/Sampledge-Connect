import { Ionicons } from '@expo/vector-icons';
import {
  CONNECTOR_CATALOG,
  CONNECTOR_MODES,
  type Connector,
  type ConnectorProvider,
} from '@sampledge/contracts';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button } from '../../../components/Button';
import {
  CredentialInputs,
  Field,
  MODE_HELP,
  MODE_LABEL,
  MODE_TONE,
  Notice,
} from '../../../components/ChannelBits';
import { Chips } from '../../../components/Chips';
import { Glass } from '../../../components/Glass';
import { Pill, ProviderMark } from '../../../components/InboxBits';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { useWorkspace } from '../../../state/AppProvider';
import { useInboxSettings } from '../../../state/useInbox';
import { alpha, radius, space } from '../../../theme/themes';
import { useTheme } from '../../../theme/ThemeProvider';

/** Pick a provider, then connect it in test mode (no real traffic) or live with real credentials. */
export default function AddChannelScreen() {
  const [provider, setProvider] = useState<ConnectorProvider | null>(null);
  return (
    <Screen edges={['bottom']}>
      <Stack.Screen
        options={{
          title: provider ? `Connect ${CONNECTOR_CATALOG[provider].name}` : 'Add channel',
        }}
      />
      {provider ? (
        <Connect provider={provider} onBack={() => setProvider(null)} />
      ) : (
        <Catalog onPick={setProvider} />
      )}
    </Screen>
  );
}

function Catalog({ onPick }: { onPick: (p: ConnectorProvider) => void }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const all = Object.values(CONNECTOR_CATALOG);
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}>
      {CONNECTOR_MODES.map((m) => (
        <View key={m} style={{ gap: space.sm }}>
          <View style={styles.row}>
            <Pill text={MODE_LABEL[m]} tone={MODE_TONE[m]} />
            <Text variant="meta" tone="subtle" style={{ flex: 1 }}>
              {MODE_HELP[m]}
            </Text>
          </View>
          {all
            .filter((d) => d.mode === m)
            .map((d) => (
              <Pressable
                key={d.provider}
                onPress={() => onPick(d.provider)}
                accessibilityRole="button"
                accessibilityLabel={`Connect ${d.name}`}
              >
                <Glass style={[styles.card, styles.row]}>
                  <ProviderMark provider={d.provider} size={32} />
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong">{d.name}</Text>
                    <Text variant="meta" tone="muted" numberOfLines={2}>
                      {d.summary}
                    </Text>
                  </View>
                  <Ionicons name="add-circle-outline" size={22} color={c.accent} />
                </Glass>
              </Pressable>
            ))}
        </View>
      ))}
    </ScrollView>
  );
}

function Connect({ provider, onBack }: { provider: ConnectorProvider; onBack: () => void }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const settings = useInboxSettings();
  const d = CONNECTOR_CATALOG[provider];
  const [name, setName] = useState(`${d.name} support`);
  const [env, setEnv] = useState<'test' | 'live'>('test');
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [teamId, setTeamId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing =
    env === 'live' ? d.credentialFields.filter((f) => f.required && !creds[f.key]?.trim()) : [];

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const made = await engine.inboxServer<Connector>('POST', '/v1/connectors', {
        provider,
        name: name.trim(),
        environment: env,
        credentials: env === 'live' ? creds : {},
        teamId: teamId || null,
      });
      router.replace(`/inbox/channels/${made.connectorId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 100 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.row}>
        <ProviderMark provider={provider} size={40} />
        <View style={{ flex: 1 }}>
          <Text variant="heading">{d.name}</Text>
          <Pill text={MODE_LABEL[d.mode]} tone={MODE_TONE[d.mode]} />
        </View>
      </View>
      <Text variant="meta" tone="muted">
        {d.auth.authorization}
      </Text>
      <Field label="Name" value={name} onChangeText={setName} />
      <View style={styles.modes} accessibilityRole="radiogroup" accessibilityLabel="Mode">
        {(['test', 'live'] as const).map((m) => (
          <Pressable
            key={m}
            onPress={() => setEnv(m)}
            accessibilityRole="radio"
            accessibilityState={{ checked: env === m }}
            accessibilityLabel={m === 'test' ? 'Test mode' : 'Live'}
            style={[
              styles.mode,
              {
                borderColor: env === m ? c.accent : c.border,
                backgroundColor: env === m ? alpha(c.accent, 0.12) : 'transparent',
              },
            ]}
          >
            <View style={styles.row}>
              <Ionicons
                name={m === 'test' ? 'flask-outline' : 'shield-checkmark-outline'}
                size={16}
                color={m === 'test' ? c.accentSecondary : c.accent}
              />
              <Text variant="label">{m === 'test' ? 'Test mode' : 'Live'}</Text>
            </View>
            <Text variant="meta" tone="muted">
              {m === 'test'
                ? 'Generated credentials. Nothing leaves the server.'
                : `Real ${d.name} credentials and traffic.`}
            </Text>
          </Pressable>
        ))}
      </View>
      {env === 'live' ? (
        <CredentialInputs descriptor={d} values={creds} onChange={setCreds} />
      ) : null}
      {settings?.teams.length ? (
        <View style={{ gap: 4 }}>
          <Text variant="label">Owning team</Text>
          <Chips
            label="Owning team"
            options={[
              { key: '', label: 'Everyone in the inbox' },
              ...settings.teams.map((t) => ({ key: t.teamId, label: t.name })),
            ]}
            selected={[teamId]}
            onToggle={setTeamId}
          />
        </View>
      ) : null}
      {missing.length ? (
        <Notice
          tone="warning"
          text={`Still missing: ${missing.map((f) => f.label).join(', ')}. You can save now and add them later; the channel stays inactive until they're set.`}
        />
      ) : null}
      {error ? <Notice tone="danger" text={error} /> : null}
      <View style={styles.row}>
        <Button title="Back" kind="quiet" onPress={onBack} style={{ flex: 1 }} />
        <Button
          title="Connect"
          icon="link"
          busy={busy}
          disabled={!name.trim()}
          onPress={() => void connect()}
          style={{ flex: 1 }}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  modes: { flexDirection: 'row', gap: space.sm },
  mode: {
    flex: 1,
    padding: space.md,
    gap: 4,
    borderRadius: radius.md,
    borderWidth: 1,
  },
});
