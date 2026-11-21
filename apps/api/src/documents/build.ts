import {
  formatCallDuration,
  languageLabel,
  type MinutesAttendee,
  type MinutesActionItem,
  type MinutesSources,
} from '@sampledge/contracts';
import type { Block, ChatLine, DocLogo, DocModel, TranscriptRow } from './model.js';

/** Builds the document models for minutes and chat exports (renderers: pdf.ts, docx.ts). */

export interface Brand {
  orgName: string;
  appName: string;
  logo: DocLogo | null;
  brand: string;
}

/** An IANA time zone the runtime knows, else UTC. */
export function safeTimeZone(tz: string | undefined | null): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

export function fmt(d: Date, tz: string, o: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...o }).format(d);
}
export const fmtDate = (d: Date, tz: string) =>
  fmt(d, tz, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const fmtTime = (d: Date, tz: string) =>
  fmt(d, tz, { hour: '2-digit', minute: '2-digit', hour12: false });
export const fmtStamp = (d: Date, tz: string) =>
  `${fmt(d, tz, { day: 'numeric', month: 'short', year: 'numeric' })}, ${fmtTime(d, tz)}`;
const tzLabel = (tz: string) => (tz === 'UTC' ? 'UTC' : tz.replace(/_/g, ' '));
const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

export interface MinutesInput {
  title: string;
  conversationName: string;
  media: 'audio' | 'video';
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  attendees: MinutesAttendee[];
  agenda: string;
  summary: string;
  decisions: string[];
  actionItems: MinutesActionItem[];
  openQuestions: string[];
  notes: string;
  language: string;
  sources: MinutesSources;
  status: 'draft' | 'shared';
  updatedByName: string;
  updatedAt: Date;
  sharedByName: string | null;
  ownerName: (id: string | null) => string | null;
  /** Transcript appendix (when asked for). */
  transcript: { title: string; note: string; lines: TranscriptRow[] }[];
}

export function minutesModel(m: MinutesInput, brand: Brand, tz: string, author: string): DocModel {
  const when = `${fmtDate(m.startedAt, tz)} · ${fmtTime(m.startedAt, tz)}${
    m.endedAt ? `–${fmtTime(m.endedAt, tz)}` : ''
  } ${tzLabel(tz)}`;
  const facts: [string, string][] = [
    ['Date', fmt(m.startedAt, tz, { day: 'numeric', month: 'long', year: 'numeric' })],
    [
      'Time',
      `${fmtTime(m.startedAt, tz)}${m.endedAt ? `–${fmtTime(m.endedAt, tz)}` : ''} ${tzLabel(tz)}`,
    ],
    ['Duration', m.durationSec != null ? formatCallDuration(m.durationSec) : '—'],
    ['Meeting', m.media === 'video' ? 'Video call' : 'Voice call'],
    ['Conversation', m.conversationName],
    ['Attendees', String(m.attendees.length)],
    ['Language', languageLabel(m.language)],
    [
      'Status',
      m.status === 'shared'
        ? `Shared${m.sharedByName ? ` by ${m.sharedByName}` : ''}`
        : 'Draft, in review',
    ],
  ];
  const blocks: Block[] = [];
  blocks.push({ kind: 'heading', text: 'Attendees' });
  blocks.push({
    kind: 'table',
    columns: ['Name', 'Role', 'Time in call'],
    widths: [5, 2, 2],
    rows: m.attendees.map((a) => [
      a.name,
      a.guest ? 'Guest' : 'Member',
      a.minutes != null ? `${a.minutes} min` : '—',
    ]),
  });
  if (m.agenda.trim()) {
    blocks.push({ kind: 'heading', text: 'Agenda' });
    blocks.push({ kind: 'paragraph', text: m.agenda.trim() });
  }
  blocks.push({ kind: 'heading', text: 'Summary' });
  blocks.push({
    kind: 'paragraph',
    text: m.summary.trim() || 'No summary was written for this meeting.',
    muted: !m.summary.trim(),
  });
  blocks.push({ kind: 'heading', text: 'Decisions' });
  if (m.decisions.length) blocks.push({ kind: 'list', style: 'number', items: m.decisions });
  else blocks.push({ kind: 'paragraph', text: 'No decisions were recorded.', muted: true });
  blocks.push({ kind: 'heading', text: 'Action items' });
  if (m.actionItems.length)
    blocks.push({
      kind: 'table',
      columns: ['#', 'Action', 'Owner', 'Due', 'Status'],
      widths: [0.6, 6, 2.4, 1.8, 1.4],
      rows: m.actionItems.map((a, i) => [
        String(i + 1),
        a.text,
        m.ownerName(a.ownerId) ?? a.ownerName ?? 'Unassigned',
        a.due ?? '—',
        a.done ? 'Done' : 'Open',
      ]),
    });
  else blocks.push({ kind: 'paragraph', text: 'No action items were recorded.', muted: true });
  if (m.openQuestions.length) {
    blocks.push({ kind: 'heading', text: 'Open questions' });
    blocks.push({ kind: 'list', style: 'bullet', items: m.openQuestions });
  }
  if (m.notes.trim()) {
    blocks.push({ kind: 'heading', text: 'Notes' });
    blocks.push({ kind: 'paragraph', text: m.notes.trim() });
  }
  blocks.push({ kind: 'heading', text: 'How these minutes were made' });
  blocks.push({ kind: 'paragraph', text: sourcesText(m.sources), muted: true });
  for (const t of m.transcript) {
    blocks.push({ kind: 'pageBreak' });
    blocks.push({ kind: 'transcript', ...t });
  }
  return {
    title: m.title,
    subtitle: when,
    eyebrow: 'Minutes of meeting',
    orgName: brand.orgName,
    appName: brand.appName,
    logo: brand.logo,
    brand: brand.brand,
    language: m.language,
    facts,
    blocks,
    footer: `${brand.orgName} · ${m.title} · ${
      m.status === 'draft' ? 'Draft, not yet shared' : `Last edited by ${m.updatedByName}`
    }`,
    watermark: m.status === 'draft' ? 'DRAFT' : null,
    author,
    subject: `Minutes of meeting, ${fmtDate(m.startedAt, tz)}`,
  };
}

export function sourcesText(s: MinutesSources): string {
  const parts: string[] = [];
  if (s.transcripts)
    parts.push(
      `${s.transcripts} call recording transcript${s.transcripts === 1 ? '' : 's'}${
        s.reviewedTranscripts ? ` (${s.reviewedTranscripts} checked by a person)` : ''
      }`,
    );
  if (s.captionLines) parts.push(`${s.captionLines} live caption lines with speaker names`);
  if (s.chatMessages)
    parts.push(`${s.chatMessages} chat message${s.chatMessages === 1 ? '' : 's'}`);
  const from = parts.length
    ? `Prepared from ${parts.join(', ')}.`
    : 'Written by the people in the meeting.';
  const langs = s.spokenLanguages.length
    ? ` Spoken languages: ${s.spokenLanguages.map(languageLabel).join(', ')}.`
    : '';
  return `${from}${langs} Speech recognition and translation run on your organization's own servers and can contain mistakes; the people in the call reviewed this draft before sharing it.`;
}

export interface ChatExportInput {
  conversationName: string;
  kindLabel: string;
  memberCount: number;
  from: Date | null;
  to: Date | null;
  exportedBy: string;
  exportedAt: Date;
  lines: (ChatLine & { date: Date })[];
  truncated: boolean;
  language: string;
}

export function chatModel(c: ChatExportInput, brand: Brand, tz: string): DocModel {
  const first = c.lines[0]?.date ?? null;
  const last = c.lines.at(-1)?.date ?? null;
  const range =
    first && last
      ? `${fmt(c.from ?? first, tz, { day: 'numeric', month: 'short', year: 'numeric' })} – ${fmt(
          c.to ?? last,
          tz,
          { day: 'numeric', month: 'short', year: 'numeric' },
        )}`
      : 'No messages in this range';
  const blocks: Block[] = [];
  let day = '';
  for (const l of c.lines) {
    const d = fmtDate(l.date, tz);
    if (d !== day) {
      blocks.push({ kind: 'day', text: d });
      day = d;
    }
    blocks.push({ kind: 'chat', line: l });
  }
  if (!c.lines.length)
    blocks.push({ kind: 'paragraph', text: 'No messages in this range.', muted: true });
  if (c.truncated)
    blocks.push({
      kind: 'paragraph',
      text: 'This export stops at its size limit. Choose a shorter date range for the rest.',
      muted: true,
    });
  return {
    title: c.conversationName,
    subtitle: range,
    eyebrow: 'Chat export',
    orgName: brand.orgName,
    appName: brand.appName,
    logo: brand.logo,
    brand: brand.brand,
    language: c.language,
    facts: [
      ['Conversation', c.kindLabel],
      ['Members', String(c.memberCount)],
      ['Messages', String(c.lines.filter((l) => !l.system).length)],
      ['Exported by', c.exportedBy],
      ['Exported on', `${fmtStamp(c.exportedAt, tz)} ${tzLabel(tz)}`],
      ['Times shown in', tzLabel(tz)],
    ],
    blocks,
    footer: `${brand.orgName} · ${c.conversationName} · Exported by ${c.exportedBy}. Confidential.`,
    watermark: null,
    author: c.exportedBy,
    subject: `Chat export, ${range}`,
  };
}

export function chatText(c: ChatExportInput, brand: Brand, tz: string): string {
  const out: string[] = [];
  out.push(`${c.conversationName} · Chat export`);
  out.push(`${brand.orgName} · ${c.kindLabel} · ${c.memberCount} members`);
  out.push(`Exported by ${c.exportedBy} on ${fmtStamp(c.exportedAt, tz)} (${tzLabel(tz)})`);
  out.push('='.repeat(72));
  let day = '';
  for (const l of c.lines) {
    const d = fmtDate(l.date, tz);
    if (d !== day) {
      out.push('', `--- ${d} ---`, '');
      day = d;
    }
    if (l.system) out.push(`[${l.at}] · ${l.text}`);
    else {
      const body = l.text.split('\n');
      out.push(`[${l.at}] ${l.who}${l.edited ? ' (edited)' : ''}: ${body[0] ?? ''}`);
      for (const more of body.slice(1)) out.push(`        ${more}`);
    }
    for (const f of l.files ?? []) out.push(`        Attachment: ${f}`);
    if (l.transcript) out.push(`        Transcript: ${l.transcript}`);
  }
  if (c.truncated) out.push('', 'This export stops at its size limit. Choose a shorter range.');
  out.push('');
  return `﻿${out.join('\r\n')}`;
}

export function minutesTranscriptRows(
  segments: { startMs: number; text: string }[],
  text: string | null,
): TranscriptRow[] {
  if (segments.length)
    return segments.map((s) => ({ at: mmss(s.startMs), speaker: null, text: s.text }));
  return text ? [{ at: '0:00', speaker: null, text }] : [];
}
