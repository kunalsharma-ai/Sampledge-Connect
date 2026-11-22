import { uuidv7 } from '@sampledge/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Button } from '../../../components/Button';
import { Glass } from '../../../components/Glass';
import { Field } from '../../../components/NetworkBits';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { useWorkspace } from '../../../state/AppProvider';
import { space } from '../../../theme/themes';
import { useTheme } from '../../../theme/ThemeProvider';

/** A new group inside a community: a chat where messages, files and calls all work. */
export default function NewGroup() {
  const { id, name: communityName } = useLocalSearchParams<{ id: string; name?: string }>();
  const { theme } = useTheme();
  const { engine } = useWorkspace();
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [priv, setPriv] = useState(false);
  const [ann, setAnn] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    await engine.netAct({
      method: 'POST',
      path: `/v1/network/communities/${id}/groups`,
      body: {
        clientActionId: uuidv7(),
        name: name.trim(),
        topic: topic.trim(),
        access: priv ? 'private' : 'open',
        announcementsOnly: ann,
      },
      label: `New group ${name.trim()}`,
      scopes: ['communities'],
    });
    router.back();
  };

  const toggle = (label: string, value: boolean, set: (v: boolean) => void) => (
    <View style={styles.row}>
      <Text variant="label" style={{ flex: 1 }}>
        {label}
      </Text>
      <Switch
        value={value}
        onValueChange={set}
        accessibilityLabel={label}
        trackColor={{ true: theme.colors.accent, false: theme.colors.border }}
      />
    </View>
  );

  return (
    <Screen edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text tone="muted">
          A chat inside {communityName || 'this community'}. Messages, files and calls all work
          here.
        </Text>
        <Field
          label="Group name"
          value={name}
          onChangeText={setName}
          maxLength={60}
          placeholder="Panel quality"
        />
        <Field label="Topic" value={topic} onChangeText={setTopic} maxLength={250} />
        <Glass style={{ padding: space.lg, gap: space.md }}>
          {toggle('Private (admins add people)', priv, setPriv)}
          {toggle('Only moderators post', ann, setAnn)}
        </Glass>
        <Button
          title="Create group"
          icon="people-outline"
          disabled={!name.trim()}
          onPress={() => void create()}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
