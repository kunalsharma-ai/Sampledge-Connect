import { describe, expect, it } from 'vitest';
import { BASE, contrast, customTheme, THEMES } from './themes';

describe('themes', () => {
  it('uses the exact brand values from the spec', () => {
    expect(THEMES.midnight.colors.background).toBe('#080F1F');
    expect(THEMES.arctic.colors.accent).toBe('#2563EB');
    expect(THEMES.graphite.colors.accentSecondary).toBe('#D4B483');
    expect(THEMES.emerald.colors.text).toBe('#ECFDF5');
    expect(Object.keys(BASE)).toHaveLength(4);
  });

  it.each(Object.values(THEMES))('$name keeps text readable (WCAG)', (t) => {
    const c = t.colors;
    expect(contrast(c.text, c.background)).toBeGreaterThanOrEqual(7);
    expect(contrast(c.textMuted, c.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.textSubtle, c.background)).toBeGreaterThanOrEqual(3);
    expect(contrast(c.bubbleOwnText, c.bubbleOwn)).toBeGreaterThanOrEqual(3);
  });

  it('builds light and dark custom brand themes and rejects invalid colours', () => {
    const dark = customTheme({
      primary: '#FF6A00',
      secondary: '#00B3A4',
      dark: true,
      workspaceName: 'Acme',
    });
    const light = customTheme({ primary: '#FFE600', secondary: '#00B3A4', dark: false });
    expect(dark.dark).toBe(true);
    expect(dark.name).toBe('Acme brand');
    expect(light.dark).toBe(false);
    // A very light brand yellow is darkened enough to stay visible on white.
    expect(contrast(light.colors.accent, light.colors.surface)).toBeGreaterThanOrEqual(3);
    expect(
      customTheme({ primary: 'red', secondary: '#zzz', dark: true }).colors.accentSecondary,
    ).toBe(BASE.midnight.accentSecondary);
  });
});
