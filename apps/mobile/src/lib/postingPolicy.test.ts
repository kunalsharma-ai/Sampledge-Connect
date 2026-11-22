import { describe, expect, it } from 'vitest';
import type { LocalConversation } from '../db/store';
import { canPostIn, canSetPostingPolicy } from './access';

const conv = (over: Partial<LocalConversation> = {}): LocalConversation => ({
  conversationId: 'c1',
  kind: 'channel_public',
  name: 'news',
  topic: null,
  memberIds: [],
  archivedAt: null,
  myRole: 'member',
  lastChangeSeq: 0,
  cursor: 0,
  lastMessageAt: null,
  lastPreview: null,
  unread: 0,
  pending: 0,
  notifyLevel: 'all',
  notifyLevelPending: false,
  postingPolicy: 'everyone',
  allowForwarding: true,
  ...over,
});

describe('announcement channels', () => {
  it('lets only moderators, owners and workspace admins post when moderators-only', () => {
    const news = conv({ postingPolicy: 'moderators' });
    expect(canPostIn(conv(), 'member')).toBe(true);
    expect(canPostIn(news, 'member')).toBe(false);
    expect(canPostIn({ ...news, myRole: 'moderator' }, 'member')).toBe(true);
    expect(canPostIn({ ...news, myRole: 'owner' }, 'member')).toBe(true);
    expect(canPostIn(news, 'admin')).toBe(true);
    expect(canPostIn({ ...news, archivedAt: '2026-01-01T00:00:00.000Z' }, 'admin')).toBe(false);
  });

  it('offers the switch on channels to those who can rename them', () => {
    expect(canSetPostingPolicy(conv({ myRole: 'owner' }), 'member')).toBe(true);
    expect(canSetPostingPolicy(conv(), 'member')).toBe(false);
    expect(canSetPostingPolicy(conv({ kind: 'group', myRole: 'owner' }), 'member')).toBe(false);
  });
});
