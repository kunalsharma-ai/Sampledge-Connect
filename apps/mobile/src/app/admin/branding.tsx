import { Ionicons } from '@expo/vector-icons';
import { LOGO_MAX_BYTES, type BrandingInput, type BrandingView } from '@sampledge/contracts';
import * as ImagePicker from 'expo-image-picker';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { useWorkspace } from '../../state/AppProvider';
import { customTheme, radius, space, type as typeScale } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

const HEX = /^#[0-9a-fA-F]{6}$/;

function draftFrom(v: BrandingView): Required<BrandingInput> {
  return {
    appName: v.appName,
    logo: v.logo,
    primary: v.primary,
    secondary: v.secondary,
    mode: v.mode,
    useBrandTheme: v.useBrandTheme,
    enforceTheme: v.enforceTheme,
    loginMessage: v.loginMessage,
    supportEmail: v.supportEmail,
    supportUrl: v.supportUrl,
    hidePoweredBy: v.hidePoweredBy,
  };
}

/**
 * The organization's white-label settings, stored in the database. Owners edit them; everyone
 * else sees what is set. Saving updates every signed-in phone and browser.
 */
export default function Branding() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const [view, setView] = useState<BrandingView | null>(null);
  const [d, setD] = useState<Required<BrandingInput> | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const blocked = engine.serverActionBlocker();

  useEffect(() => {
    if (blocked) return;
    engine
      .getBranding()
      .then((v) => {
        setView(v);
        setD(draftFrom(v));
      })
      .catch((e: unknown) =>
        setNote({ text: e instanceof Error ? e.message : String(e), ok: false }),
      );
  }, [engine, blocked]);

  if (!view || !d)
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ title: 'Branding' }} />
        <View style={styles.center}>
          {note || blocked ? (
            <Text tone="muted" style={{ textAlign: 'center' }}>
              {note?.text ?? `${blocked} Branding is kept on the server.`}
            </Text>
          ) : (
            <ActivityIndicator color={c.accent} />
          )}
        </View>
      </Screen>
    );

  const can = view.canManage;
  const set = (patch: Partial<BrandingInput>) => {
    setD({ ...d, ...patch } as Required<BrandingInput>);
    setNote(null);
  };
  const input = [
    typeScale.body,
    styles.input,
    { color: c.text, backgroundColor: c.surfaceSunken, borderColor: c.border },
  ];
  const text = (
    label: string,
    value: string | null,
    onChange: (v: string | null) => void,
    opts: { placeholder?: string; max?: number; multiline?: boolean } = {},
  ) => (
    <View style={{ gap: 6 }}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <TextInput
        value={value ?? ''}
        onChangeText={(t) => onChange(t.trim() ? t : null)}
        editable={can}
        placeholder={opts.placeholder}
        placeholderTextColor={c.textSubtle}
        maxLength={opts.max}
        multiline={opts.multiline}
        autoCapitalize="none"
        accessibilityLabel={label}
        style={[input, opts.multiline && { minHeight: 64, textAlignVertical: 'top' }]}
      />
    </View>
  );
  const colorsOk = HEX.test(d.primary) && HEX.test(d.secondary);
  const preview = customTheme({
    primary: HEX.test(d.primary) ? d.primary : view.primary,
    secondary: HEX.test(d.secondary) ? d.secondary : view.secondary,
    dark: d.mode === 'dark',
  }).colors;

  const pickLogo = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (r.canceled || !r.assets[0]) return;
    const a = r.assets[0];
    const url = a.uri.startsWith('data:')
      ? a.uri
      : a.base64
        ? `data:${a.mimeType ?? 'image/png'};base64,${a.base64}`
        : null;
    if (!url) return setNote({ text: 'Could not read that image.', ok: false });
    const bytes = Math.floor(((url.length - url.indexOf(',') - 1) * 3) / 4);
    if (bytes > LOGO_MAX_BYTES)
      return setNote({
        text: 'The logo must be 256 KB or smaller. Try a smaller image.',
        ok: false,
      });
    set({ logo: url });
  };

  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      const v = await engine.saveBranding(d);
      setView(v);
      setD(draftFrom(v));
      setNote({
        text: 'Saved. Everyone sees the new branding the next time their app connects.',
        ok: true,
      });
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Branding' }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
        >
          {!can ? (
            <Text variant="meta" tone="muted">
              Only the organization owner can change branding.
            </Text>
          ) : null}
          <View
            style={[styles.preview, { backgroundColor: preview.background, borderColor: c.border }]}
            accessibilityLabel="Preview"
          >
            {d.logo ? (
              <Image source={{ uri: d.logo }} style={styles.logo} resizeMode="contain" />
            ) : (
              <View style={[styles.logo, { backgroundColor: preview.accent }]} />
            )}
            <View style={{ flex: 1, gap: 6 }}>
              <Text variant="bodyStrong" style={{ color: preview.text }}>
                {d.appName ?? view.displayName}
              </Text>
              <View style={[styles.bubble, { backgroundColor: preview.accent }]}>
                <Text variant="meta" style={{ color: preview.onAccent }}>
                  Your message
                </Text>
              </View>
            </View>
            <View style={[styles.dot, { backgroundColor: preview.accentSecondary }]} />
          </View>
          {can ? (
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Button
                  title={d.logo ? 'Change logo' : 'Add logo'}
                  kind="quiet"
                  icon="image-outline"
                  onPress={() => void pickLogo()}
                />
              </View>
              {d.logo ? (
                <View style={{ flex: 1 }}>
                  <Button
                    title="Remove logo"
                    kind="danger"
                    icon="trash-outline"
                    onPress={() => set({ logo: null })}
                  />
                </View>
              ) : null}
            </View>
          ) : null}
          {text('App name', d.appName, (v) => set({ appName: v }), {
            placeholder: view.organizationName + ' Connect',
            max: 40,
          })}
          <View style={{ flexDirection: 'row', gap: space.md }}>
            {(
              [
                ['Primary color', 'primary'],
                ['Accent color', 'secondary'],
              ] as const
            ).map(([label, key]) => (
              <View key={key} style={{ flex: 1, gap: 6 }}>
                <Text variant="label" tone="muted">
                  {label}
                </Text>
                <View style={styles.colorRow}>
                  <View
                    style={[
                      styles.swatch,
                      {
                        backgroundColor: HEX.test(d[key]) ? d[key] : 'transparent',
                        borderColor: c.border,
                      },
                    ]}
                  />
                  <TextInput
                    value={d[key]}
                    onChangeText={(t) => set({ [key]: t.trim() })}
                    editable={can}
                    autoCapitalize="characters"
                    maxLength={7}
                    accessibilityLabel={label}
                    style={[input, { flex: 1 }, !HEX.test(d[key]) && { borderColor: c.danger }]}
                  />
                </View>
              </View>
            ))}
          </View>
          <View style={{ gap: 6 }}>
            <Text variant="label" tone="muted">
              Theme mode
            </Text>
            <Chips
              label="Theme mode"
              options={[
                { key: 'dark', label: 'Dark' },
                { key: 'light', label: 'Light' },
              ]}
              selected={[d.mode]}
              onToggle={(m) => can && set({ mode: m })}
            />
          </View>
          <Glass style={{ padding: space.md, gap: space.md }}>
            {(
              [
                [
                  'useBrandTheme',
                  'Start everyone on this theme',
                  'People can still pick another theme in Appearance.',
                ],
                ['enforceTheme', 'Always use this theme', 'People cannot change it.'],
                [
                  'hidePoweredBy',
                  'Hide “with Sampledge Connect”',
                  'On the sign-in screen and in emails.',
                ],
              ] as const
            ).map(([key, label, hint]) => (
              <View key={key} style={styles.colorRow}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{label}</Text>
                  <Text variant="meta" tone="muted">
                    {hint}
                  </Text>
                </View>
                <Switch
                  value={d[key]}
                  disabled={!can}
                  onValueChange={(v) => set({ [key]: v })}
                  accessibilityLabel={label}
                />
              </View>
            ))}
          </Glass>
          {text('Sign-in message', d.loginMessage, (v) => set({ loginMessage: v }), {
            placeholder: 'Shown when someone types your workspace',
            max: 280,
            multiline: true,
          })}
          {text('Support email', d.supportEmail, (v) => set({ supportEmail: v }), {
            placeholder: 'help@yourcompany.com',
            max: 254,
          })}
          {text('Support link', d.supportUrl, (v) => set({ supportUrl: v }), {
            placeholder: 'https://help.yourcompany.com',
            max: 500,
          })}
          {note ? (
            <View style={styles.colorRow}>
              <Ionicons
                name={note.ok ? 'checkmark-circle' : 'alert-circle'}
                size={18}
                color={note.ok ? c.success : c.danger}
              />
              <Text
                variant="meta"
                tone={note.ok ? 'muted' : 'danger'}
                style={{ flex: 1 }}
                accessibilityLiveRegion="polite"
              >
                {note.text}
              </Text>
            </View>
          ) : null}
          {can ? (
            <Button
              title="Save branding"
              icon="checkmark"
              busy={busy}
              disabled={!colorsOk || !!blocked}
              onPress={() => void save()}
            />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  input: {
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  logo: { width: 48, height: 48, borderRadius: 12 },
  bubble: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.lg,
  },
  dot: { position: 'absolute', top: 12, right: 12, width: 14, height: 14, borderRadius: 7 },
  colorRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  swatch: { width: 28, height: 28, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
});
