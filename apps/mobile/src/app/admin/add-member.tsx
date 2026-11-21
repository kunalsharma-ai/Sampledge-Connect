import { router, Stack } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Button } from '../../components/Button';
import { Chips } from '../../components/Chips';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { ROLE_LABEL, temporaryPasswordProblem } from '../../lib/admin';
import { useWorkspace } from '../../state/AppProvider';
import { TransportError } from '../../sync/transport';
import { radius, space, type as typeScale } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * Adds a member with a temporary password to share with them. The plan's seat limit applies to
 * members and admins (guests don't use a seat); the server says when it is reached.
 */
export default function AddMember() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin' | 'guest'>('member');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = engine.serverActionBlocker();
  const input = [
    typeScale.body,
    styles.input,
    { color: c.text, backgroundColor: c.surfaceSunken, borderColor: c.border },
  ];

  const save = async () => {
    if (!name.trim()) return setError('Enter their name.');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter a valid email address.');
    const pw = temporaryPasswordProblem(password);
    if (pw) return setError(`Temporary password: ${pw}`);
    setBusy(true);
    setError(null);
    try {
      await engine.inviteMember({
        displayName: name.trim(),
        email: email.trim(),
        role,
        temporaryPassword: password,
      });
      router.back();
    } catch (e) {
      setError(
        e instanceof TransportError && e.code === 'CONFLICT'
          ? `${e.message}${/seat|limit|plan/i.test(e.message) ? ' Upgrade the plan on the web, or add them as a guest.' : ''}`
          : e instanceof Error
            ? e.message
            : String(e),
      );
      setBusy(false);
    }
  };

  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
    extra: Partial<React.ComponentProps<typeof TextInput>> = {},
  ) => (
    <View style={{ gap: 6 }}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={(t) => {
          set(t);
          setError(null);
        }}
        placeholderTextColor={c.textSubtle}
        accessibilityLabel={label}
        style={input}
        {...extra}
      />
    </View>
  );

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Add member' }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 100 }}
          keyboardShouldPersistTaps="handled"
        >
          {field('Name', name, setName, { placeholder: 'Ana Costa', autoCapitalize: 'words' })}
          {field('Work email', email, setEmail, {
            placeholder: 'ana@company.com',
            autoCapitalize: 'none',
            keyboardType: 'email-address',
          })}
          <View style={{ gap: 6 }}>
            <Text variant="label" tone="muted">
              Role
            </Text>
            <Chips
              label="Role"
              options={(['member', 'admin', 'guest'] as const).map((r) => ({
                key: r,
                label: ROLE_LABEL[r],
              }))}
              selected={[role]}
              onToggle={setRole}
            />
            <Text variant="meta" tone="muted">
              {role === 'guest'
                ? 'Guests only see conversations they are added to and don’t use a seat.'
                : role === 'admin'
                  ? 'Admins manage members, devices and integrations.'
                  : 'Members join #general and can start conversations.'}
            </Text>
          </View>
          {field('Temporary password', password, setPassword, {
            placeholder: 'At least 12 characters',
            autoCapitalize: 'none',
            secureTextEntry: true,
          })}
          <Text variant="meta" tone="muted">
            Share it with them privately. They can change it after signing in.
          </Text>
          {error || blocked ? (
            <Text variant="meta" tone="danger" accessibilityLiveRegion="polite">
              {error ?? `${blocked}`}
            </Text>
          ) : null}
          <Button
            title="Add member"
            icon="person-add-outline"
            busy={busy}
            disabled={!!blocked}
            onPress={() => void save()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
