import { describe, expect, it } from 'vitest';
import {
  GREETING_CATEGORIES,
  GREETING_OCCASIONS,
  GreetingCardSchema,
  MAX_MESSAGE_LENGTH,
  greetingAllowed,
  greetingOf,
  greetingPreview,
  offeredOccasions,
  searchOccasions,
  upcomingOccasions,
  type GreetingOccasion,
} from './index.js';

const all = GREETING_OCCASIONS as readonly GreetingOccasion[];

describe('greeting catalogue', () => {
  it('has unique ids, a headline and at least three messages per occasion', () => {
    expect(new Set(all.map((o) => o.id)).size).toBe(all.length);
    for (const o of all) {
      expect(o.titles.length, o.id).toBeGreaterThan(0);
      expect(o.messages.length, o.id).toBeGreaterThanOrEqual(3);
      for (const t of o.titles) expect(t.length, o.id).toBeLessThanOrEqual(80);
      for (const m of o.messages) {
        expect(m.text.length).toBeGreaterThan(20);
        expect(m.text.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
      }
    }
  });

  it('covers Indian festivals prominently, and every category', () => {
    const india = all.filter((o) => o.category === 'india').map((o) => o.id);
    for (const id of ['diwali', 'holi', 'eid-ul-fitr', 'raksha-bandhan', 'onam', 'pongal'])
      expect(india).toContain(id);
    for (const c of GREETING_CATEGORIES) expect(all.some((o) => o.category === c.id)).toBe(true);
  });

  it('covers festivals and special days around the world', () => {
    const ids = (cat: string) => all.filter((o) => o.category === cat).map((o) => o.id);
    for (const id of [
      'lunar-new-year',
      'hanukkah',
      'mid-autumn',
      'rosh-hashanah',
      'kwanzaa',
      'day-of-the-dead',
      'songkran',
    ])
      expect(ids('world')).toContain(id);
    for (const id of ['earth-day', 'yoga-day', 'mental-health-day', 'national-day'])
      expect(ids('days')).toContain(id);
    expect(searchOccasions(all, 'dia de muertos').map((o) => o.id)).toContain('day-of-the-dead');
    expect(searchOccasions(all, 'mooncake').map((o) => o.id)).toContain('mid-autumn');
  });

  it('keeps condolences quiet and free of playful messages', () => {
    const c = all.find((o) => o.id === 'condolence')!;
    expect(c.quiet).toBe(true);
    expect(c.messages.some((m) => m.tone === 'playful')).toBe(false);
  });

  it('applies the organization policy', () => {
    const policy = { enabled: true, hiddenCategories: ['india' as const] };
    expect(greetingAllowed(policy, 'diwali')).toBe(false);
    expect(greetingAllowed(policy, 'birthday')).toBe(true);
    expect(greetingAllowed({ enabled: false, hiddenCategories: [] }, 'birthday')).toBe(false);
    expect(offeredOccasions(policy).some((o) => o.category === 'india')).toBe(false);
  });

  it('finds festivals coming up and searches keywords', () => {
    const nov = upcomingOccasions(all, new Date('2026-11-05T12:00:00Z')).map((o) => o.id);
    expect(nov).toContain('diwali');
    expect(nov).toContain('christmas'); // next month
    expect(nov).not.toContain('holi');
    expect(searchOccasions(all, 'deepavali').map((o) => o.id)).toEqual(['diwali']);
    expect(searchOccasions(all, 'RAKHI').map((o) => o.id)).toContain('raksha-bandhan');
  });

  it('parses cards on messages and builds previews', () => {
    const card = GreetingCardSchema.parse({
      occasionId: 'holi',
      styleId: 'festive',
      title: ' Happy Holi ',
    });
    expect(card).toEqual({ occasionId: 'holi', styleId: 'festive', title: 'Happy Holi', to: null });
    expect(greetingOf({ metadata: { greeting: card } })).toEqual(card);
    expect(greetingOf({ metadata: { greeting: { occasionId: 'x' } } })).toBeNull();
    expect(greetingPreview(card, 'Rang barse!')).toBe('🎨 Happy Holi: Rang barse!');
  });
});
