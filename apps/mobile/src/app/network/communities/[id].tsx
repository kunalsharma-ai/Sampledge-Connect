import { Ionicons } from '@expo/vector-icons';
import {
  uuidv7,
  type Community,
  type CommunityGroup,
  type CommunityInviteLink,
  type CommunityMember,
  type CommunityRole,
  type Connection,
} from '@sampledge/contracts';
import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { Button } from '../../../components/Button';
import { Chips } from '../../../components/Chips';
import { Glass } from '../../../components/Glass';
import {
  CommunityAvatar,
  Empty,
  Field,
  PersonRow,
  QueuedTag,
  Section,
  SmallButton,
  Tag,
} from '../../../components/NetworkBits';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { confirmThen } from '../../../lib/confirm';
import {
  LOCAL_COMMUNITY,
  ROLE_LABEL,
  count,
  localCommunityById,
  pendingForCommunity,
  pendingInvites,
  withPendingCommunity,
  withPendingLinks,
  withPendingMembers,
  type PendingNet,
} from '../../../lib/network';
import { useWorkspace } from '../../../state/AppProvider';
import { useNet, useNetPending } from '../../../state/useNetwork';
import { alpha, radius, space } from '../../../theme/themes';
import { useTheme } from '../../../theme/ThemeProvider';

type Tab = 'groups' | 'members' | 'invite' | 'settings';
type Method = 'POST' | 'PUT' | 'DELETE' | 'PATCH';
type Run = (label: string, method: Method, path: string, body?: unknown) => void;

const canCopy = () =>
  Platform.OS === 'web' && typeof navigator !== 'undefined' && !!navigator.clipboard;

/** Shares a link through the system sheet on phones; the browser copies it. */
async function shareLink(url: string, title: string): Promise<boolean> {
  if (canCopy()) {
    await navigator.clipboard.writeText(url).catch(() => undefined);
    return true;
  }
  await Share.share({ message: url, title }).catch(() => undefined);
  return false;
}

/**
 * A community: join, follow, groups, members, invites and settings. Every change is queued on
 * the phone and shows at once, offline too.
 */
