import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button } from '../../components/Button';
import { PeoplePicker } from '../../components/PeoplePicker';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { useApp, useWorkspace } from '../../state/AppProvider';
import { useConversation, useDirectory } from '../../state/hooks';
import { alpha, radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

/** Adds people from the directory to a group or channel. */
export default function AddMembers() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  useApp();
  const conv = useConversation(id);
  const people = useDirectory();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = engine.serverActionBlocker();

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await engine.addMembers(id, selected);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Add people' }} />
      <View style={{ flex: 1, paddingHorizontal: space.lg, paddingTop: space.md }}>
        <PeoplePicker
          people={people}
          selected={selected}
          onChange={setSelected}
          exclude={conv?.memberIds ?? []}
          header={
            blocked || error ? (
              <View
                style={[
                  styles.note,
                  { backgroundColor: alpha(error ? c.danger : c.warning, 0.12) },
                ]}
              >
                <Text variant="meta" style={{ color: error ? c.danger : c.warning }}>
                  {error ?? blocked}
                </Text>
              </View>
            ) : undefined
          }
        />
      </View>
      <View style={[styles.footer, { borderTopColor: c.border, backgroundColor: c.background }]}>
        <Button
          title={selected.length ? `Add ${selected.length}` : 'Add'}
          onPress={() => void add()}
          busy={busy}
          disabled={!!blocked || selected.length === 0}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { padding: space.md, borderRadius: radius.md },
  footer: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
