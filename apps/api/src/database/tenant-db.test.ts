import { describe, expect, it, vi } from 'vitest';
import type { Collection } from 'mongodb';
import { TenantCollection } from './tenant-db.js';

function fakeCollection() {
  return {
    find: vi.fn(() => ({ toArray: async () => [] })),
    findOne: vi.fn(async () => null),
    insertOne: vi.fn(async () => ({})),
    updateOne: vi.fn(async () => ({})),
    findOneAndUpdate: vi.fn(async () => null),
    aggregate: vi.fn(() => ({})),
  };
}

describe('TenantCollection', () => {
  it('adds tenantId to every read filter', async () => {
    const col = fakeCollection();
    const t = new TenantCollection(
      col as unknown as Collection<{ _id: string; tenantId: string }>,
      'tA',
    );
    await t.findOne({ _id: 'x' });
    t.find({});
    t.aggregate([{ $limit: 1 }]);
    expect(col.findOne).toHaveBeenCalledWith({ _id: 'x', tenantId: 'tA' }, undefined);
    expect(col.find).toHaveBeenCalledWith({ tenantId: 'tA' }, undefined);
    expect(col.aggregate).toHaveBeenCalledWith(
      [{ $match: { tenantId: 'tA' } }, { $limit: 1 }],
      undefined,
    );
  });

  it('rejects filters that name another tenant', () => {
    const t = new TenantCollection(fakeCollection() as never, 'tA');
    expect(() => t.find({ tenantId: 'tB' } as never)).toThrow(/Cross-tenant/);
  });

  it('stamps tenantId on inserts, overriding any supplied value', async () => {
    const col = fakeCollection();
    const t = new TenantCollection<{ _id: string; tenantId: string; v: number }>(
      col as never,
      'tA',
    );
    const doc = await t.insertOne({ v: 1, tenantId: 'tB' } as never);
    expect(doc.tenantId).toBe('tA');
    expect(typeof doc._id).toBe('string');
  });

  it('forbids changing tenantId and gives upserts a string _id', async () => {
    const col = fakeCollection();
    const t = new TenantCollection<{ _id: string; tenantId: string; v: number }>(
      col as never,
      'tA',
    );
    expect(() => t.updateOne({}, { $set: { tenantId: 'tB' } })).toThrow(/immutable/);
    await t.updateOne({ v: 1 }, { $set: { v: 2 } }, { upsert: true });
    const update = (col.updateOne.mock.calls[0] as unknown[])[1] as {
      $setOnInsert: { _id: unknown };
    };
    expect(typeof update.$setOnInsert._id).toBe('string');
  });
});
