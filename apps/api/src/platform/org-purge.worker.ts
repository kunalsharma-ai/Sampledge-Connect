import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { TenantDb } from '../database/tenant-db.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { PlatformAudit } from './platform-audit.service.js';

const HOUR = 3_600_000;
/** Collections without a tenantId (or that outlive organizations). Everything else is erased. */
const GLOBAL = new Set([
  'tenants',
  'billing_plans',
  'platform_admins',
  'platform_audit',
  'platform_settings',
  '_migrations',
  'attachment_files.files',
  'attachment_files.chunks',
]);

/**
 * Erases organizations whose scheduled deletion is due (docs/super-admin.md): every
 * document that carries the organization's tenantId, its stored files, then the
 * organization itself. One replica claims each organization, so two never erase the same one.
 */
@Injectable()
export class OrgPurgeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('OrgPurge');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: TenantDb,
    private readonly audit: PlatformAudit,
    private readonly realtime: RealtimePublisher,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  onModuleInit() {
    if (this.cfg.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.run().catch((e) => this.log.error(e)), HOUR);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Erases every organization due by `now`. Returns their ids. */
  async run(now = new Date()): Promise<string[]> {
    const done: string[] = [];
    for (;;) {
      const t = await this.db.tenants.findOneAndUpdate(
        {
          'deletion.scheduledFor': { $lte: now },
          kind: { $ne: 'network' },
          $or: [
            { 'deletion.purgingAt': null },
            { 'deletion.purgingAt': { $lt: new Date(Date.now() - 6 * HOUR) } },
          ],
        },
        { $set: { 'deletion.purgingAt': new Date() } },
        { returnDocument: 'after' },
      );
      if (!t) return done;
      await this.erase(t._id);
      await this.audit.record({
        ctx: null,
        action: 'platform.org_purged',
        tenantId: t._id,
        target: { type: 'tenant', id: t._id, label: t.name },
        metadata: { orgName: t.name, slug: t.slug },
      });
      this.realtime.toPlatform('platform:changed', { area: 'orgs', tenantId: t._id });
      this.log.log(`Erased organization ${t.slug}`);
      done.push(t._id);
    }
  }

  private async erase(tenantId: string) {
    const raw = this.db.raw;
    const files = raw.collection<{ _id: unknown }>('attachment_files.files');
    const ids = (
      await files.find({ 'metadata.tenantId': tenantId }, { projection: { _id: 1 } }).toArray()
    ).map((f) => f._id);
    for (let i = 0; i < ids.length; i += 500) {
      const batch = ids.slice(i, i + 500);
      await raw.collection('attachment_files.chunks').deleteMany({ files_id: { $in: batch } });
      await files.deleteMany({ _id: { $in: batch } });
    }
    const names = (await raw.listCollections({}, { nameOnly: true }).toArray())
      .map((c) => c.name)
      .filter((n) => !GLOBAL.has(n) && !n.startsWith('system.'));
    for (const n of names) await raw.collection(n).deleteMany({ tenantId });
    await this.db.platformAdmins.deleteMany({ tenantId });
    await this.db.tenants.deleteOne({ _id: tenantId });
  }
}
