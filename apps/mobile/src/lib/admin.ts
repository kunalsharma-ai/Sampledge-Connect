import type { AuditEntry, TenantRole } from '@sampledge/contracts';

export const ROLE_LABEL: Record<TenantRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  guest: 'Guest',
};

/** "Sam Okafor changed a member: Lena Fischer" style line for an audit entry. */
export function auditLine(e: AuditEntry): string {
  const who = e.actor?.name ?? 'Someone';
  const target = e.target?.name ? `: ${e.target.name}` : '';
  return `${who} · ${e.label}${target}`;
}

/** What changed on a member, from the audit metadata of member.updated. */
export function memberChange(meta: Record<string, unknown>): string | null {
  const parts: string[] = [];
  if (typeof meta.role === 'string') parts.push(`role → ${meta.role}`);
  if (meta.status === 'deactivated') parts.push('deactivated');
  if (meta.status === 'active') parts.push('reactivated');
  return parts.length ? parts.join(', ') : null;
}

/** Share of active people with two-step verification on, as a whole percent. */
export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** At least 12 characters, matching the server's password rule for a temporary password. */
export function temporaryPasswordProblem(pw: string): string | null {
  if (pw.length < 12) return 'Use at least 12 characters.';
  return null;
}

/** "1 owner, 2 admins, 5 members, no guests" from counts by role. */
export function roleSummary(byRole: Record<TenantRole, number>): string {
  const n = (count: number, word: string) =>
    count === 0 ? `no ${word}s` : `${count} ${word}${count === 1 ? '' : 's'}`;
  return [
    n(byRole.owner, 'owner'),
    n(byRole.admin, 'admin'),
    n(byRole.member, 'member'),
    n(byRole.guest, 'guest'),
  ].join(', ');
}
