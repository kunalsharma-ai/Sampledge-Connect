import { describe, expect, it } from 'vitest';
import { matchRanges, parseSearchOperators, searchTerms, snippetAround } from './search.js';

describe('search helpers', () => {
  it('splits terms and keeps quoted phrases', () => {
    expect(searchTerms('Budget "Q4 quota" budget')).toEqual(['budget', 'q4 quota']);
  });

  it('merges overlapping match ranges', () => {
    expect(matchRanges('Budget budgets', ['budget', 'dget'])).toEqual([
      [0, 6],
      [7, 13],
    ]);
  });

  it('cuts a snippet around the first match and re-bases ranges', () => {
    const text = `${'x '.repeat(200)}the quota is 400 ${'y '.repeat(200)}`;
    const { snippet, matches } = snippetAround(text, ['quota'], 80);
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    const [a, b] = matches[0]!;
    expect(snippet.slice(a, b)).toBe('quota');
  });

  it('parses operators and leaves the rest as text', () => {
    expect(
      parseSearchOperators('quota from:@ravi in:#fieldwork-uk has:file after:2026-10-01 foo:bar'),
    ).toEqual({
      text: 'quota foo:bar',
      from: 'ravi',
      in: 'fieldwork-uk',
      hasFile: true,
      before: null,
      after: '2026-10-01',
    });
    expect(parseSearchOperators('from:"Ravi Kumar" sheet').from).toBe('Ravi Kumar');
  });
});
