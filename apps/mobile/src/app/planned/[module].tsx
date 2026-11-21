import { Stack, useLocalSearchParams } from 'expo-router';
import { Planned } from '../../components/Planned';
import { Screen } from '../../components/Screen';
import { MODULES } from '../../state/modules';

export default function PlannedModule() {
  const { module } = useLocalSearchParams<{ module: string }>();
  const m = MODULES.find((x) => x.key === module) ?? {
    title: 'Module',
    summary: '',
    icon: 'cube-outline' as const,
  };
  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: m.title }} />
      <Planned title={m.title} summary={m.summary} icon={m.icon} />
    </Screen>
  );
}
