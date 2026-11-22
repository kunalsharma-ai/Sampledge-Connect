import type { IntegrationProviderDef } from '@sampledge/contracts';
import { AI_TRANSCRIPTION_INTEGRATION_ID } from '@sampledge/contracts';
import { normalizeBaseUrl } from './model.js';
import { assertSafeModelUrl } from './settings.js';

/**
 * The organization's own speech-to-text server, configured in the database
 * (Administration › Integrations › Speech-to-text), never in env. Any server with the
 * OpenAI-compatible `POST /v1/audio/transcriptions` works: Speaches (faster-whisper),
 * LocalAI, whisper.cpp server with `--inference-path /v1/audio/transcriptions`, vLLM.
 */
export interface SttSettings {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  /** ISO 639-1 hint such as `en`; null lets the server detect it. */
  language: string | null;
  timeoutMs: number;
  autoTranscribeCalls: boolean;
  autoTranscribeVoice: boolean;
  /** Languages every finished transcript is also translated into (ISO 639-1). */
  translateTo: string[];
}

export const AI_TRANSCRIPTION_PROVIDER: IntegrationProviderDef = {
  id: AI_TRANSCRIPTION_INTEGRATION_ID,
  label: 'Speech-to-text server',
  description:
    'Your own Whisper server (Speaches / faster-whisper, whisper.cpp, LocalAI) for call recording and voice message transcripts. Audio never leaves your servers.',
  category: 'ai',
  scopes: ['tenant', 'platform'],
  testable: true,
  fields: [
    {
      key: 'baseUrl',
      label: 'Server URL',
      type: 'url',
      required: true,
      placeholder: 'http://speaches:8000',
      help: 'OpenAI-compatible endpoint with /v1/audio/transcriptions. /v1 is added when missing.',
    },
    {
      key: 'apiKey',
      label: 'API key',
      type: 'secret',
      help: 'Only if your server requires one. Stored encrypted.',
    },
    {
      key: 'model',
      label: 'Model',
      type: 'string',
      required: true,
      placeholder: 'Systran/faster-whisper-small',
      default: 'whisper-1',
    },
    {
      key: 'language',
      label: 'Language',
      type: 'string',
      placeholder: 'en',
      help: 'Two-letter code. Leave empty to detect the language of each recording.',
    },
    {
      key: 'translateTo',
      label: 'Also translate transcripts to',
      type: 'string',
      placeholder: 'en',
      help: 'Comma-separated language codes such as en, hi. English works with the speech-to-text server alone; other languages use your AI model server. A transcript already in that language is not translated.',
    },
    {
      key: 'autoTranscribeCalls',
      label: 'Transcribe call recordings automatically',
      type: 'boolean',
      default: true,
    },
    {
      key: 'autoTranscribeVoice',
      label: 'Transcribe voice messages automatically',
      type: 'boolean',
      default: false,
      help: 'Otherwise people press Transcript on a voice message.',
    },
    {
      key: 'timeoutMs',
      label: 'Timeout (ms)',
      type: 'number',
      default: 600000,
      min: 10000,
      max: 3600000,
      help: 'Long recordings on a CPU can take several minutes.',
    },
  ],
};

const bool = (v: unknown, dflt: boolean) =>
  v === true || v === 'true' ? true : v === false || v === 'false' ? false : dflt;

/** Maps integration-store values; null when the server URL or model is missing. */
export function sttSettingsFromValues(values: Record<string, unknown>): SttSettings | null {
  const baseUrl = typeof values.baseUrl === 'string' ? values.baseUrl.trim() : '';
  const model = typeof values.model === 'string' ? values.model.trim() : '';
  if (!baseUrl || !model) return null;
  assertSafeModelUrl(baseUrl);
  const lang = typeof values.language === 'string' ? values.language.trim().toLowerCase() : '';
  const timeout = Number(values.timeoutMs);
  return {
    baseUrl,
    apiKey: typeof values.apiKey === 'string' && values.apiKey ? values.apiKey : null,
    model,
    language: /^[a-z]{2,3}$/.test(lang) ? lang : null,
    timeoutMs:
      Number.isFinite(timeout) && timeout >= 10_000 ? Math.min(timeout, 3_600_000) : 600_000,
    translateTo: parseLanguages(values.translateTo),
    autoTranscribeCalls: bool(values.autoTranscribeCalls, true),
    autoTranscribeVoice: bool(values.autoTranscribeVoice, false),
  };
}

/** "en, hi" → ['en', 'hi'] (valid codes only, at most 5). */
export function parseLanguages(v: unknown): string[] {
  const raw = Array.isArray(v) ? v.join(',') : typeof v === 'string' ? v : '';
  return [
    ...new Set(
      raw
        .split(/[\s,;]+/)
        .map((x) => x.trim().toLowerCase())
        .filter((x) => /^[a-z]{2,3}$/.test(x)),
    ),
  ].slice(0, 5);
}

