import { describe, expect, it } from 'vitest';
import { conversationCan, tenantCan } from './permissions.js';

describe('tenant permissions', () => {
  it('only owners manage the tenant', () => {
    expect(tenantCan('owner', 'tenant.manage')).toBe(true);
    expect(tenantCan('admin', 'tenant.manage')).toBe(false);
  });
  it('guests cannot browse the directory or create channels', () => {
    expect(tenantCan('guest', 'directory.read')).toBe(false);
    expect(tenantCan('guest', 'channel.public.create')).toBe(false);
    expect(tenantCan('member', 'channel.public.create')).toBe(true);
  });
});

describe('conversation permissions', () => {
  const base = { tenantRole: 'member' as const, archived: false, isPublicChannel: false };
  it('non-members cannot read private conversations, even tenant admins', () => {
    expect(conversationCan({ ...base, conversationRole: null }, 'conversation.read')).toBe(false);
    expect(
      conversationCan(
        { ...base, tenantRole: 'admin', conversationRole: null },
        'conversation.read',
      ),
    ).toBe(false);
  });
  it('public channels are readable by members but not guests', () => {
    const pub = { ...base, isPublicChannel: true, conversationRole: null };
    expect(conversationCan(pub, 'conversation.read')).toBe(true);
    expect(conversationCan({ ...pub, tenantRole: 'guest' }, 'conversation.read')).toBe(false);
    expect(conversationCan(pub, 'message.send')).toBe(false);
  });
  it('members cannot moderate; moderators can', () => {
    expect(conversationCan({ ...base, conversationRole: 'member' }, 'message.delete.any')).toBe(
      false,
    );
    expect(conversationCan({ ...base, conversationRole: 'moderator' }, 'message.delete.any')).toBe(
      true,
    );
  });
  it('archived conversations are read-only', () => {
    const a = { ...base, archived: true, conversationRole: 'owner' as const };
    expect(conversationCan(a, 'conversation.read')).toBe(true);
    expect(conversationCan(a, 'message.send')).toBe(false);
  });
});
