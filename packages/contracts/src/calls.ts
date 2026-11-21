import { z } from 'zod';
import { ServerIdSchema } from './ids.js';
import { CallGuestSchema, CallLobbyEntrySchema } from './guests.js';
import { CallRecordingStateSchema } from './recordings.js';

/**
 * Voice and video calls inside a conversation.
 *
 * Media never touches the API: it flows through a self-hosted SFU (LiveKit) that the
 * tenant runs next to the API. The API owns the call record (MongoDB), membership checks,
 * ringing, and issues short-lived join tokens scoped to one SFU room per call.
 *
 * A conversation has at most one live call. Starting a call while one is live returns it.
 */
export const CALL_MEDIA = ['audio', 'video'] as const;
export const CallMediaSchema = z.enum(CALL_MEDIA);
export type CallMedia = z.infer<typeof CallMediaSchema>;

/** live: at least one person is (or was just) in the room. ended: the room is closed for good. */
export const CALL_STATUSES = ['live', 'ended'] as const;
export const CallStatusSchema = z.enum(CALL_STATUSES);
export type CallStatus = z.infer<typeof CallStatusSchema>;

/**
 * Per-person state within a call.
 * ringing: invited, not answered yet. joined: in the room now. left: was in, has left.
 * declined: said no. missed: never answered before the ring timed out or the call ended.
 */
export const CALL_PARTICIPANT_STATES = ['ringing', 'joined', 'left', 'declined', 'missed'] as const;
export const CallParticipantStateSchema = z.enum(CALL_PARTICIPANT_STATES);
export type CallParticipantState = z.infer<typeof CallParticipantStateSchema>;

export const CallParticipantSchema = z.object({
  userId: ServerIdSchema,
  state: CallParticipantStateSchema,
  /** First time this person joined, if ever. */
  joinedAt: z.string().datetime().nullable(),
  leftAt: z.string().datetime().nullable(),
});
export type CallParticipant = z.infer<typeof CallParticipantSchema>;

export const CallSchema = z.object({
  callId: ServerIdSchema,
  conversationId: ServerIdSchema,
  media: CallMediaSchema,
  status: CallStatusSchema,
  startedBy: ServerIdSchema,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  /** Everyone invited (the conversation members when the call started) plus anyone who joined later. */
  participants: z.array(CallParticipantSchema),
  /** Non-null while the call is being recorded: every client shows a "Recording" indicator. */
  recording: CallRecordingStateSchema.nullable().optional(),
  /** External guests waiting to be let in (everyone in the call can admit or deny them). */
  lobby: z.array(CallLobbyEntrySchema).optional(),
  /** External guests who were admitted or denied. */
  guests: z.array(CallGuestSchema).optional(),
});
export type Call = z.infer<typeof CallSchema>;

/** Connection details for the SFU. The token is valid for one room and expires quickly. */
export const CallJoinSchema = z.object({
  /** WebSocket URL of the self-hosted SFU (LIVEKIT_PUBLIC_URL). */
  url: z.string(),
  token: z.string(),
  expiresAt: z.string().datetime(),
});
export type CallJoin = z.infer<typeof CallJoinSchema>;

export const CallJoinResponseSchema = z.object({ call: CallSchema, join: CallJoinSchema });
export type CallJoinResponse = z.infer<typeof CallJoinResponseSchema>;

/** Body of POST /v1/conversations/:id/calls. */
export const StartCallRequestSchema = z.object({ media: CallMediaSchema.default('video') });
export type StartCallRequest = z.input<typeof StartCallRequestSchema>;

/** GET /v1/calls/config: whether this deployment has a media server configured. */
export const CallsConfigSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['livekit']).nullable(),
  /** Seconds an invite rings before it counts as missed. */
  ringTimeoutSeconds: z.number().int().positive(),
  /** Whether calls can be recorded here (egress configured and allowed by the organization). */
  recordingEnabled: z.boolean().optional(),
  /** Live captions are available (the organization has a speech-to-text server). */
  captionsEnabled: z.boolean().optional(),
});
export type CallsConfig = z.infer<typeof CallsConfigSchema>;

/**
 * Live captions. POST /v1/calls/:callId/captions (members) or /v1/guest/:token/captions
 * (admitted guests) with a few seconds of the sender's own microphone as the raw body
 * (Content-Type audio/webm, audio/ogg or audio/mp4, at most 512 KB). The text comes back and
 * the sender's app shares it with the call over the media server's data channel, topic
 * `captions`, as JSON `CallCaptionPacket`. A participant attribute `captions: "1"` means that
 * person wants captions; apps send clips only while someone in the call has it set.
 */
export const CallCaptionResponseSchema = z.object({ text: z.string() });
export type CallCaptionResponse = z.infer<typeof CallCaptionResponseSchema>;

export const CALL_CAPTIONS_TOPIC = 'captions';
export const CallCaptionPacketSchema = z.object({
  /** Unique per clip, so a repeated packet is shown once. */
  id: z.string().max(64),
  name: z.string().max(80),
  text: z.string().max(500),
});
export type CallCaptionPacket = z.infer<typeof CallCaptionPacketSchema>;

/** Unanswered invites become `missed` after this long. */
export const CALL_RING_TIMEOUT_SECONDS = 45;

/**
 * The system message a call posts into its conversation (messageType 'system').
 * `metadata.call` carries this object; `content.text` is a human-readable fallback.
 * One message is posted when the call starts and is updated in place (message:updated,
 * changeSequence bump) when it ends, so a cached timeline renders the call history offline.
 */
export const CallSystemMetadataSchema = z.object({
  callId: ServerIdSchema,
  media: CallMediaSchema,
  /** started: the call began. ended: it finished with at least two people. missed: nobody answered. */
  status: z.enum(['started', 'ended', 'missed', 'declined']),
  startedBy: ServerIdSchema,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  durationSec: z.number().int().nonnegative().nullable(),
  /** Everyone who joined at some point (on `started`, just the caller). */
  participantIds: z.array(ServerIdSchema),
});
export type CallSystemMetadata = z.infer<typeof CallSystemMetadataSchema>;

/** Payload of the `call:ringing` socket event, sent to each invitee's personal room. */
export const CallRingingEventSchema = z.object({
  call: CallSchema,
  callerId: ServerIdSchema,
  conversationId: ServerIdSchema,
  media: CallMediaSchema,
  /** Stop ringing at this time even if no call:updated / call:ended arrives. */
  expiresAt: z.string().datetime(),
});
export type CallRingingEvent = z.infer<typeof CallRingingEventSchema>;

export function formatCallDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}
