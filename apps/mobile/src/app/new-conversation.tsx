import type { CreateConversationRequest } from '@sampledge/contracts';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';
import { Button } from '../components/Button';
import { PeoplePicker } from '../components/PeoplePicker';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { canInWorkspace, channelNameError } from '../lib/access';
import { useApp, useWorkspace } from '../state/AppProvider';
import { useDirectory, useTenantRole } from '../state/hooks';
import { alpha, radius, space, type as typeScale } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';

type Kind = 'dm' | 'group' | 'channel';

/** Start a direct message, a group, or a channel. Needs the server (it decides membership). */
export default function NewConversation() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  useApp(); // re-render on connectivity changes
  const role = useTenantRole();
  const people = useDirectory();
  const kinds = (
    [
      { key: 'dm', label: 'Direct', allowed: canInWorkspace(role, 'conversation.dm.create') },
      { key: 'group', label: 'Group', allowed: canInWorkspace(role, 'conversation.group.create') },
      {
        key: 'channel',
        label: 'Channel',
        allowed:
          canInWorkspace(role, 'channel.public.create') ||
          canInWorkspace(role, 'channel.private.create'),
      },
    ] as const
  ).filter((k) => k.allowed);
  const [kind, setKind] = useState<Kind>('dm');
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = engine.serverActionBlocker();

  const pickKind = (k: Kind) => {
    setKind(k);
    setError(null);
    if (k === 'dm') setSelected((s) => s.slice(0, 1));
  };

  const invalid =
    kind === 'dm'
      ? selected.length !== 1
        ? 'Pick one person.'
        : null
      : kind === 'group'
        ? selected.length < 2
          ? 'Pick at least two people. For one person, start a direct message.'
          : null
        : channelNameError(name);

  const create = async () => {
    if (invalid) return setError(invalid);
    const req: CreateConversationRequest =
      kind === 'dm'
        ? { kind: 'dm', memberIds: selected }
        : kind === 'group'
          ? { kind: 'group', memberIds: selected, ...(name.trim() ? { name: name.trim() } : {}) }
          : {
              kind: isPrivate ? 'channel_private' : 'channel_public',
              name: name.trim(),
              ...(topic.trim() ? { topic: topic.trim() } : {}),
              memberIds: selected,
            };
    setBusy(true);
    setError(null);
    try {
      const id = await engine.createConversation(req);
      router.dismiss();
      router.push({ pathname: '/conversation/[id]', params: { id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const field = [
    typeScale.body,
    styles.input,
    { color: c.text, backgroundColor: c.surfaceSunken, borderColor: c.border },
  ];

  const header = (
    <View style={{ gap: space.md }}>
      <View style={[styles.segment, { backgroundColor: c.surfaceSunken, borderColor: c.border }]}>
        {kinds.map((k) => {
          const on = k.key === kind;
          return (
            <Pressable
              key={k.key}
              onPress={() => pickKind(k.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              style={[styles.segmentItem, on && { backgroundColor: c.surfaceRaised }]}
            >
              <Text variant="label" tone={on ? 'default' : 'muted'}>
                {k.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {kind === 'group' ? (
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Group name (optional)"
          placeholderTextColor={c.textSubtle}
          maxLength={80}
          accessibilityLabel="Group name"
          style={field}
        />
      ) : null}
      {kind === 'channel' ? (
        <View style={{ gap: space.sm }}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Channel name, e.g. fieldwork-ops"
            placeholderTextColor={c.textSubtle}
            maxLength={80}
            autoCapitalize="none"
            accessibilityLabel="Channel name"
            style={field}
          />
          <TextInput
            value={topic}
            onChangeText={setTopic}
            placeholder="What is it for? (optional)"
            placeholderTextColor={c.textSubtle}
            maxLength={250}
            accessibilityLabel="Channel topic"
            style={field}
          />
          <View style={[styles.toggle, { borderColor: c.border }]}>
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">Private channel</Text>
              <Text variant="meta" tone="muted">
                {isPrivate
                  ? 'Only people you add can find and read it.'
                  : 'Anyone in the workspace can find, read and join it.'}
              </Text>
            </View>
            <Switch
              value={isPrivate}
              onValueChange={setPrivate}
              disabled={!canInWorkspace(role, 'channel.private.create')}
              accessibilityLabel="Private channel"
              trackColor={{ true: c.accent, false: c.border }}
            />
          </View>
          <Text variant="overline" tone="subtle" style={{ marginTop: space.xs }}>
            Add people (optional)
          </Text>
        </View>
      ) : null}
      {blocked ? (
        <View style={[styles.note, { backgroundColor: alpha(c.warning, 0.12) }]}>
          <Text variant="meta" style={{ color: c.warning }}>
            {blocked}
          </Text>
        </View>
      ) : null}
      {error ? (
        <View style={[styles.note, { backgroundColor: alpha(c.danger, 0.12) }]}>
          <Text variant="meta" tone="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'New conversation' }} />
      <View style={{ flex: 1, paddingHorizontal: space.lg, paddingTop: space.md }}>
        <PeoplePicker
          people={people}
          selected={selected}
          onChange={(ids) => {
            setSelected(ids);
            setError(null);
          }}
          single={kind === 'dm'}
          header={header}
        />
      </View>
      <View style={[styles.footer, { borderTopColor: c.border, backgroundColor: c.background }]}>
        <Button
          title={
            kind === 'dm'
              ? 'Start conversation'
              : kind === 'group'
                ? 'Create group'
                : 'Create channel'
          }
          onPress={() => void create()}
          busy={busy}
          disabled={!!blocked}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  segment: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.sm },
  input: {
    paddingHorizontal: space.md,
    paddingVertical: 11,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
  },
  note: { padding: space.md, borderRadius: radius.md },
  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
