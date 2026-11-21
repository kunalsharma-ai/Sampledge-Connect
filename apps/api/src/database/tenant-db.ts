import {
  ObjectId,
  type AggregateOptions,
  type Collection,
  type CountDocumentsOptions,
  type Db,
  type Document,
  type Filter,
  type FindOneAndUpdateOptions,
  type FindOptions,
  type UpdateFilter,
  type UpdateOptions,
} from 'mongodb';
import type { TenantCollections, TenantDoc } from './documents.js';

export const newId = (): string => new ObjectId().toHexString();

type Owned = { _id: string; tenantId: string };
type Insert<T extends Owned> = Omit<T, 'tenantId' | '_id'> & { _id?: string };

/**
 * A collection view bound to one tenant. Every read adds `tenantId` to the
 * filter and every write stamps it, so feature code cannot forget it.
 * This class is the only way feature modules touch tenant data.
 */
export class TenantCollection<T extends Owned> {
  constructor(
    private readonly col: Collection<T>,
    readonly tenantId: string,
  ) {}

  private scope(filter: Filter<T> = {}): Filter<T> {
    if ('tenantId' in filter && (filter as { tenantId?: unknown }).tenantId !== this.tenantId) {
      throw new Error('Cross-tenant filter rejected');
    }
    return { ...filter, tenantId: this.tenantId } as Filter<T>;
  }

  find(filter: Filter<T> = {}, options?: FindOptions) {
    return this.col.find(this.scope(filter), options);
  }
  findOne(filter: Filter<T>, options?: FindOptions) {
    return this.col.findOne(this.scope(filter), options);
  }
  countDocuments(filter: Filter<T> = {}, options?: CountDocumentsOptions) {
    return this.col.countDocuments(this.scope(filter), options);
  }
  async insertOne(doc: Insert<T>): Promise<T> {
    const full = { ...doc, _id: doc._id ?? newId(), tenantId: this.tenantId } as unknown as T;
    await this.col.insertOne(full as never);
    return full;
  }
  async insertMany(docs: Insert<T>[]): Promise<T[]> {
    if (docs.length === 0) return [];
    const full = docs.map(
      (d) => ({ ...d, _id: d._id ?? newId(), tenantId: this.tenantId }) as unknown as T,
    );
    await this.col.insertMany(full as never[]);
    return full;
  }
  updateOne(filter: Filter<T>, update: UpdateFilter<T>, options?: UpdateOptions) {
    return this.col.updateOne(
      this.scope(filter),
      this.guardUpdate(update, options?.upsert),
      options,
    );
  }
  updateMany(filter: Filter<T>, update: UpdateFilter<T>) {
    return this.col.updateMany(this.scope(filter), this.guardUpdate(update));
  }
  findOneAndUpdate(
    filter: Filter<T>,
    update: UpdateFilter<T>,
    options: FindOneAndUpdateOptions = {},
  ) {
    return this.col.findOneAndUpdate(
      this.scope(filter),
      this.guardUpdate(update, options.upsert),
      options,
    );
  }
  deleteMany(filter: Filter<T>) {
    return this.col.deleteMany(this.scope(filter));
  }
  aggregate<R extends Document>(pipeline: Document[], options?: AggregateOptions) {
    return this.col.aggregate<R>([{ $match: { tenantId: this.tenantId } }, ...pipeline], options);
  }

  /** Updates may never change tenantId. Upserts inherit it from the scoped filter. */
  private guardUpdate(update: UpdateFilter<T>, upsert = false): UpdateFilter<T> {
    const u = update as Record<string, Record<string, unknown> | undefined>;
    for (const op of ['$set', '$unset', '$rename'] as const) {
      if (u[op] && 'tenantId' in u[op]!) throw new Error('tenantId is immutable');
    }
    if (u.$setOnInsert && 'tenantId' in u.$setOnInsert) throw new Error('tenantId is immutable');
    // Our ids are ObjectId hex strings; without this an upsert would insert a BSON ObjectId _id.
    if (upsert)
      return {
        ...update,
        $setOnInsert: { _id: newId(), ...(u.$setOnInsert ?? {}) },
      } as UpdateFilter<T>;
    return update;
  }
}

export type ScopedDb = { [K in keyof TenantCollections]: TenantCollection<TenantCollections[K]> };

export class TenantDb {
  constructor(private readonly db: Db) {}

  /** Global (non-tenant) collection. Only auth/tenancy bootstrap code uses this. */
  get tenants(): Collection<TenantDoc> {
    return this.db.collection<TenantDoc>('tenants');
  }

  /**
   * Today every tenant lives in the shared database. A dedicated-database
   * tenant would resolve to a different `Db` here, without changing callers.
   */
  for(tenantId: string): ScopedDb {
    if (!tenantId) throw new Error('tenantId required');
    const c = <K extends keyof TenantCollections>(name: K) =>
      new TenantCollection<TenantCollections[K]>(
        this.db.collection<TenantCollections[K]>(name),
        tenantId,
      );
    return {
      users: c('users'),
      memberships: c('memberships'),
      workspaces: c('workspaces'),
      conversations: c('conversations'),
      conversation_members: c('conversation_members'),
      messages: c('messages'),
      message_receipts: c('message_receipts'),
      devices: c('devices'),
      sync_checkpoints: c('sync_checkpoints'),
      audit_logs: c('audit_logs'),
      attachments: c('attachments'),
      notifications: c('notifications'),
      calls: c('calls'),
      meetings: c('meetings'),
      user_settings: c('user_settings'),
      tenant_settings: c('tenant_settings'),
      bookmarks: c('bookmarks'),
      scheduled_messages: c('scheduled_messages'),
    };
  }
}
