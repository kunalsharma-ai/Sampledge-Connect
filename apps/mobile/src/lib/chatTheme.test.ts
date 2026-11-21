import { CHAT_THEMES } from '@sampledge/contracts';
import { contrastRatio } from '@sampledge/design-tokens';
import { describe, expect, it } from 'vitest';
import { THEMES } from '../theme/themes';
import { chatLook, choiceFor, rgba } from './chatTheme';

describe('chat themes on the phone', () => {
  it('every theme keeps bubble text readable in every app theme', () => {
    for (const app of Object.values(THEMES))
      for (const t of CHAT_THEMES) {
        const l = chatLook(t.id, app.colors, app.dark);
        expect(contrastRatio(l.bubbleOwnFg, l.bubbleOwn)).toBeGreaterThanOrEqual(4.5);
      }
  });

  it('patterns and scenes are drawn as SVG the phone can render', () => {
    const app = THEMES.midnight;
    const blueprint = chatLook('blueprint', app.colors, true);
    expect(blueprint.fillXml).toMatch(/<pattern id="p-blueprint" width="48" height="48"/);
    expect(blueprint.scene).toBeNull();
    const skyline = chatLook('skyline-office', app.colors, true);
    expect(skyline.scene?.aspect).toBeCloseTo(1440 / 420);
    const aurora = chatLook('aurora', app.colors, true);
    expect(aurora.fillXml).toMatch(/radialGradient/);
    // CSS4 rgb(r g b / a%) is web-only; the phone gets rgba().
    for (const l of [blueprint, skyline, aurora])
      expect(`${l.fillXml ?? ''}${l.scene?.xml ?? ''}`).not.toMatch(/rgb\(\d+ /);
    expect(chatLook('graphite', app.colors, true).fillXml).toBeNull();
  });

  it('rgba conversion', () => {
    expect(rgba('#FF8000', 0.5)).toBe('rgba(255,128,0,0.5)');
  });

  it('tapping the default while following it keeps following the organization default', () => {
    const policy = { defaultThemeId: 'graphite' as const, allowed: null };
    expect(choiceFor('graphite', policy, null)).toBeNull();
    expect(choiceFor('graphite', policy, 'aurora')).toBe('graphite');
    expect(choiceFor('linen', policy, null)).toBe('linen');
  });
});
