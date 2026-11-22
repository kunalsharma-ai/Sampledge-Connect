import { Ionicons } from '@expo/vector-icons';
import {
  CALL_BACKGROUND_MAX_ORGANIZATION,
  CALL_BACKGROUND_MAX_PERSONAL,
  isNeutralAppearance,
  type CallBackgroundChoice,
  type CallBackgroundPolicy,
  type CallBackgroundUpload,
} from '@sampledge/contracts';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Button } from '../../components/Button';
import { CallBackgroundPreview } from '../../components/CallBackgroundPreview';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import {
  callBackgroundLabel,
  isLocalUpload,
  PRESET_GROUPS,
  sameChoice,
} from '../../lib/callBackground';
import { prepareCallBackground } from '../../lib/callBackgroundImage';
import { confirmThen } from '../../lib/confirm';
import { useWorkspace } from '../../state/AppProvider';
import { useCallBackground } from '../../state/useCallBackground';
import { alpha, radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';
import { cameraEffectsAvailable } from '../../../modules/camera-effects';

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
    if (choice.kind === 'upload' && isLocalUpload(choice.imageId)) return;
    if (locked) return;
    void engine.setCallBackground(choice);
  };
  const mine = state.uploads.filter((u) => u.owner === 'mine');
  const library = state.uploads.filter((u) => u.owner === 'organization');
  const pickImage = async (): Promise<{ uri: string; name: string } | null> => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (r.canceled || !r.assets[0]) return null;
    const a = r.assets[0];
    const name = (a.fileName ?? '').replace(/\.[a-z0-9]+$/i, '').slice(0, 60) || 'My background';
    return { uri: await prepareCallBackground(a.uri, a.width, a.height), name };
  };
  const upload = () =>
    run(async () => {
      const img = await pickImage();
      if (img) await engine.addCallBackgroundImage(img.uri, img.name);
    }, 'Added and selected. Your other devices have it too.');
  const addToLibrary = () =>
    run(async () => {
      const img = await pickImage();
      if (img) await engine.addOrganizationCallBackground(img.uri, img.name);
    }, 'Added for everyone in your organization.');
  const removeImage = (u: CallBackgroundUpload) =>
    confirmThen(
      u.owner === 'organization' ? `Remove “${u.name}” for everyone?` : `Remove “${u.name}”?`,
      state.choice?.kind === 'upload' && state.choice.imageId === u.imageId
        ? 'Calls go back to your organization’s default background.'
        : u.owner === 'organization'
          ? 'People using it go back to the default background.'
          : 'It is removed from all your devices.',
      'Remove',
      () =>
        void run(() =>
          u.owner === 'organization'
            ? engine.removeOrganizationCallBackground(u.imageId)
            : engine.removeCallBackgroundImage(u.imageId),
        ),
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

  const tile = (
    ch: CallBackgroundChoice,
    label: string,
    key: string,
    extra: { onRemove?: () => void; uploading?: boolean; off?: boolean } = {},
  ) => (
    <Tile
      key={key}
      label={extra.uploading ? `${label} · uploading` : label}
      selected={selected(ch)}
      isDefault={sameChoice(draft.defaultChoice, ch)}
      disabled={(disabled && ch.kind !== 'logo') || extra.off}
      onPress={() => pick(ch)}
      onRemove={extra.onRemove}
    >
      <CallBackgroundPreview choice={ch} state={state} />
    </Tile>
  );
  const addTile = (label: string, onPress: () => void, off: boolean) => (
    <Tile key={`add-${label}`} label={label} selected={false} disabled={off} onPress={onPress}>
      <View style={[styles.add, { borderColor: c.border, backgroundColor: alpha(c.accent, 0.08) }]}>
        <Ionicons name="add-circle-outline" size={24} color={c.accent} />
      </View>
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
            {state.effective.kind === 'upload'
              ? (state.uploads.find(
                  (u) => state.effective.kind === 'upload' && u.imageId === state.effective.imageId,
                )?.name ?? callBackgroundLabel(state.effective))
              : callBackgroundLabel(state.effective)}
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
              {cameraEffectsAvailable()
                ? 'Applied to your camera in calls on this phone, in a browser and in the desktop app. Everything is done on the device; your camera picture never leaves it unprocessed.'
                : 'This version of the app sends your camera as it is. Update the app to use backgrounds on this phone; browsers and the desktop app already apply them.'}
            </Text>
          </View>
        </Glass>

        <Glass>
          <Pressable
            onPress={() => router.push('/settings/call-appearance')}
            accessibilityRole="button"
            accessibilityLabel="How you look on camera"
            style={styles.linkRow}
          >
            <Ionicons name="color-wand-outline" size={20} color={c.accent} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">How you look</Text>
              <Text variant="meta" tone="muted">
                {isNeutralAppearance(state.appearance)
                  ? 'As the camera sees you'
                  : 'Your look and touch-up are on'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={c.textSubtle} />
          </Pressable>
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
          </View>
        </View>

        {managing ? null : (
          <View style={{ gap: space.sm }}>
            <Text variant="label" tone="muted">
              Your backgrounds ({mine.length} of {CALL_BACKGROUND_MAX_PERSONAL})
            </Text>
            <View style={styles.grid}>
              {mine.map((u) =>
                tile({ kind: 'upload', imageId: u.imageId }, u.name, u.imageId, {
                  uploading: isLocalUpload(u.imageId),
                  onRemove: busy ? undefined : () => removeImage(u),
                }),
              )}
              {mine.length < CALL_BACKGROUND_MAX_PERSONAL
                ? addTile('Add your image', () => void upload(), locked || busy)
                : null}
            </View>
          </View>
        )}

        {library.length || (managing && state.policy.canManage) ? (
          <View style={{ gap: space.sm }}>
            <Text variant="label" tone="muted">
              From your organization
            </Text>
            <View style={styles.grid}>
              {library.map((u) =>
                tile({ kind: 'upload', imageId: u.imageId }, u.name, u.imageId, {
                  onRemove: managing && !blocked && !busy ? () => removeImage(u) : undefined,
                }),
              )}
              {managing && library.length < CALL_BACKGROUND_MAX_ORGANIZATION
                ? addTile(
                    blocked ? 'Add (needs a connection)' : 'Add for everyone',
                    () => void addToLibrary(),
                    !!blocked || busy,
                  )
                : null}
            </View>
          </View>
        ) : null}

        {PRESET_GROUPS.map((g) => (
          <View key={g.group} style={{ gap: space.sm }}>
            <Text variant="label" tone="muted">
              {g.group === 'Office' ? 'Offices' : 'Luxury homes'}
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
  onRemove,
  children,
}: {
  label: string;
  selected: boolean;
  isDefault?: boolean;
  disabled?: boolean;
  onPress: () => void;
  onRemove?: () => void;
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
        {onRemove ? (
          <Pressable
            onPress={onRemove}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${label}`}
            hitSlop={8}
            style={[styles.remove, { backgroundColor: alpha('#000000', 0.55) }]}
          >
            <Ionicons name="close" size={14} color="#ffffff" />
          </Pressable>
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
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  remove: {
    position: 'absolute',
    top: 5,
    left: 5,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
