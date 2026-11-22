import { uuidv7 } from '@sampledge/contracts';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Button } from '../../../components/Button';
import { Chips } from '../../../components/Chips';
import { Glass } from '../../../components/Glass';
import { Field } from '../../../components/NetworkBits';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { useWorkspace } from '../../../state/AppProvider';
import { space } from '../../../theme/themes';
import { useTheme } from '../../../theme/ThemeProvider';

/**
 * A new community. It comes with an Announcements channel and a General group. Made offline,
 * it shows at once in your list and is created when you're back online.
 */
export default function NewCommunity() {
  const { theme } = useTheme();
  const { engine } = useWorkspace();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [approval, setApproval] = useState(false);
  const ready = name.trim().length >= 2;

  const create = async () => {
    if (!ready) return;
    await engine.netAct({
      method: 'POST',
      path: '/v1/network/communities',
      body: {
        clientActionId: uuidv7(),
        name: name.trim(),
        description: description.trim(),
        visibility,
        joinPolicy: approval ? 'approval' : 'open',
      },
      label: `Create ${name.trim()}`,
      scopes: ['communities'],
    });
    router.back();
  };

  return (
    <Screen edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text tone="muted">
          Comes with an Announcements channel and a General group. Add more groups any time.
        </Text>
        <Field
          label="Name"
          value={name}
          onChangeText={setName}
          maxLength={80}
          placeholder="Market Research Leaders"
        />
        <Field
          label="What it’s about"
          value={description}
          onChangeText={setDescription}
          maxLength={1000}
          multiline
        />
        <Glass style={{ padding: space.lg, gap: space.md }}>
          <Chips
            label="Who can find it"
            options={[
              { key: 'public', label: 'Public' },
              { key: 'private', label: 'Private' },
            ]}
            selected={[visibility]}
            onToggle={setVisibility}
          />
          <Text variant="meta" tone="muted">
            {visibility === 'public'
              ? 'Anyone can find it, and it has a shareable page.'
              : 'Hidden. People join by invite link or invitation.'}
          </Text>
          <View style={styles.row}>
            <Text variant="label" style={{ flex: 1 }}>
              Admins approve new members
            </Text>
            <Switch
              value={approval}
              onValueChange={setApproval}
              accessibilityLabel="Admins approve new members"
              trackColor={{ true: theme.colors.accent, false: theme.colors.border }}
            />
          </View>
        </Glass>
        <Button
          title="Create community"
          icon="people-circle-outline"
          disabled={!ready}
          onPress={() => void create()}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
