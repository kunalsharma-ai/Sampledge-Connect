import { uuidv7, type Circle, type NetworkInvite } from '@sampledge/contracts';
import { useState } from 'react';
import { Linking, Platform, ScrollView, Share, StyleSheet, View } from 'react-native';
import { Button } from '../../components/Button';
import { Chips } from '../../components/Chips';
import { Glass } from '../../components/Glass';
import { Empty, Field, QueuedTag, Section, SmallButton, Tag } from '../../components/NetworkBits';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { CIRCLE_LABEL } from '../../lib/network';
import { useWorkspace } from '../../state/AppProvider';
import { useNet, useNetPending } from '../../state/useNetwork';
import { space } from '../../theme/themes';

type Channel = 'link' | 'email' | 'sms';

const DELIVERY: Record<NonNullable<NetworkInvite['delivery']>, string> = {
  sent: 'Email sent',
  not_configured: 'Email not set up: share the link',
  failed: 'Email failed: share the link',
};

/**
 * Invite someone who isn't on SampConnect yet: a link to share, an email, or a text from your
 * own phone. When they sign up from it you are connected automatically.
 */
export default function Invite() {
  const { engine } = useWorkspace();
  const { data } = useNet<NetworkInvite[]>('/v1/network/invites');
  const pending = useNetPending().filter((p) => p.path === '/v1/network/invites');
  const [channel, setChannel] = useState<Channel>('link');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [circle, setCircle] = useState<Circle>('business');
  const [copied, setCopied] = useState<string | null>(null);

  const ready =
    channel === 'link' ||
    (channel === 'email' && /\S+@\S+\.\S+/.test(email)) ||
    (channel === 'sms' && phone.replace(/[^\d]/g, '').length >= 7);

  const create = () => {
    void engine.netAct({
      method: 'POST',
      path: '/v1/network/invites',
      body: {
        clientActionId: uuidv7(),
        channel,
        circle,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(channel === 'email' ? { email: email.trim() } : {}),
        ...(channel === 'sms' ? { phone: phone.trim() } : {}),
      },
      label: `Invite ${name.trim() || email.trim() || phone.trim() || 'by link'}`,
      scopes: ['invites'],
    });
    setName('');
    setEmail('');
    setPhone('');
  };

  // Phones share through the system sheet (which can copy too); the browser copies directly.
  const canCopy =
    Platform.OS === 'web' && typeof navigator !== 'undefined' && !!navigator.clipboard;
  const copy = async (i: NetworkInvite) => {
    await navigator.clipboard.writeText(i.url).catch(() => undefined);
    setCopied(i.inviteId);
    setTimeout(() => setCopied((c) => (c === i.inviteId ? null : c)), 2000);
  };

  const invites = data ?? [];
  return (
    <Screen edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}
        keyboardShouldPersistTaps="handled"
      >
        <Glass style={{ padding: space.lg, gap: space.md }}>
          <Text variant="heading">Invite someone</Text>
          <Text variant="meta" tone="muted">
            They get a free personal account, and you’re connected as soon as they join.
          </Text>
          <Chips
            label="Invite by"
            options={[
              { key: 'link', label: 'Link' },
              { key: 'email', label: 'Email' },
              { key: 'sms', label: 'Text message' },
            ]}
            selected={[channel]}
            onToggle={setChannel}
          />
          <Field
            label="Their name (optional)"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />
          {channel === 'email' ? (
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder="maria@example.com"
            />
          ) : null}
          {channel === 'sms' ? (
            <Field
              label="Phone number"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="+44 7700 900123"
              hint="The text goes from your own phone, with the invite link in it."
            />
          ) : null}
          <Text variant="label" tone="muted">
            Add them to
          </Text>
          <Chips
            label="Add them to"
            options={[
              { key: 'business', label: 'Business' },
              { key: 'friends', label: 'Friends' },
            ]}
            selected={[circle]}
            onToggle={setCircle}
          />
          <Button
            title={
              channel === 'link'
                ? 'Create invite link'
                : channel === 'email'
                  ? 'Send invite'
                  : 'Create text invite'
            }
            disabled={!ready}
            onPress={create}
          />
        </Glass>

        <Section title={`Your invites (${invites.length + pending.length})`}>
          {pending.map((p, i) => (
            <View key={`p${i}`} style={[styles.invite, i > 0 && styles.divider]}>
              <Text variant="bodyStrong">{p.label.replace(/^Invite /, '')}</Text>
              <View style={styles.tags}>
                <QueuedTag />
              </View>
              <Text variant="meta" tone="subtle">
                The link appears here once it reaches the server.
              </Text>
            </View>
          ))}
          {invites.map((i, n) => (
            <View
              key={i.inviteId}
              style={[styles.invite, (n > 0 || pending.length > 0) && styles.divider]}
            >
              <Text variant="bodyStrong">{i.name || i.email || i.phone || 'Invite link'}</Text>
              <View style={styles.tags}>
                <Tag
                  accent={i.status === 'accepted'}
                  text={
                    i.status === 'accepted'
                      ? 'Joined'
                      : i.status === 'expired'
                        ? 'Expired'
                        : 'Waiting'
                  }
                />
                <Tag
                  text={i.channel === 'sms' ? 'Text' : i.channel === 'email' ? 'Email' : 'Link'}
                />
                {i.delivery ? <Tag text={DELIVERY[i.delivery]} /> : null}
              </View>
              <Text variant="meta" tone="muted" numberOfLines={1} selectable>
                {i.url}
              </Text>
              {i.status === 'pending' ? (
                <View style={styles.actions}>
                  {canCopy ? (
                    <SmallButton
                      icon="copy-outline"
                      title={copied === i.inviteId ? 'Copied' : 'Copy link'}
                      onPress={() => void copy(i)}
                    />
                  ) : null}
                  <SmallButton
                    icon="share-outline"
                    title="Share"
                    onPress={() =>
                      void Share.share({
                        message: `Join me on SampConnect: ${i.url}`,
                        url: i.url,
                      }).catch(() => undefined)
                    }
                  />
                  {i.smsUrl ? (
                    <SmallButton
                      icon="chatbox-outline"
                      title="Send text"
                      onPress={() => void Linking.openURL(i.smsUrl!).catch(() => undefined)}
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
          ))}
          {!invites.length && !pending.length ? (
            <Empty icon="mail-outline" title="No invites yet" />
          ) : null}
        </Section>
        <Text variant="meta" tone="subtle" style={{ textAlign: 'center' }}>
          Invites expire after a while; make a new one if a link stops working. New connections land
          in {CIRCLE_LABEL[circle]} unless you pick otherwise.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  invite: { padding: space.md, gap: 6 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(127,127,127,0.25)' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: 4 },
});
