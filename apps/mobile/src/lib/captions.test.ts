import { describe, expect, it } from 'vitest';
import {
  SHOW_MS,
  addCaption,
  anyoneWantsCaptions,
  captionsNotice,
  freshCaptions,
  readCaptionPacket,
  rms,
} from './captions';

const enc = (x: unknown) => new TextEncoder().encode(JSON.stringify(x));

describe('live captions', () => {
  it('reads caption packets and ignores anything else on the channel', () => {
    expect(readCaptionPacket(enc({ id: 'u1:1', name: 'Priya', text: 'Hello' }))).toEqual({
      id: 'u1:1',
      name: 'Priya',
      text: 'Hello',
    });
    expect(readCaptionPacket(enc({ kind: 'reaction' }))).toBeNull();
    expect(readCaptionPacket(new TextEncoder().encode('not json'))).toBeNull();
  });

  it('shows a repeated packet once and keeps the last four lines', () => {
    let lines = addCaption([], { id: 'a', name: 'P', text: '1' }, 0);
    lines = addCaption(lines, { id: 'a', name: 'P', text: '1' }, 5);
    expect(lines).toHaveLength(1);
    for (const id of ['b', 'c', 'd', 'e'])
      lines = addCaption(lines, { id, name: 'P', text: id }, 1);
    expect(lines.map((l) => l.id)).toEqual(['b', 'c', 'd', 'e']);
  });

  it('old lines fade after a few seconds', () => {
    const lines = addCaption(
      addCaption([], { id: 'a', name: 'P', text: '1' }, 0),
      {
        id: 'b',
        name: 'P',
        text: '2',
      },
      5000,
    );
    expect(freshCaptions(lines, SHOW_MS + 1).map((l) => l.id)).toEqual(['b']);
    expect(freshCaptions(lines, 100)).toBe(lines);
  });

  it('clips are sent only while someone in the call wants captions', () => {
    expect(anyoneWantsCaptions([{}, undefined, { captions: '' }])).toBe(false);
    expect(anyoneWantsCaptions([{}, { captions: '1' }])).toBe(true);
  });

  it('says when this phone cannot caption its own speech', () => {
    expect(captionsNotice({ on: true, lines: 0, error: null, canSend: true })).toBe(
      'Captions on · waiting for someone to speak',
    );
    expect(captionsNotice({ on: true, lines: 2, error: null, canSend: false })).toMatch(
      /your own speech isn’t captioned from this phone yet/,
    );
    expect(captionsNotice({ on: false, lines: 0, error: null, canSend: true })).toMatch(
      /Someone turned on captions/,
    );
    expect(captionsNotice({ on: true, lines: 0, error: 'No server', canSend: true })).toBe(
      'No server',
    );
  });

  it('measures silence as quiet', () => {
    expect(rms(new Float32Array(64))).toBe(0);
    expect(rms(new Float32Array(64).fill(0.5))).toBeCloseTo(0.5);
  });
});
