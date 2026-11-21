export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

/** The web preview has no push; these report it as unsupported. */
export function easProjectId(): string | null {
  return null;
}

export async function pushPermission(): Promise<PushPermission> {
  return 'unsupported';
}

export async function requestPushPermission(): Promise<PushPermission> {
  return 'unsupported';
}
