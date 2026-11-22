import type { BookingPage } from '@sampledge/contracts';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { Button } from '../../components/Button';
import { Chips } from '../../components/Chips';
import { Screen } from '../../components/Screen';
import { SyncBanner } from '../../components/SyncBanner';
import { Text } from '../../components/Text';
import type { LocalBookingPage } from '../../db/work';
import {
  BUFFERS,
  bookingPatch,
  DURATIONS,
  durationLabel,
  HORIZONS,
  NOTICES,
  slugify,
  slugProblem,
} from '../../lib/booking';
import { confirmThen } from '../../lib/confirm';
import { useWorkspace } from '../../state/AppProvider';
import { useBookingPages, usePeopleChoices } from '../../state/hooks';
import { radius, space, type as typeScale } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

type Form = Pick<
  BookingPage,
  | 'title'
  | 'slug'
  | 'description'
  | 'durationMinutes'
  | 'hostIds'
  | 'mode'
  | 'bufferMinutes'
  | 'minNoticeMinutes'
  | 'horizonDays'
  | 'media'
  | 'enabled'
>;

const fromPage = (p: Form): Form => ({
  title: p.title,
  slug: p.slug,
  description: p.description,
  durationMinutes: p.durationMinutes,
  hostIds: p.hostIds,
  mode: p.mode,
  bufferMinutes: p.bufferMinutes,
  minNoticeMinutes: p.minNoticeMinutes,
  horizonDays: p.horizonDays,
  media: p.media,
  enabled: p.enabled,
});

