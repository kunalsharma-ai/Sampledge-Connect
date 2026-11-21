import { Planned } from '../../components/Planned';
import { Screen } from '../../components/Screen';
import { MODULES } from '../../state/modules';

export default function Activity() {
  const m = MODULES.find((x) => x.key === 'notifications')!;
  return (
    <Screen>
      <Planned
        title={m.title}
        summary={`${m.summary} Unread counts on the Messages tab already work.`}
        icon={m.icon}
      />
    </Screen>
  );
}
