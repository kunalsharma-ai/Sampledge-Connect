import { Ionicons } from '@expo/vector-icons';
import { formatClipDuration, languageLabel, type TranscriptSegment } from '@sampledge/contracts';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Button } from '../../components/Button';
import { Chips } from '../../components/Chips';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { changedLines, transcriptBusy, translationOffers } from '../../lib/transcript';
import { useWorkspace } from '../../state/AppProvider';
import { useTranscript, useTranscription } from '../../state/useTranscript';
import { alpha, radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

const ORIGINAL = 'original';

/**
 * A recording's transcript from the organization's own speech-to-text server. People who were
 * there can switch languages, correct lines and mark it checked; corrections show at once, sync
 * live to every device and wait on this phone when there is no connection.
 */
export default function TranscriptScreen() {
  const { attachmentId, title } = useLocalSearchParams<{ attachmentId: string; title?: string }>();
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const settings = useTranscription();
  const { t, loaded, error, reload } = useTranscript(attachmentId);
  const [lang, setLang] = useState<string>(ORIGINAL);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [draftText, setDraftText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const blocked = engine.serverActionBlocker();

  const tr =
    t && lang !== ORIGINAL ? (t.translations.find((x) => x.language === lang) ?? null) : null;
  const segments: TranscriptSegment[] = tr ? tr.segments : (t?.segments ?? []);
  const text = tr ? tr.text : (t?.text ?? null);
  const reviewedAt = tr ? tr.reviewedAt : (t?.reviewedAt ?? null);
  const edited = tr ? tr.edited : !!t?.edited;
  const viewDone = !tr || tr.status === 'done';
  const language = tr ? tr.language : null;

  // Back online: the queued correction is on its way, so the offline note no longer applies.
  const offline = !!blocked;
  useEffect(() => {
    if (!offline) setNote((n) => (n?.tone === 'ok' ? null : n));
  }, [offline]);

  // A translation that disappeared (or a fresh transcript): back to the original.
  useEffect(() => {
    if (t && lang !== ORIGINAL && !t.translations.some((x) => x.language === lang))
      setLang(ORIGINAL);
  }, [t, lang]);

  const startEdit = () => {
    setDraft(segments.map((s) => s.text));
    setDraftText(text ?? '');
    setEditing(true);
    setNote(null);
  };

  const queued = () =>
    setNote(
      blocked
        ? { tone: 'ok', text: 'Saved on this phone. It syncs when you’re back online.' }
        : null,
    );

  const saveLines = async () => {
    setBusy('save');
    try {
      if (segments.length) {
        const lines = changedLines(segments, draft);
        if (lines) await engine.correctTranscript(attachmentId, language, { segments: lines });
      } else if (draftText.trim() !== (text ?? '').trim())
        await engine.correctTranscript(attachmentId, language, { text: draftText.trim() });
      setEditing(false);
      queued();
    } catch (e) {
      setNote({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const toggleChecked = async () => {
    setBusy('check');
    try {
      await engine.correctTranscript(attachmentId, language, { reviewed: !reviewedAt });
      queued();
    } catch (e) {
      setNote({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const translate = async (code: string) => {
    setBusy(`tr:${code}`);
    setNote(null);
    try {
      await engine.translateTranscript(attachmentId, code);
      setLang(code);
    } catch (e) {
      setNote({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const input = [
    styles.input,
    { color: c.text, backgroundColor: c.surfaceSunken, borderColor: c.border },
  ];
  const offers = t ? translationOffers(t, settings?.translation ?? 'none') : [];

  const body = () => {
    if (!t)
      return (
        <Text tone={error ? 'danger' : 'muted'}>
          {error ??
            (loaded && blocked ? `${blocked} The transcript loads from the server.` : 'Loading…')}
        </Text>
      );
    if (t.status === 'not_configured')
      return (
        <Text tone="muted">
          Your organization hasn’t set up a speech-to-text server yet (admin › Integrations ›
          Speech-to-text).
        </Text>
      );
    if (t.status === 'failed')
      return (
        <View style={{ gap: space.md }}>
          <Text tone="danger">{t.error ?? 'Transcription failed.'}</Text>
          <Button
            title="Try again"
            kind="quiet"
            icon="refresh"
            disabled={!!blocked}
            onPress={() => reload(true)}
          />
        </View>
      );
    if (transcriptBusy(t.status))
      return (
        <View style={styles.row}>
          <ActivityIndicator color={c.accent} />
          <Text tone="muted" style={{ flex: 1 }}>
            Transcribing on your organization’s speech-to-text server. Long recordings can take a
            few minutes.
          </Text>
        </View>
      );
    if (t.status !== 'done') return <Text tone="muted">No transcript yet.</Text>;
    if (!t.text?.trim()) return <Text tone="muted">No speech was heard.</Text>;

    return (
      <View style={{ gap: space.lg }}>
        <View style={{ gap: space.sm }}>
          <Chips
            label="Transcript language"
            options={[
              {
                key: ORIGINAL,
                label: `${t.language ? languageLabel(t.language) : 'Original'} · original`,
              },
              ...t.translations.map((x) => ({
                key: x.language,
                label: `${languageLabel(x.language)}${transcriptBusy(x.status) ? ' …' : ''}${x.outdated ? ' ⚠' : ''}`,
              })),
            ]}
            selected={[lang]}
            onToggle={(k) => !editing && setLang(k)}
          />
          {offers.length && !editing ? (
            <View style={{ gap: space.xs }}>
              <Text variant="label" tone="muted">
                Translate to
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.row}>
                  {offers.map(([code, name]) => (
                    <Pressable
                      key={code}
                      onPress={() => void translate(code)}
                      disabled={!!blocked || !!busy}
                      accessibilityRole="button"
                      accessibilityLabel={`Translate to ${name}`}
                      style={[
                        styles.offer,
                        { borderColor: c.border, opacity: blocked || busy ? 0.5 : 1 },
                      ]}
                    >
                      {busy === `tr:${code}` ? (
                        <ActivityIndicator size="small" color={c.accent} />
                      ) : (
                        <Ionicons name="language-outline" size={14} color={c.accent} />
                      )}
                      <Text variant="meta">{name}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            </View>
          ) : null}
        </View>

        {tr && tr.status === 'failed' ? (
          <View style={{ gap: space.md }}>
            <Text tone="danger">{tr.error ?? 'Translation failed.'}</Text>
            <Button
              title="Try again"
              kind="quiet"
              icon="refresh"
              disabled={!!blocked}
              onPress={() => void translate(tr.language)}
            />
          </View>
        ) : tr && !viewDone ? (
          <View style={styles.row}>
            <ActivityIndicator color={c.accent} />
            <Text tone="muted" style={{ flex: 1 }}>
              Translating to {languageLabel(tr.language)}
              {tr.engine === 'stt' ? ' on your speech-to-text server' : ' on your AI model server'}…
            </Text>
          </View>
        ) : editing ? (
          segments.length ? (
            <View style={{ gap: space.sm }}>
              {segments.map((s, i) => (
                <View key={i} style={styles.line}>
                  <Text variant="meta" tone="subtle" style={styles.time}>
                    {formatClipDuration(s.startMs)}
                  </Text>
                  <TextInput
                    value={draft[i] ?? ''}
                    onChangeText={(v) => setDraft((d) => d.map((x, j) => (j === i ? v : x)))}
                    multiline
                    accessibilityLabel={`Line ${i + 1}`}
                    style={[
                      ...input,
                      { flex: 1, minWidth: 0 },
                      draft[i] !== s.text ? { borderColor: c.accent } : null,
                    ]}
                  />
                </View>
              ))}
            </View>
          ) : (
            <TextInput
              value={draftText}
              onChangeText={setDraftText}
              multiline
              accessibilityLabel="Transcript text"
              style={[...input, { minHeight: 160, textAlignVertical: 'top' }]}
            />
          )
        ) : segments.length ? (
          <View style={{ gap: space.sm }}>
            {segments.map((s, i) => (
              <View key={i} style={styles.line}>
                <Text variant="meta" tone="subtle" style={styles.time}>
                  {formatClipDuration(s.startMs)}
                </Text>
                <Text style={{ flex: 1, minWidth: 0 }} selectable>
                  {s.text}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text selectable>{text}</Text>
        )}

        {tr?.outdated && viewDone && !editing ? (
          <View style={[styles.notice, { backgroundColor: alpha(c.warning, 0.12) }]}>
            <Ionicons name="warning-outline" size={16} color={c.warning} />
            <Text variant="meta" style={{ flex: 1, color: c.warning }}>
              The original was corrected after this was translated.
            </Text>
            <Pressable
              onPress={() => void translate(tr.language)}
              disabled={!!blocked}
              accessibilityRole="button"
            >
              <Text variant="label" tone="accent">
                Translate again
              </Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.row}>
          {reviewedAt ? <Ionicons name="checkmark-circle" size={16} color={c.success} /> : null}
          <Text
            variant="meta"
            tone={reviewedAt ? 'default' : 'muted'}
            style={[{ flex: 1 }, reviewedAt ? { color: c.success } : null]}
          >
            {reviewedAt
              ? 'Checked against the recording'
              : tr
                ? `Machine translation from ${t.language ? languageLabel(t.language) : 'the original'}`
                : `Machine transcript${t.language ? ` · ${languageLabel(t.language)}` : ''}`}
            {edited ? ' · corrected by people' : ''}
            {!reviewedAt ? '. It can contain mistakes and does not label speakers.' : ''}
          </Text>
        </View>

        {t.canEdit && viewDone ? (
          editing ? (
            <View style={styles.actions}>
              <Button
                title="Cancel"
                kind="quiet"
                disabled={!!busy}
                onPress={() => setEditing(false)}
                style={{ flex: 1 }}
              />
              <Button
                title="Save corrections"
                busy={busy === 'save'}
                onPress={() => void saveLines()}
                style={{ flex: 1 }}
              />
            </View>
          ) : (
            <View style={styles.actions}>
              <Button title="Correct" kind="quiet" onPress={startEdit} style={{ flex: 1 }} />
              <Button
                title={reviewedAt ? 'Uncheck' : 'Mark checked'}
                kind="quiet"
                busy={busy === 'check'}
                onPress={() => void toggleChecked()}
                style={{ flex: 1 }}
              />
            </View>
          )
        ) : null}
      </View>
    );
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: title ? `Transcript · ${title}` : 'Transcript' }} />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
      >
        <Glass>
          <View style={{ padding: space.lg }}>{body()}</View>
        </Glass>
        {note ? (
          <Text
            variant="meta"
            accessibilityLiveRegion="polite"
            style={{
              color: note.tone === 'ok' ? c.success : note.tone === 'warn' ? c.warning : c.danger,
            }}
          >
            {note.text}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  time: { width: 44, paddingTop: 2, fontVariant: ['tabular-nums'] },
  input: {
    paddingHorizontal: space.md,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  offer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
  },
  actions: { flexDirection: 'row', gap: space.sm },
});
