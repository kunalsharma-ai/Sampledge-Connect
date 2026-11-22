import { describe, expect, it } from 'vitest';
import { buildSearch, dropOperator, findPerson, highlightParts } from './search';

const people = [
  { userId: 'u1', displayName: 'Sam Okafor', email: 'sam@northwind.test' },
  { userId: 'u2', displayName: 'Priya Shah', email: 'priya@northwind.test' },
  { userId: 'u3', displayName: 'Priyanka Rao', email: 'pr@northwind.test' },
];
const places = [
  { conversationId: 'c1', kind: 'channel_public', name: 'fieldwork-ops', memberIds: ['u1', 'u2'] },
  { conversationId: 'c2', kind: 'dm', name: null, memberIds: ['u1', 'u2'] },
];
const ctx = {
  people,
  places,
  selfId: 'u1',
  placeTitle: (c: { name: string | null }) => (c.name ? `# ${c.name}` : 'Priya Shah'),
};

describe('search box', () => {
  it('resolves operators into filters for the server and the phone', () => {
    const b = buildSearch(
      'quota from:@priya in:#fieldwork has:file after:2026-10-01 "wave 3"',
      ctx,
    );
    expect(b.problem).toBeNull();
    expect(b.params).toMatchObject({ q: 'quota "wave 3"', from: 'u2', in: 'c1', hasFile: true });
    expect(b.local.terms).toEqual(['quota', 'wave 3']);
    expect(b.local.from).toBe('u2');
    expect(new Date(b.params.after!).getDate()).toBe(1);
    expect(b.filters.map((f) => f.label)).toEqual([
      'From Priya Shah',
      'In # fieldwork-ops',
      'Has a file',
      'After 2026-10-01',
    ]);
  });

  it('finds people by first name, full name, email or "me", and DMs by name', () => {
    expect(findPerson('priya', people, 'u1')?.userId).toBe('u2');
    expect(findPerson('Priyanka Rao', people, 'u1')?.userId).toBe('u3');
    expect(findPerson('me', people, 'u1')?.userId).toBe('u1');
    expect(buildSearch('in:priya', ctx).params.in).toBe('c2');
    expect(buildSearch('from:me', ctx).filters[0]?.label).toBe('From you');
  });

  it('says what it could not understand, and is empty without words or filters', () => {
    expect(buildSearch('from:nobody hello', ctx).problem).toMatch(/No one called “nobody”/);
    expect(buildSearch('in:#nowhere', ctx).problem).toMatch(/No channel or chat/);
    expect(buildSearch('   ', ctx).empty).toBe(true);
    expect(buildSearch('has:file', ctx).empty).toBe(false);
  });

  it('narrows to the chosen tab', () => {
    expect(buildSearch('quota', { ...ctx, type: 'files' }).params.types).toEqual(['files']);
  });

  it('closing a chip removes its operator', () => {
    expect(dropOperator('quota from:@priya has:file', 'from')).toBe('quota has:file');
    expect(dropOperator('quota from:@priya has:file', 'hasFile')).toBe('quota from:@priya');
    expect(dropOperator('in:"field ops" x', 'in')).toBe('x');
  });

  it('splits text for highlighting', () => {
    expect(highlightParts('Wave 3 quota by region', [[7, 12]])).toEqual([
      { text: 'Wave 3 ', hit: false },
      { text: 'quota', hit: true },
      { text: ' by region', hit: false },
    ]);
    expect(highlightParts('abc', [])).toEqual([{ text: 'abc', hit: false }]);
  });
});
