import { Injectable } from '@nestjs/common';
import type { TenantContext } from '../common/tenant-context.js';
import { RecordsService } from '../integrations/records.service.js';
import type { LinkedRecordResolver } from './linked-records.js';

/**
 * Verifies inbox links against the records Connect has received from SampForce and Samptrek.
 * A record Connect has not seen yet stays "unverified" rather than being rejected, since the
 * module may simply not have sent an event for it. Restricted records are never revealed to
 * inbox agents: the link keeps what the agent typed and stays unverified.
 */
@Injectable()
export class ModuleRecordsResolver implements LinkedRecordResolver {
  constructor(private readonly records: RecordsService) {}

  async resolve(
    ctx: TenantContext,
    module: 'sampforce' | 'samptrek',
    recordType: string,
    externalId: string,
  ) {
    const r = await this.records.findRecord(ctx.tenantId, module, recordType, externalId);
    if (!r || r.sensitivity === 'restricted') return undefined;
    return { label: r.title, url: r.url };
  }
}
