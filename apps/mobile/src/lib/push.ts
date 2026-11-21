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
