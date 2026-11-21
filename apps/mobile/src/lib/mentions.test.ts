import { describe, expect, it } from 'vitest';
import {
  activeMentionQuery,
  filterCandidates,
  insertMention,
  mentionsInText,
  segmentMentions,
} from './mentions';

const people = [
  { userId: 'u1', name: 'Priya Shah' },
  { userId: 'u2', name: 'Marco Silva' },
  { userId: 'u3', name: 'Priya' },
];

describe('mentions', () => {
  it('finds the query being typed', () => {
    expect(activeMentionQuery('hi @pri')).toBe('pri');
    expect(activeMentionQuery('@')).toBe('');
    expect(activeMentionQuery('mail me@x')).toBeNull();
    expect(activeMentionQuery('@priya done')).toBeNull();
  });

  it('inserts the picked name and filters by any word', () => {
    expect(insertMention('thanks @ma', 'Marco Silva')).toBe('thanks @Marco Silva ');
    expect(filterCandidates('sil', people).map((p) => p.userId)).toEqual(['u2']);
  });

  it('segments the longest matching name first', () => {
    expect(segmentMentions('ask @Priya Shah and @Priya, ok', people)).toEqual([
      { text: 'ask ' },
      { text: '@Priya Shah', userId: 'u1' },
      { text: ' and ' },
      { text: '@Priya', userId: 'u3' },
      { text: ', ok' },
    ]);
  });

  it('drops mentions whose name was deleted from the text', () => {
    expect(mentionsInText('hello @Marco Silva', people)).toEqual(['u2']);
    expect(mentionsInText('hello Marco', people)).toEqual([]);
  });
});
