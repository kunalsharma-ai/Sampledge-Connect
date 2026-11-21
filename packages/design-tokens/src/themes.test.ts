import { describe, expect, it } from 'vitest';
import { contrastRatio, parseHex } from './color.js';
import { createBrandTheme, THEMES, themeToCssVars } from './themes.js';
import { buildThemesCss } from './css.js';

const all = Object.values(THEMES);

describe('built-in themes', () => {
  it('use the exact seed colors from the product spec', () => {
    expect(THEMES['midnight-executive'].colors).toMatchObject({
      bg: '#080F1F',
      surface: '#111C30',
      accent: '#5B8CFF',
      accent2: '#8B5CF6',
      text: '#F8FAFC',
    });
    expect(THEMES['arctic-professional'].colors).toMatchObject({
      bg: '#F6F8FC',
      surface: '#FFFFFF',
      accent: '#2563EB',
      accent2: '#0D9488',
      text: '#0F172A',
    });
    expect(THEMES['royal-graphite'].colors).toMatchObject({
      bg: '#121318',
      accent: '#9B8CFF',
      accent2: '#D4B483',
    });
    expect(THEMES['emerald-enterprise'].colors).toMatchObject({
      bg: '#071C1A',
      accent: '#34D399',
      accent2: '#5EEAD4',
    });
  });

  it.each(all.map((t) => [t.name, t] as const))(
    '%s meets WCAG AA contrast for text roles',
    (_n, t) => {
      const c = t.colors;
      expect(contrastRatio(c.text, c.bg)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(c.text, c.surface)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(c.textMuted, c.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.textSubtle, c.surface)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(c.accentFg, c.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.bubbleOwnFg, c.bubbleOwn)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.text, c.bubbleOther)).toBeGreaterThanOrEqual(7);
    },
  );
});

describe('custom brand theme', () => {
  it('nudges low-contrast brand colors to at least 3:1 against surface', () => {
    const t = createBrandTheme({ primary: '#FFE14D', secondary: '#B3E5FC', mode: 'light' });
    expect(contrastRatio(t.colors.accent, t.colors.surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(t.colors.accent2, t.colors.surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(t.colors.accentFg, t.colors.accent)).toBeGreaterThanOrEqual(4.5);
  });
  it('supports dark and light variants', () => {
    const d = createBrandTheme({ primary: '#E11D48', secondary: '#F59E0B', mode: 'dark' });
    expect(d.mode).toBe('dark');
    expect(contrastRatio(d.colors.text, d.colors.bg)).toBeGreaterThanOrEqual(7);
  });
});

describe('css output', () => {
  it('emits a selector per theme and reduced-motion overrides', () => {
    const css = buildThemesCss();
    for (const t of all) expect(css).toContain(`[data-theme="${t.id}"]`);
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('--sc-color-accent: #5B8CFF');
  });
  it('produces valid hex for every derived color', () => {
    for (const t of all)
      for (const [k, v] of Object.entries(themeToCssVars(t))) {
        if (v.startsWith('#')) expect(() => parseHex(v), k).not.toThrow();
      }
  });
});
