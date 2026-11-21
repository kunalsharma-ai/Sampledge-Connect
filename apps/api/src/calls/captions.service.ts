import { Injectable, Logger } from '@nestjs/common';
import type { CallCaptionResponse } from '@sampledge/contracts';
import { AppError, forbidden } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { RateLimitService } from '../redis/redis.module.js';
import { TranscriptsService } from '../ai/transcripts.service.js';
import { SttClient, SttUnavailableError } from '../ai/transcription.js';
import { CallsService } from './calls.service.js';
import { TenantDb } from '../database/tenant-db.js';
import { DEFAULT_MINUTES_SETTINGS } from '@sampledge/contracts';

/** Audio formats browsers record (MediaRecorder): WebM/Opus, Ogg/Opus, MP4/AAC (Safari), WAV. */
const AUDIO = /^audio\/(webm|ogg|mp4|mpeg|wav|x-wav|aac)(;|$)/i;
export const CAPTION_CLIP_MAX_BYTES = 512 * 1024;

/**
 * Live captions. Each person's own app sends short clips of their microphone (only while
 * someone in the call has captions on and they are speaking) to the organization's own
 * speech-to-text server; the text comes back to them and their app shares it with the call
 * over the media server's data channel. Audio and text are never stored.
 */
@Injectable()
export class CaptionsService {
  private readonly log = new Logger('Captions');

  constructor(
    private readonly transcripts: TranscriptsService,
    private readonly calls: CallsService,
    private readonly rateLimit: RateLimitService,
    private readonly db: TenantDb,
  ) {}

  async available(tenantId: string): Promise<boolean> {
    return !!(await this.transcripts.settings(tenantId));
  }

  /**
   * Whether caption text is kept (with the speaker's name) for the call's minutes. Off unless
   * an admin turned it on; everyone in the call sees that it is.
   */
  async saved(tenantId: string): Promise<{ keep: boolean; days: number }> {
    const s = await this.db
      .for(tenantId)
      .tenant_settings.findOne({}, { projection: { minutes: 1 } });
    const m = { ...DEFAULT_MINUTES_SETTINGS, ...(s?.minutes ?? {}) };
    return { keep: m.keepCaptions, days: m.captionRetentionDays };
  }

  private async keep(
    tenantId: string,
    line: {
      callId: string;
      conversationId: string;
      userId: string | null;
      speaker: string;
      text: string;
    },
  ) {
    if (!line.text) return;
    const { keep, days } = await this.saved(tenantId);
    if (!keep) return;
    const at = new Date();
    await this.db
      .for(tenantId)
      .call_captions.insertOne({
        ...line,
        speaker: line.speaker.slice(0, 120),
        at,
        expiresAt: new Date(at.getTime() + days * 86_400_000),
      })
      .catch((e: unknown) => this.log.warn(`caption line not kept: ${String(e)}`));
  }

  /** A member's clip: they must be in the live call. */
  async member(
    ctx: TenantContext,
    callId: string,
    audio: unknown,
    mimeType: string | undefined,
  ): Promise<CallCaptionResponse> {
    const call = await this.calls.get(ctx, callId);
    const me = call.participants.find((p) => p.userId === ctx.userId);
    if (call.status !== 'live' || me?.state !== 'joined')
      throw forbidden('Join the call to use captions');
    await this.rateLimit.consume('caption_clip', `${ctx.tenantId}:${ctx.userId}`);
    const r = await this.transcribe(ctx.tenantId, audio, mimeType);
    if (r.text) {
      const u = await this.db
        .for(ctx.tenantId)
        .users.findOne({ _id: ctx.userId }, { projection: { displayName: 1 } });
      await this.keep(ctx.tenantId, {
        callId,
        conversationId: call.conversationId,
        userId: ctx.userId,
        speaker: u?.displayName ?? 'Someone',
        text: r.text,
      });
    }
    return r;
  }

  /** An admitted guest's clip (the guest link's call checks happen in GuestsService). */
  async guest(
    tenantId: string,
    guestId: string,
    audio: unknown,
    mimeType: string | undefined,
    call?: { callId: string; conversationId: string; name: string },
  ): Promise<CallCaptionResponse> {
    await this.rateLimit.consume('caption_clip', `${tenantId}:guest:${guestId}`);
    const r = await this.transcribe(tenantId, audio, mimeType);
    if (call && r.text)
      await this.keep(tenantId, {
        callId: call.callId,
        conversationId: call.conversationId,
        userId: null,
        speaker: `${call.name} (guest)`,
        text: r.text,
      });
    return r;
  }

  private async transcribe(
    tenantId: string,
    audio: unknown,
    mimeType: string | undefined,
  ): Promise<CallCaptionResponse> {
    const type = (mimeType ?? '').toLowerCase();
    if (!AUDIO.test(type) || !Buffer.isBuffer(audio) || audio.length === 0)
      throw new AppError('VALIDATION_FAILED', 'Send a short audio clip (audio/webm, ogg or mp4)');
    if (audio.length > CAPTION_CLIP_MAX_BYTES)
      throw new AppError('VALIDATION_FAILED', 'Audio clip is too long');
    const s = await this.transcripts.settings(tenantId);
    if (!s)
      throw new AppError(
        'UNAVAILABLE',
        'Captions need a speech-to-text server. An administrator can add one in Integrations.',
      );
    const ext = type.includes('ogg')
      ? 'ogg'
      : type.includes('mp4') || type.includes('aac')
        ? 'm4a'
        : type.includes('wav')
          ? 'wav'
          : type.includes('mpeg')
            ? 'mp3'
            : 'webm';
    try {
      const r = await new SttClient(s, this.transcripts.fetchImpl).transcribe(
        audio,
        `clip.${ext}`,
        type.split(';')[0]!,
      );
      return { text: cleanCaption(r.text) };
    } catch (e) {
      if (e instanceof SttUnavailableError) {
        this.log.warn(`caption clip failed: ${e.message}`);
        throw new AppError('UNAVAILABLE', e.message);
      }
      throw e;
    }
  }
}

/** Whisper-style models invent these on silence or noise; never show them as speech. */
const NOISE = new Set([
  '',
  'you',
  'thank you.',
  'thanks for watching!',
  '.',
  '...',
  '[music]',
  '[silence]',
  '(silence)',
  '[blank_audio]',
]);

export function cleanCaption(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return NOISE.has(t.toLowerCase()) || !/[\p{L}\p{N}]/u.test(t) ? '' : t.slice(0, 500);
}
