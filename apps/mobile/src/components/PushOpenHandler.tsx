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
        // Meeting invites, changes and reminders open the meeting.
        if (data.type === 'meeting' && typeof data.meetingId === 'string') {
          void engine.refreshMeetings();
          router.push({ pathname: '/meeting/[id]', params: { id: data.meetingId } });
          return;
        }
        // Help center replies and status changes open the question.
        if (data.type === 'support' && typeof data.queryId === 'string') {
          void engine.refreshSupport();
          router.push({ pathname: '/help/query/[id]', params: { id: data.queryId } });
          return;
        }
        const conversationId = typeof data.conversationId === 'string' ? data.conversationId : null;
        if (!conversationId) return;
        // A ringing call: show the incoming call sheet if it is still ringing for you.
        if (data.type === 'call' && typeof data.callId === 'string') {
          router.push({ pathname: '/conversation/[id]', params: { id: conversationId } });
          void engine.calls.openFromPush(data.callId);
          return;
        }
        if (typeof data.notificationId === 'string')
          void engine.markNotificationsRead({ notificationIds: [data.notificationId] });
        router.push({ pathname: '/conversation/[id]', params: { id: conversationId } });
      }),
    [engine],
  );
  return null;
}
