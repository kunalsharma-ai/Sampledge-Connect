import { Planned } from '../../components/Planned';
import { Screen } from '../../components/Screen';
import { MODULES } from '../../state/modules';

export default function Inbox() {
  const m = MODULES.find((x) => x.key === 'inbox')!;
  return (
    <Screen>
      <Planned title={m.title} summary={m.summary} icon={m.icon} />
    </Screen>
  );
}
