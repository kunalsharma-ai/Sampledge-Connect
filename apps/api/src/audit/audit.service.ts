import { Injectable, Logger } from '@nestjs/common';
import { TenantDb } from '../database/tenant-db.js';

export interface AuditEvent {
  tenantId: string;
  actorId: string | null;
  action: string;
  target?: { type: string; id: string } | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

/** Append-only audit trail for security-relevant actions. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');
  constructor(private readonly db: TenantDb) {}

  async record(e: AuditEvent): Promise<void> {
    try {
      await this.db.for(e.tenantId).audit_logs.insertOne({
        actorId: e.actorId,
        action: e.action,
        target: e.target ?? null,
        ip: e.ip ?? null,
        userAgent: e.userAgent?.slice(0, 300) ?? null,
        at: new Date(),
        metadata: e.metadata ?? {},
      });
    } catch (err) {
      // Audit failures must be visible but must not break the user action.
      this.logger.error(`Failed to write audit event ${e.action}: ${(err as Error).message}`);
    }
  }

  async list(tenantId: string, limit = 100) {
    return this.db
      .for(tenantId)
      .audit_logs.find({}, { sort: { at: -1 }, limit: Math.min(limit, 500) })
      .toArray();
  }
}
