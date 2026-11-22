import { Ionicons } from '@expo/vector-icons';
import {
  CHAT_EXPORT_MAX_MESSAGES,
  CHAT_EXPORT_POLICY_LABEL,
  MIME_BY_FORMAT,
  type ChatExportAccess,
  type ChatExportFormat,
} from '@sampledge/contracts';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Button } from '../components/Button';
import { Chips } from '../components/Chips';
import { Glass } from '../components/Glass';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { exportRange, type ExportRange } from '../lib/minutes';
import { shareDocument } from '../lib/localFiles';
import { useWorkspace } from '../state/AppProvider';
import { space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';

const RANGES: { key: ExportRange; label: string }[] = [
  { key: 'all', label: 'Everything' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
];

/** Downloads a conversation as PDF, Word or text, within your organization's export rule. */
export default function ExportChatScreen() {
  const { conversationId, title } = useLocalSearchParams<{
    conversationId: string;
    title?: string;
  }>();
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const [access, setAccess] = useState<ChatExportAccess | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [format, setFormat] = useState<ChatExportFormat>('pdf');
  const [range, setRange] = useState<ExportRange>('all');
  const [events, setEvents] = useState(true);
  const [transcripts, setTranscripts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const blocked = engine.serverActionBlocker();

  useEffect(() => {
    let live = true;
    engine
      .chatExportAccess(conversationId)
      .then((a) => live && setAccess(a))
      .catch((e: unknown) => live && setAccessError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [engine, conversationId, blocked]);

  const go = async () => {
    setBusy(true);
    setNote(null);
    try {
      const uri = await engine.exportChat(conversationId, title ?? 'Conversation', {
        format,
        ...exportRange(range, new Date()),
        includeSystem: events,
        includeTranscripts: transcripts,
      });
      await shareDocument(uri, MIME_BY_FORMAT[format], title ?? 'Conversation');
      setNote({
        ok: true,
        text: 'Exported. The export is recorded in your organization’s audit log.',
      });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Export chat' }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}>
        <Text tone="muted">
          Download {title ? `“${title}”` : 'this conversation'} with names, times and files listed.
          Up to {CHAT_EXPORT_MAX_MESSAGES.toLocaleString()} messages.
        </Text>
        {!access ? (
          <Text tone="muted">
            {accessError ?? (blocked ? `${blocked} Exporting needs a connection.` : 'Checking…')}
          </Text>
        ) : !access.allowed ? (
          <Glass>
            <View style={styles.notice}>
              <Ionicons name="lock-closed-outline" size={18} color={c.accent} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text variant="bodyStrong">You can’t export this conversation</Text>
                <Text variant="meta" tone="muted">
                  {access.reason ?? 'Your organization limits who can export.'} Who can export:{' '}
                  {CHAT_EXPORT_POLICY_LABEL[access.policy]}.
                </Text>
              </View>
            </View>
          </Glass>
        ) : (
          <Glass>
            <View style={{ padding: space.lg, gap: space.lg }}>
              <View style={{ gap: space.sm }}>
                <Text variant="label" tone="muted">
                  Format
                </Text>
                <Chips
                  label="Format"
                  options={[
                    { key: 'pdf', label: 'PDF' },
                    { key: 'docx', label: 'Word' },
                    { key: 'txt', label: 'Text' },
                  ]}
                  selected={[format]}
                  onToggle={setFormat}
                />
              </View>
              <View style={{ gap: space.sm }}>
                <Text variant="label" tone="muted">
                  Messages from
                </Text>
                <Chips
                  label="Messages from"
                  options={RANGES}
                  selected={[range]}
                  onToggle={setRange}
                />
              </View>
              <View style={styles.rowBetween}>
                <View style={{ flex: 1 }}>
                  <Text variant="label">Calls and other events</Text>
                  <Text variant="meta" tone="muted">
                    Call cards, recordings, meetings and minutes.
                  </Text>
                </View>
                <Switch
                  value={events}
                  onValueChange={setEvents}
                  accessibilityLabel="Calls and other events"
                  trackColor={{ true: c.accent, false: c.border }}
                />
              </View>
              <View style={styles.rowBetween}>
                <View style={{ flex: 1 }}>
                  <Text variant="label">Recording transcripts</Text>
                  <Text variant="meta" tone="muted">
                    Each recording’s transcript under it.
                  </Text>
                </View>
                <Switch
                  value={transcripts}
                  onValueChange={setTranscripts}
                  accessibilityLabel="Recording transcripts"
                  trackColor={{ true: c.accent, false: c.border }}
                />
              </View>
              <Button
                title={blocked ? 'Needs a connection' : 'Export'}
                busy={busy}
                disabled={!!blocked}
                onPress={() => void go()}
              />
            </View>
          </Glass>
        )}
        {note ? (
          <Text variant="meta" tone={note.ok ? 'muted' : 'danger'} accessibilityLiveRegion="polite">
            {note.text}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row', gap: space.md, padding: space.md, alignItems: 'flex-start' },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
});
