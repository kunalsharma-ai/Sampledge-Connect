import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import type { DirectoryEntry } from '../state/hooks';
import { alpha, radius, space, type as typeScale } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Avatar } from './Avatar';
import { Text } from './Text';

/**
 * Searchable list of people from the cached directory. `single` picks one person (a DM);
 * otherwise rows toggle and the chosen people show as chips above the list.
 */
export function PeoplePicker({
  people,
  selected,
  onChange,
  single,
  exclude = [],
  header,
}: {
  people: DirectoryEntry[];
  selected: string[];
  onChange: (ids: string[]) => void;
  single?: boolean;
  /** Already in the conversation: shown greyed out. */
  exclude?: readonly string[];
  header?: React.ReactElement;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle
      ? people.filter((p) =>
          [p.displayName, p.email, p.title ?? ''].some((f) => f.toLowerCase().includes(needle)),
        )
      : people;
  }, [people, q]);
  const byId = useMemo(() => new Map(people.map((p) => [p.userId, p])), [people]);

  const toggle = (id: string) =>
    onChange(
      single ? [id] : selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id],
    );

  return (
    <FlatList
      data={shown}
      keyExtractor={(p) => p.userId}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: 140 }}
      ListHeaderComponent={
        <View style={{ gap: space.md, paddingBottom: space.sm }}>
          {header}
          <View
            style={[styles.search, { backgroundColor: c.surfaceSunken, borderColor: c.border }]}
          >
            <Ionicons name="search" size={16} color={c.textSubtle} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search people"
              placeholderTextColor={c.textSubtle}
              autoCorrect={false}
              autoCapitalize="none"
              accessibilityLabel="Search people"
              style={[typeScale.body, { flex: 1, color: c.text, paddingVertical: 10 }]}
            />
          </View>
          {!single && selected.length ? (
            <View style={styles.chips}>
              {selected.map((id) => (
                <Pressable
                  key={id}
                  onPress={() => toggle(id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${byId.get(id)?.displayName ?? 'person'}`}
                  style={[
                    styles.chip,
                    { backgroundColor: alpha(c.accent, 0.14), borderColor: alpha(c.accent, 0.4) },
                  ]}
                >
                  <Text variant="label" tone="accent">
                    {byId.get(id)?.displayName ?? 'Someone'}
                  </Text>
                  <Ionicons name="close" size={14} color={c.accent} />
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      }
      renderItem={({ item }) => {
        const taken = exclude.includes(item.userId);
        const on = selected.includes(item.userId);
        return (
          <Pressable
            onPress={() => !taken && toggle(item.userId)}
            disabled={taken}
            accessibilityRole={single ? 'radio' : 'checkbox'}
            accessibilityState={{ checked: on || taken, disabled: taken }}
            accessibilityLabel={item.displayName}
            style={({ pressed }) => [
              styles.row,
              pressed && { backgroundColor: c.surfaceSunken },
              taken && { opacity: 0.5 },
            ]}
          >
            <Avatar name={item.displayName} size={38} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {item.displayName}
              </Text>
              <Text variant="meta" tone="muted" numberOfLines={1}>
                {taken
                  ? 'Already here'
                  : [item.title, item.role === 'guest' ? 'Guest' : null, item.email]
                      .filter(Boolean)
                      .join(' · ')}
              </Text>
            </View>
            <Ionicons
              name={
                on || taken
                  ? single
                    ? 'radio-button-on'
                    : 'checkmark-circle'
                  : single
                    ? 'radio-button-off'
                    : 'ellipse-outline'
              }
              size={22}
              color={on || taken ? c.accent : c.textSubtle}
            />
          </Pressable>
        );
      }}
      ListEmptyComponent={
        <Text tone="muted" style={{ textAlign: 'center', padding: space.xl }}>
          {people.length
            ? 'No one matches that search.'
            : 'The people directory has not synced to this phone yet.'}
        </Text>
      }
    />
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.xs,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
});
