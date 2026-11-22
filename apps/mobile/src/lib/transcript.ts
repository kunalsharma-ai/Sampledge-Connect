import {
  TRANSCRIPT_LANGUAGES,
  type AiStatus,
  type AiTranscript,
  type TranscriptSegment,
  type UpdateTranscriptRequest,
} from '@sampledge/contracts';
import type { TranscriptPatch } from '../db/work';

export type TranscriptionSettings = AiStatus['transcription'];

export const transcriptBusy = (s: string | undefined) => s === 'queued' || s === 'processing';

/** True while the transcript or one of its translations is still being made. */
export const transcriptPending = (t: AiTranscript | null) =>
  !!t && (transcriptBusy(t.status) || t.translations.some((x) => transcriptBusy(x.status)));

const applyLines = (segments: TranscriptSegment[], lines: Record<number, string> | undefined) =>
  lines
    ? segments.map((s, i) => (lines[i] !== undefined ? { ...s, text: lines[i]! } : s))
    : segments;

const reviewedFields = (reviewed: boolean | undefined, selfId: string, at: string) =>
  reviewed === undefined
    ? {}
    : reviewed
      ? { reviewedBy: selfId, reviewedAt: at }
      : { reviewedBy: null, reviewedAt: null };

/**
 * The transcript as this phone last saw it with corrections not sent yet laid over it, so a
 * correction shows at once, on or offline.
 */
export function withPendingTranscript(
  t: AiTranscript,
  pending: { original?: TranscriptPatch; translations: Record<string, TranscriptPatch> },
  selfId: string,
  now: string,
): AiTranscript {
  const o = pending.original;
  const lines = (p: TranscriptPatch | undefined) => !!p && (!!p.segments || p.text !== undefined);
  const segments = applyLines(t.segments, o?.segments);
  return {
    ...t,
    segments,
    text:
      o?.text !== undefined && !t.segments.length
        ? o.text
        : o?.segments
          ? segments.map((s) => s.text).join(' ')
          : t.text,
    edited: t.edited || lines(o),
    ...reviewedFields(o?.reviewed, selfId, now),
    translations: t.translations.map((x) => {
      const p = pending.translations[x.language];
      if (!p) return x;
      const segs = applyLines(x.segments, p.segments);
      return {
        ...x,
        segments: segs,
        text:
          p.text !== undefined && !x.segments.length
            ? p.text
            : p.segments
              ? segs.map((s) => s.text).join(' ')
              : x.text,
        edited: x.edited || lines(p),
        ...reviewedFields(p.reviewed, selfId, now),
      };
    }),
  };
}

/** The PATCH body for a queued correction. */
export function transcriptRequest(
  language: string | null,
  baseRevision: number,
  p: TranscriptPatch,
): UpdateTranscriptRequest {
  return {
    baseRevision,
    ...(language ? { language } : {}),
    ...(p.segments
      ? {
          segments: Object.entries(p.segments).map(([index, text]) => ({
            index: Number(index),
            text,
          })),
        }
      : {}),
    ...(p.text !== undefined ? { text: p.text } : {}),
    ...(p.reviewed !== undefined ? { reviewed: p.reviewed } : {}),
  };
}

/** Lines of a draft that differ from what is shown. */
export function changedLines(
  segments: TranscriptSegment[],
  draft: string[],
): Record<number, string> | null {
  const out: Record<number, string> = {};
  let any = false;
  draft.forEach((v, i) => {
    if (segments[i] && v.replace(/\s+/g, ' ').trim() !== segments[i]!.text) {
      out[i] = v.replace(/\s+/g, ' ').trim();
      any = true;
    }
  });
  return any ? out : null;
}

/** Languages this organization can translate into that the transcript doesn't have yet. */
export function translationOffers(
  t: AiTranscript,
  translation: TranscriptionSettings['translation'],
): (typeof TRANSCRIPT_LANGUAGES)[number][] {
  if (translation === 'none') return [];
  const have = new Set([t.language ?? '', ...t.translations.map((x) => x.language)]);
  const all =
    translation === 'model'
      ? TRANSCRIPT_LANGUAGES
      : TRANSCRIPT_LANGUAGES.filter(([c]) => c === 'en');
  return all.filter(([c]) => !have.has(c));
}
