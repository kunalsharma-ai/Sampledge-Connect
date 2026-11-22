import { describe, expect, it } from 'vitest';
import { formatBytesShort, orgStateText, platformApi } from './platform';

describe('super admin console helpers', () => {
  it('describes an organization’s state', () => {
    expect(orgStateText({ status: 'active', deletionScheduledFor: null })).toEqual({
      text: 'Active',
      tone: 'ok',
    });
    expect(orgStateText({ status: 'suspended', deletionScheduledFor: null }).tone).toBe('warn');
    expect(
      orgStateText({ status: 'suspended', deletionScheduledFor: '2026-12-22T10:00:00.000Z' }).text,
    ).toMatch(/^Erased /);
  });

  it('formats storage', () => {
    expect(formatBytesShort(5 * 1024 ** 2)).toBe('5 MB');
    expect(formatBytesShort(3.25 * 1024 ** 3)).toBe('3.3 GB');
  });

  it('builds the same routes as the web, with an idempotency key on suspend', async () => {
    const calls: [string, string, unknown][] = [];
    const api = platformApi({
      platform: async <T>(m: string, p: string, b?: unknown) => {
        calls.push([m, p, b]);
        return {} as T;
      },
    });
    await api.orgs({ status: 'suspended', q: 'acme & co' });
    await api.suspend('t1', 'Unpaid');
    await api.audit({ area: 'admins', before: '1_a' });
    expect(calls[0]).toEqual([
      'GET',
      '/v1/platform/orgs?status=suspended&page=1&limit=25&q=acme%20%26%20co',
      undefined,
    ]);
    expect(calls[1]![1]).toBe('/v1/platform/orgs/t1/suspend');
    expect((calls[1]![2] as { clientActionId: string }).clientActionId).toHaveLength(36);
    expect(calls[2]![1]).toBe('/v1/platform/audit?limit=50&area=admins&before=1_a');
  });
});