export default function CommunityPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useTheme();
  const c0 = theme.colors;
  const { engine } = useWorkspace();
  const local = id.startsWith(LOCAL_COMMUNITY);
  const { data, loading } = useNet<Community>(local ? null : `/v1/network/communities/${id}`);
  const pending = useNetPending();
  const [tab, setTab] = useState<Tab>('groups');
  const [copied, setCopied] = useState(false);

  const base = data ?? (local ? localCommunityById(id, pending) : undefined);
  if (!base)
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ title: '' }} />
        {loading ? (
          <ActivityIndicator style={{ marginTop: space.xl }} />
        ) : (
          <Empty
            icon="people-circle-outline"
            title="Community not available"
            body={
              local
                ? 'It was created. Find it in your communities.'
                : 'Open it again once you’re online.'
            }
          />
        )}
      </Screen>
    );

  const c = withPendingCommunity(base, pending);
  const isMod = c.myRole === 'owner' || c.myRole === 'admin' || c.myRole === 'moderator';
  const isAdmin = c.myRole === 'owner' || c.myRole === 'admin';
  const path = `/v1/network/communities/${c.communityId}`;
  const run: Run = (label, method, p, body) =>
    void engine.netAct({
      method,
      path: p,
      label,
      scopes: p.includes('/follows/') ? ['communities', 'follows'] : ['communities'],
      ...(body ? { body } : {}),
    });
  const tabs: { key: Tab; label: string }[] = [
    { key: 'groups', label: 'Groups' },
    { key: 'members', label: 'Members' },
    ...(isMod || c.joinPolicy === 'open' ? [{ key: 'invite' as const, label: 'Invite' }] : []),
    ...(isAdmin ? [{ key: 'settings' as const, label: 'Settings' }] : []),
  ];
  const shown = tabs.some((t) => t.key === tab) ? tab : 'groups';

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: '' }} />
      <ScrollView
        contentContainerStyle={{ gap: space.lg, paddingBottom: 80 }}
        keyboardShouldPersistTaps="handled"
      >
        <LinearGradient
          colors={[alpha(c.avatarColor, 0.35), alpha(c.avatarColor, 0)]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={styles.hero}
        >
          <CommunityAvatar name={c.name} color={c.avatarColor} size={72} />
          <Text variant="title" style={{ textAlign: 'center' }}>
            {c.name}
          </Text>
          <View style={styles.metaRow}>
            <Ionicons
              name={c.visibility === 'public' ? 'globe-outline' : 'lock-closed-outline'}
              size={13}
              color={c0.textMuted}
            />
            <Text variant="meta" tone="muted">
              {c.visibility === 'public' ? 'Public' : 'Private'} · {count(c.memberCount, 'member')}{' '}
              · {count(c.followerCount, 'follower')}
            </Text>
          </View>
          <View style={styles.tags}>
            {c.myRole ? <Tag accent text={ROLE_LABEL[c.myRole]} /> : null}
            {c.myStatus === 'pending' ? <Tag text="Waiting for approval" /> : null}
            {c.myStatus === 'invited' ? <Tag accent text="Invited" /> : null}
            {pendingForCommunity(c.communityId, pending) ? <QueuedTag /> : null}
          </View>
          {c.description ? (
            <Text tone="muted" style={{ textAlign: 'center' }}>
              {c.description}
            </Text>
          ) : null}
        </LinearGradient>

        <View style={styles.body}>
          {local ? (
            <Glass style={styles.note}>
              <Ionicons name="cloud-offline-outline" size={18} color={c0.warning} />
              <Text variant="meta" tone="muted" style={{ flex: 1 }}>
                Waiting on this phone. It’s created when you’re back online, with its Announcements
                channel and General group.
              </Text>
            </Glass>
          ) : (
            <View style={{ gap: space.sm }}>
              {c.myStatus === 'member' ? null : c.myStatus === 'pending' ? null : (
                <Button
                  title={
                    c.myStatus === 'invited'
                      ? 'Accept invitation'
                      : c.joinPolicy === 'approval'
                        ? 'Ask to join'
                        : 'Join'
                  }
                  icon="person-add-outline"
                  onPress={() => run(`Join ${c.name}`, 'POST', `${path}/join`)}
                />
              )}
              {c.myStatus === 'invited' ? (
                <Button
                  title="Decline invitation"
                  kind="quiet"
                  onPress={() => run('Decline invitation', 'POST', `${path}/decline`)}
                />
              ) : null}
              <View style={styles.actions}>
                {c.myStatus === 'member' ? null : (
                  <SmallButton
                    title={c.following ? 'Following' : 'Follow'}
                    icon={c.following ? 'checkmark' : 'add'}
                    onPress={() =>
                      run(
                        c.following ? `Unfollow ${c.name}` : `Follow ${c.name}`,
                        c.following ? 'DELETE' : 'PUT',
                        `/v1/network/follows/community/${c.communityId}`,
                      )
                    }
                  />
                )}
                {c.publicUrl ? (
                  <SmallButton
                    title={copied ? 'Copied' : canCopy() ? 'Copy public link' : 'Share'}
                    icon="link-outline"
                    onPress={() =>
                      void shareLink(c.publicUrl!, c.name).then((didCopy) => {
                        if (!didCopy) return;
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      })
                    }
                  />
                ) : null}
                {c.myStatus === 'member' && c.myRole !== 'owner' ? (
                  <SmallButton
                    title="Leave"
                    kind="danger"
                    icon="exit-outline"
                    onPress={() =>
                      confirmThen(
                        `Leave ${c.name}?`,
                        'You leave its groups too. You can join again later.',
                        'Leave',
                        () => run(`Leave ${c.name}`, 'POST', `${path}/leave`),
                      )
                    }
                  />
                ) : null}
              </View>
            </View>
          )}

          {c.myStatus !== 'member' ? (
            <Glass>
              <Empty
                icon={c.myStatus === 'pending' ? 'hourglass-outline' : 'lock-closed-outline'}
                title={
                  c.myStatus === 'pending'
                    ? 'Your request is with the admins'
                    : 'Join to see the groups'
                }
                body={c.rules || 'Members see the announcements channel and every open group.'}
              />
            </Glass>
          ) : local ? null : (
            <>
              <Chips
                label="Community sections"
                options={tabs}
                selected={[shown]}
                onToggle={setTab}
              />
              {shown === 'groups' ? (
                <Groups c={c} isMod={isMod} isAdmin={isAdmin} run={run} />
              ) : shown === 'members' ? (
                <Members c={c} pending={pending} run={run} />
              ) : shown === 'invite' ? (
                <Invite c={c} isMod={isMod} pending={pending} run={run} />
              ) : (
                <Settings key={c.communityId} c={c} run={run} />
              )}
            </>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

function Groups({
  c,
  isMod,
  isAdmin,
  run,
}: {
  c: Community;
  isMod: boolean;
  isAdmin: boolean;
  run: Run;
}) {
  const { theme } = useTheme();
  const { engine } = useWorkspace();
  const [notHere, setNotHere] = useState<string | null>(null);
  const open = async (g: CommunityGroup) => {
    setNotHere(null);
    if (await engine.ensureConversation(g.conversationId))
      router.push({ pathname: '/conversation/[id]', params: { id: g.conversationId } });
    else setNotHere(g.conversationId);
  };
  return (
    <Section
      title="Groups"
      right={
        isMod ? (
          <SmallButton
            title="New group"
            icon="add"
            onPress={() =>
              router.push({
                pathname: '/network/communities/group',
                params: { id: c.communityId, name: c.name },
              })
            }
          />
        ) : null
      }
    >
      {c.groups.length ? (
        c.groups.map((g, i) => {
          const localGroup = g.conversationId.startsWith(LOCAL_COMMUNITY);
          const tint =
            g.kind === 'announcements' ? theme.colors.accentSecondary : theme.colors.accent;
          return (
            <View
              key={g.conversationId}
              style={[
                styles.groupRow,
                i > 0 && {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: theme.colors.border,
                },
              ]}
            >
              <View style={[styles.groupIcon, { backgroundColor: alpha(tint, 0.14) }]}>
                <Ionicons
                  name={
                    g.kind === 'announcements'
                      ? 'megaphone-outline'
                      : g.access === 'private'
                        ? 'lock-closed-outline'
                        : 'chatbubbles-outline'
                  }
                  size={18}
                  color={tint}
                />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {g.name}
                </Text>
                <Text variant="meta" tone="muted" numberOfLines={2}>
                  {g.kind === 'announcements'
                    ? 'Only admins and moderators post'
                    : g.topic ||
                      (g.access === 'private' ? 'Private group' : 'Open to all members')}{' '}
                  · {count(g.memberCount, 'member')}
                </Text>
                {notHere === g.conversationId ? (
                  <Text variant="meta" tone="danger">
                    It opens once you’re online.
                  </Text>
                ) : null}
              </View>
              {localGroup ? (
                <QueuedTag />
              ) : g.joined ? (
                <SmallButton
                  title="Open"
                  kind="primary"
                  accessibilityLabel={`Open ${g.name}`}
                  onPress={() => void open(g)}
                />
              ) : g.access === 'open' || isAdmin ? (
                <SmallButton
                  title="Join"
                  accessibilityLabel={`Join ${g.name}`}
                  onPress={() =>
                    run(
                      `Join ${g.name}`,
                      'POST',
                      `/v1/network/communities/${c.communityId}/groups/${g.conversationId}/join`,
                    )
                  }
                />
              ) : (
                <Tag text="Private" />
              )}
            </View>
          );
        })
      ) : (
        <Empty icon="chatbubbles-outline" title="Groups show here once you’re online" />
      )}
    </Section>
  );
}

function Members({ c, pending, run }: { c: Community; pending: PendingNet[]; run: Run }) {
  const { data } = useNet<CommunityMember[]>(`/v1/network/communities/${c.communityId}/members`);
  const [managing, setManaging] = useState<string | null>(null);
  const isMod = c.myRole === 'owner' || c.myRole === 'admin' || c.myRole === 'moderator';
  const isAdmin = c.myRole === 'owner' || c.myRole === 'admin';
  if (!data) return <ActivityIndicator />;
  const all = withPendingMembers(c.communityId, data, pending);
  const asking = all.filter((m) => m.status === 'pending');
  const active = all.filter((m) => m.status === 'active');
  const banned = all.filter((m) => m.status === 'banned');
  const base = `/v1/network/communities/${c.communityId}`;
  const queued = (uid: string) =>
    pending.some((p) => p.path.startsWith(base) && p.path.includes(`/${uid}`));
  const roles: Exclude<CommunityRole, 'owner'>[] =
    c.myRole === 'owner' ? ['admin', 'moderator', 'member'] : ['moderator', 'member'];
  return (
    <>
      {isMod && asking.length ? (
        <Section title={`Asking to join · ${asking.length}`}>
          {asking.map((m, i) => (
            <PersonRow
              key={m.person.userId}
              person={m.person}
              divider={i > 0}
              actions={
                <>
                  <SmallButton
                    title="Approve"
                    kind="primary"
                    accessibilityLabel={`Approve ${m.person.displayName}`}
                    onPress={() =>
                      run(
                        `Approve ${m.person.displayName}`,
                        'POST',
                        `${base}/members/${m.person.userId}/approve`,
                      )
                    }
                  />
                  <SmallButton
                    icon="close"
                    accessibilityLabel={`Deny ${m.person.displayName}`}
                    onPress={() =>
                      run(
                        `Deny ${m.person.displayName}`,
                        'POST',
                        `${base}/members/${m.person.userId}/deny`,
                      )
                    }
                  />
                </>
              }
            />
          ))}
        </Section>
      ) : null}
      <Section title={`Members · ${active.length}`}>
        {active.map((m, i) => {
          const canManage = m.role !== 'owner' && (isAdmin || (isMod && m.role === 'member'));
          return (
            <View key={m.person.userId}>
              <PersonRow
                person={m.person}
                divider={i > 0}
                tags={
                  <>
                    <Tag accent={m.role !== 'member'} text={ROLE_LABEL[m.role]} />
                    {queued(m.person.userId) ? <QueuedTag /> : null}
                  </>
                }
                actions={
                  canManage ? (
                    <SmallButton
                      icon={managing === m.person.userId ? 'chevron-up' : 'ellipsis-horizontal'}
                      accessibilityLabel={`Manage ${m.person.displayName}`}
                      onPress={() =>
                        setManaging((x) => (x === m.person.userId ? null : m.person.userId))
                      }
                    />
                  ) : null
                }
              />
              {managing === m.person.userId ? (
                <View style={styles.manage}>
                  {isAdmin ? (
                    <Chips
                      label={`Role for ${m.person.displayName}`}
                      options={roles.map((r) => ({ key: r, label: ROLE_LABEL[r] }))}
                      selected={[m.role]}
                      onToggle={(role) =>
                        role !== m.role &&
                        run(
                          `Make ${m.person.displayName} ${ROLE_LABEL[role].toLowerCase()}`,
                          'PUT',
                          `${base}/members/${m.person.userId}/role`,
                          {
                            clientActionId: uuidv7(),
                            role,
                          },
                        )
                      }
                    />
                  ) : null}
                  {m.role === 'member' || c.myRole === 'owner' ? (
                    <View style={styles.actions}>
                      <SmallButton
                        title="Remove"
                        onPress={() =>
                          confirmThen(
                            `Remove ${m.person.displayName}?`,
                            'They can join again.',
                            'Remove',
                            () =>
                              run(
                                `Remove ${m.person.displayName}`,
                                'DELETE',
                                `${base}/members/${m.person.userId}`,
                              ),
                          )
                        }
                      />
                      <SmallButton
                        title="Ban"
                        kind="danger"
                        onPress={() =>
                          confirmThen(
                            `Ban ${m.person.displayName}?`,
                            'They are removed and can’t join again until unbanned.',
                            'Ban',
                            () =>
                              run(
                                `Ban ${m.person.displayName}`,
                                'DELETE',
                                `${base}/members/${m.person.userId}?ban=true`,
                              ),
                          )
                        }
                      />
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </Section>
      {isMod && banned.length ? (
        <Section title={`Banned · ${banned.length}`}>
          {banned.map((m, i) => (
            <PersonRow
              key={m.person.userId}
              person={m.person}
              divider={i > 0}
              actions={
                <SmallButton
                  title="Unban"
                  accessibilityLabel={`Unban ${m.person.displayName}`}
                  onPress={() =>
                    run(
                      `Unban ${m.person.displayName}`,
                      'DELETE',
                      `${base}/bans/${m.person.userId}`,
                    )
                  }
                />
              }
            />
          ))}
        </Section>
      ) : null}
    </>
  );
}

function Invite({
  c,
  isMod,
  pending,
  run,
}: {
  c: Community;
  isMod: boolean;
  pending: PendingNet[];
  run: Run;
}) {
  const { theme } = useTheme();
  const base = `/v1/network/communities/${c.communityId}`;
  const conns = useNet<Connection[]>('/v1/network/connections');
  const members = useNet<CommunityMember[]>(`${base}/members`);
  const links = useNet<CommunityInviteLink[]>(isMod ? `${base}/links` : null);
  const [picked, setPicked] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const inside = new Set((members.data ?? []).map((m) => m.person.userId));
  const invited = pendingInvites(c.communityId, pending);
  const candidates = (conns.data ?? []).filter(
    (x) => !inside.has(x.person.userId) && !invited.has(x.person.userId),
  );
  const shownLinks = withPendingLinks(c.communityId, links.data ?? [], pending);

  return (
    <>
      <Section title="Invite your connections">
        <View style={{ padding: space.md, gap: space.md }}>
          {candidates.length ? (
            <Chips
              multi
              label="Connections to invite"
              options={candidates.map((x) => ({
                key: x.person.userId,
                label: x.person.displayName,
              }))}
              selected={picked}
              onToggle={(uid) =>
                setPicked((p) => (p.includes(uid) ? p.filter((x) => x !== uid) : [...p, uid]))
              }
            />
          ) : (
            <Text variant="meta" tone="muted">
              {conns.data ? 'All your connections are here or invited.' : 'Loading connections'}
            </Text>
          )}
          {invited.size ? (
            <View style={styles.tags}>
              <Tag text={`${count(invited.size, 'invite')} waiting`} />
              <QueuedTag />
            </View>
          ) : null}
          <Button
            title={picked.length ? `Invite ${picked.length}` : 'Invite'}
            icon="person-add-outline"
            disabled={!picked.length}
            onPress={() => {
              run(`Invite to ${c.name}`, 'POST', `${base}/invite`, {
                clientActionId: uuidv7(),
                userIds: picked,
              });
              setPicked([]);
            }}
          />
        </View>
      </Section>
      {isMod ? (
        <Section
          title="Invite links"
          right={
            <SmallButton
              title="New link"
              icon="link-outline"
              onPress={() =>
                run('Create invite link', 'POST', `${base}/links`, {
                  clientActionId: uuidv7(),
                  expiresInDays: 7,
                })
              }
            />
          }
        >
          {shownLinks.length ? (
            shownLinks.map((l, i) => (
              <View
                key={l.linkId}
                style={[
                  styles.linkRow,
                  i > 0 && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: theme.colors.border,
                  },
                ]}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text
                    variant="label"
                    numberOfLines={1}
                    tone={l.revoked || l.queued ? 'subtle' : undefined}
                    style={l.revoked ? { textDecorationLine: 'line-through' } : undefined}
                  >
                    {l.queued ? 'New link, made when you’re online' : l.url}
                  </Text>
                  <Text variant="meta" tone="muted">
                    {l.revoked
                      ? 'Revoked'
                      : `${l.uses}${l.maxUses ? `/${l.maxUses}` : ''} used${
                          l.expiresAt
                            ? ` · until ${new Date(l.expiresAt).toLocaleDateString()}`
                            : ''
                        }`}
                  </Text>
                </View>
                {l.queued ? (
                  <QueuedTag />
                ) : l.revoked ? null : (
                  <>
                    <SmallButton
                      icon={
                        copied === l.linkId
                          ? 'checkmark'
                          : canCopy()
                            ? 'copy-outline'
                            : 'share-outline'
                      }
                      accessibilityLabel={canCopy() ? 'Copy link' : 'Share link'}
                      onPress={() =>
                        void shareLink(l.url, c.name).then((didCopy) => {
                          if (!didCopy) return;
                          setCopied(l.linkId);
                          setTimeout(() => setCopied(null), 2000);
                        })
                      }
                    />
                    <SmallButton
                      title="Revoke"
                      kind="danger"
                      onPress={() => run('Revoke link', 'DELETE', `${base}/links/${l.linkId}`)}
                    />
                  </>
                )}
              </View>
            ))
          ) : (
            <Empty
              icon="link-outline"
              title="No invite links"
              body="Share a link anyone can use to join, even without an account."
            />
          )}
        </Section>
      ) : null}
    </>
  );
}

function Settings({ c, run }: { c: Community; run: Run }) {
  const { theme } = useTheme();
  const [name, setName] = useState(c.name);
  const [description, setDescription] = useState(c.description);
  const [rules, setRules] = useState(c.rules);
  const path = `/v1/network/communities/${c.communityId}`;
  const changed = name !== c.name || description !== c.description || rules !== c.rules;
  const toggle = (label: string, value: boolean, onChange: (v: boolean) => void) => (
    <View style={styles.actionsBetween}>
      <Text variant="label" style={{ flex: 1 }}>
        {label}
      </Text>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ true: theme.colors.accent, false: theme.colors.border }}
      />
    </View>
  );
  return (
    <Glass style={{ padding: space.lg, gap: space.md }}>
      <Field label="Community name" value={name} onChangeText={setName} maxLength={80} />
      <Field
        label="Description"
        value={description}
        onChangeText={setDescription}
        maxLength={1000}
        multiline
      />
      <Field
        label="Rules"
        hint="Shown to people before they join."
        value={rules}
        onChangeText={setRules}
        maxLength={2000}
        multiline
      />
      <Button
        title="Save"
        disabled={!changed || name.trim().length < 2}
        onPress={() =>
          run('Save community', 'PATCH', path, {
            clientActionId: uuidv7(),
            name: name.trim(),
            description: description.trim(),
            rules: rules.trim(),
          })
        }
      />
      {toggle('Public (listed, shareable page)', c.visibility === 'public', (v) =>
        run('Change visibility', 'PATCH', path, {
          clientActionId: uuidv7(),
          visibility: v ? 'public' : 'private',
        }),
      )}
      {toggle('Admins approve new members', c.joinPolicy === 'approval', (v) =>
        run('Change join policy', 'PATCH', path, {
          clientActionId: uuidv7(),
          joinPolicy: v ? 'approval' : 'open',
        }),
      )}
    </Glass>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    paddingBottom: space.md,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: 'center' },
  body: { paddingHorizontal: space.lg, gap: space.lg },
  note: { flexDirection: 'row', gap: space.md, padding: space.md, alignItems: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  actionsBetween: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  groupIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manage: { paddingHorizontal: space.md, paddingBottom: space.md, gap: space.sm },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md },
});
