import type { UpdateProfileRequest } from '@sampledge/contracts';

export interface ProfileForm {
  displayName: string;
  title: string;
  department: string;
  phone: string;
  bio: string;
  timeZone: string;
}

/** Only the fields you changed, trimmed; an emptied field is sent as "" (which clears it). */
export function profileChanges(before: ProfileForm, after: ProfileForm): UpdateProfileRequest {
  const out: UpdateProfileRequest = {};
  for (const k of Object.keys(after) as (keyof ProfileForm)[]) {
    const v = after[k].trim();
    if (v !== before[k].trim()) out[k] = v;
  }
  return out;
}

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The server's rules (contracts UpdateProfileRequestSchema), checked before anything is queued. */
export function profileProblem(f: ProfileForm): string | null {
  if (!f.displayName.trim()) return 'Your name cannot be empty.';
  if (f.displayName.trim().length > 80) return 'Use at most 80 characters for your name.';
  if (!/^[+()\d\s.-]*$/.test(f.phone.trim()))
    return 'Use digits, spaces and + ( ) - . only in the phone number.';
  if (f.timeZone.trim() && !isTimeZone(f.timeZone.trim()))
    return `"${f.timeZone.trim()}" is not a time zone. Try a name like Asia/Kolkata or Europe/London.`;
  return null;
}

/** The centred square of a picture, for a profile photo. */
export function squareCrop(width: number, height: number) {
  const side = Math.min(width, height);
  return {
    originX: Math.floor((width - side) / 2),
    originY: Math.floor((height - side) / 2),
    width: side,
    height: side,
  };
}

/** Bytes a base64 string decodes to. */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}