/** New or existing booking page: what people book, with whom, and when. Works offline. */
export default function BookingPageEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine, selfId } = useWorkspace();
  const { items } = useBookingPages();
  const page: LocalBookingPage | undefined = items?.find((p) => p.bookingPageId === id);
  const people = usePeopleChoices();
  const blocked = engine.queueBlocker();

  const blank: Form = {
    title: '',
    slug: '',
    description: '',
    durationMinutes: 30,
    hostIds: [selfId],
    mode: 'any',
    bufferMinutes: 0,
    minNoticeMinutes: 4 * 60,
    horizonDays: 30,
    media: 'video',
    enabled: true,
  };
  const [form, setForm] = useState<Form | null>(isNew ? blank : null);
  const [slugTouched, setSlugTouched] = useState(!isNew);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Fill the form once the page is read from this phone; later live changes do not wipe edits.
  useEffect(() => {
    if (!isNew && page && !form) setForm(fromPage(page));
  }, [isNew, page, form]);
  const saved = useMemo(() => (page ? fromPage(page) : null), [page]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setError(null);
    setForm((f) => (f ? { ...f, [k]: v } : f));
  };

  const input = [
    typeScale.body,
    styles.input,
    { color: c.text, backgroundColor: c.surfaceSunken, borderColor: c.border },
  ];

  if (!form)
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ title: 'Booking page' }} />
        {items ? (
          <Text tone="muted" style={{ padding: space.lg }}>
            This booking page is not on this phone. It may have been deleted.
          </Text>
        ) : (
          <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />
        )}
      </Screen>
    );

  const save = async () => {
    const title = form.title.trim();
    if (!title) return setError('Give the page a name, for example "Intro call".');
    const slug = slugify(form.slug || title);
    const problem = slugProblem(slug);
    if (problem) return setError(problem);
    const next: Form = {
      ...form,
      title,
      slug,
      description: form.description.trim(),
      hostIds: [...new Set([selfId, ...form.hostIds])],
    };
    setBusy(true);
    setError(null);
    try {
      if (isNew) await engine.createBookingPage(next);
      else {
        const patch = bookingPatch(saved ?? next, next);
        if (Object.keys(patch).length) await engine.updateBookingPage(id, patch);
      }
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const remove = () =>
    confirmThen(
      'Delete this booking page?',
      'The link stops working. Meetings already booked stay on the calendar.',
      'Delete',
      () =>
        void engine
          .deleteBookingPage(id)
          .then(() => router.back())
          .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))),
    );

  const multiHost = form.hostIds.length > 1;

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: isNew ? 'New booking page' : 'Booking page' }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
        >
          {page ? (
            <SyncBanner
              item={page}
              what="booking page"
              onRetry={() => void engine.retryLocal('booking', page.bookingPageId)}
              onDiscard={() =>
                void engine.discardLocal('booking', page.bookingPageId).then(() => router.back())
              }
            />
          ) : null}
          <Field label="Name">
            <TextInput
              value={form.title}
              onChangeText={(t) => {
                set('title', t);
                if (!slugTouched) set('slug', slugify(t));
              }}
              placeholder="Intro call with Sales"
              placeholderTextColor={c.textSubtle}
              maxLength={120}
              accessibilityLabel="Name"
              style={input}
            />
          </Field>
          <Field label="Link" hint={`…/book/${form.slug || 'your-link'}`}>
            <TextInput
              value={form.slug}
              onChangeText={(t) => {
                setSlugTouched(true);
                set('slug', t.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
              }}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="intro-call"
              placeholderTextColor={c.textSubtle}
              maxLength={60}
              accessibilityLabel="Link"
              style={input}
            />
          </Field>
          <Field label="Description (optional)">
            <TextInput
              value={form.description}
              onChangeText={(t) => set('description', t)}
              placeholder="What the meeting is for, what to prepare"
              placeholderTextColor={c.textSubtle}
              maxLength={2000}
              multiline
              accessibilityLabel="Description"
              style={[input, { minHeight: 72, textAlignVertical: 'top' }]}
            />
          </Field>
          <Field label="Length">
            <Chips
              label="Length"
              options={DURATIONS.map((m) => ({ key: String(m), label: durationLabel(m) }))}
              selected={[String(form.durationMinutes)]}
              onToggle={(k) => set('durationMinutes', Number(k))}
            />
          </Field>
          <Field label="Hosts" hint="You are always a host.">
            <Chips
              label="Hosts"
              multi
              options={people}
              selected={form.hostIds}
              onToggle={(u) =>
                u !== selfId &&
                set(
                  'hostIds',
                  form.hostIds.includes(u)
                    ? form.hostIds.filter((x) => x !== u)
                    : [...form.hostIds, u],
                )
              }
            />
          </Field>
          {multiHost ? (
            <Field
              label="Who attends"
              hint={
                form.mode === 'any'
                  ? 'One free host takes each booking, spreading them out over the day.'
                  : 'Every host attends, so a time needs all of you free.'
              }
            >
              <Chips
                label="Who attends"
                options={[
                  { key: 'any', label: 'Any free host' },
                  { key: 'all', label: 'All hosts' },
                ]}
                selected={[form.mode]}
                onToggle={(k) => set('mode', k as Form['mode'])}
              />
            </Field>
          ) : null}
          <Field label="Call">
            <Chips
              label="Call"
              options={[
                { key: 'video', label: 'Video' },
                { key: 'audio', label: 'Audio only' },
              ]}
              selected={[form.media]}
              onToggle={(k) => set('media', k as Form['media'])}
            />
          </Field>
          <Field label="Gap before and after">
            <Chips
              label="Gap before and after"
              options={BUFFERS.map((m) => ({ key: String(m), label: m ? `${m} min` : 'None' }))}
              selected={[String(form.bufferMinutes)]}
              onToggle={(k) => set('bufferMinutes', Number(k))}
            />
          </Field>
          <Field label="Earliest booking">
            <Chips
              label="Earliest booking"
              options={NOTICES.map((n) => ({ key: String(n.minutes), label: n.label }))}
              selected={[String(form.minNoticeMinutes)]}
              onToggle={(k) => set('minNoticeMinutes', Number(k))}
            />
          </Field>
          <Field label="How far ahead">
            <Chips
              label="How far ahead"
              options={HORIZONS.map((d) => ({ key: String(d), label: `${d} days` }))}
              selected={[String(form.horizonDays)]}
              onToggle={(k) => set('horizonDays', Number(k))}
            />
          </Field>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">Taking bookings</Text>
              <Text variant="meta" tone="muted">
                Pause to stop new bookings without losing the link.
              </Text>
            </View>
            <Switch
              value={form.enabled}
              onValueChange={(v) => set('enabled', v)}
              accessibilityLabel="Taking bookings"
              trackColor={{ true: c.accent }}
            />
          </View>
          {error || blocked ? (
            <Text variant="meta" tone="danger" accessibilityLiveRegion="polite">
              {error ?? blocked}
            </Text>
          ) : null}
          <Button
            title={isNew ? 'Create booking page' : 'Save changes'}
            icon="checkmark"
            busy={busy}
            disabled={!!blocked}
            onPress={() => void save()}
          />
          {!isNew ? (
            <Button
              title="Delete booking page"
              kind="danger"
              icon="trash-outline"
              disabled={!!blocked}
              onPress={remove}
            />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      {children}
      {hint ? (
        <Text variant="meta" tone="muted">
          {hint}
        </Text>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
