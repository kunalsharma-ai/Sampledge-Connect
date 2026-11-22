import { describe, expect, it } from 'vitest';
import { defaultOutput, outputIcon, outputLabel } from './audioRoute';

const outs = (...ids: string[]) => ids.map((id) => ({ id, label: outputLabel(id) }));

describe('audio route', () => {
  it('names the routes phones report', () => {
    expect(outs('speaker', 'earpiece', 'headset', 'bluetooth').map((o) => o.label)).toEqual([
      'Speaker',
      'Phone',
      'Headset',
      'Bluetooth',
    ]);
    expect(outputLabel('force_speaker')).toBe('Speaker');
    expect(outputIcon('bluetooth')).toBe('bluetooth');
  });

  it('starts video on the speaker and voice on the earpiece; a headset wins', () => {
    expect(defaultOutput(outs('speaker', 'earpiece'), true)).toBe('speaker');
    expect(defaultOutput(outs('speaker', 'earpiece'), false)).toBe('earpiece');
    expect(defaultOutput(outs('default', 'force_speaker'), false)).toBe('default');
    expect(defaultOutput(outs('speaker', 'earpiece', 'bluetooth'), true)).toBe('bluetooth');
    expect(defaultOutput(outs('speaker', 'headset'), false)).toBe('headset');
    expect(defaultOutput([], true)).toBeNull();
  });
});
