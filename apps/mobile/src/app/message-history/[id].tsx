import type { MessageEditHistory } from '@sampledge/contracts';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { Glass } from '../../components/Glass';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { useWorkspace } from '../../state/AppProvider';
import { alpha, radius, space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

/** Every version of an edited message, newest first (docs/editing.md). Needs a connection. */
export default function MessageHistory() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const [hist, setHist] = useState<MessageEditHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    engine.messageHistory(id).then(
      (h) => live && setHist(h),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [engine, id]);

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Edit history' }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 80 }}>
        <Text variant="meta" tone="muted">
          Every version of this message, newest first. Only the latest shows in the conversation.
        </Text>
        {error ? (
          <Text tone="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : !hist ? (
          <ActivityIndicator color={c.accent} />
        ) : (
          [...hist.versions].reverse().map((v) => (
            <Glass key={v.version}>
              <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
                {v.current ? (
                  <View
                    style={{
                      paddingHorizontal: space.sm,
                      paddingVertical: 2,
                      borderRadius: radius.pill,
                      backgroundColor: alpha(c.accent, 0.15),
                    }}
                  >
                    <Text variant="meta" style={{ color: c.accent }}>
                      Current
                    </Text>
                  </View>
                ) : null}
                <Text variant="meta" tone="muted">
                  {v.version === 1 ? 'Sent' : `Edit ${v.version - 1}`} · {when(v.at)}
                </Text>
              </View>
              <Text style={{ marginTop: space.xs }}>{v.text || 'No text'}</Text>
            </Glass>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
