import { describe, expect, it } from 'vitest';
import { defaultTargetLanguage, riskSentence, summaryAsMessage } from './ai';

describe('ai helpers', () => {
  it('explains why a draft is sensitive', () => {
    expect(riskSentence({ level: 'normal', categories: [] })).toBeNull();
    expect(riskSentence({ level: 'sensitive', categories: ['financial', 'client_facing'] })).toBe(
      'This mentions money or pricing and people outside the organization. Check it before it goes out.',
    );
  });

  it('picks a translate target from the device locale', () => {
    expect(defaultTargetLanguage('de-DE')).toBe('de');
    expect(defaultTargetLanguage('pt-PT')).toBe('pt-BR');
    expect(defaultTargetLanguage('sw')).toBe('en');
    expect(defaultTargetLanguage(undefined)).toBe('en');
  });

  it('formats a summary to share', () => {
    expect(
      summaryAsMessage({
        summary: 'Wave 3 launches Monday.',
        decisions: ['Boost incentive to $5'],
        actionItems: [{ text: 'Lena to recheck quotas' }],
        openQuestions: [],
      }),
    ).toBe(
      'Summary: Wave 3 launches Monday.\n\nDecisions:\n• Boost incentive to $5\n\nAction items:\n• Lena to recheck quotas',
    );
  });
});
