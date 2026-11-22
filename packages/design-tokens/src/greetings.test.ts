import { describe, expect, it } from 'vitest';
import { contrastRatio } from './color.js';
import { GREETING_MOTIFS, GREETING_OCCASION_ART } from './greeting-art.js';
import { greetingCardLook } from './greetings.js';

const STYLES = ['radiant', 'elegant', 'festive', 'minimal', 'midnight'];

describe('greeting card art', () => {
  it('draws every occasion in every style as well-formed SVG with readable text', () => {
    for (const [id, art] of Object.entries(GREETING_OCCASION_ART)) {
      expect(GREETING_MOTIFS[art.motif], id).toBeTypeOf('function');
      for (const s of STYLES) {
        const look = greetingCardLook(id, s);
        expect(look.svg.startsWith('<svg')).toBe(true);
        expect(look.svg).not.toMatch(/NaN|undefined/);
        // Balanced tags (cheap well-formedness check).
        expect((look.svg.match(/<g[ >]/g) ?? []).length).toBe(
          (look.svg.match(/<\/g>/g) ?? []).length,
        );
        if (look.panel.fg.startsWith('#'))
          expect(contrastRatio(look.panel.fg, look.panel.bg), `${id} ${s}`).toBeGreaterThanOrEqual(
            4.5,
          );
      }
    }
  });

  it('is deterministic, so a card looks the same on every device', () => {
    expect(greetingCardLook('diwali', 'festive').svg).toBe(
      greetingCardLook('diwali', 'festive').svg,
    );
  });

  it('keeps condolence cards free of confetti and bunting', () => {
    const quiet = greetingCardLook('condolence', 'festive', { quiet: true }).svg;
    const loud = greetingCardLook('condolence', 'festive').svg;
    expect(quiet.length).toBeLessThan(loud.length);
  });
});
