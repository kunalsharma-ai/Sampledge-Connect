import { Inject, Injectable } from '@nestjs/common';
import type { Db } from 'mongodb';
import { MONGO_DB } from '../database/database.module.js';
import { TenantCollection } from '../database/tenant-db.js';
import type {
  ApprovalDoc,
  IdentityLinkDoc,
  IntegrationEventDoc,
  LinkedRecordDoc,
  ModuleActionDoc,
  ModuleBotDoc,
  ModuleKeyDoc,
  ProjectDoc,
  TaskDoc,
  WebhookDeliveryDoc,
  WebhookSubscriptionDoc,
} from './docs.js';

interface WorkCollections {
  module_keys: ModuleKeyDoc;
  module_bots: ModuleBotDoc;
  integration_events: IntegrationEventDoc;
  identity_links: IdentityLinkDoc;
  linked_records: LinkedRecordDoc;
  module_actions: ModuleActionDoc;
  webhook_subscriptions: WebhookSubscriptionDoc;
  webhook_deliveries: WebhookDeliveryDoc;
  tasks: TaskDoc;
  approvals: ApprovalDoc;
  projects: ProjectDoc;
}

export type WorkDb = { [K in keyof WorkCollections]: TenantCollection<WorkCollections[K]> };

/** Tenant-scoped access to the integration and work collections. */
@Injectable()
export class WorkStore {
  constructor(@Inject(MONGO_DB) readonly raw: Db) {}

  for(tenantId: string): WorkDb {
    if (!tenantId) throw new Error('tenantId required');
    const names: (keyof WorkCollections)[] = [
      'module_keys',
      'module_bots',
      'integration_events',
      'identity_links',
      'linked_records',
      'module_actions',
      'webhook_subscriptions',
      'webhook_deliveries',
      'tasks',
      'approvals',
      'projects',
    ];
    return Object.fromEntries(
      names.map((n) => [n, new TenantCollection(this.raw.collection<{ _id: string; tenantId: string }>(n), tenantId)]),
    ) as unknown as WorkDb;
  }

  /** Cross-tenant lookups that resolve a tenant from a credential. Nothing else uses these. */
  get keysGlobal() {
    return this.raw.collection<ModuleKeyDoc>('module_keys');
  }
  get deliveriesGlobal() {
    return this.raw.collection<WebhookDeliveryDoc>('webhook_deliveries');
  }
}
