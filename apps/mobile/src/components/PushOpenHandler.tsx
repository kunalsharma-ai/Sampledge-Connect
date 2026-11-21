import { router } from 'expo-router';
import { useEffect } from 'react';
import { onPushOpened } from '../lib/push';
import { useWorkspace } from '../state/AppProvider';

/** Opens the conversation when a push notification is tapped, and marks that item read. */
export function PushOpenHandler() {
  const { engine } = useWorkspace();
  useEffect(
    () =>
      onPushOpened((data) => {
        const conversationId = typeof data.conversationId === 'string' ? data.conversationId : null;
        if (!conversationId) return;
        if (typeof data.notificationId === 'string')
          void engine.markNotificationsRead({ notificationIds: [data.notificationId] });
        router.push({ pathname: '/conversation/[id]', params: { id: conversationId } });
      }),
    [engine],
  );
  return null;
}
