import { describe, expect, it } from 'vitest';
import { bestExcerpt } from './ai.service.js';
import { SttClient, silentWav, sttSettingsFromValues } from './transcription.js';

describe('speech-to-text settings', () => {
  it('needs a URL and model, refuses metadata addresses, and applies defaults', () => {
    expect(sttSettingsFromValues({ baseUrl: 'http://speaches:8000' })).toBeNull();
    expect(() =>
      sttSettingsFromValues({ baseUrl: 'http://169.254.169.254', model: 'whisper' }),
    ).toThrow();
    expect(
      sttSettingsFromValues({ baseUrl: 'http://speaches:8000', model: 'whisper', language: 'EN' }),
    ).toMatchObject({
      language: 'en',
      autoTranscribeCalls: true,
      autoTranscribeVoice: false,
      timeoutMs: 600_000,
      apiKey: null,
    });
    expect(
      sttSettingsFromValues({ baseUrl: 'http://x', model: 'w', language: 'English please' })!
        .language,
    ).toBeNull();
  });

  it('posts multipart to /v1/audio/transcriptions and maps segments', async () => {
    let url = '';
    let form: FormData | null = null;
    const fake = (async (u: string, init: RequestInit) => {
      url = u;
      form = init.body as FormData;
      return new Response(
        JSON.stringify({
          text: ' Hello there. ',
          language: 'german',
          segments: [{ start: 0.25, end: 1.5, text: ' Hello there. ' }],
        }),
      );
    }) as unknown as typeof fetch;
    const c = new SttClient(
      sttSettingsFromValues({ baseUrl: 'http://stt:8000/', model: 'w' })!,
      fake,
    );
    const r = await c.transcribe(silentWav(), 'a.wav', 'audio/wav');
    expect(url).toBe('http://stt:8000/v1/audio/transcriptions');
    expect(form!.get('model')).toBe('w');
    expect(form!.get('response_format')).toBe('verbose_json');
    expect(r).toEqual({
      text: 'Hello there.',
      language: 'de',
      segments: [{ startMs: 250, endMs: 1500, text: 'Hello there.' }],
    });
  });

  it('keeps server errors opaque', async () => {
    const fake = (async () =>
      new Response('secret stack trace', { status: 502 })) as unknown as typeof fetch;
    const c = new SttClient(sttSettingsFromValues({ baseUrl: 'http://stt', model: 'w' })!, fake);
    expect(await c.test()).toEqual({
      ok: false,
      message: 'Speech-to-text server returned HTTP 502',
    });
  });
});

describe('transcript excerpts', () => {
  it('picks the sentence that matches the query', () => {
    const t =
      'Thanks for joining. We agreed to move the soft launch to Tuesday. Ravi will send the plan.';
    expect(bestExcerpt(t, 'soft launch date')).toMatch(/^We agreed to move the soft launch/);
  });
});
