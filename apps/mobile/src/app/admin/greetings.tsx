import {
  DEFAULT_GREETING_POLICY,
  GREETING_CATEGORIES,
  type GreetingPolicy,
} from '@sampledge/contracts';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Button } from '../../components/Button';
import { HeaderTitleWithHelp } from '../../components/FeatureHelp';
import { Glass } from '../../components/Glass';
import { GreetingCard } from '../../components/GreetingCard';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { useWorkspace } from '../../state/AppProvider';
import { space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

/** Administration → Greeting cards: on or off, and which categories people can choose from. */
export default function GreetingsAdmin() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const [saved, setSaved] = useState<GreetingPolicy>(DEFAULT_GREETING_POLICY);
  const [draft, setDraft] = useState<GreetingPolicy>(DEFAULT_GREETING_POLICY);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const blocked = engine.serverActionBlocker();

  useEffect(() => {
    const apply = (p: GreetingPolicy) => {
      setSaved(p);
      setDraft(p);
    };
    void engine.getGreetingPolicy().then(apply);
    return engine.events.on('greetingPolicy', apply);
  }, [engine]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      await engine.setGreetingPolicy(draft);
      setNote('Saved. Everyone’s apps update now.');
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen
        options={{
          title: 'Greeting cards',
          headerTitle: () => <HeaderTitleWithHelp title="Greeting cards" id="greeting-cards" />,
        }}
      />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}>
        <Text variant="body" tone="muted">
          Ready-made cards for festivals and special moments that people can send in any chat, with
          heartfelt messages they can edit. Cards are ordinary messages, so they work offline.
        </Text>
        <Glass style={{ padding: space.md, gap: space.md }}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">Offer greeting cards</Text>
              <Text variant="meta" tone="muted">
                When off, the card option disappears for everyone. Cards already sent stay.
              </Text>
            </View>
            <Switch
              value={draft.enabled}
              onValueChange={(v) => setDraft((d) => ({ ...d, enabled: v }))}
              accessibilityLabel="Offer greeting cards"
            />
          </View>
          {GREETING_CATEGORIES.map((cat) => {
            const on = !draft.hiddenCategories.includes(cat.id);
            return (
              <View key={cat.id} style={[styles.row, { opacity: draft.enabled ? 1 : 0.5 }]}>
                <Text variant="body" style={{ flex: 1 }}>
                  {cat.name}
                </Text>
                <Switch
                  value={on}
                  disabled={!draft.enabled}
                  onValueChange={() =>
                    setDraft((d) => ({
                      ...d,
                      hiddenCategories: on
                        ? [...d.hiddenCategories, cat.id]
                        : d.hiddenCategories.filter((x) => x !== cat.id),
                    }))
                  }
                  accessibilityLabel={cat.name}
                />
              </View>
            );
          })}
        </Glass>
        {note || blocked ? (
          <Text variant="meta" style={{ color: note?.startsWith('Saved') ? c.success : c.warning }}>
            {note ?? `${blocked} Rules are kept on the server.`}
          </Text>
        ) : null}
        <Button
          title="Save"
          onPress={() => void save()}
          busy={busy}
          disabled={!dirty || !!blocked}
        />
        <View style={{ alignItems: 'center' }}>
          <GreetingCard
            card={{ occasionId: 'diwali', styleId: 'elegant', title: 'Happy Diwali', to: null }}
            text="May every diya you light tonight bring a little more warmth into your home."
            from="Aarav"
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
