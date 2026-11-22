import { describe, expect, it } from 'vitest';
import {
  NEW_IMAGE,
  applyMatrix,
  colorMatrix,
  coverRect,
  fitWithin,
  parseChatImage,
  pickChatImage,
  type ChatImage,
} from './chatImage';

const img = (p: Partial<ChatImage> = {}): ChatImage => ({
  uri: 'data:image/jpeg;base64,AAAA',
  width: 2000,
  height: 1000,
  ...NEW_IMAGE,
  ...p,
});

describe('own chat background picture', () => {
  it('shrinks to a 2560 px long edge and never enlarges', () => {
    expect(fitWithin(5120, 2880)).toEqual({ width: 2560, height: 1440 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('reads saved values safely and clamps edits to their ranges', () => {
    expect(parseChatImage('nope')).toBeNull();
    expect(parseChatImage(JSON.stringify({ uri: 'https://x/y.jpg' }))).toBeNull();
    const v = parseChatImage(
      JSON.stringify({ ...img(), dim: 2, opacity: 0, zoom: 9, blur: -3, filter: 'weird' }),
    )!;
    expect([v.dim, v.opacity, v.zoom, v.blur, v.filter]).toEqual([0.8, 0.2, 3, 0, 'none']);
  });

  it('a conversation picture wins over the one for all chats', () => {
    const all = img({ dim: 0.1 });
    const mine = img({ dim: 0.7 });
    expect(pickChatImage(all, null)).toBe(all);
    expect(pickChatImage(all, mine)).toBe(mine);
    expect(pickChatImage(null, null)).toBeNull();
  });

  it('crops around the focus point, covering the box, within the edges', () => {
    // 2000x1000 into a 400x800 portrait box: scaled to 1600x800.
    const mid = coverRect(img(), 400, 800);
    expect(mid).toEqual({ left: -600, top: 0, width: 1600, height: 800 });
    expect(coverRect(img({ focusX: 0 }), 400, 800).left).toBe(0);
    expect(coverRect(img({ focusX: 1 }), 400, 800).left).toBe(-1200);
    const zoomed = coverRect(img({ zoom: 2 }), 400, 800);
    expect(zoomed.width).toBe(3200);
    expect(zoomed.top).toBe(-400);
  });

  it('color edits: none is null; mono is grey; brightness and warmth move colors', () => {
    expect(colorMatrix(img())).toBeNull();
    const mono = colorMatrix(img({ filter: 'mono' }))!;
    expect(mono).toHaveLength(20);
    const [r, g, b] = applyMatrix(mono, [1, 0, 0]);
    expect(r).toBeCloseTo(g!);
    expect(g).toBeCloseTo(b!);
    const brighter = applyMatrix(colorMatrix(img({ brightness: 0.5 }))!, [0.4, 0.4, 0.4]);
    expect(brighter[0]).toBeGreaterThan(0.4);
    const warm = applyMatrix(colorMatrix(img({ warmth: 1 }))!, [0.5, 0.5, 0.5]);
    expect(warm[0]).toBeGreaterThan(warm[2]!);
    const lowSat = applyMatrix(colorMatrix(img({ saturation: -1 }))!, [1, 0, 0]);
    expect(lowSat[0]).toBeCloseTo(lowSat[1]!);
    const flat = applyMatrix(colorMatrix(img({ contrast: -1 }))!, [1, 1, 1]);
    expect(flat[0]).toBeLessThan(1);
  });
});
