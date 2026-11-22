import {
  ConnectHandleSchema,
  type MyNetworkProfile,
  type NetworkPrivacy,
  type UpdateNetworkProfile,
} from '@sampledge/contracts';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Share, StyleSheet, Switch, View } from 'react-native';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { Chips } from '../../components/Chips';
import { Glass } from '../../components/Glass';
import { Empty, Field, QueuedTag, SmallButton } from '../../components/NetworkBits';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { count, withPendingProfile } from '../../lib/network';
import { useWorkspace } from '../../state/AppProvider';
import { useNet, useNetPending } from '../../state/useNetwork';
import { space } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

const TOGGLES: { key: keyof NetworkPrivacy; label: string; hint: string }[] = [
  {
    key: 'discoverableByName',
    label: 'Find me by name',
    hint: 'People can find you by typing your name. Your exact Connect ID always works.',
  },
  {
    key: 'findableByEmail',
    label: 'Find me by email',
    hint: 'Someone who types your exact email address can find you.',
  },
  {
    key: 'findableByPhone',
    label: 'Find me by phone',
    hint: 'Someone who types your exact phone number can find you.',
  },
  {
    key: 'allowFollowers',
    label: 'Allow followers',
    hint: 'Followers see statuses you share with followers or the public.',
  },
  {
    key: 'showOrganization',
    label: 'Show my organization',
    hint: 'Shows your company name next to your name.',
  },
];

type Draft = { handle: string; displayName: string; headline: string; bio: string; phone: string };

