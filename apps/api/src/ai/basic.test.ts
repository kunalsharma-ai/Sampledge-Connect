import { describe, expect, it } from 'vitest';
import { basicReplies, basicSummarize, cosine, hashEmbed } from './basic.js';
import { extractJson, normalizeBaseUrl } from './model.js';
import { assertSafeModelUrl, settingsFromValues } from './settings.js';

const line = (senderId: string, senderName: string, text: string, i = 0) => ({
  messageId: `m${i}`,
  senderId,
  senderName,
  text,
  at: new Date(2026, 10, 20, 9, i),
});

describe('hashed embeddings', () => {
  it('puts related wording closer than unrelated wording', () => {
    const q = hashEmbed('pricing for the panel quote');
    const near = hashEmbed('The quote for the healthcare panel is priced per complete');
    const far = hashEmbed('The office kitchen gets cleaned on Wednesday');
    expect(cosine(q, near)).toBeGreaterThan(cosine(q, far) + 0.2);
    expect(hashEmbed('')).toHaveLength(512);
  });
});

describe('basic summaries', () => {
  it('finds decisions, action items with owners and due dates, and open questions', () => {
    const r = basicSummarize({
      title: 'Bids',
      members: [
        { userId: 'a', name: 'Aarav Shah' },
        { userId: 'p', name: 'Priya Nair' },
      ],
      lines: [
        line(
          'a',
          'Aarav Shah',
          'We agreed on the premium tier. Priya, please send the deck by Friday.',
          1,
        ),
        line('p', 'Priya Nair', 'I’ll draft it tomorrow.', 2),
        line('a', 'Aarav Shah', 'Do we need the Austria boost?', 3),
      ],
    });
    expect(r.decisions[0]).toMatch(/premium tier/);
    expect(r.actionItems[0]).toMatchObject({ assignee: 'Priya Nair', due: 'by Friday' });
    expect(r.actionItems[1]).toMatchObject({ assignee: 'Priya Nair', due: 'tomorrow' });
    expect(r.openQuestions).toEqual(['Aarav: Do we need the Austria boost?']);
  });
  it('handles an empty range', () => {
    expect(basicSummarize({ title: 'x', members: [], lines: [] }).summary).toMatch(/Nothing/);
  });
  it('suggests replies that fit the last message from someone else', () => {
    expect(basicReplies([line('a', 'A', 'Can you check the quotas?')], 'me')[0]).toMatch(/On it/);
    expect(basicReplies([line('me', 'Me', 'Thanks!')], 'me')).toEqual([]);
  });
});

describe('model server settings', () => {
  it('normalizes OpenAI-compatible base URLs', () => {
    expect(normalizeBaseUrl('http://ollama:11434')).toBe('http://ollama:11434/v1');
    expect(normalizeBaseUrl('http://vllm:8000/v1/')).toBe('http://vllm:8000/v1');
    expect(() => normalizeBaseUrl('file:///etc/passwd')).toThrow();
  });
  it('refuses metadata and link-local hosts but allows private model servers', () => {
    expect(() => assertSafeModelUrl('http://169.254.169.254/latest')).toThrow();
    expect(() => assertSafeModelUrl('http://metadata.google.internal')).toThrow();
    expect(() => assertSafeModelUrl('http://10.0.0.5:11434')).not.toThrow();
    expect(
      settingsFromValues({ baseUrl: 'http://ollama:11434', chatModel: 'llama3.1' }),
    ).toMatchObject({
      apiKey: null,
      embeddingModel: null,
      timeoutMs: 30_000,
    });
    expect(settingsFromValues({ baseUrl: '', chatModel: 'x' })).toBeNull();
  });
  it('extracts JSON from chatty model replies', () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => extractJson('no json')).toThrow();
  });
});

describe('dueHint', () => {
  it('prefers the deadline phrase over an earlier "today"', async () => {
    const { dueHint } = await import('./basic.js');
    expect(dueHint('I’ll chase the client today and send the grid by Thursday.')).toBe(
      'by Thursday',
    );
    expect(dueHint('Can you do it today?')).toBe('today');
    expect(dueHint('No date here.')).toBeNull();
  });
});
