import { CallCaptionPacketSchema, type CallCaptionPacket } from '@sampledge/contracts';

/** How long each clip is, and how long a caption stays on screen. */
export const CLIP_MS = 4000;
export const SHOW_MS = 9000;
/** Speech detection: level that counts as voice, and how much of a clip must be voiced. */
export const VOICE_RMS = 0.02;
export const MIN_VOICED_MS = 300;
/** Lines on screen at once. */
const MAX_LINES = 4;

export interface CaptionLine {
  id: string;
  name: string;
  text: string;
  at: number;
}

/** A packet from the call's data channel, or null when it is not a caption. */
export function readCaptionPacket(payload: Uint8Array): CallCaptionPacket | null {
  try {
    const parsed = CallCaptionPacketSchema.safeParse(JSON.parse(new TextDecoder().decode(payload)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Adds a line once (the same packet can arrive twice), keeping the last few. */
export function addCaption(lines: CaptionLine[], p: CallCaptionPacket, now: number): CaptionLine[] {
  if (lines.some((l) => l.id === p.id)) return lines;
  return [...lines, { id: p.id, name: p.name, text: p.text, at: now }].slice(-MAX_LINES);
}

/** Lines still young enough to show. */
export function freshCaptions(lines: CaptionLine[], now: number): CaptionLine[] {
  const keep = lines.filter((l) => now - l.at < SHOW_MS);
  return keep.length === lines.length ? lines : keep;
}

/** Whether anyone in the call has asked for captions (participant attribute `captions: "1"`). */
export function anyoneWantsCaptions(attrs: (Record<string, string> | undefined)[]): boolean {
  return attrs.some((a) => a?.captions === '1');
}

/** The notice under the lines. */
export function captionsNotice(s: {
  on: boolean;
  lines: number;
  error: string | null;
  canSend: boolean;
}): string {
  if (s.error) return s.error;
  if (!s.on)
    return 'Someone turned on captions: speech is transcribed by your organization’s server';
  const base = s.lines ? 'Captions on' : 'Captions on · waiting for someone to speak';
  return s.canSend ? base : `${base} · your own speech isn’t captioned from this phone yet`;
}

/** Root mean square level of one buffer of samples (-1..1). */
export function rms(buf: Float32Array): number {
  let sum = 0;
  for (const v of buf) sum += v * v;
  return buf.length ? Math.sqrt(sum / buf.length) : 0;
}
