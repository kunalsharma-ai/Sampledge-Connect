import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

/** EAS project id from app config; Expo push tokens cannot be issued without it. */
export function easProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? null;
}

export async function pushPermission(): Promise<PushPermission> {
  const { status } = await Notifications.getPermissionsAsync();
  return status as PushPermission;
}

/** Asks the OS for permission to show notifications. Nothing is registered with a server. */
export async function requestPushPermission(): Promise<PushPermission> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status as PushPermission;
}

/** Expo push token for this install, or null when this build cannot get one. */
export async function expoPushToken(): Promise<string | null> {
  const projectId = easProjectId();
  if (!projectId || (await pushPermission()) !== 'granted') return null;
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

/**
 * Pushes that arrive while the app is open are not shown by the OS (the in-app banner covers
 * them). Calls back with the push data when the person taps a notification.
 */
export function onPushOpened(cb: (data: Record<string, unknown>) => void): () => void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
  });
  const last = Notifications.getLastNotificationResponse();
  if (last) cb(last.notification.request.content.data ?? {});
  const sub = Notifications.addNotificationResponseReceivedListener((r) =>
    cb(r.notification.request.content.data ?? {}),
  );
  return () => sub.remove();
}
