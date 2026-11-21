import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { prepareAvatar } from '../../lib/avatarImage';
import { confirmThen } from '../../lib/confirm';
import { profileChanges, profileProblem, type ProfileForm } from '../../lib/profile';
import { deviceTimeZone, zoneLabel } from '../../lib/time';
import { useApp, useWorkspace } from '../../state/AppProvider';
import { useProfile } from '../../state/hooks';
import { alpha, radius, space, type as typeScale } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

const EMPTY: ProfileForm = {
  displayName: '',
  title: '',
  department: '',
  phone: '',
  bio: '',
  timeZone: '',
};

/**
 * Your profile: photo (camera or library, cropped square), name, job title, department, phone,
 * about you and time zone. Everyone in SampConnect sees changes at once. Works offline: changes
 * are kept on this phone and sent when you reconnect; the newest value of each field wins.
 */
export default function ProfileScreen() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine, selfId } = useWorkspace();
  const { engineState, session } = useApp();
  const me = useProfile(selfId);
  const blocked = engine.queueBlocker();
  const offline = engineState?.connectivity === 'offline';
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const phoneZone = deviceTimeZone();

  const saved: ProfileForm | null = useMemo(
    () =>
      me
        ? {
            displayName: me.displayName,
            title: me.title ?? '',
            department: me.department ?? '',
            phone: me.phone ?? '',
            bio: me.bio ?? '',
            timeZone: me.timeZone ?? '',
          }
        : null,
    [me],
  );
  // Fill the form once; later live updates of your profile do not wipe what you are typing.
  useEffect(() => {
    if (saved && !form) setForm(saved);
  }, [saved, form]);

  const f = form ?? saved ?? EMPTY;
  const changes = saved ? profileChanges(saved, f) : {};
  const dirty = Object.keys(changes).length > 0;
  const set = (k: keyof ProfileForm, v: string) => {
    setNote(null);
    setForm({ ...f, [k]: v });
  };

  const input = [
    typeScale.body,
    styles.input,
    { color: c.text, backgroundColor: c.surfaceSunken, borderColor: c.border },
  ];

  const usePicture = async (a: ImagePicker.ImagePickerAsset) => {
    setPhotoBusy(true);
    setNote(null);
    try {
      await engine.setAvatar(await prepareAvatar(a.uri, a.width, a.height));
      setNote({
        ok: true,
        text: offline
          ? 'New photo saved on this phone. Everyone sees it when you are back online.'
          : 'New photo saved. Everyone sees it now.',
      });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setPhotoBusy(false);
    }
  };
  const fromLibrary = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (!r.canceled && r.assets[0]) await usePicture(r.assets[0]);
  };
  const fromCamera = async () => {
    const cam = await ImagePicker.requestCameraPermissionsAsync();
    if (!cam.granted)
      return setNote({ ok: false, text: 'Allow camera access to take a profile photo.' });
    const r = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      cameraType: ImagePicker.CameraType.front,
      quality: 1,
    });
    if (!r.canceled && r.assets[0]) await usePicture(r.assets[0]);
  };
  const removePhoto = () =>
    confirmThen('Remove your photo?', 'Your initials show instead.', 'Remove', () => {
      setNote(null);
      void engine
        .removeAvatar()
        .catch((e: unknown) =>
          setNote({ ok: false, text: e instanceof Error ? e.message : String(e) }),
        );
    });

  const save = async () => {
    const problem = profileProblem(f);
    if (problem) return setNote({ ok: false, text: problem });
    setBusy(true);
    setNote(null);
    try {
      await engine.updateProfile(changes);
      setNote({
        ok: true,
        text: offline
          ? 'Saved on this phone. Everyone sees it when you are back online.'
          : 'Saved. Everyone sees your changes now.',
      });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  if (!me)
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ title: 'Profile' }} />
        <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />
      </Screen>
    );

  const tz = f.timeZone.trim();
  const localTime = (() => {
    try {
      return tz
        ? new Date().toLocaleTimeString([], {
            timeZone: tz,
            hour: 'numeric',
            minute: '2-digit',
          })
        : null;
    } catch {
      return null;
    }
  })();

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Profile' }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
        >
          <Glass style={styles.hero}>
            <View>
              <Avatar name={f.displayName || me.displayName} uri={me.avatarUrl} size={112} />
              {photoBusy ? (
                <View style={[styles.photoBusy, { backgroundColor: alpha('#000000', 0.45) }]}>
                  <ActivityIndicator color="#FFFFFF" />
                </View>
              ) : null}
            </View>
            <Text variant="heading" style={{ textAlign: 'center' }}>
              {me.displayName}
            </Text>
            <Text variant="meta" tone="muted" style={{ textAlign: 'center' }}>
              {[me.title, me.department].filter(Boolean).join(' · ') || (session?.user.email ?? '')}
            </Text>
            <View style={styles.photoActions}>
              <PhotoAction
                icon="camera-outline"
                label="Take photo"
                disabled={!!blocked || photoBusy}
                onPress={() => void fromCamera()}
              />
              <PhotoAction
                icon="images-outline"
                label={me.avatarUrl ? 'Change photo' : 'Choose photo'}
                disabled={!!blocked || photoBusy}
                onPress={() => void fromLibrary()}
              />
              {me.avatarUrl ? (
                <PhotoAction
                  icon="trash-outline"
                  label="Remove photo"
                  danger
                  disabled={!!blocked || photoBusy}
                  onPress={removePhoto}
                />
              ) : null}
            </View>
          </Glass>

          {offline ? (
            <View style={[styles.note, { backgroundColor: alpha(c.accent, 0.12) }]}>
              <Text variant="meta" style={{ color: c.accent }}>
                You are offline. Changes are kept on this phone and everyone sees them when you
                reconnect.
              </Text>
            </View>
          ) : null}

          <Field label="Name">
            <TextInput
              value={f.displayName}
              onChangeText={(t) => set('displayName', t)}
              maxLength={80}
              accessibilityLabel="Name"
              style={input}
            />
          </Field>
          <Field label="Job title">
            <TextInput
              value={f.title}
              onChangeText={(t) => set('title', t)}
              placeholder="Project manager"
              placeholderTextColor={c.textSubtle}
              maxLength={80}
              accessibilityLabel="Job title"
              style={input}
            />
          </Field>
          <Field label="Department">
            <TextInput
              value={f.department}
              onChangeText={(t) => set('department', t)}
              placeholder="Field operations"
              placeholderTextColor={c.textSubtle}
              maxLength={80}
              accessibilityLabel="Department"
              style={input}
            />
          </Field>
          <Field label="Phone">
            <TextInput
              value={f.phone}
              onChangeText={(t) => set('phone', t)}
              placeholder="+91 98765 43210"
              placeholderTextColor={c.textSubtle}
              keyboardType="phone-pad"
              maxLength={32}
              accessibilityLabel="Phone"
              style={input}
            />
          </Field>
          <Field label="About you" hint={`${f.bio.length}/500`}>
            <TextInput
              value={f.bio}
              onChangeText={(t) => set('bio', t)}
              placeholder="What you work on, languages you speak, best way to reach you"
              placeholderTextColor={c.textSubtle}
              maxLength={500}
              multiline
              accessibilityLabel="About you"
              style={[input, { minHeight: 88, textAlignVertical: 'top' }]}
            />
          </Field>
          <Field
            label="Time zone"
            hint={
              localTime ? `Your local time shows as ${localTime} (${zoneLabel(tz)}).` : undefined
            }
          >
            <TextInput
              value={f.timeZone}
              onChangeText={(t) => set('timeZone', t)}
              placeholder="Asia/Kolkata"
              placeholderTextColor={c.textSubtle}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={64}
              accessibilityLabel="Time zone"
              style={input}
            />
            {tz !== phoneZone ? (
              <Pressable
                onPress={() => set('timeZone', phoneZone)}
                accessibilityRole="button"
                style={styles.inline}
              >
                <Ionicons name="locate-outline" size={15} color={c.accent} />
                <Text variant="meta" tone="accent">
                  Use this phone's time zone ({phoneZone})
                </Text>
              </Pressable>
            ) : null}
          </Field>

          {note || blocked ? (
            <Text
              variant="meta"
              tone={note?.ok ? undefined : 'danger'}
              style={note?.ok ? { color: c.success } : undefined}
              accessibilityLiveRegion="polite"
            >
              {note?.text ?? blocked}
            </Text>
          ) : null}
          <Button
            title="Save profile"
            icon="checkmark"
            busy={busy}
            disabled={!!blocked || !dirty}
            onPress={() => void save()}
          />
          <Text variant="meta" tone="muted">
            Your email and role are managed by your workspace admins.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );

  function PhotoAction({
    icon,
    label,
    onPress,
    disabled,
    danger,
  }: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
    disabled?: boolean;
    danger?: boolean;
  }) {
    const tint = danger ? c.danger : c.accent;
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[
          styles.photoAction,
          { backgroundColor: alpha(tint, 0.12), opacity: disabled ? 0.5 : 1 },
        ]}
      >
        <Ionicons name={icon} size={17} color={tint} />
        <Text variant="meta" style={{ color: tint }}>
          {label}
        </Text>
      </Pressable>
    );
  }
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
  hero: { alignItems: 'center', gap: space.sm, padding: space.lg },
  photoBusy: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: space.sm,
    marginTop: space.xs,
  },
  photoAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  input: {
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  note: { padding: space.md, borderRadius: radius.md },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
});
