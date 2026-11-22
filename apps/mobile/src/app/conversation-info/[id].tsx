import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { Avatar, PersonAvatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { Glass } from '../../components/Glass';
import { NOTIFY_ICON, NotifyLevelSheet } from '../../components/NotifyLevelSheet';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { canInConversation, canSetPostingPolicy, isUnjoinedChannel } from '../../lib/access';
import { confirmThen } from '../../lib/confirm';
import { canTurnOffForwarding } from '../../lib/forward';
import { useApp, useWorkspace } from '../../state/AppProvider';
import { conversationTitle, useConversation, usePeople, useTenantRole } from '../../state/hooks';
import { alpha, radius, space, type as typeScale } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

const KIND_LABEL = {
  dm: 'Direct message',
  group: 'Group',
  channel_public: 'Public channel',
  channel_private: 'Private channel',
} as const;

const LEVEL_LABEL = { all: 'All activity', mentions: '@Mentions only', none: 'Off' } as const;

/** Who is here and what you can change: members, notifications, leave and archive. */
export default function ConversationInfo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine, selfId } = useWorkspace();
  useApp();
  const role = useTenantRole();
  const conv = useConversation(id);
  const nameOf = usePeople();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [edit, setEdit] = useState<{ name: string; topic: string } | null>(null);
  const blocked = engine.serverActionBlocker();

  if (!conv) {
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ title: 'Details' }} />
        <Text tone="muted" style={{ padding: space.xl, textAlign: 'center' }}>
          This conversation is no longer on this phone.
        </Text>
      </Screen>
    );
  }

  const title = conversationTitle(conv, nameOf, selfId);
  const isDm = conv.kind === 'dm';
  const member = conv.myRole !== null;
  const can = (p: Parameters<typeof canInConversation>[2]) => canInConversation(conv, role, p);
  const canAdd = !isDm && can('members.add');
  const canRemove = !isDm && can('members.remove');
  const canArchive = canInConversation({ ...conv, archivedAt: null }, role, 'conversation.archive');
  const isChannel = conv.kind === 'channel_public' || conv.kind === 'channel_private';
  // Owners and moderators of a group or channel (the server checks the same).
  const canRename =
    !isDm && !conv.archivedAt && (conv.myRole === 'owner' || conv.myRole === 'moderator');
  const saveEdit = async () => {
    if (!edit) return;
    if (isChannel && !edit.name.trim()) return setError('A channel needs a name.');
    const patch: { name?: string; topic?: string | null } = {};
    if (edit.name.trim() !== (conv.name ?? '')) patch.name = edit.name.trim();
    if (isChannel && edit.topic.trim() !== (conv.topic ?? ''))
      patch.topic = edit.topic.trim() || null;
    setError(null);
    try {
      if (Object.keys(patch).length) await engine.updateConversation(id, patch);
      setEdit(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const input = [
    typeScale.body,
    {
      color: c.text,
      backgroundColor: c.surfaceSunken,
      borderColor: c.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: 10,
    },
  ];
  const members = [...conv.memberIds].sort((a, b) =>
    a === selfId ? -1 : b === selfId ? 1 : nameOf(a).localeCompare(nameOf(b)),
  );

  const run = async (key: string, fn: () => Promise<void>, after?: () => void) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      after?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const leave = () =>
    confirmThen(
      `Leave ${title}?`,
      conv.kind === 'channel_public'
        ? 'You can rejoin from Browse channels at any time.'
        : 'Someone in it will need to add you back.',
      'Leave',
      () =>
        void run(
          'leave',
          () => engine.removeMember(id, selfId),
          () => router.dismissTo('/messages'),
        ),
    );

  const remove = (userId: string) =>
    confirmThen(
      `Remove ${nameOf(userId)}?`,
      'They lose access to this conversation on all their devices.',
      'Remove',
      () => void run(`rm:${userId}`, () => engine.removeMember(id, userId)),
    );

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: 'Details' }} />
      <NotifyLevelSheet
        visible={notifyOpen}
        level={conv.notifyLevel}
        pending={conv.notifyLevelPending}
        onPick={(level) => void engine.setNotifyLevel(id, level)}
        onClose={() => setNotifyOpen(false)}
      />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}>
        <View style={styles.hero}>
          <Avatar name={title} size={72} channel={conv.kind.startsWith('channel')} />
          <Text variant="title" style={{ textAlign: 'center' }}>
            {title}
          </Text>
          <Text variant="meta" tone="muted">
            {KIND_LABEL[conv.kind]}
            {conv.archivedAt ? ' · Archived' : ''}
            {!isDm && conv.myRole && conv.myRole !== 'member'
              ? ` · You are ${conv.myRole === 'owner' ? 'an owner' : 'a moderator'}`
              : ''}
            {isUnjoinedChannel(conv) ? ' · Not joined' : ''}
          </Text>
          {conv.topic ? (
            <Text tone="muted" style={{ textAlign: 'center' }}>
              {conv.topic}
            </Text>
          ) : null}
          {canRename && !edit ? (
            <Button
              title={isChannel ? 'Edit name and description' : 'Rename group'}
              icon="create-outline"
              kind="quiet"
              onPress={() => setEdit({ name: conv.name ?? '', topic: conv.topic ?? '' })}
            />
          ) : null}
        </View>
        {edit ? (
          <Glass style={{ padding: space.md, gap: space.md }}>
            <Text variant="meta" tone="muted">
              Everyone in the conversation sees the change, on every device.
            </Text>
            <TextInput
              value={edit.name}
              onChangeText={(name) => setEdit({ ...edit, name })}
              maxLength={80}
              placeholder={isChannel ? 'Channel name' : 'Group name (empty: members’ names)'}
              placeholderTextColor={c.textSubtle}
              accessibilityLabel="Name"
              style={input}
            />
            {isChannel ? (
              <TextInput
                value={edit.topic}
                onChangeText={(topic) => setEdit({ ...edit, topic })}
                maxLength={250}
                multiline
                placeholder="Description"
                placeholderTextColor={c.textSubtle}
                accessibilityLabel="Description"
                style={[input, { minHeight: 64, textAlignVertical: 'top' }]}
              />
            ) : null}
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button
                title="Cancel"
                kind="quiet"
                onPress={() => setEdit(null)}
                style={{ flex: 1 }}
              />
              <Button title="Save" onPress={() => void saveEdit()} style={{ flex: 1 }} />
            </View>
          </Glass>
        ) : null}

        {blocked && !isDm ? (
          <View style={[styles.note, { backgroundColor: alpha(c.warning, 0.12) }]}>
            <Text variant="meta" style={{ color: c.warning }}>
              {blocked} Members and settings shown are the ones saved on this phone.
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

        {isUnjoinedChannel(conv) ? (
          <Button
            title="Join channel"
            icon="enter-outline"
            onPress={() => void run('join', () => engine.joinChannel(id))}
            busy={busy === 'join'}
            disabled={!!blocked}
          />
        ) : null}

        {member ? (
          <Glass>
            <Pressable
              onPress={() => setNotifyOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Notifications, ${LEVEL_LABEL[conv.notifyLevel]}`}
              style={styles.row}
            >
              <Ionicons name={NOTIFY_ICON[conv.notifyLevel]} size={20} color={c.accent} />
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                Notifications
              </Text>
              <Text variant="label" tone="muted">
                {LEVEL_LABEL[conv.notifyLevel]}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={c.textSubtle} />
            </Pressable>
            <Pressable
              onPress={() => router.push({ pathname: '/summary/[id]', params: { id } })}
              accessibilityRole="button"
              accessibilityLabel="Summarize with AI"
              style={[
                styles.row,
                { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
              ]}
            >
              <Ionicons name="sparkles-outline" size={20} color={c.accent} />
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                Summarize with AI
              </Text>
              <Ionicons name="chevron-forward" size={16} color={c.textSubtle} />
            </Pressable>
            <Pressable
              onPress={() =>
                router.push({ pathname: '/files', params: { conversationId: id, title } })
              }
              accessibilityRole="button"
              accessibilityLabel="Files in this conversation"
              style={[
                styles.row,
                { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
              ]}
            >
              <Ionicons name="folder-outline" size={20} color={c.accent} />
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                Files
              </Text>
              <Ionicons name="chevron-forward" size={16} color={c.textSubtle} />
            </Pressable>
            <Pressable
              onPress={() =>
                router.push({ pathname: '/chat-background', params: { conversationId: id, title } })
              }
              accessibilityRole="button"
              accessibilityLabel="Chat background for this conversation"
              style={[
                styles.row,
                { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
              ]}
            >
              <Ionicons name="image-outline" size={20} color={c.accent} />
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                Chat background
              </Text>
              <Ionicons name="chevron-forward" size={16} color={c.textSubtle} />
            </Pressable>
            <Pressable
              onPress={() =>
                router.push({ pathname: '/minutes', params: { conversationId: id, title } })
              }
              accessibilityRole="button"
              accessibilityLabel="Minutes of meetings in this conversation"
              style={[
                styles.row,
                { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
              ]}
            >
              <Ionicons name="document-text-outline" size={20} color={c.accent} />
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                Minutes of meetings
              </Text>
              <Ionicons name="chevron-forward" size={16} color={c.textSubtle} />
            </Pressable>
            <Pressable
              onPress={() =>
                router.push({ pathname: '/export-chat', params: { conversationId: id, title } })
              }
              accessibilityRole="button"
              accessibilityLabel="Export this conversation"
              style={[
                styles.row,
                { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
              ]}
            >
              <Ionicons name="download-outline" size={20} color={c.accent} />
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                Export chat
              </Text>
              <Ionicons name="chevron-forward" size={16} color={c.textSubtle} />
            </Pressable>
            <Pressable
              onPress={() =>
                router.push({ pathname: '/recordings', params: { conversationId: id, title } })
              }
              accessibilityRole="button"
              accessibilityLabel="Recordings in this conversation"
              style={[
                styles.row,
                { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
              ]}
            >
              <Ionicons name="recording-outline" size={20} color={c.accent} />
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                Recordings
              </Text>
              <Ionicons name="chevron-forward" size={16} color={c.textSubtle} />
            </Pressable>
            {canSetPostingPolicy(conv, role) ? (
              <View
                style={[
                  styles.row,
                  { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
                ]}
              >
                <Ionicons name="megaphone-outline" size={20} color={c.accent} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">Announcement channel</Text>
                  <Text variant="meta" tone="muted">
                    Only owners and moderators post. Everyone can read and react.
                  </Text>
                </View>
                {busy === 'policy' ? (
                  <ActivityIndicator size="small" color={c.accent} />
                ) : (
                  <Switch
                    value={conv.postingPolicy === 'moderators'}
                    disabled={!!blocked}
                    onValueChange={(on) =>
                      void run('policy', () =>
                        engine.setPostingPolicy(id, on ? 'moderators' : 'everyone'),
                      )
                    }
                    accessibilityLabel="Announcement channel"
                  />
                )}
              </View>
            ) : null}
            {canTurnOffForwarding(conv) && canInConversation(conv, role, 'conversation.rename') ? (
              <View
                style={[
                  styles.row,
                  { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
                ]}
              >
                <Ionicons name="arrow-redo-outline" size={20} color={c.accent} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">Allow forwarding</Text>
                  <Text variant="meta" tone="muted">
                    When off, messages here can only be shared again inside this conversation.
                  </Text>
                </View>
                {busy === 'forwarding' ? (
                  <ActivityIndicator size="small" color={c.accent} />
                ) : (
                  <Switch
                    value={conv.allowForwarding}
                    disabled={!!blocked}
                    onValueChange={(on) =>
                      void run('forwarding', () => engine.setForwarding(id, on))
                    }
                    accessibilityLabel="Allow forwarding"
                  />
                )}
              </View>
            ) : null}
          </Glass>
        ) : null}

        <View style={{ gap: space.sm }}>
          <Text variant="overline" tone="subtle" style={{ marginLeft: space.xs }}>
            {members.length} member{members.length === 1 ? '' : 's'}
          </Text>
          <Glass>
            {canAdd ? (
              <Pressable
                onPress={() => router.push({ pathname: '/add-members/[id]', params: { id } })}
                disabled={!!blocked}
                accessibilityRole="button"
                accessibilityLabel="Add people"
                style={[styles.row, blocked ? { opacity: 0.5 } : null]}
              >
                <View style={[styles.addIcon, { backgroundColor: alpha(c.accent, 0.14) }]}>
                  <Ionicons name="person-add-outline" size={18} color={c.accent} />
                </View>
                <Text variant="bodyStrong" tone="accent" style={{ flex: 1 }}>
                  Add people
                </Text>
              </Pressable>
            ) : null}
            {members.map((userId, i) => (
              <View
                key={userId}
                style={[
                  styles.row,
                  (i > 0 || canAdd) && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: c.border,
                  },
                ]}
              >
                <Pressable
                  onPress={() => router.push({ pathname: '/person/[id]', params: { id: userId } })}
                  accessibilityRole="button"
                  accessibilityLabel={`Profile of ${nameOf(userId, { asWritten: true })}`}
                  style={styles.person}
                >
                  <PersonAvatar
                    userId={userId}
                    name={nameOf(userId, { asWritten: true })}
                    size={36}
                  />
                  <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                    {userId === selfId
                      ? `${nameOf(userId, { asWritten: true })} (you)`
                      : nameOf(userId)}
                  </Text>
                </Pressable>
                {canRemove && userId !== selfId ? (
                  <Pressable
                    onPress={() => remove(userId)}
                    disabled={!!blocked || busy === `rm:${userId}`}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${nameOf(userId)}`}
                    style={{ opacity: blocked ? 0.4 : 1 }}
                  >
                    <Ionicons name="remove-circle-outline" size={22} color={c.danger} />
                  </Pressable>
                ) : null}
              </View>
            ))}
          </Glass>
        </View>

        {!isDm && (member || canArchive) ? (
          <View style={{ gap: space.sm }}>
            {canArchive ? (
              <Button
                title={conv.archivedAt ? 'Unarchive' : 'Archive for everyone'}
                kind="quiet"
                icon="archive-outline"
                onPress={() =>
                  conv.archivedAt
                    ? void run('archive', () => engine.setArchived(id, false))
                    : confirmThen(
                        `Archive ${title}?`,
                        'It becomes read-only for everyone. You can unarchive it later.',
                        'Archive',
                        () => void run('archive', () => engine.setArchived(id, true)),
                      )
                }
                busy={busy === 'archive'}
                disabled={!!blocked}
              />
            ) : null}
            {member ? (
              <Button
                title={conv.kind.startsWith('channel') ? 'Leave channel' : 'Leave group'}
                kind="danger"
                icon="exit-outline"
                onPress={leave}
                busy={busy === 'leave'}
                disabled={!!blocked}
              />
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  person: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  hero: { alignItems: 'center', gap: space.xs, paddingVertical: space.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
  },
  addIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: { padding: space.md, borderRadius: radius.md },
});
