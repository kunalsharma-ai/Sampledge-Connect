import { describe, expect, it } from 'vitest';
import { DEFAULT_CALL_APPEARANCE, isNeutralAppearance } from '@sampledge/contracts';
import { faceWarps, lookParams, type Point } from './camera-look';

describe('camera looks', () => {
  it('adds the filter to the sliders and keeps the numbers in range', () => {
    const p = lookParams({ ...DEFAULT_CALL_APPEARANCE, filter: 'noir', contrast: 100 });
    expect(p.grayscale).toBe(1);
    expect(p.contrast).toBe(1);
    expect(p.vignette).toBeGreaterThan(0);
    expect(lookParams(DEFAULT_CALL_APPEARANCE)).toMatchObject({ brightness: 0, grayscale: 0 });
    expect(isNeutralAppearance(DEFAULT_CALL_APPEARANCE)).toBe(true);
    expect(isNeutralAppearance({ ...DEFAULT_CALL_APPEARANCE, filter: 'mono' })).toBe(false);
  });

  it('turns face points into gentle warps toward the middle of the face', () => {
    const lm = new Map<number, Point>();
    const set = (i: number, x: number, y: number) => lm.set(i, { x, y });
    set(234, 0.35, 0.45);
    set(454, 0.65, 0.45);
    set(1, 0.5, 0.5);
    set(4, 0.5, 0.48);
    for (const [i, x] of [
      [132, 0.37],
      [58, 0.39],
      [172, 0.41],
      [361, 0.63],
      [288, 0.61],
      [397, 0.59],
    ])
      set(i!, x!, 0.6);
    set(33, 0.4, 0.4);
    set(133, 0.46, 0.4);
    set(362, 0.54, 0.4);
    set(263, 0.6, 0.4);
    set(64, 0.47, 0.52);
    set(294, 0.53, 0.52);
    const none = faceWarps(lm, 1280, 720, { faceSlim: 0, eyes: 0, nose: 0 })!;
    expect(none.shifts).toHaveLength(0);
    const w = faceWarps(lm, 1280, 720, { faceSlim: 100, eyes: 50, nose: 50 })!;
    expect(w.radii).toHaveLength(8);
    expect(w.shifts).toHaveLength(32);
    // Left jaw moves right, right jaw moves left, by a few percent of the face width.
    expect(w.shifts[2]).toBeGreaterThan(0);
    expect(w.shifts[14]).toBeLessThan(0);
    expect(Math.abs(w.shifts[2]!)).toBeLessThan(384 * 0.06);
    // No move is big enough for the picture to fold (gradient of the falloff stays below 1).
    for (let i = 0; i < w.radii.length; i++)
      expect(Math.hypot(w.shifts[i * 4 + 2]!, w.shifts[i * 4 + 3]!) * 1.54).toBeLessThan(
        w.radii[i]!,
      );
    expect(w.eyes).toHaveLength(6);
    expect(w.eyeScale).toBeCloseTo(0.07);
    // The left side of the nose moves right.
    expect(w.shifts[26]).toBeGreaterThan(0);
    expect(faceWarps(new Map(), 1280, 720, { faceSlim: 50, eyes: 0, nose: 0 })).toBeNull();
  });
});
