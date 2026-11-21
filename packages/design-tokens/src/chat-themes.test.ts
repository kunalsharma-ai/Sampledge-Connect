import { describe, expect, it } from 'vitest';
import { CHAT_THEME_VISUALS, chatThemeStyle } from './chat-themes.js';
import { contrastRatio } from './color.js';
import { THEME_IDS, getTheme } from './themes.js';

describe('chat themes', () => {
  it('has twenty themes', () => {
    expect(Object.keys(CHAT_THEME_VISUALS)).toHaveLength(20);
  });

  for (const appId of THEME_IDS.filter((t) => t !== 'custom-brand')) {
    it(`keeps text readable on every chat theme in ${appId}`, () => {
      const app = getTheme(appId);
      for (const id of Object.keys(CHAT_THEME_VISUALS)) {
        const s = chatThemeStyle(id, app.colors, app.mode);
        expect(
          contrastRatio(s.bubbleOwnFg, s.bubbleOwn),
          `${id} own bubble`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(app.colors.text, s.bubbleOther),
          `${id} other bubble`,
        ).toBeGreaterThanOrEqual(7);
        expect(
          contrastRatio(app.colors.textSubtle, s.base),
          `${id} meta text`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(s.background.endsWith(s.base)).toBe(true);
      }
    });
  }
});