/** Your Connect ID, network profile and privacy. Saved to your account for every device. */
export default function NetworkProfileScreen() {
  const { theme } = useTheme();
  const c = theme.colors;
  const { engine } = useWorkspace();
  const { data, loading } = useNet<MyNetworkProfile>('/v1/network/me');
  const pending = useNetPending();
  const me = data ? withPendingProfile(data, pending) : null;
  const queued = pending.some((p) => p.path === '/v1/network/me');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (me && !draft)
      setDraft({
        handle: me.handle,
        displayName: me.displayName,
        headline: me.headline,
        bio: me.bio,
        phone: me.phone ?? '',
      });
  }, [me, draft]);

  if (!me || !draft)
    return (
      <Screen edges={['bottom']}>
        {loading ? (
          <ActivityIndicator style={{ marginTop: space.xl }} />
        ) : (
          <Empty
            icon="cloud-offline-outline"
            title="Not loaded yet"
            body="Open this once you’re online."
          />
        )}
      </Screen>
    );

  const patch: UpdateNetworkProfile = {};
  if (draft.handle.trim().replace(/^@/, '').toLowerCase() !== me.handle)
    patch.handle = draft.handle.trim().replace(/^@/, '').toLowerCase();
  if (draft.displayName.trim() !== me.displayName) patch.displayName = draft.displayName.trim();
  if (draft.headline.trim() !== me.headline) patch.headline = draft.headline.trim();
  if (draft.bio.trim() !== me.bio) patch.bio = draft.bio.trim();
  if (draft.phone.trim() !== (me.phone ?? '')) patch.phone = draft.phone.trim() || null;
  const dirty = Object.keys(patch).length > 0;

  const save = () => {
    if (patch.handle) {
      const ok = ConnectHandleSchema.safeParse(patch.handle);
      if (!ok.success)
        return setError('Connect IDs start with a letter; letters, numbers, dots and underscores.');
    }
    if (patch.displayName === '') return setError('Your name can’t be empty.');
    setError(null);
    void engine.netAct({
      method: 'PATCH',
      path: '/v1/network/me',
      body: patch,
      label: 'Saving your network profile',
      scopes: ['profile'],
    });
  };
  const setPrivacy = (privacy: Partial<NetworkPrivacy>) =>
    void engine.netAct({
      method: 'PATCH',
      path: '/v1/network/me',
      body: { privacy },
      label: 'Saving your privacy settings',
      scopes: ['profile'],
    });

  return (
    <Screen edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <Avatar name={me.displayName} size={84} />
          <Text variant="title">{me.displayName}</Text>
          <Text tone="muted">@{me.handle}</Text>
          {me.home ? (
            <Text variant="meta" tone="subtle">
              Linked to your {me.home.tenantName} account
            </Text>
          ) : (
            <Text variant="meta" tone="subtle">
              Personal account
            </Text>
          )}
          <Text variant="meta" tone="subtle">
            {count(me.counts.connections, 'connection')} · {count(me.counts.followers, 'follower')}{' '}
            · {me.counts.following} following
          </Text>
          {queued ? <QueuedTag /> : null}
        </View>

        <Glass style={{ padding: space.lg, gap: space.md }}>
          <Field
            label="Connect ID"
            value={draft.handle}
            onChangeText={(handle) => setDraft({ ...draft, handle })}
            autoCapitalize="none"
            hint="What people type to find you, like a Teams ID or a Telegram username."
          />
          <Field
            label="Name"
            value={draft.displayName}
            onChangeText={(displayName) => setDraft({ ...draft, displayName })}
            autoCapitalize="words"
          />
          <Field
            label="Headline"
            value={draft.headline}
            onChangeText={(headline) => setDraft({ ...draft, headline })}
            maxLength={120}
            placeholder="Head of Partnerships at Globex"
          />
          <Field
            label="About"
            value={draft.bio}
            onChangeText={(bio) => setDraft({ ...draft, bio })}
            maxLength={600}
            multiline
          />
          <Field
            label="Phone"
            value={draft.phone}
            onChangeText={(phone) => setDraft({ ...draft, phone })}
            keyboardType="phone-pad"
            placeholder="+44 7700 900123"
          />
          {error ? (
            <Text tone="danger" variant="label">
              {error}
            </Text>
          ) : null}
          <Button title="Save profile" disabled={!dirty} onPress={save} />
        </Glass>

        <Glass style={{ padding: space.lg, gap: space.md }}>
          <Text variant="heading">Privacy</Text>
          <Text variant="label" tone="muted">
            Profile page
          </Text>
          <Chips
            label="Profile page"
            options={[
              { key: 'network', label: 'Only on SampConnect' },
              { key: 'public', label: 'Public link' },
            ]}
            selected={[me.privacy.profileVisibility]}
            onToggle={(v) => setPrivacy({ profileVisibility: v })}
          />
          {me.publicUrl && me.privacy.profileVisibility === 'public' ? (
            <View style={styles.rowBetween}>
              <Text variant="meta" tone="muted" style={{ flex: 1 }} numberOfLines={1} selectable>
                {me.publicUrl}
              </Text>
              <SmallButton
                icon="share-outline"
                title="Share"
                onPress={() =>
                  void Share.share({ message: me.publicUrl!, url: me.publicUrl! }).catch(
                    () => undefined,
                  )
                }
              />
            </View>
          ) : null}
          <Text variant="label" tone="muted">
            Connection requests from
          </Text>
          <Chips
            label="Connection requests from"
            options={[
              { key: 'everyone', label: 'Everyone' },
              { key: 'nobody', label: 'Nobody' },
            ]}
            selected={[me.privacy.allowRequestsFrom]}
            onToggle={(v) => setPrivacy({ allowRequestsFrom: v })}
          />
          {TOGGLES.map((t) => (
            <View key={t.key} style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <Text variant="label">{t.label}</Text>
                <Text variant="meta" tone="muted">
                  {t.hint}
                </Text>
              </View>
              <Switch
                value={!!me.privacy[t.key]}
                onValueChange={(v) => setPrivacy({ [t.key]: v })}
                accessibilityLabel={t.label}
                trackColor={{ true: c.accent, false: c.border }}
              />
            </View>
          ))}
        </Glass>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.xs },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
