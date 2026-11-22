import { describe, expect, it } from 'vitest';
import type { ModerationReport } from '@sampledge/contracts';
import { actionsFor, deliveryLabel } from './moderation';

const person = {
  userId: 'u1',
  handle: 'sam',
  displayName: 'Sam',
  headline: '',
  kind: 'personal' as const,
  organizationName: null,
  avatarColor: '#888',
};
const base: ModerationReport = {
  reportId: 'r1',
  targetType: 'message',
  targetId: 'm1',
  reason: 'spam',
  details: '',
  status: 'open',
  reporter: person,
  subject: person,
  community: { communityId: 'c1', name: 'MRL', slug: 'mrl' },
  snapshot: 'Buy now',
  targetState: 'active',
  alsoReported: 0,
  createdAt: new Date().toISOString(),
  resolution: null,
};

describe('moderation actions', () => {
  it('offers what each moderator may do', () => {
    expect(actionsFor(base, 'community')).toEqual([
      'remove_content',
      'ban_from_community',
      'dismiss',
    ]);
    expect(actionsFor(base, 'platform')).toEqual(['remove_content', 'suspend_user', 'dismiss']);
    expect(actionsFor({ ...base, targetType: 'status' }, 'community')).toEqual(['dismiss']);
    expect(actionsFor({ ...base, targetType: 'community' }, 'platform')).toEqual([
      'suspend_community',
      'dismiss',
    ]);
    expect(actionsFor({ ...base, targetState: 'removed' }, 'platform')).toEqual([
      'suspend_user',
      'dismiss',
    ]);
    expect(
      actionsFor(
        { ...base, resolution: { action: 'dismiss', note: '', by: 'Ops', at: base.createdAt } },
        'platform',
      ),
    ).toEqual([]);
  });

  it('labels invite delivery by channel', () => {
    expect(deliveryLabel({ channel: 'sms', delivery: 'sent' })).toBe('Text sent');
    expect(deliveryLabel({ channel: 'sms', delivery: 'not_configured' })).toBe(
      'Send it from your phone',
    );
    expect(deliveryLabel({ channel: 'email', delivery: 'failed' })).toBe(
      'Email failed: share the link',
    );
    expect(deliveryLabel({ channel: 'link', delivery: null })).toBeNull();
  });
});
