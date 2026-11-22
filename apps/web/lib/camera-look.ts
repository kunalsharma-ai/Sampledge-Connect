import type { CallAppearance } from '@sampledge/contracts';

// The look numbers are shared with the phone apps (their camera runs the same math natively).
export { lookParams, type LookParams } from '@sampledge/contracts';

export interface Point {
  x: number;
  y: number;
}

/** At most this many points are moved (jaw and nose sides). */
export const MAX_SHIFTS = 8;

/** Face shaping as small local warps, in pixels of the frame. */
export interface FaceWarps {
  /**
   * Points whose surroundings move: [cx, cy, dx, dy] each, with a radius each. Nearby moves are
   * averaged, never stacked, so the picture can't fold over itself.
   */
  shifts: number[];
  radii: number[];
  /** Eye centres and radius: [cx, cy, r] each, magnified by eyeScale. */
  eyes: number[];
  eyeScale: number;
}

// MediaPipe face mesh landmark numbers.
const CHEEK_LEFT = 234;
const CHEEK_RIGHT = 454;
const NOSE_TIP = 1;
const NOSE_MID = 4;
const JAW = [132, 58, 172, 361, 288, 397];
const EYE_LEFT = [33, 133];
const EYE_RIGHT = [362, 263];
const NOSE_SIDES = [64, 294];
/** Every landmark the warps read (smoothed between frames). */
export const FACE_POINTS = [
  CHEEK_LEFT,
  CHEEK_RIGHT,
  NOSE_TIP,
  NOSE_MID,
  ...JAW,
  ...EYE_LEFT,
  ...EYE_RIGHT,
  ...NOSE_SIDES,
];

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Turns face landmarks (normalized 0..1, keyed by landmark number) into warps for a w x h frame.
 * Strengths are kept subtle on purpose: at 100 the face is clearly slimmer but still natural.
 */
export function faceWarps(
  lm: Map<number, Point>,
  w: number,
  h: number,
  a: Pick<CallAppearance, 'faceSlim' | 'eyes' | 'nose'>,
): FaceWarps | null {
  const px = (i: number): Point | null => {
    const p = lm.get(i);
    return p ? { x: p.x * w, y: p.y * h } : null;
  };
  const l = px(CHEEK_LEFT);
  const r = px(CHEEK_RIGHT);
  const tip = px(NOSE_TIP);
  if (!l || !r || !tip) return null;
  const width = dist(l, r);
  if (width < 20) return null;

  const shifts: number[] = [];
  const radii: number[] = [];
  const s = a.faceSlim / 100;
  if (s > 0)
    for (const i of JAW) {
      const p = px(i);
      if (!p) continue;
      const dx = tip.x - p.x;
      const dy = (tip.y - p.y) * 0.3;
      const len = Math.hypot(dx, dy) || 1;
      const m = width * 0.04 * s;
      shifts.push(p.x, p.y, (dx / len) * m, (dy / len) * m);
      radii.push(width * 0.28);
    }

  const mid = px(NOSE_MID);
  const sides = NOSE_SIDES.map(px);
  if (a.nose > 0 && mid && sides[0] && sides[1]) {
    const r = dist(sides[0], sides[1]) * 0.6;
    for (const p of sides as Point[]) {
      shifts.push(p.x, p.y, (mid.x - p.x) * 0.18 * (a.nose / 100), 0);
      radii.push(r);
    }
  }

  const eyes: number[] = [];
  if (a.eyes > 0)
    for (const [i, j] of [EYE_LEFT, EYE_RIGHT] as const) {
      const p = px(i!);
      const q = px(j!);
      if (!p || !q) continue;
      eyes.push((p.x + q.x) / 2, (p.y + q.y) / 2, dist(p, q) * 1.1);
    }

  return { shifts, radii, eyes, eyeScale: (a.eyes / 100) * 0.14 };
}