export class SttUnavailableError extends Error {}

export interface SttResult {
  text: string;
  language: string | null;
  segments: { startMs: number; endMs: number; text: string }[];
}

/** A 0.4 s silent 16 kHz mono WAV, for Test connection. */
export function silentWav(seconds = 0.4): Buffer {
  const rate = 16_000;
  const samples = Math.round(rate * seconds);
  const data = samples * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + data, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(data, 40);
  return b;
}

export class SttClient {
  private readonly base: string;
  constructor(
    private readonly s: SttSettings,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = normalizeBaseUrl(s.baseUrl);
  }

  get model() {
    return this.s.model;
  }

  transcribe(audio: Buffer, fileName: string, mimeType: string): Promise<SttResult> {
    return this.call('transcriptions', audio, fileName, mimeType);
  }

  /**
   * Whisper's translate task: speech in any language straight to English text, with timings.
   * Speaches, LocalAI and whisper.cpp (`--translate` route) support `/v1/audio/translations`.
   */
  async translateToEnglish(audio: Buffer, fileName: string, mimeType: string): Promise<SttResult> {
    const r = await this.call('translations', audio, fileName, mimeType);
    return { ...r, language: 'en' };
  }

  private async call(
    task: 'transcriptions' | 'translations',
    audio: Buffer,
    fileName: string,
    mimeType: string,
  ): Promise<SttResult> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), fileName);
    form.append('model', this.s.model);
    form.append('response_format', 'verbose_json');
    if (this.s.language && task === 'transcriptions') form.append('language', this.s.language);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/audio/${task}`, {
        method: 'POST',
        headers: this.s.apiKey ? { authorization: `Bearer ${this.s.apiKey}` } : {},
        body: form,
        signal: AbortSignal.timeout(this.s.timeoutMs),
      });
    } catch (e) {
      const name = (e as Error).name;
      throw new SttUnavailableError(
        name === 'TimeoutError' || name === 'AbortError'
          ? `Speech-to-text server did not finish within ${Math.round(this.s.timeoutMs / 1000)}s`
          : `Cannot reach the speech-to-text server (${(e as Error).message})`,
      );
    }
    // The body is not echoed back: the URL is admin-supplied, so keep responses opaque.
    if (!res.ok) throw new SttUnavailableError(`Speech-to-text server returned HTTP ${res.status}`);
    const raw = await res.text();
    let body: {
      text?: unknown;
      language?: unknown;
      segments?: { start?: unknown; end?: unknown; text?: unknown }[];
    };
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      // Some servers ignore response_format and answer in plain text.
      return { text: raw.trim(), language: this.s.language, segments: [] };
    }
    const segments = Array.isArray(body.segments)
      ? body.segments
          .filter((x) => typeof x?.text === 'string' && x.text.trim())
          .map((x) => ({
            startMs: Math.max(0, Math.round(Number(x.start) * 1000) || 0),
            endMs: Math.max(0, Math.round(Number(x.end) * 1000) || 0),
            text: String(x.text).trim(),
          }))
      : [];
    const text =
      typeof body.text === 'string' ? body.text.trim() : segments.map((x) => x.text).join(' ');
    return {
      text,
      language: typeof body.language === 'string' ? toIso(body.language) : this.s.language,
      segments,
    };
  }

  async test(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.transcribe(silentWav(), 'connection-test.wav', 'audio/wav');
      return { ok: true, message: `Connected to ${this.s.model}.` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }
}

/** Whisper servers report `english` or `en`. */
const NAMES: Record<string, string> = {
  english: 'en',
  german: 'de',
  french: 'fr',
  spanish: 'es',
  italian: 'it',
  dutch: 'nl',
  portuguese: 'pt',
  hindi: 'hi',
  japanese: 'ja',
  chinese: 'zh',
  polish: 'pl',
  swedish: 'sv',
  arabic: 'ar',
  bengali: 'bn',
  czech: 'cs',
  danish: 'da',
  greek: 'el',
  finnish: 'fi',
  hebrew: 'he',
  hungarian: 'hu',
  indonesian: 'id',
  korean: 'ko',
  marathi: 'mr',
  malay: 'ms',
  norwegian: 'no',
  punjabi: 'pa',
  persian: 'fa',
  romanian: 'ro',
  russian: 'ru',
  swahili: 'sw',
  tamil: 'ta',
  telugu: 'te',
  thai: 'th',
  turkish: 'tr',
  ukrainian: 'uk',
  urdu: 'ur',
  vietnamese: 'vi',
  gujarati: 'gu',
  kannada: 'kn',
  malayalam: 'ml',
  tagalog: 'tl',
};
function toIso(lang: string): string | null {
  const l = lang.trim().toLowerCase();
  if (/^[a-z]{2,3}$/.test(l)) return l;
  return NAMES[l] ?? null;
}
