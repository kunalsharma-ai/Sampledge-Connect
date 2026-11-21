import { describe, expect, it } from 'vitest';
import { checkGuestEmail, guestLabel } from './guests';

const directory = [{ email: 'priya@northwind.test', displayName: 'Priya Shah' }];

describe('guest emails', () => {
  it('normalises a valid address', () => {
    expect(checkGuestEmail('  Ana.Ruiz@Client.COM ', { taken: [], directory })).toEqual({
      email: 'ana.ruiz@client.com',
    });
  });
  it('refuses typos, people in the organization and duplicates', () => {
    expect(checkGuestEmail('ana@', { taken: [], directory })).toHaveProperty('error');
    expect(checkGuestEmail('PRIYA@northwind.test', { taken: [], directory })).toEqual({
      error: 'Priya Shah is in your organization. Add them under People.',
    });
    expect(checkGuestEmail('ana@client.com', { taken: ['ana@client.com'], directory })).toEqual({
      error: 'ana@client.com is already invited.',
    });
  });
  it('labels guests in calls', () => {
    expect(guestLabel('Ana Ruiz')).toBe('Ana Ruiz (guest)');
  });
});

describe('guest messages', () => {
  it('names the guest who wrote in a meeting chat', async () => {
    const { guestSenderLabel } = await import('./guests');
    expect(guestSenderLabel({ guest: { guestId: 'g1', name: 'Anna Schmidt' } })).toBe(
      'Anna Schmidt (guest)',
    );
    expect(guestSenderLabel({})).toBeNull();
  });
});
