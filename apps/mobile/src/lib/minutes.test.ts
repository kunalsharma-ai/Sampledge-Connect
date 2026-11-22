import { describe, expect, it } from 'vitest';
import {
  cleanActionItems,
  cleanLines,
  exportRange,
  newActionItem,
  ownerLabel,
  sourcesLine,
} from './minutes';

describe('minutes helpers', () => {
  it('describes where the minutes came from', () => {
    expect(
      sourcesLine({
        transcripts: 2,
        reviewedTranscripts: 1,
        captionLines: 0,
        chatMessages: 14,
        spokenLanguages: ['en', 'hi'],
      }),
    ).toBe('From 2 recording transcripts (1 checked), 14 chat messages. Heard: English, Hindi.');
    expect(
      sourcesLine({
        transcripts: 0,
        reviewedTranscripts: 0,
        captionLines: 0,
        chatMessages: 0,
        spokenLanguages: [],
      }),
    ).toBe('Nothing was recorded or written in the call.');
  });

  it('cleans lists and action items the way the server accepts them', () => {
    expect(cleanLines([' a ', '', '  ', 'b'])).toEqual(['a', 'b']);
    const items = cleanActionItems([
      { ...newActionItem(' Send deck '), ownerName: '  ', due: ' Friday ' },
      newActionItem('   '),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      text: 'Send deck',
      ownerName: null,
      due: 'Friday',
      done: false,
    });
    expect(ownerLabel({ ownerId: 'u1', ownerName: null }, () => 'Lena')).toBe('Lena');
    expect(ownerLabel({ ownerId: null, ownerName: 'Client' }, () => undefined)).toBe('Client');
  });

  it('turns export ranges into dates', () => {
    const now = new Date('2026-11-22T00:00:00.000Z');
    expect(exportRange('all', now)).toEqual({});
    expect(exportRange('7d', now)).toEqual({
      from: '2026-11-15T00:00:00.000Z',
      to: '2026-11-22T00:00:00.000Z',
    });
  });
});
