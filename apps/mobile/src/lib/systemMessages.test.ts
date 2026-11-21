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
  it('falls back to the server text', () => {
    expect(systemText('Priya renamed the channel', {})).toBe('Priya renamed the channel');
    expect(systemText('', {})).toBe('Conversation updated');
  });
  it('formats durations', () => {
    expect(formatDuration(12)).toBe('12 sec');
    expect(formatDuration(3720)).toBe('1 h 2 min');
  });
});
