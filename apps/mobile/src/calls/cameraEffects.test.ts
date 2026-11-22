import {
  DEFAULT_CALL_APPEARANCE,
  lookParams,
  type CallBackgroundState,
} from '@sampledge/contracts';
import { describe, expect, it } from 'vitest';
import {
  isNeutralLook,
  logoSource,
  nativeEffectsOff,
  nativeEffectsOptions,
  pictureCacheName,
} from './cameraEffects';

const brand: CallBackgroundState['brand'] = {
  name: 'Acme Research',
  logo: null,
  primary: '#1f3a5f',
  secondary: '#c9a227',
};
const state = (
  effective: CallBackgroundState['effective'],
  appearance = DEFAULT_CALL_APPEARANCE,
): Pick<CallBackgroundState, 'effective' | 'appearance' | 'brand'> => ({
  effective,
  appearance,
  brand,
});
const none = { image: null, logo: null };

describe('camera options for the phone', () => {
  it('does nothing when no background and no look are chosen', () => {
    const o = nativeEffectsOptions(state({ kind: 'none' }), none);
    expect(o).toEqual({
      background: { mode: 'off' },
      look: null,
      face: { slim: 0, eyes: 0, nose: 0 },
    });
    expect(nativeEffectsOff(o)).toBe(true);
  });

  it('blurs, and puts a picture behind you once it is on the phone', () => {
    expect(nativeEffectsOptions(state({ kind: 'blur' }), none).background).toEqual({
      mode: 'blur',
    });
    const preset = state({ kind: 'preset', presetId: 'boardroom' });
    expect(nativeEffectsOptions(preset, { image: 'file:///b.jpg', logo: null }).background).toEqual(
      {
        mode: 'image',
        uri: 'file:///b.jpg',
      },
    );
    // Not downloaded yet (offline): blur, so the room never shows.
    expect(nativeEffectsOptions(preset, none).background).toEqual({ mode: 'blur' });
    expect(nativeEffectsOff(nativeEffectsOptions(preset, none))).toBe(false);
  });

  it('draws the company background from the branding', () => {
    const o = nativeEffectsOptions(state({ kind: 'logo' }), { image: null, logo: 'file:///l.png' });
    expect(o.background).toEqual({
      mode: 'brand',
      primary: '#1f3a5f',
      secondary: '#c9a227',
      name: 'Acme Research',
      logoUri: 'file:///l.png',
    });
  });

  it('sends the same look numbers as the web app, and face shaping as 0..1', () => {
    const a = {
      ...DEFAULT_CALL_APPEARANCE,
      filter: 'noir' as const,
      smoothing: 45,
      faceSlim: 60,
      eyes: 20,
    };
    const o = nativeEffectsOptions(state({ kind: 'none' }, a), none);
    expect(o.look).toEqual(lookParams(a));
    expect(o.look!.grayscale).toBe(1);
    expect(o.face).toEqual({ slim: 0.6, eyes: 0.2, nose: 0 });
    // Face shaping alone still needs the camera, but no colour work.
    const shapeOnly = nativeEffectsOptions(
      state({ kind: 'none' }, { ...DEFAULT_CALL_APPEARANCE, nose: 30 }),
      none,
    );
    expect(shapeOnly.look).toBeNull();
    expect(nativeEffectsOff(shapeOnly)).toBe(false);
    expect(isNeutralLook({ ...DEFAULT_CALL_APPEARANCE, eyes: 50 })).toBe(true);
    expect(isNeutralLook({ ...DEFAULT_CALL_APPEARANCE, warmth: -10 })).toBe(false);
  });

  it('reads logos the camera can use and leaves vector ones to be drawn first', () => {
    expect(logoSource('data:image/png;base64,iVBORw0KGgo=')).toEqual({
      kind: 'data',
      ext: 'png',
      base64: 'iVBORw0KGgo=',
    });
    expect(logoSource('data:image/jpeg;base64,/9j/4AAQ')).toMatchObject({
      kind: 'data',
      ext: 'jpg',
    });
    expect(logoSource('data:image/svg+xml;base64,PHN2Zz4=')).toEqual({ kind: 'none' });
    expect(logoSource('https://api.test/logo.png')).toEqual({
      kind: 'url',
      url: 'https://api.test/logo.png',
    });
    expect(logoSource(null)).toEqual({ kind: 'none' });
  });

  it('keeps one downloaded copy per picture', () => {
    const a = pictureCacheName('https://api.test/v1/call-backgrounds/abc.jpg');
    expect(a).toBe(pictureCacheName('https://api.test/v1/call-backgrounds/abc.jpg'));
    expect(a).not.toBe(pictureCacheName('https://api.test/v1/call-backgrounds/abd.jpg'));
    expect(a).toMatch(/^bg-[0-9a-f]{8}-[0-9a-z]+$/);
  });
});
