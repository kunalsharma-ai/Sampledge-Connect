import { describe, expect, it } from 'vitest';
import {
  FEATURE_HELP,
  FEATURE_HELP_CATEGORIES,
  featureHelp,
  searchFeatureHelp,
} from './feature-help.js';

describe('feature help', () => {
  it('has unique ids and complete guides', () => {
    const ids = FEATURE_HELP.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of FEATURE_HELP) {
      expect(FEATURE_HELP_CATEGORIES).toContain(e.category);
      expect(e.summary.length).toBeLessThanOrEqual(110);
      expect(e.what && e.why && e.where.web && e.where.mobile).toBeTruthy();
      expect(e.how.length).toBeGreaterThanOrEqual(2);
      expect(e.how.length).toBeLessThanOrEqual(5);
    }
  });

  it('only links to guides that exist', () => {
    for (const e of FEATURE_HELP)
      for (const r of ('related' in e ? e.related : []) as readonly string[]) {
        expect(featureHelp(r), `${e.id} -> ${r}`).toBeDefined();
        expect(r).not.toBe(e.id);
      }
  });

  it('searches titles before body text', () => {
    expect(searchFeatureHelp('')).toHaveLength(FEATURE_HELP.length);
    expect(searchFeatureHelp('booking')[0]!.id).toBe('booking-pages');
    expect(searchFeatureHelp('zzzz-nothing')).toHaveLength(0);
  });
});

describe('help FAQs', () => {
  it('have unique ids and link to guides that exist', async () => {
    const { HELP_FAQS, searchFaqs } = await import('./help-faq.js');
    expect(new Set(HELP_FAQS.map((f) => f.id)).size).toBe(HELP_FAQS.length);
    for (const f of HELP_FAQS)
      if (f.featureId) expect(featureHelp(f.featureId), f.id).toBeDefined();
    expect(searchFaqs('record')[0]!.id).toBe('record');
  });
});
