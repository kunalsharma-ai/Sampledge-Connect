import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { DEFAULT_APP_NAME, type PublicBranding, type SsoInfo } from '@sampledge/contracts';
import { runSso } from '../auth/ssoFlow';
import { normaliseUrl, type PendingMfa } from '../auth/session';
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
    // Single sign-on only workspaces say so.
    if (e.code === 'FORBIDDEN' && e.message) return e.message;
  }
  return e instanceof Error ? e.message : 'Sign-in failed.';
}

/** The second step's errors come from the server, which says what to do next. */
function codeErrorText(e: unknown): { text: string; restart: boolean } {
  if (e instanceof TransportError && e.kind === 'network')
    return { text: errorText(e), restart: false };
  if (e instanceof TransportError && e.code === 'RATE_LIMITED')
    return { text: errorText(e), restart: false };
  const text = e instanceof Error && e.message ? e.message : 'That code didn’t work.';
  // The challenge is gone (expired, or too many wrong codes): back to the password step.
  return { text, restart: /password again/i.test(text) };
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
  const [mfa, setMfa] = useState<PendingMfa | null>(null);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [brand, setBrand] = useState<PublicBranding | null>(null);
  const [sso, setSso] = useState<SsoInfo | null>(null);
  // Shown under the SSO button, where the person is looking after the browser closes.
  const [ssoError, setSsoError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // The workspace's own logo, name and sign-in message once the address and workspace are typed.
  useEffect(() => {
    const slug = tenantSlug.trim().toLowerCase();
    let base: string;
    try {
      base = normaliseUrl(serverUrl);
    } catch {
      setSso(null);
      return setBrand(null);
    }
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug) || slug.length < 3) {
      setSso(null);
      return setBrand(null);
    }
    let alive = true;
    const t = setTimeout(() => {
      fetch(`${base}/v1/branding/public/${slug}`)
        .then((r) => (r.ok ? (r.json() as Promise<PublicBranding>) : null))
        .then((b) => alive && setBrand(b))
        .catch(() => alive && setBrand(null));
      // Whether this workspace signs in through its identity provider.
      fetch(`${base}/v1/auth/sso/${slug}`)
        .then((r) => (r.ok ? (r.json() as Promise<SsoInfo>) : null))
        .then((x) => alive && setSso(x?.enabled ? x : null))
        .catch(() => alive && setSso(null));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [serverUrl, tenantSlug]);

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
    setSsoError(null);
    try {
      const pending = await sessions.signIn({
        serverUrl,
        tenantSlug: tenantSlug.trim().toLowerCase(),
        email: email.trim(),
        password,
        deviceName: Constants.deviceName ?? `${Platform.OS} device`,
        platform: devicePlatform,
      });
      if (pending) {
        setMfa(pending);
        setCode('');
        setUseRecovery(false);
        setBusy(false);
      } else setSignedIn(true);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const signInWithSso = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSsoError(null);
    try {
      const serverBase = normaliseUrl(serverUrl);
      const r = await runSso({
        serverUrl: serverBase,
        tenantSlug: tenantSlug.trim().toLowerCase(),
        deviceId: await sessions.deviceId(),
        deviceName: Constants.deviceName ?? `${Platform.OS} device`,
        platform: devicePlatform,
      });
      if (!r) return setBusy(false);
      if ('error' in r) {
        setSsoError(r.error);
        return setBusy(false);
      }
      await sessions.signInWithSso(serverBase, r.code, r.codeVerifier);
      setSignedIn(true);
    } catch (e) {
      setSsoError(
        e instanceof TransportError && e.isAuth
          ? 'This sign-in could not be verified. Try again.'
          : errorText(e),
      );
      setBusy(false);
    }
  };
  // SSO-only workspaces hide the password form (the owner can still open it).
  const passwordForm = !sso || sso.passwordLogin || showPassword;

  const codeReady = useRecovery ? code.trim().length >= 6 : /^\d{6}$/.test(code.trim());
  const verify = async () => {
    if (!mfa || !codeReady || busy) return;
    setBusy(true);
    setError(null);
    try {
      await sessions.verifyMfa(mfa, code);
      setSignedIn(true);
    } catch (e) {
      const { text, restart } = codeErrorText(e);
      setError(text);
      setCode('');
      if (restart) {
        setMfa(null);
        setPassword('');
      }
      setBusy(false);
    }
  };
  const leaveMfa = () => {
    setMfa(null);
    setCode('');
    setPassword('');
    setError(null);
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
              {brand?.logo ? (
                <Image
                  source={{ uri: brand.logo }}
                  style={styles.logo}
                  resizeMode="contain"
                  accessibilityLabel={`${brand.displayName} logo`}
                />
              ) : (
                <LinearGradient
                  colors={
                    brand
                      ? [brand.primary, brand.secondary]
                      : [theme.colors.accent, theme.colors.accentSecondary]
                  }
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.logo}
                >
                  <Text
                    style={{ fontFamily: fonts.bold, fontSize: 24, color: theme.colors.onAccent }}
                  >
                    {(brand?.displayName ?? 'S').slice(0, 1).toUpperCase()}
                  </Text>
                </LinearGradient>
              )}
              <Text variant="display">
                {reauth ? 'Sign in again' : (brand?.displayName ?? DEFAULT_APP_NAME)}
              </Text>
              {brand &&
              !reauth &&
              brand.displayName !== DEFAULT_APP_NAME &&
              !brand.hidePoweredBy ? (
                <Text variant="meta" tone="subtle">
                  with {DEFAULT_APP_NAME}
                </Text>
              ) : null}
              <Text tone="muted">
                {reauth
                  ? 'Your session ended. Messages you wrote are still queued on this device and send once you sign in.'
                  : (brand?.loginMessage ?? 'One Workspace. Every Conversation. Connected.')}
              </Text>
            </View>

            {mfa ? (
              <Glass style={{ padding: space.lg, gap: space.lg, borderRadius: radius.xl }}>
                <View style={{ gap: space.xs }}>
                  <Text variant="title">Two-step verification</Text>
                  <Text tone="muted">
                    {useRecovery
                      ? 'Enter one of the recovery codes you saved when you set this up. Each works once.'
                      : 'Open your authenticator app and enter the 6-digit code for SampConnect.'}
                  </Text>
                </View>
                <View style={{ gap: 6 }}>
                  <Text variant="label" tone="muted">
                    {useRecovery ? 'Recovery code' : 'Code'}
                  </Text>
                  <TextInput
                    key={useRecovery ? 'recovery' : 'totp'}
                    value={code}
                    onChangeText={(t) =>
                      setCode(useRecovery ? t : t.replace(/\D/g, '').slice(0, 6))
                    }
                    autoFocus
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType={useRecovery ? 'default' : 'number-pad'}
                    textContentType="oneTimeCode"
                    autoComplete="one-time-code"
                    maxLength={useRecovery ? 20 : 6}
                    placeholder={useRecovery ? 'xxxx-xxxx' : '123456'}
                    placeholderTextColor={theme.colors.textSubtle}
                    onSubmitEditing={() => void verify()}
                    accessibilityLabel={useRecovery ? 'Recovery code' : 'Code'}
                    style={[
                      styles.input,
                      styles.code,
                      {
                        color: theme.colors.text,
                        backgroundColor: theme.colors.surfaceSunken,
                        borderColor: theme.colors.border,
                      },
                    ]}
                  />
                </View>
                {error ? (
                  <Text variant="label" tone="danger" accessibilityLiveRegion="polite">
                    {error}
                  </Text>
                ) : null}
                <Pressable
                  onPress={() => void verify()}
                  disabled={!codeReady || busy}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.primary,
                    {
                      backgroundColor: theme.colors.accent,
                      opacity: !codeReady || busy ? 0.5 : pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator color={theme.colors.onAccent} />
                  ) : (
                    <Text variant="bodyStrong" tone="onAccent">
                      Verify and sign in
                    </Text>
                  )}
                </Pressable>
                <Pressable
                  onPress={() => {
                    setUseRecovery((r) => !r);
                    setCode('');
                    setError(null);
                  }}
                  accessibilityRole="button"
                  hitSlop={6}
                >
                  <Text variant="label" tone="accent" style={{ textAlign: 'center' }}>
                    {useRecovery
                      ? 'Use my authenticator app instead'
                      : 'Lost your phone? Use a recovery code'}
                  </Text>
                </Pressable>
                <Pressable onPress={leaveMfa} accessibilityRole="button" hitSlop={6}>
                  <Text variant="label" tone="muted" style={{ textAlign: 'center' }}>
                    {reauth ? 'Enter my password again' : 'Use a different account'}
                  </Text>
                </Pressable>
              </Glass>
            ) : (
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
                {sso ? (
                  <View style={{ gap: space.md }}>
                    <Pressable
                      onPress={() => void signInWithSso()}
                      disabled={busy}
                      accessibilityRole="button"
                      style={({ pressed }) => [
                        styles.primary,
                        styles.ssoButton,
                        {
                          backgroundColor: theme.colors.accent,
                          opacity: busy ? 0.5 : pressed ? 0.85 : 1,
                        },
                      ]}
                    >
                      {busy ? (
                        <ActivityIndicator color={theme.colors.onAccent} />
                      ) : (
                        <>
                          <Ionicons name="key-outline" size={18} color={theme.colors.onAccent} />
                          <Text variant="bodyStrong" tone="onAccent">
                            {sso.label || 'Sign in with single sign-on'}
                          </Text>
                        </>
                      )}
                    </Pressable>
                    {ssoError ? (
                      <Text variant="label" tone="danger" accessibilityLiveRegion="polite">
                        {ssoError}
                      </Text>
                    ) : null}
                    {passwordForm ? (
                      <View style={styles.divider}>
                        <View style={[styles.rule, { backgroundColor: theme.colors.border }]} />
                        <Text variant="meta" tone="subtle">
                          or use your password
                        </Text>
                        <View style={[styles.rule, { backgroundColor: theme.colors.border }]} />
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => setShowPassword(true)}
                        accessibilityRole="button"
                        hitSlop={6}
                      >
                        <Text variant="label" tone="muted" style={{ textAlign: 'center' }}>
                          Workspace owner? Sign in with a password
                        </Text>
                      </Pressable>
                    )}
                  </View>
                ) : null}
                {passwordForm ? (
                  <>
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
                  </>
                ) : null}
                {error ? (
                  <Text variant="label" tone="danger" accessibilityLiveRegion="polite">
                    {error}
                  </Text>
                ) : null}
                {passwordForm ? (
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
                ) : null}
              </Glass>
            )}

            {!reauth && !mfa ? (
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
  code: { textAlign: 'center', fontSize: 22, letterSpacing: 6, fontFamily: fonts.semibold },
  ssoButton: { flexDirection: 'row', gap: space.sm },
  divider: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  primary: { height: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  secondary: {
    alignItems: 'center',
    gap: 4,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
