import { describe, expect, it } from 'vitest';
import { formatDuration, systemText } from './systemMessages';

describe('system messages', () => {
  it('describes call events', () => {
    expect(systemText('', { call: { media: 'video', status: 'started' } })).toBe(
      'Video call started',
    );
    expect(systemText('', { call: { media: 'audio', status: 'ended', durationSec: 754 } })).toBe(
      'Voice call ended · 13 min',
    );
    expect(systemText('', { call: { media: 'audio', status: 'missed' } })).toBe(
      'Missed voice call',
    );
  });
  it('describes call recordings', () => {
    const base = { callId: 'c1', startedBy: 'u1', startedAt: '2026-11-21T10:00:00.000Z' };
    expect(
      systemText('', {
        recording: { ...base, attachmentId: 'a1', durationMs: 754_000, audioOnly: false },
      }),
    ).toBe('Call recording · 12:34');
    expect(
      systemText('', {
        recording: { ...base, attachmentId: 'a1', durationMs: 65_000, audioOnly: true },
      }),
    ).toBe('Call recording (audio) · 1:05');
    expect(
      systemText('', { recording: { ...base, attachmentId: null, durationMs: 0, failed: true } }),
    ).toBe('Call recording failed. No file was saved');
  });
  it('falls back to the server text', () => {
    expect(systemText('Priya renamed the channel', {})).toBe('Priya renamed the channel');
    expect(systemText('', {})).toBe('Conversation updated');
  });
  it('formats durations', () => {
    expect(formatDuration(12)).toBe('12 sec');
    expect(formatDuration(3720)).toBe('1 h 2 min');
  });
});
