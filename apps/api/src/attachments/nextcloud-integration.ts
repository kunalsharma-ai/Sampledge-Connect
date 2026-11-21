import { Injectable, type OnModuleInit } from '@nestjs/common';
import { TenantDb } from '../database/tenant-db.js';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service.js';
import { NEXTCLOUD_PROVIDER, NextcloudClient, nextcloudConfig } from './nextcloud.js';

/** Registers the Nextcloud provider and its connection test (write, read back, delete). */
@Injectable()
export class NextcloudIntegration implements OnModuleInit {
  constructor(
    private readonly settings: IntegrationSettingsService,
    private readonly db: TenantDb,
  ) {}

  onModuleInit() {
    this.settings.register(NEXTCLOUD_PROVIDER, {
      test: async (values, tenantId) => {
        const cfg = nextcloudConfig(values);
        if (!cfg) return { ok: false, message: 'Fill in the address, user name and app password' };
        const folder = await new NextcloudClient(cfg).roundTrip();
        let message = `Wrote, read back and deleted a test file in ${folder}.`;
        if (tenantId) {
          const t = this.db.for(tenantId).attachments;
          const [copied, failed, live] = await Promise.all([
            t.countDocuments({ 'storage.mirror.status': 'copied' }),
            t.countDocuments({ 'storage.mirror.status': 'failed' }),
            t.countDocuments({ 'storage.backend': 'nextcloud', deletedAt: null }),
          ]);
          message +=
            cfg.mode === 'test'
              ? ` Test mode: ${copied} file${copied === 1 ? '' : 's'} copied, ${failed} failed.`
              : ` Live: ${live} file${live === 1 ? '' : 's'} stored in Nextcloud${failed ? `, ${failed} kept in Connect after a failure` : ''}.`;
        }
        return { ok: true, message };
      },
    });
  }
}
