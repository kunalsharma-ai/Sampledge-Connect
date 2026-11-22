import { describe, expect, it } from 'vitest';
import {
  ChatBackgroundAdjustSchema,
  chatBackgroundColorMatrix,
  isNeutralChatBackground,
} from './chat-themes.js';

const apply = (m: number[], [r, g, b]: [number, number, number]) =>
  [0, 1, 2].map((i) => m[i * 5]! * r + m[i * 5 + 1]! * g + m[i * 5 + 2]! * b + m[i * 5 + 4]!);
const base = ChatBackgroundAdjustSchema.parse({});

describe('chat background colour matrix', () => {
  it('is the identity with no edits', () => {
    expect(isNeutralChatBackground(base)).toBe(true);
    expect(chatBackgroundColorMatrix(base)).toEqual([
      1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0,
    ]);
  });
  it('mono makes grey, warmth warms, brightness lifts', () => {
    const [r, g, b] = apply(chatBackgroundColorMatrix({ ...base, filter: 'mono' }), [1, 0, 0]);
    expect(r).toBeCloseTo(g!);
    expect(g).toBeCloseTo(b!);
    const [wr, , wb] = apply(chatBackgroundColorMatrix({ ...base, warmth: 1 }), [0.5, 0.5, 0.5]);
    expect(wr! - wb!).toBeGreaterThan(0.1);
    const [br] = apply(chatBackgroundColorMatrix({ ...base, brightness: 0.5 }), [0.2, 0.2, 0.2]);
    expect(br).toBeGreaterThan(0.3);
  });
  it('keeps alpha untouched for every filter', () => {
    for (const filter of ['none', 'mono', 'sepia', 'vivid', 'fade', 'noir', 'cool'] as const) {
      expect(chatBackgroundColorMatrix({ ...base, filter }).slice(15)).toEqual([0, 0, 0, 1, 0]);
    }
  });
});
