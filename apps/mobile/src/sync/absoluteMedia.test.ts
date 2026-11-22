import { describe, expect, it } from 'vitest';
import { withAbsoluteMedia } from './transport';

describe('withAbsoluteMedia', () => {
  it('makes relative status media links absolute, deep in a feed', () => {
    const feed = {
      mine: [{ statusId: 's1', media: { url: '/v1/files/a?sig=1', mimeType: 'image/jpeg' } }],
      people: [{ statuses: [{ media: { url: 'https://cdn.example/b' } }, { media: null }] }],
    };
    const r = withAbsoluteMedia(feed, 'http://api.test:4000');
    expect(r.mine[0]!.media.url).toBe('http://api.test:4000/v1/files/a?sig=1');
    expect(r.people[0]!.statuses[0]!.media!.url).toBe('https://cdn.example/b');
    expect(r.people[0]!.statuses[1]!.media).toBeNull();
  });
});
