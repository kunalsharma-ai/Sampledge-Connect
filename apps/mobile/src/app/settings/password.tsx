import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button } from '../../components/Button';
import { Glass } from '../../components/Glass';
import { Field, netErrorText } from '../../components/NetworkBits';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { useWorkspace } from '../../state/AppProvider';
import { space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * Change your password. Your other devices are signed out. Your organization's admins and
 * SampConnect see that it changed, never the password. Needs a connection.
 */
export default function ChangePassword() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const tooShort = next.length > 0 && next.length < 12;
  const mismatch = again.length > 0 && again !== next;

  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await engine.changePassword(current, next);
      setCurrent('');
      setNext('');
      setAgain('');
      setNote({
        ok: true,
        text: r.signedOutDevices
          ? `Password changed. ${r.signedOutDevices} other device${r.signedOutDevices === 1 ? ' was' : 's were'} signed out.`
          : 'Password changed.',
      });
    } catch (e) {
      setNote({ ok: false, text: netErrorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Password' }} />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <Text variant="meta" tone="muted">
          Changing your password signs your other devices out. Your organization and SampConnect see
          that it changed, never the password itself.
        </Text>
        <Glass style={{ padding: space.md, gap: space.md }}>
          <Field
            label="Current password"
            value={current}
            onChangeText={setCurrent}
            secureTextEntry
            autoCapitalize="none"
            textContentType="password"
          />
          <Field
            label="New password"
            hint={tooShort ? 'Use at least 12 characters.' : 'At least 12 characters.'}
            value={next}
            onChangeText={setNext}
            secureTextEntry
            autoCapitalize="none"
            textContentType="newPassword"
          />
          <Field
            label="New password again"
            hint={mismatch ? 'The two new passwords don’t match.' : undefined}
            value={again}
            onChangeText={setAgain}
            secureTextEntry
            autoCapitalize="none"
            textContentType="newPassword"
          />
        </Glass>
        {note ? (
          <Text
            variant="meta"
            style={{ color: note.ok ? c.success : c.danger }}
            accessibilityLiveRegion="polite"
          >
            {note.text}
          </Text>
        ) : null}
        <View style={{ gap: space.sm }}>
          <Button
            title="Change password"
            icon="key-outline"
            busy={busy}
            disabled={!current || next.length < 12 || next !== again}
            onPress={() => void save()}
          />
          {note?.ok ? <Button title="Done" kind="quiet" onPress={() => router.back()} /> : null}
        </View>
      </ScrollView>
    </Screen>
  );
}
