import { describe, expect, it } from 'vitest';
import type { AuditEntry } from '@sampledge/contracts';
import { auditLine, memberChange, percent, roleSummary, temporaryPasswordProblem } from './admin';

describe('admin helpers', () => {
  it('describes an audit entry', () => {
    const e = {
      actor: { name: 'Priya Shah' },
      label: 'Changed a member',
      target: { name: 'Lena Fischer' },
    } as unknown as AuditEntry;
    expect(auditLine(e)).toBe('Priya Shah · Changed a member: Lena Fischer');
    expect(auditLine({ ...e, actor: null, target: null } as unknown as AuditEntry)).toBe(
      'Someone · Changed a member',
    );
  });

  it('says what changed on a member', () => {
    expect(memberChange({ role: 'admin' })).toBe('role → admin');
    expect(memberChange({ status: 'deactivated' })).toBe('deactivated');
    expect(memberChange({ role: 'guest', status: 'active' })).toBe('role → guest, reactivated');
    expect(memberChange({})).toBeNull();
  });

  it('counts and checks', () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(0, 0)).toBe(0);
    expect(roleSummary({ owner: 1, admin: 2, member: 5, guest: 0 })).toBe(
      '1 owner, 2 admins, 5 members, no guests',
    );
    expect(temporaryPasswordProblem('short')).toMatch(/12/);
    expect(temporaryPasswordProblem('long-enough-password')).toBeNull();
  });
});
