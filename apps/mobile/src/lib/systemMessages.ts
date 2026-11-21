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

/** One line describing a system message, e.g. "Video call ended · 12 min". */
export function systemText(text: string, metadata: Record<string, unknown>): string {
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
