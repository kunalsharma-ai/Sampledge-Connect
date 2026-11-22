import {
  languageLabel,
  type MeetingMinutes,
  type MinutesActionItem,
  type MinutesSources,
} from '@sampledge/contracts';
import { formatDuration } from './systemMessages';

/** "From 2 recording transcripts (1 checked), 14 chat messages. Heard: English, Hindi." */
export function sourcesLine(s: MinutesSources): string {
  const parts: string[] = [];
  if (s.transcripts)
    parts.push(
      `${s.transcripts} recording transcript${s.transcripts === 1 ? '' : 's'}` +
        (s.transcripts ? ` (${s.reviewedTranscripts} checked)` : ''),
    );
  if (s.captionLines)
    parts.push(`${s.captionLines} caption line${s.captionLines === 1 ? '' : 's'}`);
  if (s.chatMessages)
    parts.push(`${s.chatMessages} chat message${s.chatMessages === 1 ? '' : 's'}`);
  const from = parts.length
    ? `From ${parts.join(', ')}.`
    : 'Nothing was recorded or written in the call.';
  const heard = s.spokenLanguages.length
    ? ` Heard: ${s.spokenLanguages.map(languageLabel).join(', ')}.`
    : '';
  return from + heard;
}

/** "Thu 20 Nov, 10:00 · 42 min" */
export function minutesWhen(m: Pick<MeetingMinutes, 'startedAt' | 'durationSec'>): string {
  const d = new Date(m.startedAt);
  const day = d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${t}${m.durationSec ? ` · ${formatDuration(m.durationSec)}` : ''}`;
}

/** Lines people typed, trimmed, empty ones dropped (what the server accepts). */
export function cleanLines(lines: readonly string[]): string[] {
  return lines.map((l) => l.trim()).filter(Boolean);
}

export function newActionItem(text = ''): MinutesActionItem {
  return {
    id: `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    text,
    ownerId: null,
    ownerName: null,
    due: null,
    done: false,
  };
}

/** Action items ready to save: text trimmed, empty ones dropped, blanks as null. */
export function cleanActionItems(items: readonly MinutesActionItem[]): MinutesActionItem[] {
  return items
    .map((a) => ({
      ...a,
      text: a.text.trim(),
      ownerName: a.ownerName?.trim() || null,
      due: a.due?.trim() || null,
    }))
    .filter((a) => a.text);
}

/** Who the action is for: the member's name when known, else the name as written. */
export function ownerLabel(
  a: Pick<MinutesActionItem, 'ownerId' | 'ownerName'>,
  nameOf: (userId: string) => string | undefined,
): string | null {
  return (a.ownerId && nameOf(a.ownerId)) || a.ownerName || null;
}

export type ExportRange = 'all' | '7d' | '30d' | '90d';

/** The from/to of a chat export for a preset range ending now (none for everything). */
export function exportRange(range: ExportRange, now: Date): { from?: string; to?: string } {
  if (range === 'all') return {};
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  return {
    from: new Date(now.getTime() - days * 86_400_000).toISOString(),
    to: now.toISOString(),
  };
}
