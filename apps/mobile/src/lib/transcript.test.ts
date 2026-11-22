import type { AiTranscript } from '@sampledge/contracts';
import { describe, expect, it } from 'vitest';
import { mergeTranscriptPatch } from '../db/work';
import {
  changedLines,
  transcriptRequest,
  translationOffers,
  withPendingTranscript,
} from './transcript';

const t: AiTranscript = {
  attachmentId: 'a1',
  conversationId: 'c1',
  messageId: null,
  status: 'done',
  text: 'one two',
  segments: [
    { startMs: 0, endMs: 1, text: 'one' },
    { startMs: 1, endMs: 2, text: 'two' },
  ],
  language: 'en',
  model: null,
  error: null,
  updatedAt: null,
  translations: [
    {
      language: 'hi',
      status: 'done',
      text: 'ek do',
      segments: [
        { startMs: 0, endMs: 1, text: 'ek' },
        { startMs: 1, endMs: 2, text: 'do' },
      ],
      engine: 'model',
      error: null,
      edited: false,
      reviewedBy: null,
      reviewedAt: null,
      updatedAt: '2026-11-20T10:00:00.000Z',
      outdated: false,
    },
  ],
  revision: 1,
  edited: false,
  reviewedBy: null,
  reviewedAt: null,
  canEdit: true,
};

describe('transcript helpers', () => {
  it('lays pending lines over the original and a translation', () => {
    const r = withPendingTranscript(
      t,
      { original: { segments: { 1: 'Two.' } }, translations: { hi: { reviewed: true } } },
      'me',
      '2026-11-21T00:00:00.000Z',
    );
    expect(r.segments[1]!.text).toBe('Two.');
    expect(r.text).toBe('one Two.');
    expect(r.edited).toBe(true);
    expect(r.translations[0]!.reviewedBy).toBe('me');
    expect(r.translations[0]!.edited).toBe(false);
  });

  it('merges waiting corrections per line', () => {
    expect(
      mergeTranscriptPatch(
        { segments: { 0: 'a', 1: 'b' } },
        { segments: { 1: 'c' }, reviewed: false },
      ),
    ).toEqual({ segments: { 0: 'a', 1: 'c' }, reviewed: false });
  });

  it('builds the request and finds changed lines', () => {
    expect(transcriptRequest('hi', 4, { segments: { 2: 'x' }, reviewed: true })).toEqual({
      baseRevision: 4,
      language: 'hi',
      segments: [{ index: 2, text: 'x' }],
      reviewed: true,
    });
    expect(changedLines(t.segments, ['one', ' two  now '])).toEqual({ 1: 'two now' });
    expect(changedLines(t.segments, ['one', 'two'])).toBeNull();
  });

  it('offers languages the transcript does not have yet', () => {
    const codes = translationOffers(t, 'model').map(([c]) => c);
    expect(codes).not.toContain('en');
    expect(codes).not.toContain('hi');
    expect(codes.length).toBeGreaterThan(3);
    expect(translationOffers({ ...t, language: 'hi', translations: [] }, 'english')).toEqual([
      ['en', 'English'],
    ]);
    expect(translationOffers(t, 'none')).toEqual([]);
  });
});
