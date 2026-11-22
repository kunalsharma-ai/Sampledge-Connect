import { describe, expect, it } from 'vitest';
import {
  PRESET_GROUPS,
  UNKNOWN_CALL_BACKGROUND,
  callBackgroundLabel,
  fitCallBackground,
  sameChoice,
  shade,
  withPendingCallBackground,
} from './callBackground';

const base = {
  ...UNKNOWN_CALL_BACKGROUND,
  choice: { kind: 'preset', presetId: 'library-study' } as const,
  effective: { kind: 'preset', presetId: 'library-study' } as const,
  customImageUrl: 'https://api/v1/call-backgrounds/t/k1',
};

describe('call background on the phone', () => {
  it('lays unsent changes over the server copy in order', () => {
    const s = withPendingCallBackground(base, [
      { kind: 'callbg.set', choice: { kind: 'blur' } },
      { kind: 'callbg.image', localUri: 'file:///x.jpg' },
    ]);
    expect(s.choice).toEqual({ kind: 'custom' });
    expect(s.customImageUrl).toBe('file:///x.jpg');
    const r = withPendingCallBackground(s, [{ kind: 'callbg.imageRemove' }]);
    expect(r.choice).toBeNull();
    expect(r.customImageUrl).toBeNull();
    expect(r.effective).toEqual({ kind: 'none' });
    // Picking "your image" with none left does nothing, as the server would refuse it.
    expect(
      withPendingCallBackground(r, [{ kind: 'callbg.set', choice: { kind: 'custom' } }]).choice,
    ).toBeNull();
  });

  it('the company rule wins over any pick', () => {
    const locked = { ...base, policy: { ...base.policy, enforceLogo: true } };
    const s = withPendingCallBackground(locked, [{ kind: 'callbg.set', choice: { kind: 'blur' } }]);
    expect(s.choice).toEqual({ kind: 'blur' });
    expect(s.effective).toEqual({ kind: 'logo' });
  });

  it('fits images within 1920x1080 and labels choices', () => {
    expect(fitCallBackground(4032, 3024)).toEqual({ width: 1440, height: 1080 });
    expect(fitCallBackground(3000, 1000)).toEqual({ width: 1920, height: 640 });
    expect(fitCallBackground(800, 600)).toEqual({ width: 800, height: 600 });
    expect(callBackgroundLabel({ kind: 'preset', presetId: 'villa-terrace' })).toBe(
      'Villa terrace',
    );
    expect(
      sameChoice(
        { kind: 'preset', presetId: 'office-lounge' },
        { kind: 'preset', presetId: 'library-study' },
      ),
    ).toBe(false);
    expect(sameChoice({ kind: 'blur' }, { kind: 'blur' })).toBe(true);
    expect(PRESET_GROUPS.map((g) => g.presets.length)).toEqual([12, 12]);
    expect(shade('#808080', -0.5)).toBe('#404040');
  });
});
