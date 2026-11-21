import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Glass } from '../components/Glass';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { devicePlatform, useApp } from '../state/AppProvider';
import { TransportError } from '../sync/transport';
import { fonts, radius, space } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';

function errorText(e: unknown): string {
  if (e instanceof TransportError) {
    if (e.kind === 'network')
      return 'Could not reach the server. Check the address and your connection.';
    if (e.code === 'UNAUTHENTICATED' || e.code === 'SESSION_EXPIRED')
      return 'Email, password or workspace is incorrect.';
    if (e.code === 'VALIDATION_FAILED') return 'Check the details and try again.';
    if (e.code === 'RATE_LIMITED') return 'Too many attempts. Wait a moment and try again.';
  }
  return e instanceof Error ? e.message : 'Sign-in failed.';
}

export default function SignIn() {
  const { theme, motion } = useTheme();
  const { sessions, sessionState, session, workspace } = useApp();
  const reauth = sessionState === 'expired';
  const [serverUrl, setServerUrl] = useState(session?.serverUrl ?? '');
  const [tenantSlug, setTenantSlug] = useState(session?.tenant.slug ?? '');
  const [email, setEmail] = useState(session?.user.email ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  // Leave this screen once the account's local database is open (it opens after sign-in).
  useEffect(() => {
    if (!signedIn || !workspace) return;
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [signedIn, workspace]);

  const canSubmit = serverUrl.trim() && tenantSlug.trim() && email.trim() && password && !busy;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await sessions.signIn({
        serverUrl,
        tenantSlug: tenantSlug.trim().toLowerCase(),
        email: email.trim(),
        password,
        deviceName: Constants.deviceName ?? `${Platform.OS} device`,
        platform: devicePlatform,
      });
      setSignedIn(true);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const field = (props: TextInputProps & { label: string }) => (
    <View style={{ gap: 6 }}>
      <Text variant="label" tone="muted">
        {props.label}
      </Text>
      <TextInput
        placeholderTextColor={theme.colors.textSubtle}
        autoCapitalize="none"
        autoCorrect={false}
        {...props}
        style={[
          styles.input,
          {
            color: theme.colors.text,
            backgroundColor: theme.colors.surfaceSunken,
            borderColor: theme.colors.border,
          },
        ]}
        accessibilityLabel={props.label}
      />
    </View>
  );

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Animated.View
            entering={motion.slow ? FadeInDown.duration(motion.slow) : undefined}
            style={{ gap: space.xl }}
          >
            <View style={{ gap: space.md }}>
              <LinearGradient
                colors={[theme.colors.accent, theme.colors.accentSecondary]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.logo}
              >
                <Text
                  style={{ fontFamily: fonts.bold, fontSize: 24, color: theme.colors.onAccent }}
                >
                  S
                </Text>
              </LinearGradient>
              <Text variant="display">{reauth ? 'Sign in again' : 'Sampledge Connect'}</Text>
              <Text tone="muted">
                {reauth
                  ? 'Your session ended. Messages you wrote are still queued on this device and send once you sign in.'
                  : 'One Workspace. Every Conversation. Connected.'}
              </Text>
            </View>

            <Glass style={{ padding: space.lg, gap: space.lg, borderRadius: radius.xl }}>
              {field({
                label: 'Server address',
                value: serverUrl,
                onChangeText: setServerUrl,
                placeholder: 'connect.yourcompany.com',
                keyboardType: 'url',
                editable: !reauth,
              })}
              {field({
                label: 'Workspace',
                value: tenantSlug,
                onChangeText: setTenantSlug,
                placeholder: 'your-workspace',
                editable: !reauth,
              })}
              {field({
                label: 'Email',
                value: email,
                onChangeText: setEmail,
                placeholder: 'you@company.com',
                keyboardType: 'email-address',
                autoComplete: 'email',
                textContentType: 'username',
              })}
              {field({
                label: 'Password',
                value: password,
                onChangeText: setPassword,
                secureTextEntry: true,
                autoComplete: 'password',
                textContentType: 'password',
                onSubmitEditing: () => canSubmit && void submit(),
              })}
              {error ? (
                <Text variant="label" tone="danger" accessibilityLiveRegion="polite">
                  {error}
                </Text>
              ) : null}
              <Pressable
                onPress={submit}
                disabled={!canSubmit}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.primary,
                  {
                    backgroundColor: theme.colors.accent,
                    opacity: !canSubmit ? 0.5 : pressed ? 0.85 : 1,
                  },
                ]}
              >
                {busy ? (
                  <ActivityIndicator color={theme.colors.onAccent} />
                ) : (
                  <Text variant="bodyStrong" tone="onAccent">
                    Sign in
                  </Text>
                )}
              </Pressable>
              <Text variant="meta" tone="subtle">
                Single sign-on (OIDC) is planned for mobile. Use your workspace email and password
                for now.
              </Text>
            </Glass>

            {!reauth ? (
              <Pressable
                onPress={() => void sessions.enterDemo().then(() => setSignedIn(true))}
                accessibilityRole="button"
                style={[styles.secondary, { borderColor: theme.colors.border }]}
              >
                <Text variant="bodyStrong" tone="accent">
                  Explore the offline demo
                </Text>
                <Text variant="meta" tone="muted" style={{ textAlign: 'center' }}>
                  Sample conversations stored only on this phone. No server is contacted.
                </Text>
              </Pressable>
            ) : null}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: 'center', padding: space.xl },
  logo: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  input: {
    fontFamily: fonts.regular,
    fontSize: 16,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  primary: { height: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  secondary: {
    alignItems: 'center',
    gap: 4,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
