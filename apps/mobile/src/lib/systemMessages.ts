import { formatClipDuration } from '@sampledge/contracts';

/**
 * Text for messages the server writes into a timeline (messageType 'system'), such as call
 * events. Works from the cached message alone, so it renders offline.
 */
export interface CallMeta {
  callId?: string;
  media?: 'audio' | 'video';
  status?: 'started' | 'ended' | 'missed' | 'declined' | string;
  durationSec?: number | null;
}

export function callMeta(metadata: Record<string, unknown>): CallMeta | null {
  const c = metadata.call;
  return c && typeof c === 'object' ? (c as CallMeta) : null;
}

export function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.max(1, Math.round(sec))} sec`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

export interface MeetingMeta {
  meetingId?: string;
  title?: string;
  startsAt?: string;
  endsAt?: string;
  organizerId?: string;
  status?: 'scheduled' | 'updated' | 'cancelled' | string;
}

export function meetingMeta(metadata: Record<string, unknown>): MeetingMeta | null {
  const m = metadata.meeting;
  return m && typeof m === 'object' ? (m as MeetingMeta) : null;
}

export interface RecordingMeta {
  callId?: string;
  attachmentId?: string | null;
  startedBy?: string;
  durationMs?: number;
  audioOnly?: boolean;
  failed?: boolean;
}

export function recordingMeta(metadata: Record<string, unknown>): RecordingMeta | null {
  const r = metadata.recording;
  return r && typeof r === 'object' ? (r as RecordingMeta) : null;
}

export interface MinutesMeta {
  minutesId?: string;
  callId?: string;
  title?: string;
  decisions?: number;
  actionItems?: number;
  deleted?: boolean;
}

/** The card posted when minutes of meeting are shared (and updated when they are deleted). */
export function minutesMeta(metadata: Record<string, unknown>): MinutesMeta | null {
  const m = metadata.minutes;
  return m && typeof m === 'object' ? (m as MinutesMeta) : null;
}

function when(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/** One line describing a system message, e.g. "Video call ended · 12 min". */
export function systemText(text: string, metadata: Record<string, unknown>): string {
  const meeting = meetingMeta(metadata);
  if (meeting) {
    const title = meeting.title ? `“${meeting.title}”` : 'Meeting';
    const at = meeting.startsAt ? ` · ${when(meeting.startsAt)}` : '';
    switch (meeting.status) {
      case 'cancelled':
        return `${title} was cancelled`;
      case 'updated':
        return `${title} moved${at}`;
      default:
        return `${title} scheduled${at}`;
    }
  }
  const rec = recordingMeta(metadata);
  if (rec) {
    if (rec.failed || !rec.attachmentId) return 'Call recording failed. No file was saved';
    const kind = rec.audioOnly ? 'Call recording (audio)' : 'Call recording';
    return rec.durationMs ? `${kind} · ${formatClipDuration(rec.durationMs)}` : kind;
  }
  const call = callMeta(metadata);
  if (call) {
    const kind = call.media === 'video' ? 'Video call' : 'Voice call';
    switch (call.status) {
      case 'started':
        return `${kind} started`;
      case 'missed':
        return `Missed ${kind.toLowerCase()}`;
      case 'declined':
        return `${kind} declined`;
      case 'ended':
        return call.durationSec
          ? `${kind} ended · ${formatDuration(call.durationSec)}`
          : `${kind} ended`;
      default:
        return text || kind;
    }
  }
  return text || 'Conversation updated';
}
