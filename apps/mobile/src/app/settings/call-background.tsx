import { Ionicons } from '@expo/vector-icons';
import type { CallBackgroundChoice, CallBackgroundPolicy } from '@sampledge/contracts';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Button } from '../../components/Button';
import { CallBackgroundPreview } from '../../components/CallBackgroundPreview';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { callBackgroundLabel, PRESET_GROUPS, sameChoice } from '../../lib/callBackground';
import { prepareCallBackground } from '../../lib/callBackgroundImage';
import { confirmThen } from '../../lib/confirm';
import { useWorkspace } from '../../state/AppProvider';
import { useCallBackground } from '../../state/useCallBackground';
import { alpha, radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

type Draft = Pick<CallBackgroundPolicy, 'defaultChoice' | 'enforceLogo'>;

/**
 * What you show behind you in calls. Saved to your account, so every device uses it and a change
 * here reaches a call you are in elsewhere. Works offline. Admins set the default and can require
 * the company background.
 */
export default function CallBackgroundScreen() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const state = useCallBackground();
  const [managing, setManaging] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const blocked = engine.serverActionBlocker();
  useEffect(() => {
    if (state)
      setDraft({
        defaultChoice: state.policy.defaultChoice,
        enforceLogo: state.policy.enforceLogo,
      });
  }, [state?.policy]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state || !draft)
    return (
      <Screen edges={['bottom']}>
        <Text tone="muted" style={{ padding: space.lg }}>
          Loading your call background…
        </Text>
      </Screen>
    );

  const locked = state.policy.enforceLogo;
  const run = async (f: () => Promise<void>, ok?: string) => {
    setBusy(true);
    setNote(null);
    try {
      await f();
      if (ok) setNote({ ok: true, text: ok });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  const pick = (choice: CallBackgroundChoice) => {
    setNote(null);
    if (managing) {
      if (choice.kind !== 'custom') setDraft({ ...draft, defaultChoice: choice });
      return;
    }
    if (locked) return;
    void engine.setCallBackground(choice);
  };
  const upload = () =>
    run(async () => {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      if (r.canceled || !r.assets[0]) return;
      const a = r.assets[0];
      await engine.setCallBackgroundImage(await prepareCallBackground(a.uri, a.width, a.height));
    }, 'Saved. Your other devices use it too.');
  const removeImage = () =>
    confirmThen(
      'Remove your image?',
      state.choice?.kind === 'custom'
        ? 'Calls go back to your organization’s default background.'
        : 'It is removed from all your devices.',
      'Remove',
      () => engine.removeCallBackgroundImage(),
    );
  const saveRules = () =>
    run(async () => {
      await engine.setCallBackgroundPolicy(draft);
      setManaging(false);
    }, 'Call background rules saved. Calls in progress update now.');

  const selected = (ch: CallBackgroundChoice) =>
    managing ? sameChoice(draft.defaultChoice, ch) : sameChoice(state.effective, ch);
  const changed =
    JSON.stringify(draft) !==
    JSON.stringify({
      defaultChoice: state.policy.defaultChoice,
      enforceLogo: state.policy.enforceLogo,
    });
  const disabled = !managing && locked;

  const tile = (ch: CallBackgroundChoice, label: string, key: string) => (
    <Tile
      key={key}
      label={label}
      selected={selected(ch)}
      isDefault={sameChoice(draft.defaultChoice, ch)}
      disabled={disabled && ch.kind !== 'logo'}
      onPress={() => pick(ch)}
    >
      <CallBackgroundPreview choice={ch} state={state} />
    </Tile>
  );

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}>
        <View style={{ gap: space.sm }}>
          <CallBackgroundPreview
            choice={state.effective}
            state={state}
            person
            testID="call-background-preview"
          />
          <Text variant="bodyStrong" accessibilityLiveRegion="polite">
            {callBackgroundLabel(state.effective)}
            {state.choice ? '' : ' (organization default)'}
          </Text>
          <Text variant="meta" tone="muted">
            Saved to your account, so all your devices use it, and a change here reaches a call you
            are in on another device. Works offline.
          </Text>
        </View>

        <Glass>
          <View style={styles.notice}>
            <Ionicons name="phone-portrait-outline" size={18} color={c.accent} />
            <Text variant="meta" tone="muted" style={{ flex: 1 }}>
              Backgrounds are applied to your camera when you join from a browser or the desktop
              app. Applying them to a phone’s camera is planned; until then a phone sends your
              camera as it is.
            </Text>
          </View>
        </Glass>

        {locked && !managing ? (
          <Glass>
            <View style={styles.notice}>
              <Ionicons name="lock-closed-outline" size={18} color={c.accent} />
              <Text variant="meta" tone="muted" style={{ flex: 1 }}>
                Your organization uses the company background for everyone in calls.
              </Text>
            </View>
          </Glass>
        ) : null}

        {state.policy.canManage ? (
          <Glass>
            <View style={{ padding: space.lg, gap: space.md }}>
              <View style={styles.rowBetween}>
                <Text variant="bodyStrong">Organization rules</Text>
                <Button
                  title={managing ? 'Done' : 'Manage'}
                  kind="quiet"
                  onPress={() => setManaging((m) => !m)}
                  style={{ paddingVertical: 6, paddingHorizontal: space.md }}
                />
              </View>
              <Text variant="meta" tone="muted">
                Default for everyone who hasn’t picked: {callBackgroundLabel(draft.defaultChoice)}.
                {draft.enforceLogo ? ' The company background is required.' : ''}
              </Text>
              {managing ? (
                <>
                  <Text variant="meta" tone="muted">
                    Tap a background below to make it the default.
                  </Text>
                  <View style={styles.rowBetween}>
                    <View style={{ flex: 1 }}>
                      <Text variant="label">Require the company background</Text>
                      <Text variant="meta" tone="muted">
                        Everyone in the organization shows it and can’t change it. Guests from
                        outside keep their own.
                      </Text>
                    </View>
                    <Switch
                      value={draft.enforceLogo}
                      onValueChange={(on) => setDraft({ ...draft, enforceLogo: on })}
                      accessibilityLabel="Require the company background"
                      trackColor={{ true: c.accent, false: c.border }}
                    />
                  </View>
                  <Button
                    title={blocked ? 'Needs a connection' : 'Save rules'}
                    onPress={() => void saveRules()}
                    busy={busy}
                    disabled={!!blocked || !changed}
                  />
                </>
              ) : null}
            </View>
          </Glass>
        ) : null}

        {note ? (
          <Text variant="meta" tone={note.ok ? 'muted' : 'danger'} accessibilityLiveRegion="polite">
            {note.text}
          </Text>
        ) : null}

        <View style={{ gap: space.sm }}>
          <Text variant="label" tone="muted">
            Basics
          </Text>
          <View style={styles.grid}>
            {tile({ kind: 'none' }, 'No background', 'none')}
            {tile({ kind: 'blur' }, 'Blur', 'blur')}
            {tile({ kind: 'logo' }, 'Company background', 'logo')}
            {managing ? null : state.customImageUrl ? (
              tile({ kind: 'custom' }, 'Your image', 'custom')
            ) : (
              <Tile
                key="upload"
                label="Add your image"
                selected={false}
                disabled={locked || busy}
                onPress={() => void upload()}
              >
                <View
                  style={[
                    styles.add,
                    { borderColor: c.border, backgroundColor: alpha(c.accent, 0.08) },
                  ]}
                >
                  <Ionicons name="add-circle-outline" size={24} color={c.accent} />
                </View>
              </Tile>
            )}
          </View>
          {!managing && state.customImageUrl ? (
            <View style={styles.actions}>
              <Button
                title="Replace image"
                kind="quiet"
                onPress={() => void upload()}
                disabled={locked || busy}
              />
              <Button title="Remove image" kind="quiet" onPress={removeImage} disabled={busy} />
            </View>
          ) : null}
        </View>

        {PRESET_GROUPS.map((g) => (
          <View key={g.group} style={{ gap: space.sm }}>
            <Text variant="label" tone="muted">
              {g.group === 'Office' ? 'Office scenes' : 'Simple'}
            </Text>
            <View style={styles.grid}>
              {g.presets.map((p) => tile({ kind: 'preset', presetId: p.id }, p.name, p.id))}
            </View>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

function Tile({
  label,
  selected,
  isDefault,
  disabled,
  onPress,
  children,
}: {
  label: string;
  selected: boolean;
  isDefault?: boolean;
  disabled?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      aria-checked={selected}
      accessibilityLabel={`${label}${isDefault ? ', organization default' : ''}`}
      style={[styles.tile, { opacity: disabled ? 0.45 : 1 }]}
    >
      <View style={[styles.tileFrame, { borderColor: selected ? c.accent : 'transparent' }]}>
        {children}
        {selected ? (
          <View style={[styles.check, { backgroundColor: c.accent }]}>
            <Ionicons name="checkmark" size={12} color={c.onAccent} />
          </View>
        ) : null}
      </View>
      <Text variant="meta" numberOfLines={1} style={{ marginTop: 4 }}>
        {label}
      </Text>
      {isDefault ? (
        <Text variant="meta" tone="subtle" numberOfLines={1}>
          Default
        </Text>
      ) : null}
    </Pressable>
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: space.md,
  },
  tile: { width: '48%' },
  tileFrame: { borderWidth: 2, borderRadius: radius.md, overflow: 'hidden' },
  add: {
    aspectRatio: 16 / 9,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { flexDirection: 'row', gap: space.sm },
  check: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
