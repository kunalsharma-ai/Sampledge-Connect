import { Ionicons } from '@expo/vector-icons';
import {
  MINUTES_TEMPLATES,
  MINUTES_TEMPLATE_INFO,
  MIME_BY_FORMAT,
  TRANSCRIPT_LANGUAGES,
  languageLabel,
  type DocumentFormat,
  type MeetingMinutes,
  type MinutesActionItem,
  type MinutesTemplate,
} from '@sampledge/contracts';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { Button } from '../../components/Button';
import { Chips } from '../../components/Chips';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { confirmThen } from '../../lib/confirm';
import { shareDocument } from '../../lib/localFiles';
import {
  cleanActionItems,
  cleanLines,
  minutesWhen,
  newActionItem,
  ownerLabel,
  sourcesLine,
} from '../../lib/minutes';
import { useWorkspace } from '../../state/AppProvider';
import { usePeople } from '../../state/hooks';
import { useCallMinutes, useMinutesConfig } from '../../state/useMinutes';
import { alpha, radius, space, type as typeScale } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * Minutes of one call: make the draft, review and edit it together (edits work offline and
 * merge per field), share it with the conversation, and download it as PDF or Word.
 */
export default function MinutesScreen() {
  const { callId } = useLocalSearchParams<{ callId: string }>();
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const { data, loaded, error } = useCallMinutes(callId);
  const config = useMinutesConfig();
  const [language, setLanguage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const blocked = engine.serverActionBlocker();
  const lang = language ?? data?.minutes?.language ?? config?.defaultLanguage ?? 'en';

  const run = async (key: string, f: () => Promise<void>, ok?: string) => {
    setBusy(key);
    setNote(null);
    try {
      await f();
      if (ok) setNote({ ok: true, text: ok });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const m = data?.minutes ?? null;
  const languagePicker = (
    <View style={{ gap: space.sm }}>
      <Text variant="label" tone="muted">
        Write the minutes in
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Chips
          label="Language"
          options={TRANSCRIPT_LANGUAGES.map(([key, label]) => ({ key, label }))}
          selected={[lang]}
          onToggle={setLanguage}
        />
      </ScrollView>
      {config && !config.model && lang !== 'en' ? (
        <Text variant="meta" tone="muted">
          Languages other than English need your organization’s AI model server.
        </Text>
      ) : null}
    </View>
  );

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen
        options={{ title: m ? (m.status === 'draft' ? 'Draft minutes' : 'Minutes') : 'Minutes' }}
      />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 96 }}
        keyboardShouldPersistTaps="handled"
      >
        {!loaded ? (
          <Text tone="muted">Loading the minutes…</Text>
        ) : !m ? (
          <Glass>
            <View style={{ padding: space.lg, gap: space.md }}>
              <Ionicons name="document-text-outline" size={28} color={c.accent} />
              <Text variant="bodyStrong">No minutes for this call yet</Text>
              {data?.blockedReason ? (
                <Text tone="muted">{data.blockedReason}</Text>
              ) : data?.canCreate ? (
                <>
                  <Text tone="muted">
                    {config?.aiEnabled === false
                      ? 'The draft starts with the attendees filled in, and you write the rest together.'
                      : 'A draft is written from the call’s recording transcripts, saved captions and chat. Only people who were in the call see it until it’s shared.'}
                  </Text>
                  {languagePicker}
                  <Button
                    title={blocked ? 'Needs a connection' : 'Make minutes'}
                    busy={busy === 'make'}
                    disabled={!!blocked}
                    onPress={() => void run('make', () => engine.generateMinutes(callId, lang))}
                  />
                </>
              ) : (
                <Text tone="muted">
                  {error ??
                    (blocked
                      ? `${blocked} Minutes load the first time you are online.`
                      : 'Only people who were in the call can make minutes.')}
                </Text>
              )}
            </View>
          </Glass>
        ) : (
          <MinutesBody
            m={m}
            busy={busy}
            run={run}
            languagePicker={languagePicker}
            lang={lang}
            defaultTemplate={config?.defaultTemplate ?? 'modern'}
          />
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

function MinutesBody({
  m,
  busy,
  run,
  languagePicker,
  lang,
  defaultTemplate,
}: {
  m: MeetingMinutes;
  busy: string | null;
  run: (key: string, f: () => Promise<void>, ok?: string) => Promise<void>;
  languagePicker: React.ReactNode;
  lang: string;
  defaultTemplate: MinutesTemplate;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const nameOf = usePeople();
  const blocked = engine.serverActionBlocker();
  const edit = m.canEdit;
  const save = (patch: Parameters<typeof engine.editMinutes>[1]) =>
    void engine.editMinutes(m, patch);
  const [regen, setRegen] = useState(false);
  const input = [
    typeScale.body,
    styles.input,
    { color: c.text, backgroundColor: c.surfaceSunken, borderColor: c.border },
  ];

  return (
    <>
      <View style={{ gap: space.xs }}>
        <View style={styles.rowWrap}>
          <View
            style={[
              styles.pill,
              {
                backgroundColor:
                  m.status === 'draft' ? alpha(c.warning, 0.15) : alpha(c.success, 0.15),
              },
            ]}
          >
            <Text variant="meta" style={{ color: m.status === 'draft' ? c.warning : c.success }}>
              {m.status === 'draft'
                ? 'Draft · only people in the call see it'
                : 'Shared with the conversation'}
            </Text>
          </View>
        </View>
        <TextField
          value={m.title}
          editable={edit}
          label="Title"
          style={[...input, typeScale.title]}
          onSave={(title) => title.trim() && title !== m.title && save({ title: title.trim() })}
        />
        <Text variant="meta" tone="muted">
          {minutesWhen(m)} · {m.media === 'video' ? 'Video call' : 'Voice call'} ·{' '}
          {languageLabel(m.language)}
        </Text>
      </View>

      <Section title="Attendees" icon="people-outline">
        <Text>
          {m.attendees.length
            ? m.attendees
                .map(
                  (a) =>
                    `${a.name}${a.guest ? ' (guest)' : ''}${a.minutes ? ` · ${a.minutes} min` : ''}`,
                )
                .join('\n')
            : 'Nobody recorded.'}
        </Text>
      </Section>

      <Section title="Agenda" icon="list-outline">
        <TextField
          value={m.agenda}
          editable={edit}
          multiline
          label="Agenda"
          placeholder="What the meeting was for"
          style={input}
          onSave={(agenda) => agenda !== m.agenda && save({ agenda })}
        />
      </Section>

      <Section title="Summary" icon="reader-outline">
        <TextField
          value={m.summary}
          editable={edit}
          multiline
          label="Summary"
          placeholder="What was discussed"
          style={input}
          onSave={(summary) => summary !== m.summary && save({ summary })}
        />
      </Section>

      <Section title="Decisions" icon="checkmark-done-outline">
        <LinesField
          lines={m.decisions}
          editable={edit}
          label="Decision"
          addLabel="Add decision"
          inputStyle={input}
          onSave={(decisions) => save({ decisions: cleanLines(decisions) })}
        />
      </Section>

      <Section title="Action items" icon="flag-outline">
        <ActionItems
          items={m.actionItems}
          editable={edit}
          inputStyle={input}
          ownerOf={(a) => ownerLabel(a, (id) => nameOf(id))}
          onSave={(actionItems) => save({ actionItems: cleanActionItems(actionItems) })}
        />
      </Section>

      <Section title="Open questions" icon="help-circle-outline">
        <LinesField
          lines={m.openQuestions}
          editable={edit}
          label="Question"
          addLabel="Add question"
          inputStyle={input}
          onSave={(openQuestions) => save({ openQuestions: cleanLines(openQuestions) })}
        />
      </Section>

      <Section title="Notes" icon="create-outline">
        <TextField
          value={m.notes}
          editable={edit}
          multiline
          label="Notes"
          placeholder="Anything else worth keeping"
          style={input}
          onSave={(notes) => notes !== m.notes && save({ notes })}
        />
      </Section>

      <Text variant="meta" tone="muted">
        {sourcesLine(m.sources)}{' '}
        {m.engine === 'manual'
          ? 'Written by people.'
          : 'Drafted automatically: check it against the call before sharing.'}
      </Text>

      {edit ? (
        <Glass>
          <View style={{ padding: space.lg, gap: space.md }}>
            {m.status === 'draft' ? (
              <Button
                title={blocked ? 'Needs a connection' : 'Share with the conversation'}
                busy={busy === 'share'}
                disabled={!!blocked}
                onPress={() =>
                  void run(
                    'share',
                    () => engine.shareMinutes(m),
                    'Shared. Everyone in the conversation can open them.',
                  )
                }
              />
            ) : null}
            {regen ? (
              <>
                {languagePicker}
                <Text variant="meta" tone="muted">
                  Writing again replaces the agenda, summary, decisions, actions and questions with
                  a fresh draft from the sources.
                </Text>
                <View style={styles.rowWrap}>
                  <Button
                    title="Write again"
                    kind="quiet"
                    busy={busy === 'regen'}
                    disabled={!!blocked}
                    onPress={() =>
                      void run('regen', async () => {
                        await engine.generateMinutes(m.callId, lang, true);
                        setRegen(false);
                      })
                    }
                  />
                  <Button title="Cancel" kind="quiet" onPress={() => setRegen(false)} />
                </View>
              </>
            ) : (
              <View style={styles.rowWrap}>
                <Button
                  title="Regenerate"
                  kind="quiet"
                  onPress={() => setRegen(true)}
                  disabled={!!blocked}
                />
                <Button
                  title="Delete"
                  kind="quiet"
                  disabled={!!blocked}
                  onPress={() =>
                    confirmThen(
                      'Delete these minutes?',
                      m.status === 'shared'
                        ? 'The card in the conversation will say they were deleted.'
                        : 'The draft is removed for everyone.',
                      'Delete',
                      () => void run('delete', () => engine.deleteMinutes(m)),
                    )
                  }
                />
              </View>
            )}
          </View>
        </Glass>
      ) : null}

      <Download m={m} defaultTemplate={defaultTemplate} busy={busy} run={run} />
    </>
  );
}

function Download({
  m,
  defaultTemplate,
  busy,
  run,
}: {
  m: MeetingMinutes;
  defaultTemplate: MinutesTemplate;
  busy: string | null;
  run: (key: string, f: () => Promise<void>, ok?: string) => Promise<void>;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const [format, setFormat] = useState<DocumentFormat>('pdf');
  const [template, setTemplate] = useState<MinutesTemplate>(defaultTemplate);
  const [transcript, setTranscript] = useState(false);
  const blocked = engine.serverActionBlocker();
  return (
    <Glass>
      <View style={{ padding: space.lg, gap: space.md }}>
        <Text variant="bodyStrong">Download</Text>
        <Chips
          label="Format"
          options={[
            { key: 'pdf', label: 'PDF' },
            { key: 'docx', label: 'Word' },
          ]}
          selected={[format]}
          onToggle={setFormat}
        />
        <View
          style={{ gap: space.sm }}
          accessibilityRole="radiogroup"
          accessibilityLabel="Template"
        >
          {MINUTES_TEMPLATES.map((t) => {
            const on = t === template;
            return (
              <Pressable
                key={t}
                onPress={() => setTemplate(t)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                aria-checked={on}
                accessibilityLabel={`${MINUTES_TEMPLATE_INFO[t].label} template`}
                style={[
                  styles.template,
                  {
                    borderColor: on ? c.accent : c.border,
                    backgroundColor: on ? alpha(c.accent, 0.1) : 'transparent',
                  },
                ]}
              >
                <Ionicons
                  name={on ? 'radio-button-on' : 'radio-button-off'}
                  size={18}
                  color={on ? c.accent : c.textSubtle}
                />
                <View style={{ flex: 1 }}>
                  <Text variant="label">{MINUTES_TEMPLATE_INFO[t].label}</Text>
                  <Text variant="meta" tone="muted">
                    {MINUTES_TEMPLATE_INFO[t].description}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.rowBetween}>
          <Text variant="label" style={{ flex: 1 }}>
            Add the full transcript
          </Text>
          <Switch
            value={transcript}
            onValueChange={setTranscript}
            accessibilityLabel="Add the full transcript"
            trackColor={{ true: c.accent, false: c.border }}
          />
        </View>
        <Button
          title={blocked ? 'Needs a connection' : `Download ${format === 'pdf' ? 'PDF' : 'Word'}`}
          busy={busy === 'download'}
          disabled={!!blocked}
          onPress={() =>
            void run('download', async () => {
              const uri = await engine.downloadMinutes(m, {
                format,
                template,
                transcript: transcript ? '1' : '0',
              });
              await shareDocument(uri, MIME_BY_FORMAT[format], m.title);
            })
          }
        />
      </View>
    </Glass>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  children: React.ReactNode;
}) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.rowWrap}>
        <Ionicons name={icon} size={16} color={theme.colors.accent} />
        <Text variant="label" tone="muted" accessibilityRole="header">
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

/** A text box that saves when you leave it, and follows changes from others while you aren't in it. */
function TextField({
  value,
  editable,
  multiline,
  label,
  placeholder,
  style,
  onSave,
}: {
  value: string;
  editable: boolean;
  multiline?: boolean;
  label: string;
  placeholder?: string;
  style: object[];
  onSave: (v: string) => void;
}) {
  const { theme } = useTheme();
  const [draft, setDraft] = useState(value);
  // Not state: leaving a box must not re-render it back to the old value before the save lands.
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  if (!editable) return value ? <Text>{value}</Text> : <Text tone="subtle">None.</Text>;
  return (
    <TextInput
      value={draft}
      onChangeText={setDraft}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        onSave(draft);
      }}
      multiline={multiline}
      placeholder={placeholder}
      placeholderTextColor={theme.colors.textSubtle}
      accessibilityLabel={label}
      style={[...style, multiline ? { minHeight: 72, textAlignVertical: 'top' } : null]}
    />
  );
}

/** A list of one-line entries (decisions, questions) with add and remove. */
function LinesField({
  lines,
  editable,
  label,
  addLabel,
  inputStyle,
  onSave,
}: {
  lines: string[];
  editable: boolean;
  label: string;
  addLabel: string;
  inputStyle: object[];
  onSave: (lines: string[]) => void;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [draft, setDraft] = useState(lines);
  // Not state: leaving a box must not re-render it back to the old value before the save lands.
  const focused = useRef(false);
  // Follow other people's changes, but only real ones (each read makes new arrays).
  const linesKey = JSON.stringify(lines);
  useEffect(() => {
    if (!focused.current) setDraft(JSON.parse(linesKey) as string[]);
  }, [linesKey]);
  if (!editable)
    return lines.length ? (
      <View style={{ gap: 4 }}>
        {lines.map((l, i) => (
          <Text key={i}>• {l}</Text>
        ))}
      </View>
    ) : (
      <Text tone="subtle">None.</Text>
    );
  return (
    <View style={{ gap: space.sm }}>
      {draft.map((l, i) => (
        <View key={i} style={styles.row}>
          <TextInput
            value={l}
            onChangeText={(t) => setDraft(draft.map((x, j) => (j === i ? t : x)))}
            onFocus={() => (focused.current = true)}
            onBlur={() => {
              focused.current = false;
              onSave(draft);
            }}
            accessibilityLabel={`${label} ${i + 1}`}
            style={[...inputStyle, { flex: 1, minWidth: 0 }]}
          />
          <Pressable
            onPress={() => {
              const next = draft.filter((_, j) => j !== i);
              setDraft(next);
              onSave(next);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${label.toLowerCase()} ${i + 1}`}
            hitSlop={8}
          >
            <Ionicons name="close-circle-outline" size={20} color={c.textSubtle} />
          </Pressable>
        </View>
      ))}
      <Button
        title={addLabel}
        kind="quiet"
        onPress={() => setDraft([...draft, ''])}
        style={{ alignSelf: 'flex-start' }}
      />
    </View>
  );
}

function ActionItems({
  items,
  editable,
  inputStyle,
  ownerOf,
  onSave,
}: {
  items: MinutesActionItem[];
  editable: boolean;
  inputStyle: object[];
  ownerOf: (a: MinutesActionItem) => string | null;
  onSave: (items: MinutesActionItem[]) => void;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [draft, setDraft] = useState(items);
  // Not state: leaving a box must not re-render it back to the old value before the save lands.
  const focused = useRef(false);
  const itemsKey = JSON.stringify(items);
  useEffect(() => {
    if (!focused.current) setDraft(JSON.parse(itemsKey) as MinutesActionItem[]);
  }, [itemsKey]);
  const patch = (id: string, p: Partial<MinutesActionItem>) =>
    draft.map((a) => (a.id === id ? { ...a, ...p } : a));
  const field = (
    a: MinutesActionItem,
    key: 'text' | 'ownerName' | 'due',
    label: string,
    flex = 1,
  ) => (
    <TextInput
      value={
        key === 'ownerName' ? (a.ownerName ?? (a.ownerId ? ownerOf(a) : '') ?? '') : (a[key] ?? '')
      }
      onChangeText={(t) =>
        setDraft(patch(a.id, key === 'ownerName' ? { ownerName: t, ownerId: null } : { [key]: t }))
      }
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        onSave(draft);
      }}
      placeholder={label}
      placeholderTextColor={c.textSubtle}
      accessibilityLabel={label}
      style={[...inputStyle, { flex, minWidth: 0 }]}
    />
  );
  if (!editable && !items.length) return <Text tone="subtle">None.</Text>;
  return (
    <View style={{ gap: space.md }}>
      {(editable ? draft : items).map((a) => (
        <View key={a.id} style={[styles.action, { borderColor: c.border }]}>
          <View style={styles.row}>
            <Pressable
              onPress={() => {
                if (!editable) return;
                const next = patch(a.id, { done: !a.done });
                setDraft(next);
                onSave(next);
              }}
              disabled={!editable}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: a.done, disabled: !editable }}
              aria-checked={a.done}
              accessibilityLabel={`Done: ${a.text}`}
              hitSlop={8}
            >
              <Ionicons
                name={a.done ? 'checkbox' : 'square-outline'}
                size={20}
                color={a.done ? c.success : c.textSubtle}
              />
            </Pressable>
            {editable ? (
              field(a, 'text', 'Action')
            ) : (
              <Text style={{ flex: 1, textDecorationLine: a.done ? 'line-through' : 'none' }}>
                {a.text}
              </Text>
            )}
          </View>
          {editable ? (
            <View style={styles.row}>
              {field(a, 'ownerName', 'Owner')}
              {field(a, 'due', 'Due', 0.7)}
              <Pressable
                onPress={() => {
                  const next = draft.filter((x) => x.id !== a.id);
                  setDraft(next);
                  onSave(next);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Remove action ${a.text}`}
                hitSlop={8}
              >
                <Ionicons name="trash-outline" size={18} color={c.textSubtle} />
              </Pressable>
            </View>
          ) : ownerOf(a) || a.due ? (
            <Text variant="meta" tone="muted" style={{ marginLeft: 28 }}>
              {[ownerOf(a), a.due ? `due ${a.due}` : null].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
        </View>
      ))}
      {editable ? (
        <Button
          title="Add action"
          kind="quiet"
          onPress={() => setDraft([...draft, newActionItem()])}
          style={{ alignSelf: 'flex-start' }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowWrap: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  pill: { paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill },
  template: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  action: { gap: space.sm, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
});
